import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const config = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://iom:iom@localhost:5432/iom_test",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_API_KEY: undefined,
  OPENAI_API_KEY: "test",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
  API_PORT: 3001,
  PLATFORM_ORIGIN: "http://localhost:5173",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./storage-test",
  R2_ACCOUNT_ID: undefined,
  R2_ACCESS_KEY_ID: undefined,
  R2_SECRET_ACCESS_KEY: undefined,
  R2_BUCKET_NAME: undefined,
  R2_ENDPOINT: undefined,
  MODEL_CACHE_ROOT: "./models-test",
  WORKER_CONCURRENCY: 1,
  JOB_LEASE_SECONDS: 60,
  WORKER_AI_TIMEOUT_MS: 120_000,
  OCR_LANGUAGES: "ind+eng",
  ANVIA_LENS_ENABLED: false,
  ANVIA_LENS_URL: undefined,
  LANGFUSE_ENABLED: false,
  LANGFUSE_PUBLIC_KEY: undefined,
  LANGFUSE_SECRET_KEY: undefined,
  LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
  LANGFUSE_ENVIRONMENT: "test",
  LANGFUSE_RELEASE: "local",
  LANGFUSE_CAPTURE_MODE: "full",
  LANGFUSE_CAPTURE_MAX_BYTES: 65_536,
  OBSERVABILITY_ID_SECRET: undefined,
  CLASSIFIER_MODEL_ID: "deepseek-v4-flash-0731",
  OVERLAP_MODEL_ID: "deepseek-v4-flash-0731",
} as const;

describe("API boundary", () => {
  it("exposes a health check without database access", async () => {
    const app = createApp({} as never, config);
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  it("rejects cross-origin mutations", async () => {
    const app = createApp({} as never, config);
    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "password123" }),
    });
    expect(response.status).toBe(403);
  });

  it("allows the overlap PUT workflow through the configured CORS boundary", async () => {
    const app = createApp({} as never, config);
    const response = await app.request("/overlap/matches/example/decision", {
      method: "OPTIONS",
      headers: {
        origin: config.PLATFORM_ORIGIN,
        "access-control-request-method": "PUT",
      },
    });
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});
