import { describe, expect, it } from "vitest";
import {
  finalOverlapDecisionSchema,
  overlapDecisionPayloadSchema,
  overlapMatchSchema,
} from "./index.js";

describe("overlap contracts", () => {
  it("requires rationale for pending, replace, and partial decisions", () => {
    expect(overlapDecisionPayloadSchema.safeParse({ status: "PENDING_REVIEW" }).success).toBe(
      false,
    );
    expect(
      overlapDecisionPayloadSchema.safeParse({ status: "FINAL", outcome: "REPLACES" }).success,
    ).toBe(false);
    expect(
      overlapDecisionPayloadSchema.safeParse({
        status: "FINAL",
        outcome: "PARTIALLY_OVERRIDES",
        rationale: "ubah",
      }).success,
    ).toBe(false);
  });

  it("requires and normalizes the shape of partial scope at the boundary", () => {
    const parsed = finalOverlapDecisionSchema.safeParse({
      status: "FINAL",
      outcome: "PARTIALLY_OVERRIDES",
      rationale: "ubah",
      topicScope: ["cuti", "CUTI"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.topicScope).toEqual(["cuti"]);
    expect(
      finalOverlapDecisionSchema.safeParse({
        status: "FINAL",
        outcome: "COMPLEMENTS",
        topicScope: ["cuti"],
      }).success,
    ).toBe(false);
    expect(
      finalOverlapDecisionSchema.safeParse({
        status: "FINAL",
        outcome: "COMPLEMENTS",
        topicScope: [],
      }).success,
    ).toBe(false);
  });

  it("rejects ungrounded material recommendations and inconsistent conflicts", () => {
    const base = {
      existingVersionId: "00000000-0000-0000-0000-000000000001",
      confidence: 0.9,
      sharedTopics: ["cuti"],
      changedRules: [],
      evidence: [],
    };
    expect(
      overlapMatchSchema.safeParse({
        ...base,
        recommendation: "REPLACES",
        hasConflict: false,
        conflicts: [],
      }).success,
    ).toBe(false);
    expect(
      overlapMatchSchema.safeParse({
        ...base,
        recommendation: "NO_MATERIAL_OVERLAP",
        hasConflict: true,
        conflicts: [],
      }).success,
    ).toBe(false);
  });
});
