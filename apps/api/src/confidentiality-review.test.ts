import { describe, expect, it } from "vitest";
import { needsConfidentialityReview } from "./confidentiality-review.js";

const reviewedAt = new Date("2026-09-17T00:00:00.000Z");

describe("needsConfidentialityReview", () => {
  it("clears a version whose latest chunk decisions were confirmed by HR", () => {
    expect(
      needsConfidentialityReview([
        { visibility: "HR_ONLY", decisions: [{ reviewedAt }] },
        { visibility: "EMPLOYEE_SAFE", decisions: [{ reviewedAt }] },
      ]),
    ).toBe(false);
  });

  it("keeps unresolved and unconfirmed decisions in the queue", () => {
    expect(
      needsConfidentialityReview([
        { visibility: "NEEDS_REVIEW", decisions: [{ reviewedAt: null }] },
      ]),
    ).toBe(true);
    expect(
      needsConfidentialityReview([{ visibility: "HR_ONLY", decisions: [{ reviewedAt: null }] }]),
    ).toBe(true);
  });
});
