import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./index";

const required = {
  DATABASE_URL: "postgresql://iom:iom@localhost:5432/iom",
  QDRANT_URL: "http://localhost:6333",
  OPENAI_API_KEY: "test-key",
  COOKIE_SECRET: "a-secure-test-secret-with-32-characters",
  PLATFORM_ORIGIN: "http://localhost:5173",
};

describe("server configuration", () => {
  it("uses the official OpenAI v1 API endpoint by default", () => {
    expect(parseServerConfig(required).OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
  });

  it("accepts an application-owned compatible endpoint", () => {
    expect(
      parseServerConfig({ ...required, OPENAI_BASE_URL: "https://gateway.internal.example/v1" })
        .OPENAI_BASE_URL,
    ).toBe("https://gateway.internal.example/v1");
  });

  it("accepts an omitted optional Lens URL", () => {
    expect(parseServerConfig(required).ANVIA_LENS_URL).toBeUndefined();
  });

  it("normalizes an empty optional Lens URL", () => {
    expect(parseServerConfig({ ...required, ANVIA_LENS_URL: "" }).ANVIA_LENS_URL).toBeUndefined();
  });

  it("locks document AI workloads to the approved DeepSeek model", () => {
    const config = parseServerConfig(required);
    expect(config.CLASSIFIER_MODEL_ID).toBe("deepseek-v4-flash-0731");
    expect(config.OVERLAP_MODEL_ID).toBe("deepseek-v4-flash-0731");
    expect(
      parseServerConfig({
        ...required,
        CLASSIFIER_MODEL_ID: "gpt-5.6-sol",
        OVERLAP_MODEL_ID: "gpt-6-astra",
      }),
    ).toMatchObject({
      CLASSIFIER_MODEL_ID: "deepseek-v4-flash-0731",
      OVERLAP_MODEL_ID: "deepseek-v4-flash-0731",
    });
  });

  it("defaults document storage to local disk", () => {
    const config = parseServerConfig(required);
    expect(config.STORAGE_DRIVER).toBe("local");
    expect(config.R2_BUCKET_NAME).toBeUndefined();
  });

  it("accepts R2 storage with an account id and credentials", () => {
    const config = parseServerConfig({
      ...required,
      STORAGE_DRIVER: "r2",
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_BUCKET_NAME: "iom-ai",
    });
    expect(config.STORAGE_DRIVER).toBe("r2");
    expect(config.R2_BUCKET_NAME).toBe("iom-ai");
    expect(config.R2_ENDPOINT).toBeUndefined();
  });

  it("accepts R2 storage with an explicit endpoint instead of an account id", () => {
    expect(
      parseServerConfig({
        ...required,
        STORAGE_DRIVER: "r2",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
        R2_BUCKET_NAME: "iom-ai",
        R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      }).R2_ENDPOINT,
    ).toBe("https://account-id.r2.cloudflarestorage.com");
  });

  it("rejects R2 storage without credentials", () => {
    expect(() =>
      parseServerConfig({ ...required, STORAGE_DRIVER: "r2", R2_BUCKET_NAME: "iom-ai" }),
    ).toThrow(/R2_ACCESS_KEY_ID/);
  });

  it("rejects R2 storage without an account id or endpoint", () => {
    expect(() =>
      parseServerConfig({
        ...required,
        STORAGE_DRIVER: "r2",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
        R2_BUCKET_NAME: "iom-ai",
      }),
    ).toThrow(/R2_ACCOUNT_ID or R2_ENDPOINT/);
  });

  it("allows Langfuse to stay disabled without credentials", () => {
    const config = parseServerConfig(required);
    expect(config.LANGFUSE_ENABLED).toBe(false);
    expect(config.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(config.LANGFUSE_CAPTURE_MODE).toBe("full");
  });

  it("fails fast on partial Langfuse credentials", () => {
    expect(() => parseServerConfig({ ...required, LANGFUSE_PUBLIC_KEY: "pk-lf-test" })).toThrow();
  });

  it("requires a complete Langfuse connection when enabled", () => {
    expect(() => parseServerConfig({ ...required, LANGFUSE_ENABLED: "true" })).toThrow();
    const config = parseServerConfig({
      ...required,
      LANGFUSE_ENABLED: "true",
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      OBSERVABILITY_ID_SECRET: "a-secure-test-secret-with-32-characters",
    });
    expect(config.LANGFUSE_ENABLED).toBe(true);
    expect(config.LANGFUSE_BASE_URL).toBe("https://cloud.langfuse.com");
  });

  it("fails fast when server secrets are missing", () => {
    expect(() => parseServerConfig({})).toThrow();
  });
});
