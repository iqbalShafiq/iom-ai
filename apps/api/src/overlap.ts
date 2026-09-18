import { overlapDecisionPayloadSchema } from "@iom/contracts";
import { enqueueJob } from "@iom/database/jobs";
import { refreshIomPublishReadiness } from "@iom/database/readiness";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "./audit.js";
import { authMiddleware, requireHr } from "./auth.js";
import { enqueueLangfuseScore } from "./langfuse-jobs.js";
import type { AppBindings } from "./types.js";

const evidenceSchema = z.array(
  z.object({
    candidateChunkId: z.string().uuid(),
    existingChunkId: z.string().uuid(),
    explanation: z.string(),
  }),
);
const noMatchConfirmationSchema = z.object({ note: z.string().trim().max(2_000).optional() });
const safeOverlapErrorCodes = new Set([
  "OVERLAP_RETRIEVAL_INCOMPLETE",
  "OVERLAP_INPUT_TOO_LARGE",
  "OVERLAP_MODEL_TIMEOUT",
  "OVERLAP_MODEL_SCHEMA_INVALID",
  "OVERLAP_PROVENANCE_INVALID",
  "OVERLAP_NO_AUTHORIZED_CANDIDATES",
]);

function normalizeTopics(topics: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  return (topics ?? []).reduce<string[]>((result, topic) => {
    const value = topic.trim();
    const key = value.toLocaleLowerCase("id-ID");
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
    return result;
  }, []);
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isSerializableConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

function changedRulesDto(value: unknown) {
  return safeArray(value).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const rule = item as Record<string, unknown>;
    return [
      {
        subject: typeof rule.subject === "string" ? rule.subject.slice(0, 200) : "Tidak ditentukan",
        previousValue:
          typeof rule.previousValue === "string" ? rule.previousValue.slice(0, 2_000) : null,
        proposedValue:
          typeof rule.proposedValue === "string" ? rule.proposedValue.slice(0, 2_000) : null,
        effectiveFrom: typeof rule.effectiveFrom === "string" ? rule.effectiveFrom : null,
      },
    ];
  });
}

function versionSummary(version: {
  id: string;
  iomNumber: string;
  title: string;
  revision: number;
  status: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}) {
  return {
    id: version.id,
    iomNumber: version.iomNumber,
    title: version.title,
    revision: version.revision,
    status: version.status,
    effectiveFrom: version.effectiveFrom.toISOString(),
    ...(version.effectiveUntil ? { effectiveUntil: version.effectiveUntil.toISOString() } : {}),
  };
}

async function projectEvidence(
  match: {
    evidence: unknown;
    recommendation: string;
    run: { candidateVersionId: string };
    existingVersionId: string;
  },
  context: {
    chunksById: ReadonlyMap<
      string,
      {
        id: string;
        versionId: string;
        vectorGeneration: number | null;
        text: string;
        pageStart: number | null;
        section: string | null;
      }
    >;
    versionsById: ReadonlyMap<
      string,
      { id: string; iomNumber: string; title: string; status: string }
    >;
  },
  policyVersion?: number,
) {
  const parsed = evidenceSchema.safeParse(match.evidence);
  if (!parsed.success) return { evidenceStatus: "MISSING" as const, evidence: [] };
  if (parsed.data.length === 0) {
    return {
      evidenceStatus:
        match.recommendation === "NO_MATERIAL_OVERLAP"
          ? ("CURRENT" as const)
          : ("MISSING" as const),
      evidence: [],
    };
  }
  const candidate = context.versionsById.get(match.run.candidateVersionId);
  const existing = context.versionsById.get(match.existingVersionId);
  if (
    !candidate ||
    !existing ||
    !["IN_REVIEW", "READY_TO_PUBLISH"].includes(candidate.status) ||
    !["PUBLISHED", "SUPERSEDED"].includes(existing.status)
  ) {
    return { evidenceStatus: "STALE" as const, evidence: [] };
  }
  const evidence: Array<{ explanation: string; candidate: object; existing: object }> = [];
  for (const item of parsed.data) {
    const candidateChunk = context.chunksById.get(item.candidateChunkId);
    const existingChunk = context.chunksById.get(item.existingChunkId);
    if (
      !candidateChunk ||
      !existingChunk ||
      candidateChunk.versionId !== candidate.id ||
      existingChunk.versionId !== existing.id ||
      (policyVersion !== undefined && existingChunk.vectorGeneration !== policyVersion)
    ) {
      return { evidenceStatus: "STALE" as const, evidence: [] };
    }
    evidence.push({
      explanation: item.explanation,
      candidate: {
        versionId: candidate.id,
        iomNumber: candidate.iomNumber,
        title: candidate.title,
        ...(candidateChunk.pageStart ? { page: candidateChunk.pageStart } : {}),
        ...(candidateChunk.section ? { section: candidateChunk.section } : {}),
        excerpt: candidateChunk.text.slice(0, 500),
      },
      existing: {
        versionId: existing.id,
        iomNumber: existing.iomNumber,
        title: existing.title,
        ...(existingChunk.pageStart ? { page: existingChunk.pageStart } : {}),
        ...(existingChunk.section ? { section: existingChunk.section } : {}),
        excerpt: existingChunk.text.slice(0, 500),
      },
    });
  }
  return { evidenceStatus: "CURRENT" as const, evidence };
}

