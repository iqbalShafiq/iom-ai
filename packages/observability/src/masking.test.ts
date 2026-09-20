import { describe, expect, it } from "vitest";
import { maskSensitiveValue } from "./masking.js";

describe("maskSensitiveValue", () => {
  it("redacts secrets, cookies, and connection strings before export", () => {
    const masked = maskSensitiveValue({
      authorization: "Bearer super-secret",
      cookie: "sid=abc",
      passwordHash: "argon2",
      DATABASE_URL: "postgresql://iom:iom@localhost:5432/iom",
      prompt: "Bearer sk-live-secret should vanish",
      nested: { QDRANT_API_KEY: "qd-key", text: "safe page text" },
    }) as Record<string, unknown>;

    expect(masked.authorization).toBe("[REDACTED]");
    expect(masked.cookie).toBe("[REDACTED]");
    expect(masked.passwordHash).toBe("[REDACTED]");
    expect(masked.DATABASE_URL).toBe("[REDACTED]");
    expect(String(masked.prompt)).not.toContain("sk-live-secret");
    expect((masked.nested as { QDRANT_API_KEY: string }).QDRANT_API_KEY).toBe("[REDACTED]");
    expect((masked.nested as { text: string }).text).toBe("safe page text");
  });
});
