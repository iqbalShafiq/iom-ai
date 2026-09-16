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
  "OVERLAP_MANUAL_REVIEW",
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
    matches: ReadonlyArray<{
      existingVersionId: string;
      decisionId: string | null;
      decision: string | null;
    }>;
  } | null;
  relations: ReadonlyArray<{
    targetVersionId: string;
    type: string;
    overlapDecisionId: string | null;
  }>;
};

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
    if (
      input.metadataConfirmedAt &&
      input.overlapRun.createdAt.getTime() < input.metadataConfirmedAt.getTime()
    ) {
      reasons.add("OVERLAP_STALE");
    }

    for (const match of input.overlapRun.matches) {
      if (!match.decision) {
        reasons.add("OVERLAP_DECISION_MISSING");
        continue;
      }
      if (match.decision === "MANUAL_REVIEW") {
        reasons.add("OVERLAP_MANUAL_REVIEW");
        continue;
      }

      const requiredRelation =
        match.decision === "ARCHIVE_EXISTING"
          ? "REPLACES"
          : match.decision === "PUBLISH_AS_COMPLEMENT"
            ? "COMPLEMENTS"
            : null;
      if (
        requiredRelation &&
        !input.relations.some(
          (relation) =>
            relation.targetVersionId === match.existingVersionId &&
            relation.type === requiredRelation &&
            relation.overlapDecisionId === match.decisionId,
        )
      ) {
        reasons.add("OVERLAP_RELATION_MISSING");
      }
    }
  }

  return { ready: reasons.size === 0, reasons: [...reasons] };
}

export async function getPublishReadiness(
  database: Pick<Database, "iomVersion">,
  versionId: string,
): Promise<PublishReadiness | null> {
  const version = await database.iomVersion.findUnique({
    where: { id: versionId },
    select: {
      metadataConfirmedAt: true,
      confidentialityPolicy: { select: { status: true } },
      chunks: {
        select: {
          visibility: true,
          decisions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { reviewedAt: true },
          },
        },
      },
      outgoingRelations: {
        select: { targetVersionId: true, type: true, overlapDecisionId: true },
      },
      overlapRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          createdAt: true,
          matches: {
            select: {
              existingVersionId: true,
              decision: { select: { id: true, decision: true } },
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
  return assessPublishReadiness({
    metadataConfirmedAt: version.metadataConfirmedAt,
    policyStatus: version.confidentialityPolicy?.status ?? null,
    chunks: version.chunks.map((chunk) => ({
      visibility: chunk.visibility,
      reviewedAt: chunk.decisions[0]?.reviewedAt ?? null,
    })),
    overlapRun: overlapRun
      ? {
          status: overlapRun.status,
          createdAt: overlapRun.createdAt,
          matches: overlapRun.matches.map((match) => ({
            existingVersionId: match.existingVersionId,
            decisionId: match.decision?.id ?? null,
            decision: match.decision?.decision ?? null,
          })),
        }
      : null,
    relations: version.outgoingRelations,
  });
}

export async function refreshIomPublishReadiness(
  database: Pick<Database, "iomVersion">,
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