export function registerOverlapRoutes(app: Hono<AppBindings>, modelId: string) {
  app.use("/overlap/*", authMiddleware(), requireHr());

  app.post("/overlap/runs", async (context) => {
    const input = z
      .object({ candidateVersionId: z.string().uuid() })
      .safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Versi kandidat tidak valid." }, 400);
    const database = context.get("database");
    const version = await database.iomVersion.findFirst({
      where: {
        id: input.data.candidateVersionId,
        status: { in: ["IN_REVIEW", "READY_TO_PUBLISH"] },
      },
      select: { id: true, metadataConfirmedAt: true },
    });
    if (!version) return context.json({ error: "Versi kandidat tidak ditemukan." }, 404);
    if (!version.metadataConfirmedAt)
      return context.json(
        { error: "Konfirmasi metadata sebelum menjalankan analisis overlap." },
        409,
      );
    const activeRun = await database.overlapRun.findFirst({
      where: { candidateVersionId: version.id, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (activeRun)
      return context.json(
        {
          run: {
            id: activeRun.id,
            status: activeRun.status,
            createdAt: activeRun.createdAt.toISOString(),
          },
        },
        202,
      );
    try {
      const run = await database.$transaction(async (transaction) => {
        const created = await transaction.overlapRun.create({
          data: { candidateVersionId: version.id, status: "QUEUED", modelId },
        });
        await transaction.iomRelation.deleteMany({
          where: { sourceVersionId: version.id, overlapDecisionId: { not: null } },
        });
        await enqueueJob(transaction, {
          type: "ANALYZE_OVERLAP",
          payload: { runId: created.id },
          idempotencyKey: `overlap:${created.id}`,
        });
        return created;
      });
      await refreshIomPublishReadiness(database, version.id);
      await audit(database, {
        actorId: context.get("actor").id,
        action: "OVERLAP_RUN_START",
        entityType: "OverlapRun",
        entityId: run.id,
        correlationId: context.get("correlationId"),
        resultStatus: "SUCCESS",
      });
      return context.json(
        { run: { id: run.id, status: run.status, createdAt: run.createdAt.toISOString() } },
        202,
      );
    } catch (error) {
      const isActiveRunRace =
        error instanceof Error &&
        (error.message.includes("OverlapRun_one_active_per_candidate") ||
          (error as Error & { code?: string }).code === "P2002");
      if (isActiveRunRace) {
        const current = await database.overlapRun.findFirst({
          where: { candidateVersionId: version.id, status: { in: ["QUEUED", "RUNNING"] } },
          orderBy: { createdAt: "desc" },
        });
        if (current)
          return context.json(
            {
              run: {
                id: current.id,
                status: current.status,
                createdAt: current.createdAt.toISOString(),
              },
            },
            202,
          );
      }
      if (isSerializableConflict(error))
        return context.json({ error: "Analisis overlap sedang berubah. Coba lagi." }, 409);
      throw error;
    }
  });

  app.get("/overlap/runs", async (context) => {
    const database = context.get("database");
    const runs = await database.overlapRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        candidateVersion: {
          select: {
            id: true,
            iomNumber: true,
            title: true,
            revision: true,
            status: true,
            effectiveFrom: true,
            effectiveUntil: true,
          },
        },
        noMatchConfirmedBy: { select: { name: true } },
        matches: {
          include: {
            existingVersion: {
              select: {
                id: true,
                iomNumber: true,
                title: true,
                revision: true,
                status: true,
                effectiveFrom: true,
                effectiveUntil: true,
              },
            },
            decision: { include: { decidedBy: { select: { name: true } } } },
          },
        },
      },
    });
    const evidenceIds = new Set<string>();
    const evidenceVersionIds = new Set<string>();
    for (const run of runs) {
      evidenceVersionIds.add(run.candidateVersionId);
      for (const match of run.matches) {
        evidenceVersionIds.add(match.existingVersionId);
        const parsed = evidenceSchema.safeParse(match.evidence);
        if (parsed.success) {
          for (const item of parsed.data) {
            evidenceIds.add(item.candidateChunkId);
            evidenceIds.add(item.existingChunkId);
          }
        }
      }
    }
    const [evidenceChunks, evidenceVersions] = await Promise.all([
      evidenceIds.size
        ? database.iomChunk.findMany({
            where: {
              id: { in: [...evidenceIds] },
              visibility: { in: ["EMPLOYEE_SAFE", "HR_ONLY"] },
            },
            select: {
              id: true,
              versionId: true,
              vectorGeneration: true,
              text: true,
              pageStart: true,
              section: true,
            },
          })
        : [],
      evidenceVersionIds.size
        ? database.iomVersion.findMany({
            where: { id: { in: [...evidenceVersionIds] } },
            select: { id: true, iomNumber: true, title: true, status: true },
          })
        : [],
    ]);
    const projectionContext = {
      chunksById: new Map(evidenceChunks.map((chunk) => [chunk.id, chunk])),
      versionsById: new Map(evidenceVersions.map((version) => [version.id, version])),
    };
    const projected = await Promise.all(
      runs.map(async (run) => {
        const runMetrics =
          run.analysisMetrics &&
          typeof run.analysisMetrics === "object" &&
          !Array.isArray(run.analysisMetrics)
            ? (run.analysisMetrics as Record<string, unknown>)
            : {};
        const policyVersion =
          typeof runMetrics.policyVersion === "number" ? runMetrics.policyVersion : undefined;
        const matches = await Promise.all(
          run.matches.map(async (match) => {
            const projectedEvidence = await projectEvidence(
              {
                ...match,
                recommendation: match.decision?.outcome ?? match.recommendation,
                run: { candidateVersionId: run.candidateVersionId },
              },
              projectionContext,
              policyVersion,
            );
            return {
              id: match.id,
              recommendation: match.recommendation,
              confidence: match.confidence,
              sharedTopics: safeArray(match.sharedTopics).filter(
                (value): value is string => typeof value === "string",
              ),
              changedRules: changedRulesDto(match.changedRules),
              hasConflict: safeArray(match.conflicts).length > 0,
              conflicts: safeArray(match.conflicts).filter(
                (value): value is string => typeof value === "string",
              ),
              evidenceStatus: projectedEvidence.evidenceStatus,
              evidence: projectedEvidence.evidence,
              existingVersion: versionSummary(match.existingVersion),
              decision: match.decision
                ? {
                    status: match.decision.status,
                    ...(match.decision.outcome ? { outcome: match.decision.outcome } : {}),
                    ...(match.decision.rationale ? { rationale: match.decision.rationale } : {}),
                    topicScope: safeArray(match.decision.topicScope).filter(
                      (value): value is string => typeof value === "string",
                    ),
                    decidedByName: match.decision.decidedBy.name,
                    updatedAt: match.decision.updatedAt.toISOString(),
                  }
                : null,
            };
          }),
        );
        return {
          id: run.id,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
          ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
          coverageComplete: run.coverageComplete,
          ...(run.errorCode && safeOverlapErrorCodes.has(run.errorCode)
            ? { safeErrorCode: run.errorCode }
            : {}),
          candidateVersion: versionSummary(run.candidateVersion),
          metrics: {
            analyzedCandidateCount:
              typeof runMetrics.analyzedCandidateCount === "number"
                ? runMetrics.analyzedCandidateCount
                : matches.length,
            queryWindowCount:
              typeof runMetrics.queryWindowCount === "number" ? runMetrics.queryWindowCount : 0,
          },
          noMatchConfirmation:
            run.noMatchConfirmedAt && run.noMatchConfirmedBy
              ? {
                  confirmedAt: run.noMatchConfirmedAt.toISOString(),
                  confirmedByName: run.noMatchConfirmedBy.name,
                  ...(run.noMatchNote ? { note: run.noMatchNote } : {}),
                }
              : null,
          matches,
        };
      }),
    );
    return context.json({ runs: projected });
  });

  app.put("/overlap/matches/:matchId/decision", async (context) => {
    const input = overlapDecisionPayloadSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Keputusan overlap tidak valid.", issues: input.error.issues },
        400,
      );
    const database = context.get("database");
    const matchId = context.req.param("matchId");
    if (!z.string().uuid().safeParse(matchId).success)
      return context.json({ error: "Match overlap tidak valid." }, 400);
    const actorId = context.get("actor").id;
    const next =
      input.data.status === "PENDING_REVIEW"
        ? {
            status: "PENDING_REVIEW" as const,
            outcome: null,
            rationale: input.data.rationale,
            topicScope: [],
          }
        : {
            status: "FINAL" as const,
            outcome: input.data.outcome,
            rationale: input.data.rationale?.trim() || null,
            topicScope: normalizeTopics(input.data.topicScope),
          };
    const saved = await (async () => {
      try {
        return await database.$transaction(
          async (transaction) => {
            const match = await transaction.overlapMatch.findUnique({
              where: { id: matchId },
              include: {
                run: {
                  select: {
                    id: true,
                    candidateVersionId: true,
                    status: true,
                    candidateVersion: { select: { status: true } },
                  },
                },
                existingVersion: { select: { status: true } },
              },
            });
            if (!match) return { kind: "NOT_FOUND" as const };
            if (match.run.status !== "COMPLETED") return { kind: "RUN_NOT_COMPLETED" as const };
            const latestRun = await transaction.overlapRun.findFirst({
              where: { candidateVersionId: match.run.candidateVersionId },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true },
            });
            if (latestRun?.id !== match.run.id) return { kind: "RUN_STALE" as const };
            if (!["IN_REVIEW", "READY_TO_PUBLISH"].includes(match.run.candidateVersion.status)) {
              return { kind: "CANDIDATE_IMMUTABLE" as const };
            }
            if (!["PUBLISHED", "SUPERSEDED"].includes(match.existingVersion.status)) {
              return { kind: "EXISTING_UNAVAILABLE" as const };
            }
            const previous = await transaction.overlapDecision.findUnique({ where: { matchId } });
            const decision = await transaction.overlapDecision.upsert({
              where: { matchId },
              create: {
                matchId,
                decidedById: actorId,
                status: next.status,
                outcome: next.outcome,
                rationale: next.rationale,
                topicScope: next.topicScope,
              },
              update: {
                decidedById: actorId,
                status: next.status,
                outcome: next.outcome,
                rationale: next.rationale,
                topicScope: next.topicScope,
              },
            });
            await transaction.iomRelation.deleteMany({ where: { overlapDecisionId: decision.id } });
            let relationId: string | null = null;
            if (next.status === "FINAL" && next.outcome !== "NO_MATERIAL_OVERLAP") {
              const relation = await transaction.iomRelation.upsert({
                where: {
                  sourceVersionId_targetVersionId_type: {
                    sourceVersionId: match.run.candidateVersionId,
                    targetVersionId: match.existingVersionId,
                    type: next.outcome,
                  },
                },
                create: {
                  sourceVersionId: match.run.candidateVersionId,
                  targetVersionId: match.existingVersionId,
                  overlapDecisionId: decision.id,
                  type: next.outcome,
                  topicScope: next.topicScope,
                  confirmedById: actorId,
                  note: next.rationale,
                },
                update: {
                  overlapDecisionId: decision.id,
                  topicScope: next.topicScope,
                  confirmedById: actorId,
                  note: next.rationale,
                },
              });
              relationId = relation.id;
            }
            return {
              kind: "SAVED" as const,
              decision,
              previous,
              candidateVersionId: match.run.candidateVersionId,
              existingVersionId: match.existingVersionId,
              relationId,
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (isSerializableConflict(error)) return null;
        throw error;
      }
    })();
    if (!saved) return context.json({ error: "Data berubah bersamaan. Coba lagi." }, 409);
    if (saved.kind === "NOT_FOUND")
      return context.json({ error: "Match overlap tidak ditemukan." }, 404);
    if (saved.kind === "RUN_NOT_COMPLETED")
      return context.json({ error: "Analisis overlap belum selesai." }, 409);
    if (saved.kind === "RUN_STALE")
      return context.json(
        { error: "Run overlap bukan analisis terbaru. Jalankan analisis terbaru." },
        409,
      );
    if (saved.kind === "CANDIDATE_IMMUTABLE")
      return context.json(
        { error: "Keputusan versi yang sudah dipublish tidak dapat diubah." },
        409,
      );
    if (saved.kind === "EXISTING_UNAVAILABLE")
      return context.json(
        { error: "Dokumen existing sudah tidak tersedia untuk direlasikan." },
        409,
      );
    await enqueueLangfuseScore(database, {
      kind: "overlap",
      entityId: matchId,
      revision: saved.decision.updatedAt.toISOString(),
    });
    await audit(database, {
      actorId,
      action:
        saved.decision.status === "PENDING_REVIEW"
          ? "OVERLAP_DECISION_PENDING"
          : saved.previous
            ? "OVERLAP_DECISION_UPDATE"
            : "OVERLAP_DECISION_CREATE",
      entityType: "OverlapMatch",
      entityId: matchId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: {
        previousStatus: saved.previous?.status ?? null,
        previousOutcome: saved.previous?.outcome ?? null,
        status: saved.decision.status,
        outcome: saved.decision.outcome,
        topicCount: next.topicScope.length,
      },
    });
    if (
      saved.decision.status === "FINAL" &&
      saved.decision.outcome &&
      saved.decision.outcome !== "NO_MATERIAL_OVERLAP"
    ) {
      await audit(database, {
        actorId,
        action:
          saved.decision.outcome === "REPLACES"
            ? "OVERLAP_RELATION_REPLACE"
            : "OVERLAP_RELATION_CREATE",
        entityType: "IomRelation",
        entityId: saved.relationId ?? saved.decision.id,
        correlationId: context.get("correlationId"),
        resultStatus: "SUCCESS",
        safeMetadata: { relationType: saved.decision.outcome, topicCount: next.topicScope.length },
      });
    }
    await refreshIomPublishReadiness(database, saved.candidateVersionId);
    return context.json({
      decision: {
        status: saved.decision.status,
        outcome: saved.decision.outcome,
        topicScope: next.topicScope,
        updatedAt: saved.decision.updatedAt.toISOString(),
      },
    });
  });

  app.put("/overlap/runs/:runId/no-match-confirmation", async (context) => {
    const input = noMatchConfirmationSchema.safeParse(await context.req.json().catch(() => ({})));
    if (!input.success) return context.json({ error: "Konfirmasi tidak valid." }, 400);
    const database = context.get("database");
    const runId = context.req.param("runId");
    if (!z.string().uuid().safeParse(runId).success)
      return context.json({ error: "Run overlap tidak valid." }, 400);
    const actorId = context.get("actor").id;
    const result = await (async () => {
      try {
        return await database.$transaction(
          async (transaction) => {
            const run = await transaction.overlapRun.findUnique({
              where: { id: runId },
              include: { matches: true, candidateVersion: { select: { status: true } } },
            });
            if (!run) return { kind: "NOT_FOUND" as const };
            if (run.status !== "COMPLETED" || !run.coverageComplete)
              return { kind: "INCOMPLETE" as const };
            if (run.matches.length > 0) return { kind: "HAS_MATCHES" as const };
            const latestRun = await transaction.overlapRun.findFirst({
              where: { candidateVersionId: run.candidateVersionId },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true },
            });
            if (latestRun?.id !== run.id) return { kind: "RUN_STALE" as const };
            if (!["IN_REVIEW", "READY_TO_PUBLISH"].includes(run.candidateVersion.status))
              return { kind: "CANDIDATE_IMMUTABLE" as const };
            const updated = await transaction.overlapRun.update({
              where: { id: runId },
              data: {
                noMatchConfirmedAt: new Date(),
                noMatchConfirmedById: actorId,
                ...(input.data.note ? { noMatchNote: input.data.note } : { noMatchNote: null }),
              },
            });
            return {
              kind: "CONFIRMED" as const,
              updated,
              candidateVersionId: run.candidateVersionId,
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (isSerializableConflict(error)) return null;
        throw error;
      }
    })();
    if (!result) return context.json({ error: "Data berubah bersamaan. Coba lagi." }, 409);
    if (result.kind === "NOT_FOUND")
      return context.json({ error: "Run overlap tidak ditemukan." }, 404);
    if (result.kind === "INCOMPLETE")
      return context.json({ error: "Run belum memiliki coverage lengkap." }, 409);
    if (result.kind === "HAS_MATCHES")
      return context.json(
        { error: "Konfirmasi tanpa overlap hanya tersedia jika tidak ada kandidat." },
        409,
      );
    if (result.kind === "RUN_STALE")
      return context.json({ error: "Run overlap bukan analisis terbaru." }, 409);
    if (result.kind === "CANDIDATE_IMMUTABLE")
      return context.json({ error: "Versi kandidat sudah dipublish dan tidak dapat diubah." }, 409);
    await audit(database, {
      actorId,
      action: "OVERLAP_NO_MATCH_CONFIRM",
      entityType: "OverlapRun",
      entityId: runId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
    });
    await refreshIomPublishReadiness(database, result.candidateVersionId);
    return context.json({ confirmedAt: result.updated.noMatchConfirmedAt?.toISOString() ?? null });
  });
}
