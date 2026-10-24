import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export function authError(error: unknown): unknown {
  if (
    isAuthRetryableFetchError(error) ||
    (error instanceof TypeError &&
      /fetch|network|load failed/i.test(error.message))
  ) {
    return new Error(
      "Could not reach the sign-in service. Check your internet connection and try again. If this continues, check that your Supabase project is running.",
    );
  }
  return error;
}
