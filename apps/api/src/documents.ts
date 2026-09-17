import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { createEventStreamResponse } from "@anvia/server";
import type { ServerConfig } from "@iom/config";
import { createPolicySchema, createUploadBatchSchema, paginationSchema } from "@iom/contracts";
import { assertIomTransition } from "@iom/database/iom";
import { enqueueJob } from "@iom/database/jobs";
import { getPublishReadiness, refreshIomPublishReadiness } from "@iom/database/readiness";
import { LocalFileStorage, MAX_BATCH_FILES, validateDocumentFile } from "@iom/documents";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "./audit.js";
import { authMiddleware, requireHr } from "./auth.js";
import { needsConfidentialityReview } from "./confidentiality-review.js";
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

const policyDecisionReviewSchema = z.object({
  visibility: z.enum(["EMPLOYEE_SAFE", "HR_ONLY"]),
  reason: z.string().trim().min(3).max(2_000),
});

const versionMetadataSchema = z.object({
  iomNumber: z.string().trim().min(2).max(100),
  title: z.string().trim().min(3).max(300),
  publicationDate: z.coerce.date().optional(),
  effectiveFrom: z.coerce.date(),
  effectiveUntil: z.coerce.date().nullable().optional(),
  previousVersionId: z.string().uuid().optional(),
});

