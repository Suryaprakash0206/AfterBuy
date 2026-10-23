import express from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { config, capabilities } from "./config.js";
import { errorHandler, AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { authenticate, workspaceAccess } from "./lib/auth.js";
import { accountRoutes, householdRoutes } from "./modules/workspaces/routes.js";
import { productRoutes } from "./modules/products/routes.js";
import { coverageRoutes } from "./modules/coverage/routes.js";
import { documentRoutes } from "./modules/documents/routes.js";
import { caseRoutes } from "./modules/cases/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { reminderRoutes } from "./modules/reminders/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    res.on("finish", () =>
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
        },
        "Request",
      ),
    );
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: config.FRONTEND_ORIGIN,
      exposedHeaders: ["Content-Disposition", "X-Request-Id"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).json({
          error: {
            code: "RATE_LIMIT",
            message: "Too many requests. Please wait a minute.",
            requestId: req.requestId,
          },
        }),
    }),
  );
  app.get("/api/v1/health", (_req, res) =>
    res.json({ status: "ok", service: "afterbuy-api" }),
  );
  app.get("/api/v1/config", (_req, res) =>
    res.json({
      ...capabilities(),
      max_file_bytes: config.MAX_FILE_BYTES,
      max_pages: config.MAX_PDF_PAGES,
    }),
  );
  app.get("/api/v1/ready", async (_req, res) => {
    let database = false;
    if (capabilities().database) {
      try {
        const response = await fetch(
          `${config.SUPABASE_URL}/rest/v1/workspaces?select=id&limit=0`,
          {
            headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY },
            signal: AbortSignal.timeout(3000),
          },
        );
        // An anonymous RLS/table-grant denial proves the table exists. An
        // invalid API key also returns 401, but must never report readiness.
        database = response.ok;
        if (response.status === 401 || response.status === 403) {
          const body = (await response.json().catch(() => ({}))) as {
            code?: string;
          };
          database = body.code === "42501";
        }
      } catch {
        /* Unreachable dependency is reported below. */
      }
    }
    res.status(database ? 200 : 503).json({
      status: database ? "ready" : "not_ready",
      database,
      configured: capabilities(),
      workers:
        "Run the separate worker process; database document and delivery states show job progress.",
    });
  });
  app.use("/api/v1", authenticate);
  app.use("/api/v1", accountRoutes);
  const ws = express.Router({ mergeParams: true });
  ws.use(
    workspaceAccess,
    householdRoutes,
    productRoutes,
    coverageRoutes,
    documentRoutes,
    caseRoutes,
    aiRoutes,
    reminderRoutes,
    analyticsRoutes,
  );
  app.use("/api/v1/workspaces/:workspaceId", ws);
  app.use((_req, _res) => {
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  });
  app.use(errorHandler);
  return app;
}
