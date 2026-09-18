import { describe, expect, it } from "vitest";
import { needsConfidentialityReview, needsPolicyImpactReview } from "./confidentiality-review.js";

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

describe("needsPolicyImpactReview", () => {
  it("requires review for missing, unresolved, conflicting, or access-changing outcomes", () => {
    expect(needsPolicyImpactReview("HR_ONLY", undefined)).toBe(true);
    expect(
      needsPolicyImpactReview("HR_ONLY", {
        visibility: "NEEDS_REVIEW",
        conflictsWithMarker: false,
        reviewedAt: null,
      }),
    ).toBe(true);
    expect(
      needsPolicyImpactReview("HR_ONLY", {
        visibility: "HR_ONLY",
        conflictsWithMarker: true,
        reviewedAt: null,
      }),
    ).toBe(true);
    expect(
      needsPolicyImpactReview("HR_ONLY", {
        visibility: "EMPLOYEE_SAFE",
        conflictsWithMarker: false,
        reviewedAt: null,
      }),
    ).toBe(true);
  });

  it("accepts unchanged safe outcomes and reviewed changes", () => {
    expect(
      needsPolicyImpactReview("EMPLOYEE_SAFE", {
        visibility: "EMPLOYEE_SAFE",
        conflictsWithMarker: false,
        reviewedAt: null,
      }),
    ).toBe(false);
    expect(
      needsPolicyImpactReview("HR_ONLY", {
        visibility: "EMPLOYEE_SAFE",
        conflictsWithMarker: false,
        reviewedAt,
      }),
    ).toBe(false);
  });
});
