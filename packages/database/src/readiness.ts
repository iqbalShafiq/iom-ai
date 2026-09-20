import type { Database } from "./index.js";

export const publishReadinessReasonCodes = [
  "METADATA_NOT_CONFIRMED",
  "POLICY_NOT_ACTIVE",
  "NO_CHUNKS",
  "CONFIDENTIALITY_NOT_REVIEWED",
  "CONFIDENTIALITY_UNRESOLVED",
  "OVERLAP_NOT_COMPLETED",
  "OVERLAP_STALE",
  "OVERLAP_DECISION_MISSING",
  "OVERLAP_COVERAGE_INCOMPLETE",
  "OVERLAP_NO_MATCH_CONFIRMATION_MISSING",
  "OVERLAP_DECISION_PENDING",
  "OVERLAP_DECISION_RATIONALE_MISSING",
  "OVERLAP_TOPIC_SCOPE_MISSING",
  "OVERLAP_EVIDENCE_STALE",
  "OVERLAP_RELATION_MISSING",
] as const;

export type PublishReadinessReasonCode = (typeof publishReadinessReasonCodes)[number];

type PublishReadinessInput = {
  metadataConfirmedAt: Date | null;
  policyStatus: string | null;
  chunks: ReadonlyArray<{
    visibility: string;
    reviewedAt: Date | null;
  }>;
  overlapRun: {
    status: string;
    createdAt: Date;
    coverageComplete: boolean;
    noMatchConfirmedAt: Date | null;
    matches: ReadonlyArray<{
      existingVersionId: string;
      decisionId: string | null;
      decisionStatus: string | null;
      outcome: string | null;
      rationale: string | null;
      topicScope: unknown;
      recommendation: string;
      evidenceStatus: "CURRENT" | "STALE" | "MISSING";
    }>;
  } | null;
  relations: ReadonlyArray<{
    targetVersionId: string;
    type: string;
    overlapDecisionId: string | null;
    topicScope: unknown;
  }>;
};

function normalizedTopicScope(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .reduce<string[]>((topics, item) => {
      if (typeof item !== "string") return topics;
      const topic = item.trim();
      const key = topic.toLocaleLowerCase("id-ID");
      if (topic && !seen.has(key)) {
        seen.add(key);
        topics.push(key);
      }
      return topics;
    }, [])
    .sort((left, right) => left.localeCompare(right, "id-ID"));
}

export type PublishReadiness = {
  ready: boolean;
  reasons: PublishReadinessReasonCode[];
};

