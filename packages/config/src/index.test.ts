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

  it("locks document AI workloads to the approved Luna model", () => {
    const config = parseServerConfig(required);
    expect(config.CLASSIFIER_MODEL_ID).toBe("gpt-5.6-luna");
    expect(config.OVERLAP_MODEL_ID).toBe("gpt-5.6-luna");
    expect(
      parseServerConfig({
        ...required,
        CLASSIFIER_MODEL_ID: "gpt-5.6-sol",
        OVERLAP_MODEL_ID: "gpt-6-astra",
      }),
    ).toMatchObject({
      CLASSIFIER_MODEL_ID: "gpt-5.6-luna",
      OVERLAP_MODEL_ID: "gpt-5.6-luna",
    });
  });

  it("fails fast when server secrets are missing", () => {
    expect(() => parseServerConfig({})).toThrow();
  });
});
