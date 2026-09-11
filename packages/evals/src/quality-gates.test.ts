import { StreamReleaseGuard } from "@iom/agents/stream-guard";
import { describe, expect, it } from "vitest";
import { safetyCases } from "./security-cases";

function citationsAreAuthorized(citations: string[], authorizedIds: Set<string>) {
  return citations.length > 0 && citations.every((id) => authorizedIds.has(id));
}

function overlapNeedsManualReview(input: {
  confidence: number;
  hasConflict: boolean;
  hasProvenance: boolean;
}) {
  return input.confidence < 0.75 || input.hasConflict || !input.hasProvenance;
}

describe("versioned security corpus", () => {
  it("keeps every denied value detectable by the release guard", () => {
    for (const item of safetyCases) {
      for (const denied of item.deniedValues) {
        const guard = new StreamReleaseGuard(
          item.deniedValues.map((value) => ({ value, kind: "entity_value" })),
          8,
        );
        const result = guard.push(`Jawaban: ${denied}`);
        expect(result.blocked, item.id).toBe(true);
      }
    }
  });

  it("rejects invented or cross-role citations", () => {
    const authorized = new Set(["employee-chunk-1", "employee-chunk-2"]);
    expect(citationsAreAuthorized(["employee-chunk-1"], authorized)).toBe(true);
    expect(citationsAreAuthorized(["hr-only-chunk"], authorized)).toBe(false);
    expect(citationsAreAuthorized([], authorized)).toBe(false);
  });

  it("routes uncertain overlap outcomes to HR review", () => {
    expect(
      overlapNeedsManualReview({ confidence: 0.74, hasConflict: false, hasProvenance: true }),
    ).toBe(true);
    expect(
      overlapNeedsManualReview({ confidence: 0.94, hasConflict: true, hasProvenance: true }),
    ).toBe(true);
    expect(
      overlapNeedsManualReview({ confidence: 0.94, hasConflict: false, hasProvenance: false }),
    ).toBe(true);
    expect(
      overlapNeedsManualReview({ confidence: 0.94, hasConflict: false, hasProvenance: true }),
    ).toBe(false);
  });
});
