import type { OpenAIClient } from "@anvia/openai";
import {
  type AllowedModelId,
  analyzeOverlap,
  classifyConfidentiality,
  createConfidentialityClassifier,
  createOpenAIModel,
  createOverlapAnalyzer,
  OverlapModelTimeoutError,
  type RoleScopedKnowledgeIndex,
  reciprocalRankFusion,
} from "@iom/agents";
import type { ConfidentialityPolicy, IomEvidence } from "@iom/contracts";
import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import { refreshIomPublishReadiness } from "@iom/database/readiness";
import { relevantAnnotations } from "@iom/documents";
import { JobProcessingError } from "./runner.js";
import { runWithAiTimeout } from "./timeouts.js";

type WorkerModelId = AllowedModelId;

function payloadId(job: LeasedJob, name: string): string {
  const value = job.payload as Record<string, unknown>;
  if (typeof value[name] !== "string") throw new JobProcessingError("INVALID_JOB_PAYLOAD", false);
  return value[name];
}

function overlapWindows(text: string): Array<{ text: string; ordinal: number }> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const windowSize = 800;
  const overlap = 100;
  const step = windowSize - overlap;
  const windows: Array<{ text: string; ordinal: number }> = [];
  for (let start = 0, ordinal = 0; start < normalized.length; start += step, ordinal += 1) {
    const value = normalized.slice(start, start + windowSize).trim();
    if (value) windows.push({ text: value, ordinal });
    if (start + windowSize >= normalized.length) break;
  }
  return windows;
}

function lexicalTokens(text: string): string[] {
  const stopwords = new Set([
    "yang",
    "dan",
    "atau",
    "dengan",
    "untuk",
    "dari",
    "pada",
    "dalam",
    "adalah",
    "akan",
    "ini",
    "itu",
    "the",
    "and",
    "or",
    "with",
    "for",
    "from",
    "this",
    "that",
  ]);
  const counts = new Map<string, number>();
  for (const token of text.toLocaleLowerCase("id-ID").match(/[a-z0-9]{3,50}/g) ?? []) {
    if (!stopwords.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 64)
    .map(([token]) => token);
}

function normalizeIomIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("id-ID")
    .replace(/[^A-Z0-9]/g, "");
}

type OverlapPair = {
  candidateChunkId: string;
  existingChunkId: string;
  versionId: string;
  score: number;
};

function rankVersionsByPairScore(pairs: Iterable<OverlapPair>) {
  const scores = new Map<string, number[]>();
  for (const pair of pairs) {
    const versionScores = scores.get(pair.versionId) ?? [];
    versionScores.push(pair.score);
    scores.set(pair.versionId, versionScores);
  }
  return [...scores.entries()]
    .map(([id, versionScores]) => {
      const topFiveScores = versionScores.sort((left, right) => right - left).slice(0, 5);
      const topScores = topFiveScores.slice(0, 3);
      return { id, score: topScores.reduce((sum, score) => sum + score, 0) / topScores.length };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ id }) => ({ id }));
}

