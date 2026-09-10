import { describe, expect, it } from "vitest";
import { JobProcessingError } from "./runner.js";

describe("worker errors", () => {
  it("distinguishes transient from terminal failures", () => {
    expect(new JobProcessingError("OCR_TIMEOUT", true).transient).toBe(true);
    expect(new JobProcessingError("INVALID_FILE", false).transient).toBe(false);
  });
});
