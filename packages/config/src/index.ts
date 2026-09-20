import { DEFAULT_RUNTIME_MODEL_ID } from "@iom/contracts";
import { z } from "zod";

const optionalUrl = z
  .union([z.url(), z.literal("")])
  .transform((value) => value || undefined)
  .optional();

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value : undefined));

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const serverSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    QDRANT_URL: z.url(),
    QDRANT_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
    COOKIE_SECRET: z.string().min(32),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    PLATFORM_ORIGIN: z.url(),
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    STORAGE_ROOT: z.string().min(1).default("./storage"),
    R2_ACCOUNT_ID: optionalText,
    R2_ACCESS_KEY_ID: optionalSecret,
    R2_SECRET_ACCESS_KEY: optionalSecret,
    R2_BUCKET_NAME: optionalText,
    R2_ENDPOINT: optionalUrl,
    MODEL_CACHE_ROOT: z.string().min(1).default("./models"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
    JOB_LEASE_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
    WORKER_AI_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(600_000).default(120_000),
    OCR_LANGUAGES: z.string().default("ind+eng"),
    ANVIA_LENS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ANVIA_LENS_URL: optionalUrl,
    LANGFUSE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LANGFUSE_PUBLIC_KEY: optionalSecret,
    LANGFUSE_SECRET_KEY: optionalSecret,
    LANGFUSE_BASE_URL: z.url().default("https://cloud.langfuse.com"),
    LANGFUSE_ENVIRONMENT: z.string().trim().min(1).default("development"),
    LANGFUSE_RELEASE: z.string().trim().min(1).default("local"),
    LANGFUSE_CAPTURE_MODE: z.literal("full").default("full"),
    LANGFUSE_CAPTURE_MAX_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    OBSERVABILITY_ID_SECRET: optionalSecret,
  })
  .superRefine((value, context) => {
    const hasPublic = value.LANGFUSE_PUBLIC_KEY !== undefined;
    const hasSecret = value.LANGFUSE_SECRET_KEY !== undefined;
    if (hasPublic !== hasSecret) {
      context.addIssue({
        code: "custom",
        message: "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must both be set or both omitted.",
      });
    }
    if (value.STORAGE_DRIVER === "r2") {
      if (!value.R2_BUCKET_NAME) {
        context.addIssue({
          code: "custom",
          path: ["R2_BUCKET_NAME"],
          message: "R2_BUCKET_NAME is required when STORAGE_DRIVER=r2.",
        });
      }
      if (!value.R2_ACCESS_KEY_ID) {
        context.addIssue({
          code: "custom",
          path: ["R2_ACCESS_KEY_ID"],
          message: "R2_ACCESS_KEY_ID is required when STORAGE_DRIVER=r2.",
        });
      }
      if (!value.R2_SECRET_ACCESS_KEY) {
        context.addIssue({
          code: "custom",
          path: ["R2_SECRET_ACCESS_KEY"],
          message: "R2_SECRET_ACCESS_KEY is required when STORAGE_DRIVER=r2.",
        });
      }
      if (!value.R2_ACCOUNT_ID && !value.R2_ENDPOINT) {
        context.addIssue({
          code: "custom",
          path: ["R2_ACCOUNT_ID"],
          message: "R2_ACCOUNT_ID or R2_ENDPOINT is required when STORAGE_DRIVER=r2.",
        });
      }
    }
    if (!value.LANGFUSE_ENABLED) return;
    if (!value.LANGFUSE_PUBLIC_KEY) {
      context.addIssue({
        code: "custom",
        path: ["LANGFUSE_PUBLIC_KEY"],
        message: "LANGFUSE_PUBLIC_KEY is required when LANGFUSE_ENABLED=true.",
      });
    }
    if (!value.LANGFUSE_SECRET_KEY) {
      context.addIssue({
        code: "custom",
        path: ["LANGFUSE_SECRET_KEY"],
        message: "LANGFUSE_SECRET_KEY is required when LANGFUSE_ENABLED=true.",
      });
    }
    if (!value.OBSERVABILITY_ID_SECRET || value.OBSERVABILITY_ID_SECRET.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["OBSERVABILITY_ID_SECRET"],
        message:
          "OBSERVABILITY_ID_SECRET must be at least 32 characters when LANGFUSE_ENABLED=true.",
      });
    }
  });

const evaluationSchema = z.object({
  EVALUATION_MODEL_ID: z.string().trim().min(1).default(DEFAULT_RUNTIME_MODEL_ID),
  EVALUATION_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("high"),
  EVALUATION_TARGET_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EVALUATION_METRIC_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EVALUATION_CASE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(300_000),
  EVAL_DATABASE_URL: optionalUrl,
  EVAL_QDRANT_URL: optionalUrl,
  EVAL_QDRANT_API_KEY: optionalSecret,
  EVAL_QDRANT_COLLECTION_PREFIX: z.string().trim().min(1).default("iom_eval"),
});

const browserSchema = z.object({ VITE_API_URL: z.url() });

export type ServerConfig = z.infer<typeof serverSchema> & {
  readonly CLASSIFIER_MODEL_ID: typeof DEFAULT_RUNTIME_MODEL_ID;
  readonly OVERLAP_MODEL_ID: typeof DEFAULT_RUNTIME_MODEL_ID;
};
export type EvaluationConfig = z.infer<typeof evaluationSchema>;
export type BrowserConfig = z.infer<typeof browserSchema>;

export function parseServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  return {
    ...serverSchema.parse(environment),
    CLASSIFIER_MODEL_ID: DEFAULT_RUNTIME_MODEL_ID,
    OVERLAP_MODEL_ID: DEFAULT_RUNTIME_MODEL_ID,
  };
}

export function parseEvaluationConfig(
  environment: Record<string, string | undefined>,
): EvaluationConfig {
  return evaluationSchema.parse(environment);
}

export function parseBrowserConfig(environment: Record<string, unknown>): BrowserConfig {
  return browserSchema.parse(environment);
}
