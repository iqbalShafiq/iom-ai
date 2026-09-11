import { enqueueJob } from "@iom/database/jobs";
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
    const version = await context
      .get("database")
      .iomVersion.findUnique({ where: { id: input.data.candidateVersionId } });
    if (!version) return context.json({ error: "Versi kandidat tidak ditemukan." }, 404);
    const run = await context.get("database").overlapRun.create({
      data: { candidateVersionId: version.id, status: "QUEUED", modelId },
    });
    await enqueueJob(context.get("database"), {
      type: "ANALYZE_OVERLAP",
      payload: { runId: run.id },
      idempotencyKey: `overlap:${run.id}`,
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
    const match = await database.overlapMatch.findUnique({ where: { id: matchId } });
    if (!match) return context.json({ error: "Match overlap tidak ditemukan." }, 404);
    const decision = await database.overlapDecision.upsert({
      where: { matchId },
      create: {
        matchId,
        decidedById: context.get("actor").id,
        decision: input.data.decision,
        ...(input.data.note ? { note: input.data.note } : {}),
      },
      update: {
        decidedById: context.get("actor").id,
        decision: input.data.decision,
        ...(input.data.note ? { note: input.data.note } : {}),
      },
    });
    await audit(database, {
      actorId: context.get("actor").id,
      action: "OVERLAP_DECISION",
      entityType: "OverlapMatch",
      entityId: matchId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: { decision: input.data.decision },
    });
    return context.json({ decision });
  });
}
