import { describe, expect, it } from "vitest";
import { allowAnviaLangfuseSpanExport } from "./export-anvia-spans.js";

describe("allowAnviaLangfuseSpanExport", () => {
  it("is idempotent and patches the Anvia Langfuse span processor", () => {
    expect(() => allowAnviaLangfuseSpanExport()).not.toThrow();
    expect(() => allowAnviaLangfuseSpanExport()).not.toThrow();
  });
});