export function assessPublishReadiness(input: PublishReadinessInput): PublishReadiness {
  const reasons = new Set<PublishReadinessReasonCode>();

  if (!input.metadataConfirmedAt) {
    reasons.add("METADATA_NOT_CONFIRMED");
  }
  if (input.policyStatus !== "ACTIVE") {
    reasons.add("POLICY_NOT_ACTIVE");
  }
  if (input.chunks.length === 0) {
    reasons.add("NO_CHUNKS");
  }
  if (input.chunks.some((chunk) => !chunk.reviewedAt)) {
    reasons.add("CONFIDENTIALITY_NOT_REVIEWED");
  }
  if (input.chunks.some((chunk) => chunk.visibility === "NEEDS_REVIEW")) {
    reasons.add("CONFIDENTIALITY_UNRESOLVED");
  }

  if (input.overlapRun?.status !== "COMPLETED") {
    reasons.add("OVERLAP_NOT_COMPLETED");
  } else {
    if (!input.overlapRun.coverageComplete) {
      reasons.add("OVERLAP_COVERAGE_INCOMPLETE");
    }
    if (
      input.metadataConfirmedAt &&
      input.overlapRun.createdAt.getTime() < input.metadataConfirmedAt.getTime()
    ) {
      reasons.add("OVERLAP_STALE");
    }

    if (input.overlapRun.matches.length === 0 && !input.overlapRun.noMatchConfirmedAt) {
      reasons.add("OVERLAP_NO_MATCH_CONFIRMATION_MISSING");
    }

    for (const match of input.overlapRun.matches) {
      if (!match.decisionId) {
        reasons.add("OVERLAP_DECISION_MISSING");
        continue;
      }
      if (match.decisionStatus !== "FINAL") {
        reasons.add("OVERLAP_DECISION_PENDING");
        continue;
      }

      if (!match.outcome) {
        reasons.add("OVERLAP_DECISION_PENDING");
        continue;
      }

      if (
        ["REPLACES", "PARTIALLY_OVERRIDES"].includes(match.outcome) &&
        (!match.rationale || match.rationale.trim().length < 3)
      ) {
        reasons.add("OVERLAP_DECISION_RATIONALE_MISSING");
      }

      const topicScope = normalizedTopicScope(match.topicScope);
      if (match.outcome === "PARTIALLY_OVERRIDES" && topicScope.length === 0) {
        reasons.add("OVERLAP_TOPIC_SCOPE_MISSING");
      }

      if (
        ["REPLACES", "PARTIALLY_OVERRIDES", "COMPLEMENTS"].includes(match.outcome) &&
        match.evidenceStatus !== "CURRENT"
      ) {
        reasons.add("OVERLAP_EVIDENCE_STALE");
      }

      const requiredRelation =
        match.outcome === "REPLACES"
          ? "REPLACES"
          : match.outcome === "PARTIALLY_OVERRIDES"
            ? "PARTIALLY_OVERRIDES"
            : match.outcome === "COMPLEMENTS"
              ? "COMPLEMENTS"
              : null;
      if (requiredRelation) {
        const relation = input.relations.find(
          (candidate) =>
            candidate.targetVersionId === match.existingVersionId &&
            candidate.type === requiredRelation &&
            candidate.overlapDecisionId === match.decisionId,
        );
        if (
          !relation ||
          (requiredRelation === "PARTIALLY_OVERRIDES" &&
            (normalizedTopicScope(relation.topicScope).length === 0 ||
              normalizedTopicScope(relation.topicScope).join("\u0000") !==
                topicScope.join("\u0000")))
        ) {
          reasons.add("OVERLAP_RELATION_MISSING");
        }
      }
    }
  }

  return { ready: reasons.size === 0, reasons: [...reasons] };
}

