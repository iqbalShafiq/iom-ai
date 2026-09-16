import { describe, expect, it } from "vitest";
import { assessPublishReadiness } from "./readiness.js";

const now = new Date("2026-09-16T00:00:00.000Z");

function readyInput() {
  return {
    metadataConfirmedAt: now,
    policyStatus: "ACTIVE",
    chunks: [{ visibility: "EMPLOYEE_SAFE", reviewedAt: now as Date | null }],
    overlapRun: {
      status: "COMPLETED",
      createdAt: new Date(now.getTime() + 1),
      matches: [] as Array<{
        existingVersionId: string;
        decisionId: string | null;
        decision: string | null;
      }>,
    },
    relations: [] as Array<{
      targetVersionId: string;
      type: string;
      overlapDecisionId: string | null;
    }>,
  };
}

describe("assessPublishReadiness", () => {
  it("allows publish only after metadata, confidentiality, and overlap review", () => {
    expect(assessPublishReadiness(readyInput())).toEqual({ ready: true, reasons: [] });
  });

  it("blocks mixed AI decisions until every chunk receives human review", () => {
    const input = readyInput();
    input.chunks.push({ visibility: "HR_ONLY", reviewedAt: null });

    expect(assessPublishReadiness(input)).toMatchObject({
      ready: false,
      reasons: ["CONFIDENTIALITY_NOT_REVIEWED"],
    });
  });

  it("requires the lifecycle relation implied by an overlap decision", () => {
    const input = readyInput();
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decision: "ARCHIVE_EXISTING",
    });

    expect(assessPublishReadiness(input).reasons).toContain("OVERLAP_RELATION_MISSING");
    input.relations.push({
      targetVersionId: "old-version",
      type: "REPLACES",
      overlapDecisionId: "decision-1",
    });
    expect(assessPublishReadiness(input)).toEqual({ ready: true, reasons: [] });
  });

  it("blocks a stale analysis and manual-review outcome", () => {
    const input = readyInput();
    input.overlapRun.createdAt = new Date(now.getTime() - 1);
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decision: "MANUAL_REVIEW",
    });

    expect(assessPublishReadiness(input).reasons).toEqual(
      expect.arrayContaining(["OVERLAP_STALE", "OVERLAP_MANUAL_REVIEW"]),
    );
  });
});
