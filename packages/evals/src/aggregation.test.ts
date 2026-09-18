import { describe, expect, it } from "vitest";
import { invalidNeverPasses, median, worstSafetyOutcome } from "./aggregation.js";

describe("eval aggregation", () => {
  it("treats invalid as a safety failure", () => {
    expect(worstSafetyOutcome(["pass", "invalid"])).toBe("invalid");
    expect(worstSafetyOutcome(["pass", "fail"])).toBe("fail");
    expect(worstSafetyOutcome(["pass", "pass"])).toBe("pass");
  });

  it("aggregates quality scores with the median", () => {
    expect(median([0.7, 0.9, 0.8])).toBe(0.8);
    expect(median([0.2, 1])).toBe(0.6);
    expect(median([])).toBeUndefined();
  });

  it("does not count invalid outcomes as passing", () => {
    expect(invalidNeverPasses("invalid")).toBe(false);
    expect(invalidNeverPasses("pass")).toBe(true);
  });
});
