import { z } from "zod";
const schema = z.object({
  PORT: z.coerce.number().default(3001),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_PUBLISHABLE_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_EXTRACTION_MODEL: z.string().default(""),
  OPENAI_CHAT_MODEL: z.string().default(""),
  OPENAI_EMBEDDING_MODEL: z.string().default(""),
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .refine(
      (v) => v === 1536,
      "Schema requires 1536 dimensions; migrate and reindex to change it",
    )
    .default(1536),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(20971520)
    .default(20971520),
  MAX_PDF_PAGES: z.coerce.number().int().min(1).max(40).default(40),
  AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(16000)
    .default(6000),
  AI_MAX_INPUT_CHARS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(200000)
    .default(80000),
  AI_DAILY_UNITS: z.coerce.number().int().positive().default(500000),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EMAIL_PROVIDER: z.enum(["disabled", "resend"]).default("disabled"),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
});
export const config = schema.parse(process.env);
export const capabilities = () => ({
  database: !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY),
  extraction: !!(
    config.OPENAI_API_KEY &&
    config.OPENAI_EXTRACTION_MODEL &&
    config.SUPABASE_SERVICE_ROLE_KEY
  ),
  assistant: !!(
    config.OPENAI_API_KEY &&
    config.OPENAI_CHAT_MODEL &&
    config.OPENAI_EMBEDDING_MODEL &&
    config.SUPABASE_SERVICE_ROLE_KEY
  ),
  email:
    config.EMAIL_PROVIDER === "resend" &&
    !!(config.RESEND_API_KEY && config.EMAIL_FROM),
});
