import type { LangfuseScoreArgs } from "@anvia/langfuse";
import type { ObservabilityTraceRef } from "@iom/contracts";

export type ConfidentialityScoreInput = {
  traces: ObservabilityTraceRef[];
  aiVisibility: string;
  hrVisibility: string;
  overridden: boolean;
};

export type OverlapScoreInput = {
  traces: ObservabilityTraceRef[];
  recommendation: string;
  hrStatus: "PENDING_REVIEW" | "FINAL";
  hrOutcome: string | null;
  overridden: boolean;
};

function scoreForTrace(
  trace: ObservabilityTraceRef,
  name: string,
  value: number | string,
  dataType: LangfuseScoreArgs["dataType"],
): LangfuseScoreArgs {
  const args: LangfuseScoreArgs = {
    traceId: trace.traceId,
    name,
    value,
    dataType,
  };
  if (trace.observationId !== undefined) args.observationId = trace.observationId;
  return args;
}

export function confidentialityScores(input: ConfidentialityScoreInput): LangfuseScoreArgs[] {
  const primary = input.traces[0];
  if (!primary) return [];
  return [
    scoreForTrace(primary, "hr-confidentiality-final", input.hrVisibility, "CATEGORICAL"),
    scoreForTrace(
      primary,
      "hr-confidentiality-agreement",
      input.aiVisibility === input.hrVisibility ? 1 : 0,
      "BOOLEAN",
    ),
    scoreForTrace(primary, "hr-confidentiality-overridden", input.overridden ? 1 : 0, "BOOLEAN"),
  ];
}

export function overlapScores(input: OverlapScoreInput): LangfuseScoreArgs[] {
  const primary = input.traces[0];
  if (!primary) return [];
  const pending = input.hrStatus === "PENDING_REVIEW";
  const scores = [
    scoreForTrace(
      primary,
      "hr-overlap-final",
      pending ? "PENDING_REVIEW" : (input.hrOutcome ?? "UNSET"),
      "CATEGORICAL",
    ),
    scoreForTrace(
      primary,
      "hr-overlap-agreement",
      !pending && input.hrOutcome === input.recommendation ? 1 : 0,
      "BOOLEAN",
    ),
    scoreForTrace(primary, "hr-overlap-overridden", input.overridden ? 1 : 0, "BOOLEAN"),
    scoreForTrace(primary, "hr-overlap-pending", pending ? 1 : 0, "BOOLEAN"),
  ];
  return scores;
}

export function langfuseScoreJobType() {
  return "PUBLISH_LANGFUSE_SCORE" as const;
}

export function langfuseScoreIdempotencyKey(input: {
  kind: "confidentiality" | "overlap";
  entityId: string;
  revision: string;
}) {
  return `langfuse-score:${input.kind}:${input.entityId}:${input.revision}`;
}
