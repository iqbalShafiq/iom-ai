import { describe, expect, it } from "vitest";
import { passwordSchema } from "./index.js";

describe("password schema", () => {
  it("accepts passwords with at least eight characters", () => {
    expect(passwordSchema.safeParse("Test@123").success).toBe(true);
  });

  it("rejects passwords shorter than eight or longer than 256 characters", () => {
    expect(passwordSchema.safeParse("short7").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(257)).success).toBe(false);
  });
});
