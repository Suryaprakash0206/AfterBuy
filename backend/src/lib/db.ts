import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, capabilities } from "../config.js";
import { AppError } from "./errors.js";
const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
export function userClient(token: string) {
  if (!capabilities().database)
    throw new AppError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Configure the backend Supabase URL and publishable key.",
    );
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: authOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
let privileged: SupabaseClient | undefined;
export function adminClient() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY)
    throw new AppError(
      503,
      "WORKER_NOT_CONFIGURED",
      "This operation needs the backend Supabase service credential.",
    );
  return (privileged ??= createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: authOptions },
  ));
}
export async function result<T>(
  query: PromiseLike<{ data: T; error: any }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01")
      throw new AppError(
        503,
        "MIGRATIONS_REQUIRED",
        "Apply the AfterBuy SQL migrations to this Supabase project before continuing.",
      );
    if (error.code === "42501")
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have permission for this operation.",
      );
    if (error.code === "PGRST116")
      throw new AppError(404, "NOT_FOUND", "Record not found.");
    if (
      ["23505", "23503", "23514", "22P02", "22007", "P0001"].includes(
        error.code,
      )
    )
      throw new AppError(
        409,
        "CONFLICT",
        error.code === "P0001"
          ? error.message
          : "The record conflicts with existing data or an invalid relationship.",
      );
    throw new AppError(
      503,
      "DATABASE_ERROR",
      "Database request failed. Check that migrations have been applied.",
    );
  }
  return data as NonNullable<T>;
}
export const productFields =
  "id,workspace_id,name,category,brand,model,serial_number,seller,purchase_date,delivery_date,price::text,currency,location,notes,archived_at,created_at,updated_at";
export const eventFields =
  "id,workspace_id,case_id,kind,note,occurred_on,amount::text,currency,status,replacement_details,created_at";
