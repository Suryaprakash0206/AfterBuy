import { createClient } from "@supabase/supabase-js";
export const configured = !!(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);
export const supabase = configured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    )
  : null;
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId?: string,
    public details?: any,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; blob?: boolean } = {},
): Promise<T> {
  const session = await supabase?.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.data.session)
    headers.Authorization = `Bearer ${session.data.session.access_token}`;
  const isForm = options.body instanceof FormData;
  if (options.body && !isForm) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL || "/api/v1"}${path}`,
      {
        method: options.method || "GET",
        headers,
        body: options.body
          ? isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body)
          : undefined,
      },
    );
  } catch {
    throw new ApiError(
      "Could not reach AfterBuy. Check your connection and that the backend is running.",
      "NETWORK",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401)
      await supabase?.auth.signOut({ scope: "local" });
    throw new ApiError(
      body.error?.message || "The request failed.",
      body.error?.code || "REQUEST_FAILED",
      body.error?.requestId,
      body,
    );
  }
  return options.blob ? ((await response.blob()) as T) : response.json();
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const money = (
  value: string | number | null | undefined,
  currency = "INR",
) =>
  value == null
    ? "Not recorded"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(Number(value));
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value))
    : "Not recorded";
