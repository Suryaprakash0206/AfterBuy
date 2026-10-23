import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function required<T>(
  v: T | null | undefined,
  message = "Record not found",
): T {
  if (v == null) throw new AppError(404, "NOT_FOUND", message);
  return v;
}
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return _next(err);
  const validation = err instanceof ZodError;
  const status = validation
    ? 400
    : err instanceof AppError
      ? err.status
      : err.code === "LIMIT_FILE_SIZE"
        ? 413
        : 500;
  const code = validation
    ? "VALIDATION"
    : err instanceof AppError
      ? err.code
      : err.code === "LIMIT_FILE_SIZE"
        ? "FILE_TOO_LARGE"
        : "INTERNAL";
  if (status >= 500)
    logger.error(
      { requestId: req.requestId, code, kind: err.name },
      "Request failed",
    );
  res.status(status).json({
    error: {
      code,
      message: validation
        ? err.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
        : status === 500
          ? "The request could not be completed. Try again or check the server diagnostics."
          : err.message,
      requestId: req.requestId,
    },
  });
};