export function registerDocumentRoutes(app: Hono<AppBindings>, config: ServerConfig) {
  const storage = new LocalFileStorage(config.STORAGE_ROOT);
  app.use("/uploads/*", authMiddleware(), requireHr());
  app.use("/iom/*", authMiddleware());
  app.use("/confidentiality/*", authMiddleware(), requireHr());

  app.post(
    "/uploads/batches",
    rateLimit({
      limit: 20,
      windowMs: 60_000,
      keyPrefix: "batch",
      key: (context) => context.get("actor").id,
    }),
    async (context) => {
      const parsed = createUploadBatchSchema.safeParse(await context.req.json().catch(() => ({})));
      if (!parsed.success) return context.json({ error: "Detail batch tidak valid." }, 400);
      const batch = await context.get("database").uploadBatch.create({
        data: {
          createdById: context.get("actor").id,
          defaultConfidential: parsed.data.defaultConfidential,
          expectedFiles: parsed.data.expectedFiles,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
      });
      return context.json({ batch }, 201);
    },
  );

  app.post(
    "/uploads/batches/:batchId/files",
    rateLimit({
      limit: 600,
      windowMs: 60 * 60_000,
      keyPrefix: "file",
      key: (context) => context.get("actor").id,
    }),
    async (context) => {
      const batchId = context.req.param("batchId");
      if (!batchId) return context.json({ error: "Batch tidak ditemukan." }, 404);
      const batch = await context.get("database").uploadBatch.findUnique({
        where: { id: batchId },
        include: { _count: { select: { files: true } } },
      });
      if (!batch || batch.createdById !== context.get("actor").id)
        return context.json({ error: "Batch tidak ditemukan." }, 404);
      if (batch.sealedAt) return context.json({ error: "Batch upload sudah ditutup." }, 409);
      if (batch._count.files >= MAX_BATCH_FILES)
        return context.json({ error: "Batas 500 file per batch tercapai." }, 409);
      if (batch._count.files >= batch.expectedFiles)
        return context.json({ error: "Semua slot file pada batch sudah terisi." }, 409);
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
      // A Uint8Array is iterable, so Readable.from(bytes) emits one number per chunk.
      // Wrap it to preserve a single binary chunk for the writable stream.
      await storage.put(storageKey, Readable.from([Buffer.from(bytes)]));
      let uploaded: { id: string };
      try {
        uploaded = await context.get("database").$transaction(async (database) => {
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
      } catch (error) {
        await storage.delete(storageKey);
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return context.json({ status: "DUPLICATE" }, 409);
        }
        throw error;
      }
      await audit(context.get("database"), {
        actorId: context.get("actor").id,
        action: "UPLOAD_ACCEPTED",
        entityType: "UploadedFile",
        entityId: uploaded.id,
        correlationId: context.get("correlationId"),
        resultStatus: "SUCCESS",
        safeMetadata: { mimeType: validated.mimeType, sizeBytes: validated.sizeBytes },
      });
      return context.json({ file: uploaded }, 201);
    },
  );

  app.post("/uploads/batches/:batchId/seal", async (context) => {
    const database = context.get("database");
    const batch = await database.uploadBatch.findFirst({
      where: { id: context.req.param("batchId"), createdById: context.get("actor").id },
      include: { _count: { select: { files: true } } },
    });
    if (!batch) return context.json({ error: "Batch tidak ditemukan." }, 404);
    const sealed = await database.uploadBatch.update({
      where: { id: batch.id },
      data: { sealedAt: batch.sealedAt ?? new Date() },
    });
    return context.json({ batch: sealed, acceptedFiles: batch._count.files });
  });

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
        const [files, currentBatch] = await Promise.all([
          database.uploadedFile.findMany({
            where: { batchId },
            select: { id: true, stage: true, progress: true, safeError: true, updatedAt: true },
          }),
          database.uploadBatch.findUnique({ where: { id: batchId }, select: { sealedAt: true } }),
        ]);
        yield { type: "batch_progress", batchId, files };
        if (
          currentBatch?.sealedAt &&
          files.every(
            (file) =>
              file.stage === "REVIEWING" || file.stage === "COMPLETED" || file.stage === "FAILED",
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    return createEventStreamResponse({ format: "sse", events: progress() });
  });

  app.post("/uploads/files/:fileId/retry", async (context) => {
    const database = context.get("database");
    const actor = context.get("actor");
    const fileId = context.req.param("fileId");
    const file = await database.uploadedFile.findFirst({
      where: { id: fileId, batch: { createdById: actor.id }, stage: "FAILED" },
      include: { version: { select: { id: true, status: true, sourceHash: true } } },
    });
    if (!file) return context.json({ error: "File gagal tidak ditemukan." }, 404);
    const indexVersion = file.version?.status === "PUBLISHED" ? file.version : null;
    const job = await database.$transaction(async (transaction) => {
      await transaction.uploadedFile.update({
        where: { id: file.id },
        data: {
          stage: indexVersion ? "INDEXING" : "QUEUED",
          progress: indexVersion ? 85 : 0,
          errorCode: null,
          safeError: null,
        },
      });
      return enqueueJob(transaction, {
        type: indexVersion ? "INDEX_VERSION" : "INGEST_DOCUMENT",
        payload: indexVersion ? { versionId: indexVersion.id } : { uploadedFileId: file.id },
        idempotencyKey: indexVersion
          ? `index:${indexVersion.id}:${indexVersion.sourceHash}:manual-${randomUUID()}`
          : `ingest:${file.id}:${file.sha256}:manual-${randomUUID()}`,
      });
    });
    await audit(database, {
      actorId: actor.id,
      action: indexVersion ? "INDEX_RETRY" : "UPLOAD_RETRY",
      entityType: "UploadedFile",
      entityId: file.id,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
    });
    return context.json({ jobId: job.id }, 202);
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

  async function confidentialityReviewQueue(database: AppBindings["Variables"]["database"]) {
    const candidates = await database.iomVersion.findMany({
      where: { status: "IN_REVIEW" },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        document: true,
        _count: { select: { chunks: true } },
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
      },
    });
    return candidates
      .filter((version) => needsConfidentialityReview(version.chunks))
      .map(({ chunks: _chunks, ...version }) => version);
  }

  app.get("/iom/reviews", requireHr(), async (context) => {
    const versions = await confidentialityReviewQueue(context.get("database"));
    return context.json({ versions });
  });

  app.get("/iom/review-count", requireHr(), async (context) => {
    const versions = await confidentialityReviewQueue(context.get("database"));
    return context.json({ count: versions.length });
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

  app.patch("/iom/:versionId", requireHr(), async (context) => {
    const parsed = versionMetadataSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Metadata IOM tidak valid." }, 400);
    if (
      parsed.data.effectiveUntil &&
      parsed.data.effectiveUntil.getTime() < parsed.data.effectiveFrom.getTime()
    )
      return context.json({ error: "Tanggal selesai tidak boleh sebelum tanggal berlaku." }, 400);
    const database = context.get("database");
    const actor = context.get("actor");
    const versionId = context.req.param("versionId");
    const current = await database.iomVersion.findUnique({ where: { id: versionId } });
    if (!current) return context.json({ error: "IOM tidak ditemukan." }, 404);
    if (["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(current.status))
      return context.json({ error: "Metadata versi yang sudah berlaku tidak dapat diubah." }, 409);
    const version = await database
      .$transaction(async (transaction) => {
        let documentId = current.documentId;
        let revision = current.revision;
        if (parsed.data.previousVersionId) {
          const previous = await transaction.iomVersion.findUnique({
            where: { id: parsed.data.previousVersionId },
          });
          if (!previous || previous.id === current.id) throw new Error("INVALID_PREVIOUS_VERSION");
          documentId = previous.documentId;
          const highest = await transaction.iomVersion.aggregate({
            where: { documentId },
            _max: { revision: true },
          });
          revision = Math.max((highest._max.revision ?? 0) + 1, previous.revision + 1);
        }
        const updated = await transaction.iomVersion.update({
          where: { id: versionId },
          data: {
            documentId,
            revision,
            iomNumber: parsed.data.iomNumber,
            title: parsed.data.title,
            effectiveFrom: parsed.data.effectiveFrom,
            ...(parsed.data.publicationDate
              ? { publicationDate: parsed.data.publicationDate }
              : {}),
            ...(parsed.data.effectiveUntil !== undefined
              ? { effectiveUntil: parsed.data.effectiveUntil }
              : {}),
            metadataConfirmedAt: new Date(),
            metadataConfirmedById: actor.id,
          },
        });
        if (documentId !== current.documentId) {
          await transaction.iomDocument.deleteMany({
            where: { id: current.documentId, versions: { none: {} } },
          });
        }
        return updated;
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "INVALID_PREVIOUS_VERSION") return null;
        throw error;
      });
    if (!version) return context.json({ error: "Versi sebelumnya tidak valid." }, 400);
    await refreshIomPublishReadiness(database, versionId);
    await audit(database, {
      actorId: actor.id,
      action: "IOM_METADATA_UPDATE",
      entityType: "IomVersion",
      entityId: versionId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: {
        revision: version.revision,
        linkedToPrevious: !!parsed.data.previousVersionId,
      },
    });
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
    const version = await database.iomVersion.findUnique({
      where: { id: versionId },
      include: {
        annotations: {
          where: {
            kind: "CONFIDENTIAL",
            pageStart: null,
            pageEnd: null,
            charStart: null,
            charEnd: null,
            section: null,
          },
          take: 1,
        },
      },
    });
    if (!version) return context.json({ error: "IOM tidak ditemukan." }, 404);
    if (!["IN_REVIEW", "READY_TO_PUBLISH"].includes(version.status))
      return context.json({ error: "IOM tidak berada dalam tahap review." }, 409);
    if (!version.confidentialityPolicyId)
      return context.json({ error: "Policy kerahasiaan aktif belum diterapkan." }, 409);
    const reviewedChunks = await database.iomChunk.findMany({
      where: { versionId, id: { in: parsed.data.decisions.map((decision) => decision.chunkId) } },
      select: {
        id: true,
        text: true,
        pageStart: true,
        pageEnd: true,
        section: true,
        decisions: {
          where: { policyId: version.confidentialityPolicyId },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    const chunkText = new Map(reviewedChunks.map((chunk) => [chunk.id, chunk.text]));
    const chunkById = new Map(reviewedChunks.map((chunk) => [chunk.id, chunk]));
    if (reviewedChunks.length !== parsed.data.decisions.length)
      return context.json({ error: "Chunk review tidak valid." }, 400);
    if (
      version.annotations.length > 0 &&
      parsed.data.decisions.some((decision) => decision.visibility === "EMPLOYEE_SAFE")
    ) {
      return context.json(
        { error: "Penanda CONFIDENTIAL manual tidak dapat diturunkan menjadi akses karyawan." },
        409,
      );
    }
    const decisionByChunk = new Map(
      reviewedChunks.map((chunk) => [chunk.id, chunk.decisions[0]?.id ?? null]),
    );
    if ([...decisionByChunk.values()].some((decisionId) => !decisionId))
      return context.json(
        { error: "Keputusan klasifikasi belum tersedia untuk semua chunk." },
        409,
      );
    const reviewedAt = new Date();
    await database.$transaction(async (transaction) => {
      for (const decision of parsed.data.decisions) {
        const reviewedChunk = chunkById.get(decision.chunkId);
        if (!reviewedChunk) throw new Error("REVIEWED_CHUNK_NOT_FOUND");
        await transaction.iomChunk.update({
          where: { id: decision.chunkId, versionId },
          data: {
            visibility: decision.visibility,
            publicText:
              decision.visibility === "EMPLOYEE_SAFE"
                ? (chunkText.get(decision.chunkId) ?? "")
                : null,
          },
        });
        await transaction.confidentialityDecision.update({
          where: { id: decisionByChunk.get(decision.chunkId) ?? "" },
          data: { reviewedById: actor.id, reviewedAt },
        });
        await transaction.iomAnnotation.create({
          data: {
            versionId,
            createdById: actor.id,
            kind: decision.visibility === "HR_ONLY" ? "CONFIDENTIAL" : "EMPLOYEE_SAFE",
            note: decision.reason,
            pageStart: reviewedChunk.pageStart,
            pageEnd: reviewedChunk.pageEnd,
            section: reviewedChunk.section,
          },
        });
      }
      await transaction.iomVersion.update({
        where: { id: versionId },
        data: { reviewedById: actor.id },
      });
    });
    const readiness = await refreshIomPublishReadiness(database, versionId);
    const unresolved = readiness?.reasons.length ?? 1;
    await audit(database, {
      actorId: actor.id,
      action: "CONFIDENTIALITY_REVIEW",
      entityType: "IomVersion",
      entityId: versionId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: {
        decisions: parsed.data.decisions.length,
        unresolved,
        readinessReasons: readiness?.reasons ?? [],
      },
    });
    return context.json({
      unresolved,
      status: readiness?.ready ? "READY_TO_PUBLISH" : "IN_REVIEW",
      readiness,
    });
  });

  app.post("/iom/:versionId/publish", requireHr(), async (context) => {
    const database = context.get("database");
    const actor = context.get("actor");
    const versionId = context.req.param("versionId");
    const result = await database.$transaction(
      async (transaction) => {
        const version = await transaction.iomVersion.findUnique({
          where: { id: versionId },
          include: {
            outgoingRelations: {
              where: { type: "REPLACES" },
              include: {
                targetVersion: { select: { id: true, status: true, effectiveFrom: true } },
              },
            },
          },
        });
        if (!version) return { kind: "NOT_FOUND" as const };
        if (version.status !== "READY_TO_PUBLISH")
          return { kind: "NOT_READY" as const, reasons: [] };
        const readiness = await getPublishReadiness(transaction, versionId);
        if (!readiness?.ready) {
          return { kind: "NOT_READY" as const, reasons: readiness?.reasons ?? [] };
        }
        assertIomTransition(version.status, "PUBLISHED");
        if (
          version.outgoingRelations.some(
            (relation) => relation.targetVersion.effectiveFrom >= version.effectiveFrom,
          )
        ) {
          return { kind: "INVALID_REPLACEMENT_DATE" as const };
        }
        const supersededAt = new Date(version.effectiveFrom.getTime() - 1);
        for (const relation of version.outgoingRelations) {
          if (relation.targetVersion.status !== "PUBLISHED") continue;
          await transaction.iomVersion.update({
            where: { id: relation.targetVersion.id },
            data: { status: "SUPERSEDED", effectiveUntil: supersededAt },
          });
        }
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
        return { kind: "PUBLISHED" as const, supersededVersions: version.outgoingRelations.length };
      },
      { isolationLevel: "Serializable" },
    );
    if (result.kind === "NOT_FOUND") return context.json({ error: "IOM tidak ditemukan." }, 404);
    if (result.kind === "NOT_READY")
      return context.json(
        {
          error: "Metadata, review kerahasiaan, dan keputusan overlap harus lengkap.",
          reasons: result.reasons,
        },
        409,
      );
    if (result.kind === "INVALID_REPLACEMENT_DATE")
      return context.json(
        { error: "Versi pengganti harus berlaku setelah versi yang digantikannya." },
        409,
      );
    await audit(database, {
      actorId: actor.id,
      action: "IOM_PUBLISH",
      entityType: "IomVersion",
      entityId: versionId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: { supersededVersions: result.supersededVersions },
    });
    return context.json({ status: "PUBLISHED" });
  });

  app.post("/iom/:versionId/relations", requireHr(), async (context) => {
    const parsed = relationSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Relasi IOM tidak valid." }, 400);
    const database = context.get("database");
    const sourceVersionId = context.req.param("versionId");
    const actor = context.get("actor");
    if (sourceVersionId === parsed.data.targetVersionId)
      return context.json({ error: "Versi tidak dapat berelasi dengan dirinya sendiri." }, 400);
    const [source, target] = await Promise.all([
      database.iomVersion.findUnique({ where: { id: sourceVersionId } }),
      database.iomVersion.findUnique({ where: { id: parsed.data.targetVersionId } }),
    ]);
    if (!source || !target) return context.json({ error: "Versi IOM tidak ditemukan." }, 404);
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
      return created;
    });
    await refreshIomPublishReadiness(database, sourceVersionId);
    await audit(database, {
      actorId: actor.id,
      action: "IOM_RELATION_CONFIRM",
      entityType: "IomRelation",
      entityId: relation.id,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      safeMetadata: { type: relation.type },
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
    const policies = await context.get("database").confidentialityPolicy.findMany({
      orderBy: { version: "desc" },
      include: {
        _count: { select: { decisions: true } },
        decisions: {
          select: { visibility: true, conflictsWithMarker: true },
        },
      },
    });
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

  app.post("/confidentiality/policies/:policyId/decisions/:chunkId/review", async (context) => {
    const parsed = policyDecisionReviewSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Keputusan review tidak valid." }, 400);
    const database = context.get("database");
    const actor = context.get("actor");
    const policyId = context.req.param("policyId");
    const chunkId = context.req.param("chunkId");
    const [policy, chunk] = await Promise.all([
      database.confidentialityPolicy.findFirst({
        where: { id: policyId, status: "EVALUATING" },
      }),
      database.iomChunk.findUnique({ where: { id: chunkId }, select: { id: true } }),
    ]);
    if (!policy || !chunk)
      return context.json({ error: "Policy atau potongan dokumen tidak ditemukan." }, 404);
    const decision = await database.confidentialityDecision.create({
      data: {
        chunkId,
        policyId,
        visibility: parsed.data.visibility,
        confidence: 1,
        categories: ["HR_MANUAL_REVIEW"],
        rationale: parsed.data.reason,
        sensitiveSpans: [],
        conflictsWithMarker: false,
        modelId: "human-review",
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    await audit(database, {
      actorId: actor.id,
      action: "POLICY_IMPACT_REVIEW",
      entityType: "IomChunk",
      entityId: chunkId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      policyVersion: policy.version,
      safeMetadata: { visibility: parsed.data.visibility },
    });
    return context.json({ decision }, 201);
  });

  app.post("/confidentiality/policies/:policyId/activate", async (context) => {
    const database = context.get("database");
    const policyId = context.req.param("policyId");
    const policy = await database.confidentialityPolicy.findFirst({
      where: { id: policyId, status: "EVALUATING" },
    });
    if (!policy) return context.json({ error: "Policy belum siap diaktifkan." }, 409);
    const chunks = await database.iomChunk.findMany({
      where: {
        version: { status: { in: ["IN_REVIEW", "READY_TO_PUBLISH", "PUBLISHED"] } },
      },
      select: {
        id: true,
        text: true,
        versionId: true,
        version: { select: { status: true, sourceHash: true } },
        decisions: {
          where: { policyId },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { visibility: true, conflictsWithMarker: true },
        },
      },
    });
    const unresolved = chunks.filter((chunk) => {
      const decision = chunk.decisions[0];
      return !decision || decision.visibility === "NEEDS_REVIEW" || decision.conflictsWithMarker;
    });
    if (unresolved.length > 0) {
      return context.json(
        {
          error: "Impact policy belum selesai direview.",
          unresolvedCount: unresolved.length,
          unresolvedChunkIds: unresolved.slice(0, 50).map((chunk) => chunk.id),
        },
        409,
      );
    }
    const publishedVersions = new Map<string, string>();
    for (const chunk of chunks) {
      if (chunk.version.status === "PUBLISHED")
        publishedVersions.set(chunk.versionId, chunk.version.sourceHash);
    }
    await database.$transaction(async (transaction) => {
      await transaction.confidentialityPolicy.updateMany({
        where: { status: "ACTIVE" },
        data: { status: "RETIRED" },
      });
      await transaction.confidentialityPolicy.update({
        where: { id: policyId },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
      for (const chunk of chunks) {
        const decision = chunk.decisions[0];
        if (!decision) continue;
        await transaction.iomChunk.update({
          where: { id: chunk.id },
          data: {
            visibility: decision.visibility,
            publicText: decision.visibility === "EMPLOYEE_SAFE" ? chunk.text : null,
            vectorGeneration: null,
          },
        });
      }
      const versionIds = [...new Set(chunks.map((chunk) => chunk.versionId))];
      if (versionIds.length > 0)
        await transaction.iomVersion.updateMany({
          where: { id: { in: versionIds } },
          data: { confidentialityPolicyId: policyId },
        });
      for (const [versionId, sourceHash] of publishedVersions) {
        await enqueueJob(transaction, {
          type: "INDEX_VERSION",
          payload: { versionId },
          idempotencyKey: `index:${versionId}:${sourceHash}:policy-${policy.version}`,
        });
      }
    });
    for (const versionId of new Set(chunks.map((chunk) => chunk.versionId))) {
      await refreshIomPublishReadiness(database, versionId);
    }
    await audit(database, {
      actorId: context.get("actor").id,
      action: "CONFIDENTIALITY_POLICY_ACTIVATE",
      entityType: "ConfidentialityPolicy",
      entityId: policyId,
      correlationId: context.get("correlationId"),
      resultStatus: "SUCCESS",
      policyVersion: policy.version,
      safeMetadata: { reclassifiedChunks: chunks.length, reindexJobs: publishedVersions.size },
    });
    return context.json({ status: "ACTIVE", reindexJobs: publishedVersions.size });
  });

  app.get("/audit", authMiddleware(), requireHr(), async (context) => {
    const page = paginationSchema.parse(context.req.query());
    const events = await context.get("database").auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: page.limit,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return context.json({ events, nextCursor: events.at(-1)?.id });
  });
}
