import type { OpenAIClient } from "@anvia/openai";
import {
  analyzeOverlap,
  classifyConfidentiality,
  createConfidentialityClassifier,
  createOpenAIModel,
  createOverlapAnalyzer,
  type RoleScopedKnowledgeIndex,
  reciprocalRankFusion,
} from "@iom/agents";
import type { ConfidentialityPolicy, IomEvidence } from "@iom/contracts";
import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import { refreshIomPublishReadiness } from "@iom/database/readiness";
import { JobProcessingError } from "./runner.js";
import { runWithAiTimeout } from "./timeouts.js";

type WorkerModelId = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol" | "gpt-6-astra";

function payloadId(job: LeasedJob, name: string): string {
  const value = job.payload as Record<string, unknown>;
  if (typeof value[name] !== "string") throw new JobProcessingError("INVALID_JOB_PAYLOAD", false);
  return value[name];
}

function toPolicy(record: {
  id: string;
  version: number;
  name: string;
  instructions: string;
  examples: unknown;
  status: string;
}): ConfidentialityPolicy {
  return {
    id: record.id,
    version: record.version,
    name: record.name,
    instructions: record.instructions,
    examples: record.examples as ConfidentialityPolicy["examples"],
    status: record.status as ConfidentialityPolicy["status"],
  };
}

export function createIndexVersionHandler(database: Database, index: RoleScopedKnowledgeIndex) {
  return async (job: LeasedJob, signal: AbortSignal) => {
    const versionId = payloadId(job, "versionId");
    const version = await database.iomVersion.findUnique({
      where: { id: versionId },
      include: {
        chunks: {
          where: { visibility: { in: ["EMPLOYEE_SAFE", "HR_ONLY"] } },
          orderBy: { ordinal: "asc" },
        },
        outgoingRelations: { include: { targetVersion: true } },
      },
    });
    if (version?.status !== "PUBLISHED" || !version.confidentialityPolicyId) {
      throw new JobProcessingError("VERSION_NOT_INDEXABLE", false);
    }
    const policy = await database.confidentialityPolicy.findUnique({
      where: { id: version.confidentialityPolicyId },
    });
    if (!policy) throw new JobProcessingError("POLICY_NOT_FOUND", false);
    const evidence: IomEvidence[] = version.chunks.map((chunk) => ({
      documentId: version.documentId,
      versionId: version.id,
      chunkId: chunk.id,
      sourceId: `${version.iomNumber}#${chunk.id.slice(0, 8)}`,
      iomNumber: version.iomNumber,
      title: version.title,
      ...(chunk.section ? { section: chunk.section } : {}),
      ...(chunk.pageStart ? { page: chunk.pageStart } : {}),
      effectiveFrom: version.effectiveFrom.toISOString(),
      ...(version.effectiveUntil ? { effectiveUntil: version.effectiveUntil.toISOString() } : {}),
      text: chunk.visibility === "EMPLOYEE_SAFE" ? (chunk.publicText ?? chunk.text) : chunk.text,
      score: 1,
      visibility: chunk.visibility === "EMPLOYEE_SAFE" ? "EMPLOYEE_SAFE" : "HR_ONLY",
      relationContext: version.outgoingRelations.map((relation) => ({
        type: relation.type,
        relatedVersionId: relation.targetVersionId,
        relatedIomNumber: relation.targetVersion.iomNumber,
        effectiveFrom: relation.targetVersion.effectiveFrom.toISOString(),
        ...(relation.note ? { note: relation.note } : {}),
      })),
    }));
    await index.index(evidence, policy.version, signal);
    await database.$transaction([
      database.iomChunk.updateMany({
        where: { versionId },
        data: { vectorGeneration: policy.version },
      }),
      database.uploadedFile.updateMany({
        where: {
          id: version.uploadedFileId ?? "00000000-0000-0000-0000-000000000000",
        },
        data: { stage: "COMPLETED", progress: 100 },
      }),
    ]);
  };
}

