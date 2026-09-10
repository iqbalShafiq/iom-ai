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
  it("accepts an omitted optional Lens URL", () => {
    expect(parseServerConfig(required).ANVIA_LENS_URL).toBeUndefined();
  });

  it("normalizes an empty optional Lens URL", () => {
    expect(parseServerConfig({ ...required, ANVIA_LENS_URL: "" }).ANVIA_LENS_URL).toBeUndefined();
  });

  it("fails fast when server secrets are missing", () => {
    expect(() => parseServerConfig({})).toThrow();
  });
});
