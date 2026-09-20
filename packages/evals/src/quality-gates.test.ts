import { StreamReleaseGuard } from "@iom/agents/stream-guard";
import { assessPublishReadiness } from "@iom/database/readiness";
import { describe, expect, it } from "vitest";
import { publishSafetyCases, safetyCases } from "./security-cases";

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

  it("enforces every versioned publish-safety case", () => {
    const confirmedAt = new Date("2026-09-16T00:00:00.000Z");
    for (const item of publishSafetyCases) {
      const input = {
        metadataConfirmedAt: confirmedAt,
        policyStatus: "ACTIVE",
        chunks: [{ visibility: "EMPLOYEE_SAFE", reviewedAt: confirmedAt as Date | null }],
        overlapRun: {
          status: "COMPLETED",
          createdAt: new Date(confirmedAt.getTime() + 1),
          coverageComplete: true,
          noMatchConfirmedAt: confirmedAt,
          matches: [] as Array<{
            existingVersionId: string;
            decisionId: string | null;
            decisionStatus: string | null;
            outcome: string | null;
            rationale: string | null;
            topicScope: unknown;
            recommendation: string;
            evidenceStatus: "CURRENT" | "STALE" | "MISSING";
          }>,
        },
        relations: [] as Array<{
          targetVersionId: string;
          type: string;
          overlapDecisionId: string | null;
          topicScope: unknown;
        }>,
      };
      if (item.mutation === "UNREVIEWED_CONFIDENTIALITY") {
        const firstChunk = input.chunks[0];
        if (firstChunk) firstChunk.reviewedAt = null;
      }
      if (item.mutation === "STALE_OVERLAP") {
        input.overlapRun.createdAt = new Date(confirmedAt.getTime() - 1);
      }
      if (item.mutation === "MISSING_REPLACEMENT_RELATION") {
        input.overlapRun.matches.push({
          existingVersionId: "existing-version",
          decisionId: "decision-1",
          decisionStatus: "FINAL",
          outcome: "REPLACES",
          rationale: "Menggantikan aturan lama.",
          topicScope: [],
          recommendation: "REPLACES",
          evidenceStatus: "CURRENT",
        });
      }

      const result = assessPublishReadiness(input);
      expect(result.ready, item.id).toBe(item.expectedReady);
      if (item.expectedReason) expect(result.reasons, item.id).toContain(item.expectedReason);
    }
  });
});