export function createPolicyEvaluationHandler(
  database: Database,
  openai: OpenAIClient,
  modelId: WorkerModelId,
  aiTimeoutMs: number,
) {
  const classifier = createConfidentialityClassifier(createOpenAIModel(openai, modelId));
  return async (job: LeasedJob, signal: AbortSignal) => {
    const policyId = payloadId(job, "policyId");
    const record = await database.confidentialityPolicy.findUnique({ where: { id: policyId } });
    if (record?.status !== "EVALUATING") {
      throw new JobProcessingError("POLICY_NOT_EVALUATING", false);
    }
    const policy = toPolicy(record);
    const chunks = await database.iomChunk.findMany({
      where: {
        version: { status: { in: ["IN_REVIEW", "READY_TO_PUBLISH", "PUBLISHED"] } },
      },
      include: {
        version: { include: { annotations: true, uploadedFile: { include: { batch: true } } } },
      },
    });
    for (const chunk of chunks) {
      const outcome = await runWithAiTimeout(signal, aiTimeoutMs, (operationSignal) =>
        classifyConfidentiality({
          agent: classifier,
          policy,
          input: {
            text: chunk.text,
            ...(chunk.section ? { section: chunk.section } : {}),
            ...(chunk.pageStart ? { page: chunk.pageStart } : {}),
            ...(chunk.version.uploadedFile?.batch.note
              ? { batchNote: chunk.version.uploadedFile.batch.note }
              : {}),
            manualMarkers: chunk.version.annotations.map((annotation) => ({
              kind: annotation.kind,
              ...(annotation.note ? { note: annotation.note } : {}),
            })),
          },
          signal: operationSignal,
        }),
      );
      await database.confidentialityDecision.create({
        data: {
          chunkId: chunk.id,
          policyId,
          visibility: outcome.visibility,
          confidence: outcome.confidence,
          categories: outcome.categories,
          rationale: outcome.rationale,
          sensitiveSpans: outcome.sensitiveSpans,
          conflictsWithMarker: outcome.conflictsWithMarker,
          modelId,
        },
      });
    }
  };
}

export function createOverlapHandler(
  database: Database,
  index: RoleScopedKnowledgeIndex,
  openai: OpenAIClient,
  modelId: WorkerModelId,
  aiTimeoutMs: number,
) {
  const analyzer = createOverlapAnalyzer(createOpenAIModel(openai, modelId));
  return async (job: LeasedJob, signal: AbortSignal) => {
    const runId = payloadId(job, "runId");
    const run = await database.overlapRun.update({
      where: { id: runId },
      data: { status: "RUNNING" },
      include: {
        candidateVersion: {
          include: { chunks: { orderBy: { ordinal: "asc" }, take: 20 } },
        },
      },
    });
    const policy = await database.confidentialityPolicy.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!policy) throw new JobProcessingError("ACTIVE_POLICY_NOT_FOUND", false);
    const query = run.candidateVersion.chunks
      .map((chunk) => chunk.text)
      .join("\n")
      .slice(0, 12_000);
    const [semantic, lexical, metadata] = await Promise.all([
      index.search(
        { query, includeHistory: true },
        { actorId: "worker", accessScope: "HR", policyVersion: policy.version },
        signal,
      ),
      database.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT v.id
        FROM "IomVersion" v
        JOIN "IomChunk" c ON c."versionId" = v.id
        WHERE v.id <> ${run.candidateVersionId}
          AND v.status IN ('PUBLISHED', 'SUPERSEDED')
          AND (to_tsvector('simple', c.text) @@ plainto_tsquery('simple', ${query})
               OR similarity(c.text, ${query}) > 0.2)
        ORDER BY v.id
        LIMIT 20
      `,
      database.iomVersion.findMany({
        where: {
          id: { not: run.candidateVersionId },
          status: { in: ["PUBLISHED", "SUPERSEDED"] },
        },
        orderBy: [{ iomNumber: "asc" }, { effectiveFrom: "desc" }],
        take: 20,
        select: { id: true },
      }),
    ]);
    const ranked = reciprocalRankFusion([
      semantic.evidence.map((item) => ({ id: item.versionId })),
      lexical,
      metadata,
    ]).slice(0, 10);
    const authorizedCandidates = await database.iomVersion.findMany({
      where: {
        id: { in: ranked.map((candidate) => candidate.id), not: run.candidateVersionId },
        status: { in: ["PUBLISHED", "SUPERSEDED"] },
      },
      include: { chunks: { orderBy: { ordinal: "asc" }, take: 20 } },
    });
    const authorizedById = new Map(
      authorizedCandidates.map((candidate) => [candidate.id, candidate]),
    );
    for (const candidate of ranked) {
      const existing = authorizedById.get(candidate.id);
      if (!existing) continue;
      const match = await runWithAiTimeout(signal, aiTimeoutMs, (operationSignal) =>
        analyzeOverlap({
          agent: analyzer,
          candidateVersionId: run.candidateVersionId,
          existingVersionId: existing.id,
          candidateChunks: run.candidateVersion.chunks.map((chunk) => ({
            id: chunk.id,
            text: chunk.text,
          })),
          existingChunks: existing.chunks.map((chunk) => ({ id: chunk.id, text: chunk.text })),
          signal: operationSignal,
        }),
      );
      const data = {
        recommendation: match.recommendation,
        confidence: match.confidence,
        sharedTopics: match.sharedTopics,
        changedRules: match.changedRules,
        conflicts: match.conflicts,
        evidence: match.evidence,
      };
      await database.overlapMatch.upsert({
        where: { runId_existingVersionId: { runId, existingVersionId: existing.id } },
        create: { runId, existingVersionId: existing.id, ...data },
        update: data,
      });
    }
    await database.overlapRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await refreshIomPublishReadiness(database, run.candidateVersionId);
  };
}