export async function getPublishReadiness(
  database: Pick<Database, "iomVersion" | "iomChunk">,
  versionId: string,
): Promise<PublishReadiness | null> {
  const version = await database.iomVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      metadataConfirmedAt: true,
      confidentialityPolicy: { select: { id: true, status: true } },
      chunks: {
        select: {
          visibility: true,
          decisions: {
            orderBy: { createdAt: "desc" },
            select: { policyId: true, reviewedAt: true },
          },
        },
      },
      outgoingRelations: {
        select: { targetVersionId: true, type: true, overlapDecisionId: true, topicScope: true },
      },
      overlapRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          createdAt: true,
          coverageComplete: true,
          analysisMetrics: true,
          noMatchConfirmedAt: true,
          matches: {
            select: {
              existingVersionId: true,
              recommendation: true,
              evidence: true,
              decision: {
                select: {
                  id: true,
                  status: true,
                  outcome: true,
                  rationale: true,
                  topicScope: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!version) {
    return null;
  }

  const overlapRun = version.overlapRuns[0];
  const runMetrics =
    overlapRun?.analysisMetrics &&
    typeof overlapRun.analysisMetrics === "object" &&
    !Array.isArray(overlapRun.analysisMetrics)
      ? (overlapRun.analysisMetrics as Record<string, unknown>)
      : {};
  const policyVersion =
    typeof runMetrics.policyVersion === "number" ? runMetrics.policyVersion : undefined;
  const evidenceIds =
    overlapRun?.matches.flatMap((match) => {
      if (!Array.isArray(match.evidence)) return [];
      return match.evidence.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        return [value.candidateChunkId, value.existingChunkId].filter(
          (id): id is string => typeof id === "string",
        );
      });
    }) ?? [];
  const authorizedEvidenceChunks = evidenceIds.length
    ? await database.iomChunk.findMany({
        where: {
          id: { in: [...new Set(evidenceIds)] },
          visibility: { in: ["EMPLOYEE_SAFE", "HR_ONLY"] },
        },
        select: {
          id: true,
          versionId: true,
          vectorGeneration: true,
          version: { select: { status: true } },
        },
      })
    : [];
  const authorizedEvidenceById = new Map(
    authorizedEvidenceChunks
      .filter(
        (chunk) =>
          (["PUBLISHED", "SUPERSEDED"].includes(chunk.version.status) ||
            chunk.version.status === "IN_REVIEW" ||
            chunk.version.status === "READY_TO_PUBLISH") &&
          (policyVersion === undefined ||
            chunk.versionId === version.id ||
            chunk.vectorGeneration === policyVersion),
      )
      .map((chunk) => [chunk.id, chunk]),
  );
  return assessPublishReadiness({
    metadataConfirmedAt: version.metadataConfirmedAt,
    policyStatus: version.confidentialityPolicy?.status ?? null,
    chunks: version.chunks.map((chunk) => ({
      visibility: chunk.visibility,
      reviewedAt:
        chunk.decisions.find((decision) => decision.policyId === version.confidentialityPolicy?.id)
          ?.reviewedAt ?? null,
    })),
    overlapRun: overlapRun
      ? {
          status: overlapRun.status,
          createdAt: overlapRun.createdAt,
          coverageComplete: overlapRun.coverageComplete,
          noMatchConfirmedAt: overlapRun.noMatchConfirmedAt,
          matches: overlapRun.matches.map((match) => ({
            existingVersionId: match.existingVersionId,
            decisionId: match.decision?.id ?? null,
            decisionStatus: match.decision?.status ?? null,
            outcome: match.decision?.outcome ?? null,
            rationale: match.decision?.rationale ?? null,
            topicScope: match.decision?.topicScope ?? [],
            recommendation: match.recommendation,
            evidenceStatus: (() => {
              const evidence = Array.isArray(match.evidence) ? match.evidence : [];
              const outcome = match.decision?.outcome ?? match.recommendation;
              const materialOutcome = ["REPLACES", "PARTIALLY_OVERRIDES", "COMPLEMENTS"].includes(
                outcome,
              );
              if (evidence.length === 0) return materialOutcome ? "MISSING" : "CURRENT";
              return evidence.every((item) => {
                if (!item || typeof item !== "object") return false;
                const value = item as Record<string, unknown>;
                const candidateChunk = authorizedEvidenceById.get(String(value.candidateChunkId));
                const existingChunk = authorizedEvidenceById.get(String(value.existingChunkId));
                return (
                  candidateChunk?.versionId === version.id &&
                  existingChunk?.versionId === match.existingVersionId
                );
              })
                ? "CURRENT"
                : "STALE";
            })(),
          })),
        }
      : null,
    relations: version.outgoingRelations,
  });
}

export async function refreshIomPublishReadiness(
  database: Pick<Database, "iomVersion" | "iomChunk">,
  versionId: string,
): Promise<PublishReadiness | null> {
  const [assessment, version] = await Promise.all([
    getPublishReadiness(database, versionId),
    database.iomVersion.findUnique({ where: { id: versionId }, select: { status: true } }),
  ]);
  if (!assessment || !version || !["IN_REVIEW", "READY_TO_PUBLISH"].includes(version.status)) {
    return assessment;
  }

  const nextStatus = assessment.ready ? "READY_TO_PUBLISH" : "IN_REVIEW";
  if (version.status !== nextStatus) {
    await database.iomVersion.update({ where: { id: versionId }, data: { status: nextStatus } });
  }
  return assessment;
}
