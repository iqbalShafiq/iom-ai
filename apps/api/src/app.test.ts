import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const config = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://iom:iom@localhost:5432/iom_test",
  QDRANT_URL: "http://localhost:6333",
  OPENAI_API_KEY: "test",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
  API_PORT: 3001,
  PLATFORM_ORIGIN: "http://localhost:5173",
  STORAGE_ROOT: "./storage-test",
  MODEL_CACHE_ROOT: "./models-test",
  WORKER_CONCURRENCY: 1,
  JOB_LEASE_SECONDS: 60,
  OCR_LANGUAGES: "ind+eng",
  ANVIA_LENS_ENABLED: false,
  CLASSIFIER_MODEL_ID: "gpt-5.6-sol",
  OVERLAP_MODEL_ID: "gpt-5.6-sol",
} as const;

describe("API boundary", () => {
  it("exposes a health check without database access", async () => {
    const app = createApp({} as never, config);
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
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
});
