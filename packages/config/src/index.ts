import { z } from "zod";

const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  QDRANT_URL: z.url(),
  QDRANT_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  PLATFORM_ORIGIN: z.url(),
  STORAGE_ROOT: z.string().min(1).default("./storage"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
  OCR_LANGUAGES: z.string().default("ind+eng"),
  ANVIA_LENS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ANVIA_LENS_URL: optionalUrl,
  CLASSIFIER_MODEL_ID: z
    .enum(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"])
    .default("gpt-5.6-sol"),
  OVERLAP_MODEL_ID: z
    .enum(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"])
    .default("gpt-5.6-sol"),
});

const browserSchema = z.object({ VITE_API_URL: z.url() });

export type ServerConfig = z.infer<typeof serverSchema>;
export type BrowserConfig = z.infer<typeof browserSchema>;

export function parseServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  return serverSchema.parse(environment);
}

export function parseBrowserConfig(environment: Record<string, unknown>): BrowserConfig {
  return browserSchema.parse(environment);
}
