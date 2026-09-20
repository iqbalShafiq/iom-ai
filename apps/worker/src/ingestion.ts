import type { ConfidentialityDecision, ConfidentialityPolicy } from "@iom/contracts";
import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import {
  chunkPages,
  type FileStorage,
  MAX_DOCUMENT_CHUNKS,
  MAX_NORMALIZED_DOCUMENT_CHARACTERS,
  parseDocument,
} from "@iom/documents";
import { JobProcessingError } from "./runner.js";
import { runWithAiTimeout } from "./timeouts.js";

interface IngestionPayload {
  uploadedFileId: string;
}

function parsePayload(job: LeasedJob): IngestionPayload {
  const value = job.payload as Partial<IngestionPayload>;
  if (typeof value.uploadedFileId !== "string")
    throw new JobProcessingError("INVALID_JOB_PAYLOAD", false);
  return { uploadedFileId: value.uploadedFileId };
}

export function createIngestionHandler(
  database: Database,
  storage: FileStorage,
  ocrLanguages: string,
  classifierModelId: string,
  aiTimeoutMs: number,
  classify: (input: {
    policy: ConfidentialityPolicy;
    versionId: string;
    text: string;
    page?: number;
    batchNote?: string;
    manualConfidential: boolean;
    signal?: AbortSignal;
  }) => Promise<{
    decision: ConfidentialityDecision;
    observabilityTraceId?: string;
    observabilityObservationId?: string;
  }>,
) {
  return async (job: LeasedJob, signal: AbortSignal): Promise<void> => {
    const { uploadedFileId } = parsePayload(job);
    const uploaded = await database.uploadedFile.findUnique({
      where: { id: uploadedFileId },
      include: { batch: true },
    });
    if (!uploaded) throw new JobProcessingError("UPLOADED_FILE_NOT_FOUND", false);
    if (signal.aborted) throw new JobProcessingError("WORKER_SHUTDOWN", true);

    await database.uploadedFile.update({
      where: { id: uploaded.id },
      data: { stage: "EXTRACTING", progress: 50, safeError: null, errorCode: null },
    });
    const materialized = await storage.materialize(uploaded.storageKey);
    let parsed: Awaited<ReturnType<typeof parseDocument>>;
    try {
      parsed = await parseDocument(
        materialized.path,
        { mimeType: uploaded.mimeType },
        ocrLanguages,
      );
    } finally {
      await materialized.release();
    }
    if (signal.aborted) throw new JobProcessingError("WORKER_SHUTDOWN", true);
    const textCharacters = parsed.pages.reduce((total, page) => total + page.text.length, 0);
    if (textCharacters > MAX_NORMALIZED_DOCUMENT_CHARACTERS) {
      throw new JobProcessingError("DOCUMENT_TEXT_LIMIT_EXCEEDED", false);
    }

    const existingVersion = await database.iomVersion.findUnique({
      where: { uploadedFileId: uploaded.id },
    });
    const version = existingVersion
      ? await database.$transaction(async (transaction) => {
          // A manual retry restarts only an unpublished processing version. Stable chunk IDs and
          // the original upload stay intact, while partial classifier writes are rebuilt cleanly.
          await transaction.iomChunk.deleteMany({ where: { versionId: existingVersion.id } });
          await transaction.iomAnnotation.deleteMany({ where: { versionId: existingVersion.id } });
          return transaction.iomVersion.update({
            where: { id: existingVersion.id },
            data: {
              status: "PROCESSING",
              confidentialityPolicyId: null,
              chunkingStrategy: "PAGE",
              reviewedById: null,
              metadataConfirmedAt: null,
              metadataConfirmedById: null,
            },
          });
        })
      : await database.$transaction(async (transaction) => {
          const document = await transaction.iomDocument.create({
            data: { stableKey: uploaded.sha256 },
          });
          return transaction.iomVersion.create({
            data: {
              documentId: document.id,
              uploadedFileId: uploaded.id,
              iomNumber: uploaded.originalName.replace(/\.[^.]+$/, ""),
              revision: 1,
              title: uploaded.originalName.replace(/\.[^.]+$/, ""),
              status: "PROCESSING",
              effectiveFrom: new Date(),
              sourceHash: uploaded.sha256,
              chunkingStrategy: "PAGE",
            },
          });
        });
    if (uploaded.batch.defaultConfidential || uploaded.batch.note) {
      await database.iomAnnotation.create({
        data: {
          versionId: version.id,
          createdById: uploaded.batch.createdById,
          kind: uploaded.batch.defaultConfidential ? "CONFIDENTIAL" : "NOTE",
          note: uploaded.batch.note,
        },
      });
    }
    const chunks = chunkPages(parsed.pages, uploaded.sha256);
    if (chunks.length > MAX_DOCUMENT_CHUNKS) {
      throw new JobProcessingError("DOCUMENT_CHUNK_LIMIT_EXCEEDED", false);
    }
    await database.iomChunk.createMany({
      data: chunks.map((chunk) => ({
        id: chunk.id,
        versionId: version.id,
        ordinal: chunk.ordinal,
        stableKey: chunk.stableKey,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text: chunk.text,
      })),
    });
    await database.uploadedFile.update({
      where: { id: uploaded.id },
      data: {
        stage: "CLASSIFYING",
        progress: 70,
        pageCount: parsed.pages.length,
        safeError: parsed.needsReview ? "OCR confidence rendah; dokumen wajib ditinjau." : null,
      },
    });

    const policyRecord = await database.confidentialityPolicy.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!policyRecord) {
      await database.$transaction([
        database.iomVersion.update({ where: { id: version.id }, data: { status: "IN_REVIEW" } }),
        database.uploadedFile.update({
          where: { id: uploaded.id },
          data: {
            stage: "REVIEWING",
            progress: 80,
            safeError: "Policy kerahasiaan aktif belum tersedia.",
          },
        }),
      ]);
      return;
    }
    const policy: ConfidentialityPolicy = {
      id: policyRecord.id,
      version: policyRecord.version,
      name: policyRecord.name,
      instructions: policyRecord.instructions,
      examples: policyRecord.examples as ConfidentialityPolicy["examples"],
      status: policyRecord.status,
    };
    for (const chunk of chunks) {
      if (signal.aborted) throw new JobProcessingError("WORKER_SHUTDOWN", true);
      const classified = await runWithAiTimeout(signal, aiTimeoutMs, (operationSignal) =>
        classify({
          policy,
          versionId: version.id,
          text: chunk.text,
          page: chunk.pageStart,
          ...(uploaded.batch.note ? { batchNote: uploaded.batch.note } : {}),
          manualConfidential: uploaded.batch.defaultConfidential,
          signal: operationSignal,
        }),
      );
      const decision = classified.decision;
      await database.$transaction([
        database.confidentialityDecision.create({
          data: {
            chunkId: chunk.id,
            policyId: policy.id,
            visibility: decision.visibility,
            confidence: decision.confidence,
            categories: decision.categories,
            rationale: decision.rationale,
            sensitiveSpans: decision.sensitiveSpans,
            conflictsWithMarker: decision.conflictsWithMarker,
            modelId: classifierModelId,
            ...(classified.observabilityTraceId
              ? { observabilityTraceId: classified.observabilityTraceId }
              : {}),
            ...(classified.observabilityObservationId
              ? { observabilityObservationId: classified.observabilityObservationId }
              : {}),
          },
        }),
        database.iomChunk.update({
          where: { id: chunk.id },
          data: {
            visibility: decision.visibility,
            classificationConfidence: decision.confidence,
            publicText: decision.visibility === "EMPLOYEE_SAFE" ? chunk.text : null,
          },
        }),
      ]);
    }
    await database.$transaction([
      database.iomVersion.update({
        where: { id: version.id },
        data: { status: "IN_REVIEW", confidentialityPolicyId: policy.id },
      }),
      database.uploadedFile.update({
        where: { id: uploaded.id },
        data: { stage: "REVIEWING", progress: 80 },
      }),
    ]);
  };
}
