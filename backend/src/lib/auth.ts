import type { RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { userClient, result } from "./db.js";
import { AppError } from "./errors.js";
import { idSchema, type Role } from "../../../shared/domain.js";
declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    db: SupabaseClient;
    userId: string;
    workspaceId: string;
    role: Role;
  }
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer "))
    throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const token = authorization.slice(7);
  req.db = userClient(token);
  // getUser verifies the token with Supabase Auth; decoded client claims are never trusted.
  const { data, error } = await req.db.auth.getUser(token);
  if (isAuthRetryableFetchError(error))
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "The sign-in service is temporarily unavailable. Please try again shortly.",
    );
  if (error || !data.user)
    throw new AppError(
      401,
      "SESSION_EXPIRED",
      "Your session expired. Sign in again.",
    );
  req.userId = data.user.id;
  next();
};
export const workspaceAccess: RequestHandler = async (req, _res, next) => {
  req.workspaceId = idSchema.parse(req.params.workspaceId);
  const member = await result(
    req.db
      .from("memberships")
      .select("role")
      .eq("workspace_id", req.workspaceId)
      .eq("user_id", req.userId)
      .maybeSingle(),
  );
  if (!member)
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have access to this workspace.",
    );
  req.role = member.role;
  next();
};
export const editAccess: RequestHandler = (req, _res, next) => {
  if (req.role === "viewer")
    throw new AppError(
      403,
      "READ_ONLY",
      "Viewers cannot change workspace records.",
    );
  next();
};
export const ownerAccess: RequestHandler = (req, _res, next) => {
  if (req.role !== "owner")
    throw new AppError(
      403,
      "OWNER_REQUIRED",
      "Only the workspace owner can manage members.",
    );
  next();
};
