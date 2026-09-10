import type { EvidenceAuthorizer, RetrievalScope } from "@iom/agents";
import type { IomEvidence, SearchIomInput } from "@iom/contracts";
import type { Database } from "@iom/database";

export class PrismaEvidenceAuthorizer implements EvidenceAuthorizer {
  constructor(private readonly database: Database) {}

  async authorize(
    evidence: readonly IomEvidence[],
    input: SearchIomInput,
    scope: RetrievalScope,
  ): Promise<IomEvidence[]> {
    const ids = [...new Set(evidence.map((item) => item.chunkId))];
    if (ids.length === 0) return [];
    const asOf = input.asOf ? new Date(`${input.asOf}T23:59:59.999Z`) : new Date();
    const chunks = await this.database.iomChunk.findMany({
      where: {
        id: { in: ids },
        ...(scope.accessScope === "EMPLOYEE" ? { visibility: "EMPLOYEE_SAFE" as const } : {}),
        version: {
          status: input.includeHistory ? { in: ["PUBLISHED", "SUPERSEDED"] } : "PUBLISHED",
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: asOf } }],
          ...(scope.accessScope === "EMPLOYEE"
            ? { confidentialityPolicy: { version: scope.policyVersion, status: "ACTIVE" as const } }
            : {}),
        },
      },
      include: {
        version: {
          include: {
            document: true,
            outgoingRelations: { include: { targetVersion: true } },
            incomingRelations: { include: { sourceVersion: true } },
          },
        },
      },
    });
    const scores = new Map(evidence.map((item) => [item.chunkId, item.score]));
    return chunks
      .map(
        (chunk): IomEvidence => ({
          documentId: chunk.version.documentId,
          versionId: chunk.versionId,
          chunkId: chunk.id,
          sourceId: `${chunk.version.iomNumber}#${chunk.id.slice(0, 8)}`,
          iomNumber: chunk.version.iomNumber,
          title: chunk.version.title,
          ...(chunk.section ? { section: chunk.section } : {}),
          ...(chunk.pageStart ? { page: chunk.pageStart } : {}),
          effectiveFrom: chunk.version.effectiveFrom.toISOString(),
          ...(chunk.version.effectiveUntil
            ? { effectiveUntil: chunk.version.effectiveUntil.toISOString() }
            : {}),
          text: scope.accessScope === "EMPLOYEE" ? (chunk.publicText ?? "") : chunk.text,
          score: Math.min(1, Math.max(0, scores.get(chunk.id) ?? 0)),
          visibility: chunk.visibility === "EMPLOYEE_SAFE" ? "EMPLOYEE_SAFE" : "HR_ONLY",
          relationContext: [
            ...chunk.version.outgoingRelations.map((relation) => ({
              type: relation.type,
              relatedVersionId: relation.targetVersionId,
              relatedIomNumber: relation.targetVersion.iomNumber,
              effectiveFrom: relation.targetVersion.effectiveFrom.toISOString(),
              ...(relation.note ? { note: relation.note } : {}),
            })),
            ...chunk.version.incomingRelations.map((relation) => ({
              type: relation.type,
              relatedVersionId: relation.sourceVersionId,
              relatedIomNumber: relation.sourceVersion.iomNumber,
              effectiveFrom: relation.sourceVersion.effectiveFrom.toISOString(),
              ...(relation.note ? { note: relation.note } : {}),
            })),
          ],
        }),
      )
      .filter((item) => item.text.length > 0)
      .sort((left, right) => right.score - left.score);
  }
}
