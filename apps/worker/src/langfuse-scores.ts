import { observabilityTraceRefListSchema } from "@iom/contracts";
import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import { confidentialityScores, type IomObservability, overlapScores } from "@iom/observability";
import { JobProcessingError } from "./runner.js";

interface ScorePayload {
  kind: "confidentiality" | "overlap";
  entityId: string;
}

function parsePayload(job: LeasedJob): ScorePayload {
  const value = job.payload as Partial<ScorePayload>;
  if (
    (value.kind !== "confidentiality" && value.kind !== "overlap") ||
    typeof value.entityId !== "string"
  ) {
    throw new JobProcessingError("INVALID_JOB_PAYLOAD", false);
  }
  return { kind: value.kind, entityId: value.entityId };
}

export function createLangfuseScoreHandler(database: Database, observability: IomObservability) {
  return async (job: LeasedJob, signal: AbortSignal) => {
    if (!observability.enabled) return;
    signal.throwIfAborted();
    const payload = parsePayload(job);
    if (payload.kind === "confidentiality") {
      const hrDecision = await database.confidentialityDecision.findUnique({
        where: { id: payload.entityId },
      });
      if (!hrDecision?.reviewedAt) throw new JobProcessingError("SCORE_SOURCE_NOT_FOUND", false);
      const aiDecision = await database.confidentialityDecision.findFirst({
        where: {
          chunkId: hrDecision.chunkId,
          policyId: hrDecision.policyId,
          observabilityTraceId: { not: null },
          id: { not: hrDecision.id },
        },
        orderBy: { createdAt: "desc" },
      });
      const traceId = aiDecision?.observabilityTraceId ?? hrDecision.observabilityTraceId;
      if (!traceId) return;
      const observationId =
        aiDecision?.observabilityObservationId ??
        hrDecision.observabilityObservationId ??
        undefined;
      const traces = [
        {
          name: "iom.confidentiality.classify",
          traceId,
          ...(observationId ? { observationId } : {}),
        },
      ];
      const scores = confidentialityScores({
        traces,
        aiVisibility: aiDecision?.visibility ?? hrDecision.visibility,
        hrVisibility: hrDecision.visibility,
        overridden: aiDecision ? aiDecision.visibility !== hrDecision.visibility : false,
      });
      for (const score of scores) await observability.score(score);
      return;
    }

    const match = await database.overlapMatch.findUnique({
      where: { id: payload.entityId },
      include: { decision: true },
    });
    if (!match?.decision) throw new JobProcessingError("SCORE_SOURCE_NOT_FOUND", false);
    const traces = observabilityTraceRefListSchema.catch([]).parse(match.observabilityTraces);
    if (traces.length === 0) return;
    const scores = overlapScores({
      traces,
      recommendation: match.recommendation,
      hrStatus: match.decision.status,
      hrOutcome: match.decision.outcome,
      overridden:
        match.decision.status === "FINAL" &&
        match.decision.outcome !== null &&
        match.decision.outcome !== match.recommendation,
    });
    for (const score of scores) await observability.score(score);
  };
}
