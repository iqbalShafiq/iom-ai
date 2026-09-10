import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { createEventStreamResponse } from "@anvia/server";
import type { ServerConfig } from "@iom/config";
import { createPolicySchema, createUploadBatchSchema, paginationSchema } from "@iom/contracts";
import { assertIomTransition } from "@iom/database/iom";
import { enqueueJob } from "@iom/database/jobs";
import { LocalFileStorage, MAX_BATCH_FILES, validateDocumentFile } from "@iom/documents";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "./audit.js";
import { authMiddleware, requireHr } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import type { AppBindings } from "./types.js";

const reviewSchema = z.object({
  decisions: z
    .array(
      z.object({
        chunkId: z.string().uuid(),
        visibility: z.enum(["EMPLOYEE_SAFE", "HR_ONLY"]),
        reason: z.string().trim().min(3).max(2_000),
      }),
    )
    .min(1)
    .max(200),
});

const relationSchema = z.object({
  targetVersionId: z.string().uuid(),
  type: z.enum(["REPLACES", "COMPLEMENTS", "PARTIALLY_OVERRIDES", "RELATED"]),
  note: z.string().trim().max(2_000).optional(),
  topicScope: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

export function registerDocumentRoutes(app: Hono<AppBindings>, config: ServerConfig) {
  const storage = new LocalFileStorage(config.STORAGE_ROOT);
  app.use("/uploads/*", authMiddleware(), requireHr());
  app.use("/iom/*", authMiddleware());
  app.use("/confidentiality/*", authMiddleware(), requireHr());

  app.post(
    "/uploads/batches",
    rateLimit({ limit: 20, windowMs: 60_000, keyPrefix: "batch" }),
    async (context) => {
      const parsed = createUploadBatchSchema.safeParse(await context.req.json().catch(() => ({})));
      if (!parsed.success) return context.json({ error: "Detail batch tidak valid." }, 400);
      const batch = await context.get("database").uploadBatch.create({
        data: {
          createdById: context.get("actor").id,
          defaultConfidential: parsed.data.defaultConfidential,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
      });
      return context.json({ batch }, 201);
    },
  );

  app.post(
    "/uploads/batches/:batchId/files",
    rateLimit({ limit: 600, windowMs: 60 * 60_000, keyPrefix: "file" }),
    async (context) => {
      const batchId = context.req.param("batchId");
      if (!batchId) return context.json({ error: "Batch tidak ditemukan." }, 404);
      const batch = await context.get("database").uploadBatch.findUnique({
        where: { id: batchId },
        include: { _count: { select: { files: true } } },
      });
      if (!batch || batch.createdById !== context.get("actor").id)
        return context.json({ error: "Batch tidak ditemukan." }, 404);
      if (batch._count.files >= MAX_BATCH_FILES)
        return context.json({ error: "Batas 500 file per batch tercapai." }, 409);
      const body = await context.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) return context.json({ error: "File diperlukan." }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let validated: Awaited<ReturnType<typeof validateDocumentFile>>;
      try {
        validated = await validateDocumentFile(bytes, file.name, file.type);
      } catch {
        return context.json({ error: "File tidak valid atau tidak didukung." }, 400);
      }
      const duplicate = await context
        .get("database")
        .uploadedFile.findFirst({ where: { sha256: validated.sha256 } });
      if (duplicate) return context.json({ duplicateOf: duplicate.id, status: "DUPLICATE" }, 409);
      const storageKey = `uploads/${batch.id}/${randomUUID()}-${basename(file.name)}`;
      await storage.put(storageKey, Readable.from(bytes));
      const uploaded = await context.get("database").$transaction(async (database) => {
        const row = await database.uploadedFile.create({
          data: {
            batchId: batch.id,
            originalName: file.name,
            mimeType: validated.mimeType,
            sizeBytes: validated.sizeBytes,
            sha256: validated.sha256,
            storageKey,
          },
        });
        await database.uploadBatch.update({
          where: { id: batch.id },
          data: { totalFiles: { increment: 1 } },
        });
        await enqueueJob(database, {
          type: "INGEST_DOCUMENT",
          payload: { uploadedFileId: row.id },
          idempotencyKey: `ingest:${row.id}:${validated.sha256}`,
        });
        return row;
      });
      return context.json({ file: uploaded }, 201);
    },
  );

  app.get("/uploads/batches", async (context) => {
    const batches = await context.get("database").uploadBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { files: { orderBy: { createdAt: "asc" } } },
    });
    return context.json({ batches });
  });

  app.get("/uploads/batches/:batchId/events", async (context) => {
    const database = context.get("database");
    const batchId = context.req.param("batchId");
    const actorId = context.get("actor").id;
    const batch = await database.uploadBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.createdById !== actorId)
      return context.json({ error: "Batch tidak ditemukan." }, 404);
    async function* progress() {
      while (true) {
        const files = await database.uploadedFile.findMany({
          where: { batchId },
          select: { id: true, stage: true, progress: true, safeError: true, updatedAt: true },
        });
        yield { type: "batch_progress", batchId, files };
        if (
          files.length > 0 &&
          files.every((file) => file.stage === "COMPLETED" || file.stage === "FAILED")
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    return createEventStreamResponse({ format: "sse", events: progress() });
  });

  app.get("/iom", async (context) => {
    const actor = context.get("actor");
    const versions = await context.get("database").iomVersion.findMany({
      where:
        actor.role === "HR_ADMIN"
          ? {}
          : { status: "PUBLISHED", chunks: { some: { visibility: "EMPLOYEE_SAFE" } } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { document: true, _count: { select: { chunks: true } } },
    });
    return context.json({ versions });
  });

  app.get("/iom/:versionId", async (context) => {
    const actor = context.get("actor");
    const version = await context.get("database").iomVersion.findFirst({
      where: {
        id: context.req.param("versionId"),
        ...(actor.role === "HR_ADMIN" ? {} : { status: "PUBLISHED" as const }),
      },
      include: {
        chunks: {
          where: actor.role === "HR_ADMIN" ? {} : { visibility: "EMPLOYEE_SAFE" },
          orderBy: { ordinal: "asc" },
          include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
        annotations: true,
        outgoingRelations: { include: { targetVersion: true } },
        incomingRelations: { include: { sourceVersion: true } },
        uploadedFile: true,
      },
    });
    if (!version) return context.json({ error: "IOM tidak ditemukan." }, 404);
    if (actor.role === "EMPLOYEE") {
      void audit(context.get("database"), {
        actorId: actor.id,
        action: "IOM_VIEW_EMPLOYEE",
        entityType: "IomVersion",
        entityId: version.id,
        correlationId: context.get("correlationId"),
        resultStatus: "SUCCESS",
      });
    }
    return context.json({ version });
  });

  app.get("/iom/:versionId/file", async (context) => {
    const actor = context.get("actor");
    const version = await context.get("database").iomVersion.findFirst({
      where: {
        id: context.req.param("versionId"),
        ...(actor.role === "HR_ADMIN" ? {} : { status: "PUBLISHED" as const }),
      },
      include: { uploadedFile: true },
    });
    if (!version?.uploadedFile) return context.json({ error: "File tidak ditemukan." }, 404);
    if (actor.role !== "HR_ADMIN") {
      const unsafe = await context
        .get("database")
        .iomChunk.count({ where: { versionId: version.id, visibility: { not: "EMPLOYEE_SAFE" } } });
      if (unsafe > 0)
        return context.json({ error: "Preview file asli hanya tersedia untuk HR." }, 403);
    }
    const stream = Readable.toWeb(
      createReadStream(storage.absolutePath(version.uploadedFile.storageKey)),
    ) as ReadableStream;
    return new Response(stream, {
      headers: { "Content-Type": version.uploadedFile.mimeType, "Content-Disposition": "inline" },
    });
  });

  app.post("/iom/:versionId/review", requireHr(), async (context) => {
    const parsed = reviewSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Keputusan review tidak valid." }, 400);
    const database = context.get("database");
    const actor = context.get("actor");
    const versionId = context.req.param("versionId");
    const version = await database.iomVersion.findUnique({ where: { id: versionId } });
    if (!version) return context.json({ error: "IOM tidak ditemukan." }, 404);
    if (version.status !== "IN_REVIEW")
      return context.json({ error: "IOM tidak berada dalam tahap review." }, 409);
    const reviewedChunks = await database.iomChunk.findMany({
      where: { versionId, id: { in: parsed.data.decisions.map((decision) => decision.chunkId) } },
      select: { id: true, text: true },
    });
    const chunkText = new Map(reviewedChunks.map((chunk) => [chunk.id, chunk.text]));
    if (reviewedChunks.length !== parsed.data.decisions.length)
      return context.json({ error: "Chunk review tidak valid." }, 400);
    await database.$transaction(
      parsed.data.decisions.flatMap((decision) => [
        database.iomChunk.update({
          where: { id: decision.chunkId, versionId },
          data: {
            visibility: decision.visibility,
            publicText:
              decision.visibility === "EMPLOYEE_SAFE"
                ? (chunkText.get(decision.chunkId) ?? "")
                : null,
          },
        }),
        database.iomAnnotation.create({
          data: {
            versionId,
            createdById: actor.id,
            kind: decision.visibility === "HR_ONLY" ? "CONFIDENTIAL" : "EMPLOYEE_SAFE",
            note: decision.reason,
          },
        }),
      ]),
    );
    const unresolved = await database.iomChunk.count({
      where: { versionId, visibility: "NEEDS_REVIEW" },
    });
    if (unresolved === 0)
      await database.iomVersion.update({
        where: { id: versionId },
        data: { status: "READY_TO_PUBLISH", reviewedById: actor.id },
      });
    await audit(database, {
      actorId: actor.id,
      action: "CONFIDENTIALITY_REVIEW",
      entityType: "IomVersion",
      entityId: versionId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: { decisions: parsed.data.decisions.length, unresolved },
    });
    return context.json({
      unresolved,
      status: unresolved === 0 ? "READY_TO_PUBLISH" : "IN_REVIEW",
    });
  });

  app.post("/iom/:versionId/publish", requireHr(), async (context) => {
    const database = context.get("database");
    const actor = context.get("actor");
    const versionId = context.req.param("versionId");
    const version = await database.iomVersion.findUnique({
      where: { id: versionId },
      include: { uploadedFile: true },
    });
    if (!version) return context.json({ error: "IOM tidak ditemukan." }, 404);
    assertIomTransition(version.status, "PUBLISHED");
    const unresolved = await database.iomChunk.count({
      where: { versionId, visibility: "NEEDS_REVIEW" },
    });
    if (unresolved > 0)
      return context.json({ error: "Semua keputusan kerahasiaan harus diselesaikan." }, 409);
    await database.$transaction(async (transaction) => {
      await transaction.iomVersion.update({
        where: { id: versionId },
        data: { status: "PUBLISHED", publishedAt: new Date(), reviewedById: actor.id },
      });
      if (version.uploadedFileId)
        await transaction.uploadedFile.update({
          where: { id: version.uploadedFileId },
          data: { stage: "INDEXING", progress: 85 },
        });
      await enqueueJob(transaction, {
        type: "INDEX_VERSION",
        payload: { versionId },
        idempotencyKey: `index:${versionId}:${version.sourceHash}`,
      });
    });
    await audit(database, {
      actorId: actor.id,
      action: "IOM_PUBLISH",
      entityType: "IomVersion",
      entityId: versionId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
    });
    return context.json({ status: "PUBLISHED" });
  });

  app.post("/iom/:versionId/relations", requireHr(), async (context) => {
    const parsed = relationSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Relasi IOM tidak valid." }, 400);
    const database = context.get("database");
    const sourceVersionId = context.req.param("versionId");
    const actor = context.get("actor");
    const relation = await database.$transaction(async (transaction) => {
      const created = await transaction.iomRelation.create({
        data: {
          sourceVersionId,
          targetVersionId: parsed.data.targetVersionId,
          type: parsed.data.type,
          confirmedById: actor.id,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          ...(parsed.data.topicScope ? { topicScope: parsed.data.topicScope } : {}),
        },
      });
      if (parsed.data.type === "REPLACES") {
        await transaction.iomVersion.update({
          where: { id: parsed.data.targetVersionId },
          data: { status: "SUPERSEDED" },
        });
      }
      return created;
    });
    return context.json({ relation }, 201);
  });

  app.post("/iom/:versionId/archive", requireHr(), async (context) => {
    const database = context.get("database");
    const version = await database.iomVersion.findUnique({
      where: { id: context.req.param("versionId") },
    });
    if (!version) return context.json({ error: "IOM tidak ditemukan." }, 404);
    assertIomTransition(version.status, "ARCHIVED");
    await database.iomVersion.update({ where: { id: version.id }, data: { status: "ARCHIVED" } });
    return context.json({ status: "ARCHIVED" });
  });

  app.get("/confidentiality/policies", async (context) => {
    const policies = await context
      .get("database")
      .confidentialityPolicy.findMany({ orderBy: { version: "desc" } });
    return context.json({ policies });
  });

  app.post("/confidentiality/policies", async (context) => {
    const parsed = createPolicySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Policy tidak valid." }, 400);
    const highest = await context
      .get("database")
      .confidentialityPolicy.aggregate({ _max: { version: true } });
    const policy = await context.get("database").confidentialityPolicy.create({
      data: {
        ...parsed.data,
        version: (highest._max.version ?? 0) + 1,
        createdById: context.get("actor").id,
      },
    });
    return context.json({ policy }, 201);
  });

  app.post("/confidentiality/policies/:policyId/evaluate", async (context) => {
    const database = context.get("database");
    const policyId = context.req.param("policyId");
    await database.confidentialityPolicy.update({
      where: { id: policyId },
      data: { status: "EVALUATING" },
    });
    const job = await enqueueJob(database, {
      type: "EVALUATE_POLICY",
      payload: { policyId },
      idempotencyKey: `policy-eval:${policyId}`,
    });
    return context.json({ jobId: job.id }, 202);
  });

  app.post("/confidentiality/policies/:policyId/activate", async (context) => {
    const database = context.get("database");
    const policyId = context.req.param("policyId");
    await database.$transaction([
      database.confidentialityPolicy.updateMany({
        where: { status: "ACTIVE" },
        data: { status: "RETIRED" },
      }),
      database.confidentialityPolicy.update({
        where: { id: policyId, status: "EVALUATING" },
        data: { status: "ACTIVE", activatedAt: new Date() },
      }),
    ]);
    return context.json({ status: "ACTIVE" });
  });

  app.get("/audit", requireHr(), async (context) => {
    const page = paginationSchema.parse(context.req.query());
    const events = await context.get("database").auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: page.limit,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return context.json({ events, nextCursor: events.at(-1)?.id });
  });
}
