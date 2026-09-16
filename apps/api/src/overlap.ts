import { enqueueJob } from "@iom/database/jobs";
import { refreshIomPublishReadiness } from "@iom/database/readiness";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "./audit.js";
import { authMiddleware, requireHr } from "./auth.js";
import type { AppBindings } from "./types.js";

const decisionSchema = z.object({
  decision: z.enum([
    "ARCHIVE_EXISTING",
    "PUBLISH_AS_COMPLEMENT",
    "NO_MATERIAL_OVERLAP",
    "MANUAL_REVIEW",
  ]),
  note: z.string().trim().max(2_000).optional(),
});

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
    });
    if (!version) return context.json({ error: "Versi kandidat tidak ditemukan." }, 404);
    if (!version.metadataConfirmedAt)
      return context.json(
        { error: "Konfirmasi metadata sebelum menjalankan analisis overlap." },
        409,
      );
    const activeRun = await database.overlapRun.findFirst({
      where: { candidateVersionId: version.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (activeRun) return context.json({ run: activeRun }, 202);
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
    return context.json({ run }, 202);
  });

  app.get("/overlap/runs", async (context) => {
    const runs = await context.get("database").overlapRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        candidateVersion: true,
        matches: { include: { existingVersion: true, decision: true } },
      },
    });
    return context.json({ runs });
  });

  app.post("/overlap/matches/:matchId/decision", async (context) => {
    const input = decisionSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Keputusan overlap tidak valid." }, 400);
    const database = context.get("database");
    const matchId = context.req.param("matchId");
    const match = await database.overlapMatch.findUnique({
      where: { id: matchId },
      include: { run: { select: { candidateVersionId: true, status: true } } },
    });
    if (!match) return context.json({ error: "Match overlap tidak ditemukan." }, 404);
    if (match.run.status !== "COMPLETED")
      return context.json({ error: "Analisis overlap belum selesai." }, 409);
    const actorId = context.get("actor").id;
    const decision = await database.$transaction(async (transaction) => {
      const saved = await transaction.overlapDecision.upsert({
        where: { matchId },
        create: {
          matchId,
          decidedById: actorId,
          decision: input.data.decision,
          ...(input.data.note ? { note: input.data.note } : {}),
        },
        update: {
          decidedById: actorId,
          decision: input.data.decision,
          ...(input.data.note ? { note: input.data.note } : {}),
        },
      });
      const relationType =
        input.data.decision === "ARCHIVE_EXISTING"
          ? "REPLACES"
          : input.data.decision === "PUBLISH_AS_COMPLEMENT"
            ? "COMPLEMENTS"
            : null;
      await transaction.iomRelation.deleteMany({
        where: {
          overlapDecisionId: saved.id,
          ...(relationType ? { type: { not: relationType } } : {}),
        },
      });
      if (relationType) {
        await transaction.iomRelation.upsert({
          where: {
            sourceVersionId_targetVersionId_type: {
              sourceVersionId: match.run.candidateVersionId,
              targetVersionId: match.existingVersionId,
              type: relationType,
            },
          },
          create: {
            sourceVersionId: match.run.candidateVersionId,
            targetVersionId: match.existingVersionId,
            overlapDecisionId: saved.id,
            type: relationType,
            confirmedById: actorId,
            note: "Dikonfirmasi melalui keputusan overlap HR.",
          },
          update: { confirmedById: actorId, overlapDecisionId: saved.id },
        });
      }
      return saved;
    });
    await audit(database, {
      actorId,
      action: "OVERLAP_DECISION",
      entityType: "OverlapMatch",
      entityId: matchId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: { decision: input.data.decision },
    });
    await refreshIomPublishReadiness(database, match.run.candidateVersionId);
    return context.json({ decision });
  });
}
