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
      coverageComplete: true,
      noMatchConfirmedAt: now,
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
      decisionStatus: "FINAL",
      outcome: "REPLACES",
      rationale: "Aturan baru menggantikan aturan lama.",
      topicScope: [],
      recommendation: "REPLACES",
      evidenceStatus: "CURRENT",
    });

    expect(assessPublishReadiness(input).reasons).toContain("OVERLAP_RELATION_MISSING");
    input.relations.push({
      targetVersionId: "old-version",
      type: "REPLACES",
      overlapDecisionId: "decision-1",
      topicScope: [],
    });
    expect(assessPublishReadiness(input)).toEqual({ ready: true, reasons: [] });
  });

  it("keeps candidate evidence current after readiness moves to READY_TO_PUBLISH", () => {
    const input = readyInput();
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decisionStatus: "FINAL",
      outcome: "COMPLEMENTS",
      rationale: null,
      topicScope: [],
      recommendation: "COMPLEMENTS",
      evidenceStatus: "CURRENT",
    });
    input.relations.push({
      targetVersionId: "old-version",
      type: "COMPLEMENTS",
      overlapDecisionId: "decision-1",
      topicScope: [],
    });
    expect(assessPublishReadiness(input)).toEqual({ ready: true, reasons: [] });
  });

  it("requires the relation scope to match the HR decision scope", () => {
    const input = readyInput();
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decisionStatus: "FINAL",
      outcome: "PARTIALLY_OVERRIDES",
      rationale: "Perubahan hanya berlaku untuk cuti tahunan.",
      topicScope: ["Cuti Tahunan"],
      recommendation: "PARTIALLY_OVERRIDES",
      evidenceStatus: "CURRENT",
    });
    input.relations.push({
      targetVersionId: "old-version",
      type: "PARTIALLY_OVERRIDES",
      overlapDecisionId: "decision-1",
      topicScope: ["Cuti Sakit"],
    });
    expect(assessPublishReadiness(input).reasons).toContain("OVERLAP_RELATION_MISSING");
  });

  it("does not let a no-overlap recommendation publish as a material HR outcome without evidence", () => {
    const input = readyInput();
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decisionStatus: "FINAL",
      outcome: "REPLACES",
      rationale: "Aturan baru menggantikan aturan lama.",
      topicScope: [],
      recommendation: "NO_MATERIAL_OVERLAP",
      evidenceStatus: "MISSING",
    });
    input.relations.push({
      targetVersionId: "old-version",
      type: "REPLACES",
      overlapDecisionId: "decision-1",
      topicScope: [],
    });

    expect(assessPublishReadiness(input).reasons).toContain("OVERLAP_EVIDENCE_STALE");
  });

  it("blocks a stale analysis and manual-review outcome", () => {
    const input = readyInput();
    input.overlapRun.createdAt = new Date(now.getTime() - 1);
    input.overlapRun.matches.push({
      existingVersionId: "old-version",
      decisionId: "decision-1",
      decisionStatus: "PENDING_REVIEW",
      outcome: null,
      rationale: "Perlu pemeriksaan HR lebih lanjut.",
      topicScope: [],
      recommendation: "MANUAL_REVIEW",
      evidenceStatus: "MISSING",
    });

    expect(assessPublishReadiness(input).reasons).toEqual(
      expect.arrayContaining(["OVERLAP_STALE", "OVERLAP_DECISION_PENDING"]),
    );
  });
});