function mergeOverlapPairs(
  semanticPairs: Map<string, OverlapPair>,
  lexicalPairs: Map<string, OverlapPair>,
) {
  const merged = new Map<string, OverlapPair>();
  for (const pair of semanticPairs.values()) {
    merged.set(`${pair.candidateChunkId}:${pair.existingChunkId}`, { ...pair });
  }
  for (const pair of lexicalPairs.values()) {
    const key = `${pair.candidateChunkId}:${pair.existingChunkId}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, score: existing.score + pair.score } : { ...pair });
  }
  return merged;
}

function selectDiversePairs(pairs: readonly OverlapPair[], limit = 40, perChunkLimit = 3) {
  const candidateCounts = new Map<string, number>();
  const existingCounts = new Map<string, number>();
  const selected: OverlapPair[] = [];
  for (const pair of pairs) {
    if (selected.length >= limit) break;
    if ((candidateCounts.get(pair.candidateChunkId) ?? 0) >= perChunkLimit) continue;
    if ((existingCounts.get(pair.existingChunkId) ?? 0) >= perChunkLimit) continue;
    selected.push(pair);
    candidateCounts.set(
      pair.candidateChunkId,
      (candidateCounts.get(pair.candidateChunkId) ?? 0) + 1,
    );
    existingCounts.set(pair.existingChunkId, (existingCounts.get(pair.existingChunkId) ?? 0) + 1);
  }
  return selected;
}

function overlapErrorCode(error: unknown): string {
  if (error instanceof OverlapModelTimeoutError) return "OVERLAP_MODEL_TIMEOUT";
  if (error instanceof JobProcessingError) {
    return error.message === "AI_OPERATION_TIMEOUT" ? "OVERLAP_MODEL_TIMEOUT" : error.message;
  }
  if (error instanceof Error && error.message.toLocaleLowerCase().includes("timeout"))
    return "OVERLAP_MODEL_TIMEOUT";
  return "OVERLAP_RETRIEVAL_INCOMPLETE";
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
        outgoingRelations: {
          include: {
            targetVersion: {
              include: { chunks: { where: { visibility: "EMPLOYEE_SAFE" }, select: { id: true } } },
            },
          },
        },
        incomingRelations: {
          include: {
            sourceVersion: {
              include: { chunks: { where: { visibility: "EMPLOYEE_SAFE" }, select: { id: true } } },
            },
          },
        },
      },
    });
    if (
      !version ||
      !["PUBLISHED", "SUPERSEDED"].includes(version.status) ||
      !version.confidentialityPolicyId
    ) {
      throw new JobProcessingError("VERSION_NOT_INDEXABLE", false);
    }
    const policy = await database.confidentialityPolicy.findUnique({
      where: { id: version.confidentialityPolicyId },
    });
    if (!policy) throw new JobProcessingError("POLICY_NOT_FOUND", false);
    const employeeSafeRelatedVersion = (relatedVersion: {
      status: string;
      confidentialityPolicyId: string | null;
      chunks: Array<{ id: string }>;
    }) =>
      ["PUBLISHED", "SUPERSEDED"].includes(relatedVersion.status) &&
      relatedVersion.confidentialityPolicyId === policy.id &&
      relatedVersion.chunks.length > 0;
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
      relationContext: [
        ...version.outgoingRelations
          .filter(
            (relation) =>
              chunk.visibility === "HR_ONLY" || employeeSafeRelatedVersion(relation.targetVersion),
          )
          .map((relation) => ({
            type: relation.type,
            relatedVersionId: relation.targetVersionId,
            relatedIomNumber: relation.targetVersion.iomNumber,
            effectiveFrom: relation.targetVersion.effectiveFrom.toISOString(),
            topicScope: Array.isArray(relation.topicScope)
              ? relation.topicScope.filter((topic): topic is string => typeof topic === "string")
              : [],
            ...(chunk.visibility === "HR_ONLY" && relation.note ? { note: relation.note } : {}),
          })),
        ...version.incomingRelations
          .filter(
            (relation) =>
              chunk.visibility === "HR_ONLY" || employeeSafeRelatedVersion(relation.sourceVersion),
          )
          .map((relation) => ({
            type: relation.type,
            relatedVersionId: relation.sourceVersionId,
            relatedIomNumber: relation.sourceVersion.iomNumber,
            effectiveFrom: relation.sourceVersion.effectiveFrom.toISOString(),
            topicScope: Array.isArray(relation.topicScope)
              ? relation.topicScope.filter((topic): topic is string => typeof topic === "string")
              : [],
            ...(chunk.visibility === "HR_ONLY" && relation.note ? { note: relation.note } : {}),
          })),
      ],
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
        version: {
          status: { in: ["IN_REVIEW", "READY_TO_PUBLISH", "PUBLISHED", "SUPERSEDED"] },
        },
      },
      include: {
        version: { include: { annotations: true, uploadedFile: { include: { batch: true } } } },
      },
    });
    let analyzedCount = 0;
    let preservedReviewCount = 0;
    for (const chunk of chunks) {
      const reviewedDecision = await database.confidentialityDecision.findFirst({
        where: { chunkId: chunk.id, policyId, reviewedAt: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (reviewedDecision) {
        preservedReviewCount += 1;
        continue;
      }
      const annotations = relevantAnnotations(chunk.version.annotations, chunk);
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
            manualMarkers: annotations.map((annotation) => ({
              kind: annotation.kind,
              ...(annotation.note ? { note: annotation.note } : {}),
            })),
          },
          signal: operationSignal,
        }),
      );
      await database.$transaction(async (transaction) => {
        await transaction.confidentialityDecision.deleteMany({
          where: { chunkId: chunk.id, policyId, reviewedAt: null },
        });
        await transaction.confidentialityDecision.create({
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
      });
      analyzedCount += 1;
    }
    await database.auditEvent.create({
      data: {
        action: "CONFIDENTIALITY_POLICY_EVALUATE_COMPLETE",
        entityType: "ConfidentialityPolicy",
        entityId: policyId,
        correlationId: job.id,
        resultStatus: "SUCCESS",
        modelId,
        policyVersion: policy.version,
        safeMetadata: { analyzedCount, preservedReviewCount },
      },
    });
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
    let candidateVersionId: string | null = null;
    try {
      const currentRun = await database.overlapRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (!currentRun) throw new JobProcessingError("OVERLAP_RUN_NOT_FOUND", false);
      if (currentRun.status === "COMPLETED")
        throw new JobProcessingError("OVERLAP_RUN_ALREADY_COMPLETED", false);
      const run = await database.overlapRun.update({
        where: { id: runId },
        data: { status: "RUNNING", errorCode: null },
        include: {
          candidateVersion: {
            include: {
              chunks: { orderBy: { ordinal: "asc" } },
              outgoingRelations: {
                select: { targetVersionId: true, targetVersion: { select: { iomNumber: true } } },
              },
            },
          },
        },
      });
      candidateVersionId = run.candidateVersionId;
      const policy = await database.confidentialityPolicy.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (!policy) throw new JobProcessingError("ACTIVE_POLICY_NOT_FOUND", false);
      const probes = run.candidateVersion.chunks.flatMap((chunk) =>
        overlapWindows(chunk.text).map((window) => ({
          candidateChunkId: chunk.id,
          text: [
            `IOM ${run.candidateVersion.iomNumber}`,
            `Judul ${run.candidateVersion.title}`,
            `Halaman ${chunk.pageStart ?? 1}`,
            `Berlaku ${run.candidateVersion.effectiveFrom.toISOString().slice(0, 10)}`,
            window.text,
          ].join("\n"),
          ordinal: window.ordinal,
        })),
      );
      if (probes.length === 0) throw new JobProcessingError("OVERLAP_INPUT_TOO_LARGE", false);

      const semanticPairs = new Map<
        string,
        { candidateChunkId: string; existingChunkId: string; versionId: string; score: number }
      >();
      const lexicalPairs = new Map<
        string,
        { candidateChunkId: string; existingChunkId: string; versionId: string; score: number }
      >();
      let semanticCandidateCount = 0;
      let lexicalCandidateCount = 0;
      for (let offset = 0; offset < probes.length; offset += 4) {
        signal.throwIfAborted();
        const batch = probes.slice(offset, offset + 4);
        const semanticResults = await index.searchProbes(
          batch.map((probe) => probe.text),
          { actorId: "worker", accessScope: "HR", policyVersion: policy.version },
          signal,
        );
        const lexicalResults = await Promise.all(
          batch.map(async (probe) => {
            const tokens = lexicalTokens(probe.text);
            return tokens.length === 0
              ? []
              : await database.$queryRaw<
                  Array<{ versionId: string; chunkId: string; score: number }>
                >`
            SELECT v.id AS "versionId", c.id AS "chunkId",
              ts_rank_cd(to_tsvector('simple', c.text), to_tsquery('simple', ${tokens.join(" | ")})) AS score
            FROM "IomVersion" v
            JOIN "IomChunk" c ON c."versionId" = v.id
            WHERE v.id <> ${run.candidateVersionId}
              AND v.status IN ('PUBLISHED', 'SUPERSEDED')
              AND to_tsvector('simple', c.text) @@ to_tsquery('simple', ${tokens.join(" | ")})
            ORDER BY score DESC
            LIMIT 20
          `;
          }),
        );
        for (const [indexInBatch, probe] of batch.entries()) {
          const semantic = semanticResults[indexInBatch];
          if (!semantic) continue;
          for (const evidence of semantic.evidence) {
            semanticCandidateCount += 1;
            semanticPairs.set(`${probe.candidateChunkId}:${evidence.chunkId}`, {
              candidateChunkId: probe.candidateChunkId,
              existingChunkId: evidence.chunkId,
              versionId: evidence.versionId,
              score: evidence.score,
            });
          }
          for (const row of lexicalResults[indexInBatch] ?? []) {
            lexicalCandidateCount += 1;
            lexicalPairs.set(`${probe.candidateChunkId}:${row.chunkId}`, {
              candidateChunkId: probe.candidateChunkId,
              existingChunkId: row.chunkId,
              versionId: row.versionId,
              score: Number(row.score),
            });
          }
        }
      }

      const [explicitByIdentity, explicitByMetadata] = await Promise.all([
        database.$queryRaw<Array<{ id: string; effectiveFrom: Date }>>`
          SELECT "id", "effectiveFrom"
          FROM "IomVersion"
          WHERE "id" <> ${run.candidateVersionId}
            AND "status" IN ('PUBLISHED', 'SUPERSEDED')
            AND regexp_replace(upper("iomNumber"), '[^A-Z0-9]', '', 'g') =
              ${normalizeIomIdentity(run.candidateVersion.iomNumber)}
        `,
        database.iomVersion.findMany({
          where: {
            id: { not: run.candidateVersionId },
            status: { in: ["PUBLISHED", "SUPERSEDED"] },
            OR: [
              { documentId: run.candidateVersion.documentId },
              {
                id: {
                  in: run.candidateVersion.outgoingRelations.map(
                    (relation) => relation.targetVersionId,
                  ),
                },
              },
            ],
          },
          select: { id: true, effectiveFrom: true },
        }),
      ]);
      const explicitVersions = [
        ...new Map(
          [...explicitByIdentity, ...explicitByMetadata].map((candidate) => [
            candidate.id,
            candidate,
          ]),
        ).values(),
      ].sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime());
      const semanticVersions = rankVersionsByPairScore(semanticPairs.values());
      const lexicalVersions = rankVersionsByPairScore(lexicalPairs.values());
      const fusedVersions = reciprocalRankFusion([semanticVersions, lexicalVersions]);
      const explicitIds = explicitVersions.map((candidate) => candidate.id);
      const rankedIds = [
        ...explicitIds,
        ...fusedVersions.map((candidate) => candidate.id).filter((id) => !explicitIds.includes(id)),
      ].slice(0, 10);
      const ranked = rankedIds.map((id) => ({ id }));
      const mergedPairs = mergeOverlapPairs(semanticPairs, lexicalPairs);
      const authorizedCandidates = await database.iomVersion.findMany({
        where: {
          id: { in: ranked.map((candidate) => candidate.id), not: run.candidateVersionId },
          status: { in: ["PUBLISHED", "SUPERSEDED"] },
        },
        include: {
          chunks: {
            where: {
              visibility: { in: ["EMPLOYEE_SAFE", "HR_ONLY"] },
              vectorGeneration: policy.version,
            },
            orderBy: { ordinal: "asc" },
          },
        },
      });
      const authorizedById = new Map(
        authorizedCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const candidateChunkById = new Map(
        run.candidateVersion.chunks.map((chunk) => [chunk.id, chunk]),
      );
      const metrics = {
        policyVersion: policy.version,
        candidateChunkCount: run.candidateVersion.chunks.length,
        queryWindowCount: probes.length,
        semanticCandidateCount,
        lexicalCandidateCount,
        explicitCandidateCount: explicitVersions.length,
        authorizedCandidateCount: authorizedCandidates.length,
        analyzedCandidateCount: 0,
        modelCallCount: 0,
        truncatedCandidateCount: 0,
      };
      for (const candidate of ranked) {
        const existing = authorizedById.get(candidate.id);
        if (!existing) continue;
        const pairs = [...mergedPairs.values()]
          .filter((pair) => pair.versionId === existing.id)
          .sort((left, right) => right.score - left.score);
        const selectedPairs = selectDiversePairs(pairs);
        const coverageWarning =
          selectedPairs.length < pairs.length
            ? "TOO_MANY_RELEVANT_PAIRS"
            : pairs.length === 0
              ? "NO_RELEVANT_EVIDENCE_PAIRS"
              : undefined;
        if (coverageWarning) metrics.truncatedCandidateCount += 1;
        const candidateIds = new Set(selectedPairs.map((pair) => pair.candidateChunkId));
        const existingIds = new Set(selectedPairs.map((pair) => pair.existingChunkId));
        const candidateChunks = [...candidateIds]
          .map((id) => candidateChunkById.get(id))
          .filter((chunk): chunk is (typeof run.candidateVersion.chunks)[number] => Boolean(chunk));
        const existingChunks = existing.chunks.filter((chunk) => existingIds.has(chunk.id));
        const match = await analyzeOverlap({
          agent: analyzer,
          candidateVersionId: run.candidateVersionId,
          existingVersionId: existing.id,
          candidateChunks: candidateChunks.map((chunk) => ({ id: chunk.id, text: chunk.text })),
          existingChunks: existingChunks.map((chunk) => ({ id: chunk.id, text: chunk.text })),
          evidencePairs: selectedPairs.map((pair) => ({
            candidateChunkId: pair.candidateChunkId,
            existingChunkId: pair.existingChunkId,
          })),
          ...(coverageWarning ? { coverageWarning } : {}),
          modelTimeoutMs: aiTimeoutMs,
          signal,
        });
        metrics.analyzedCandidateCount += 1;
        metrics.modelCallCount +=
          selectedPairs.length > 8 ? Math.ceil(selectedPairs.length / 8) + 1 : 1;
        await database.overlapMatch.upsert({
          where: { runId_existingVersionId: { runId, existingVersionId: existing.id } },
          create: {
            runId,
            existingVersionId: existing.id,
            recommendation: match.recommendation,
            confidence: match.confidence,
            sharedTopics: match.sharedTopics,
            changedRules: match.changedRules,
            conflicts: match.conflicts,
            evidence: match.evidence,
          },
          update: {
            recommendation: match.recommendation,
            confidence: match.confidence,
            sharedTopics: match.sharedTopics,
            changedRules: match.changedRules,
            conflicts: match.conflicts,
            evidence: match.evidence,
          },
        });
      }
      await database.$transaction(async (transaction) => {
        await transaction.overlapRun.update({
          where: { id: runId },
          data: {
            status: "COMPLETED",
            coverageComplete: true,
            analysisMetrics: metrics,
            completedAt: new Date(),
            errorCode: null,
          },
        });
      });
      await database.auditEvent.create({
        data: {
          action: "OVERLAP_RUN_COMPLETE",
          entityType: "OverlapRun",
          entityId: runId,
          correlationId: job.id,
          resultStatus: "SUCCESS",
          modelId,
          safeMetadata: {
            analyzedCandidateCount: metrics.analyzedCandidateCount,
            queryWindowCount: metrics.queryWindowCount,
            modelCallCount: metrics.modelCallCount,
          },
        },
      });
      await refreshIomPublishReadiness(database, run.candidateVersionId);
    } catch (error) {
      const errorCode = overlapErrorCode(error);
      const transient = error instanceof JobProcessingError ? error.transient : true;
      const terminal = !transient || job.attempts >= job.maxAttempts;
      console.error(
        JSON.stringify({
          level: "error",
          message: "Overlap analysis failed",
          runId,
          errorCode,
          errorKind: error instanceof Error ? error.constructor.name : "UnknownError",
          providerStatus:
            typeof (error as { status?: unknown })?.status === "number"
              ? (error as { status: number }).status
              : undefined,
          providerCode:
            typeof (error as { code?: unknown })?.code === "string"
              ? (error as { code: string }).code
              : undefined,
        }),
      );
      if (candidateVersionId) {
        await database.overlapRun
          .update({
            where: { id: runId },
            data: terminal
              ? { status: "FAILED", coverageComplete: false, errorCode, completedAt: new Date() }
              : { status: "QUEUED", coverageComplete: false, errorCode: null, completedAt: null },
          })
          .catch(() => undefined);
        if (terminal) {
          await database.auditEvent
            .create({
              data: {
                action: "OVERLAP_RUN_FAILED",
                entityType: "OverlapRun",
                entityId: runId,
                correlationId: job.id,
                resultStatus: "FAILED",
                modelId,
                safeMetadata: { errorCode },
              },
            })
            .catch(() => undefined);
        }
        await refreshIomPublishReadiness(database, candidateVersionId).catch(() => undefined);
      }
      if (error instanceof JobProcessingError)
        throw new JobProcessingError(errorCode, error.transient);
      // Retrieval providers and database connections can fail transiently. Explicit input and
      // lifecycle failures already use JobProcessingError(false), so unknown overlap failures
      // should get the worker's bounded retry policy instead of becoming terminal immediately.
      throw new JobProcessingError(errorCode, true);
    }
  };
}
