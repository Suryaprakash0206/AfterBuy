import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { idSchema } from "../../../../shared/domain.js";
import { config } from "../../config.js";
import { result } from "../../lib/db.js";
import { askProduct } from "./service.js";
export const aiRoutes = Router({ mergeParams: true });
const limit = rateLimit({
  windowMs: 60000,
  limit: config.AI_REQUESTS_PER_MINUTE,
  keyGenerator: (req) => req.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) =>
    res
      .status(429)
      .json({
        error: {
          code: "AI_RATE_LIMIT",
          message: "Please wait a minute before asking another question.",
          requestId: req.requestId,
        },
      }),
});
aiRoutes.post("/products/:id/assistant", limit, async (req, res) =>
  res.json(
    await askProduct(
      req.db,
      req.workspaceId,
      req.userId,
      idSchema.parse(req.params.id),
      z.object({ question: z.string().trim().min(1).max(2000) }).parse(req.body)
        .question,
    ),
  ),
);
aiRoutes.get("/products/:id/assistant", async (req, res) => {
  const c = await result(
    req.db
      .from("conversations")
      .select("id")
      .eq("workspace_id", req.workspaceId)
      .eq("user_id", req.userId)
      .eq("product_id", idSchema.parse(req.params.id))
      .maybeSingle(),
  );
  res.json(
    c
      ? await result(
          req.db
            .from("messages")
            .select("*")
            .eq("workspace_id", req.workspaceId)
            .eq("conversation_id", c.id)
            .order("created_at")
            .limit(100),
        )
      : [],
  );
});
