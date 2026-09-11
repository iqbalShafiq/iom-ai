import type { ConfidentialityDecision, ConfidentialityPolicy } from "@iom/contracts";
import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import { chunkPages, type FileStorage, parseDocument } from "@iom/documents";
import { JobProcessingError } from "./runner.js";

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
  classify: (input: {
    policy: ConfidentialityPolicy;
    text: string;
    page?: number;
    batchNote?: string;
    manualConfidential: boolean;
    signal?: AbortSignal;
  }) => Promise<ConfidentialityDecision>,
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
      data: { stage: "EXTRACTING", progress: 10, safeError: null, errorCode: null },
    });
    const parsed = await parseDocument(
      storage.absolutePath(uploaded.storageKey),
      { mimeType: uploaded.mimeType },
      ocrLanguages,
    );
    if (signal.aborted) throw new JobProcessingError("WORKER_SHUTDOWN", true);

    const existingVersion = await database.iomVersion.findUnique({
      where: { uploadedFileId: uploaded.id },
    });
    const document = existingVersion
      ? await database.iomDocument.findUniqueOrThrow({ where: { id: existingVersion.documentId } })
      : await database.iomDocument.create({ data: { stableKey: uploaded.sha256 } });
    const version = existingVersion
      ? await database.$transaction(async (transaction) => {
          // A manual retry restarts only an unpublished processing version. Stable chunk IDs and
          // the original upload stay intact, while partial classifier writes are rebuilt cleanly.
          await transaction.iomChunk.deleteMany({ where: { versionId: existingVersion.id } });
          await transaction.iomAnnotation.deleteMany({ where: { versionId: existingVersion.id } });
          return transaction.iomVersion.update({
            where: { id: existingVersion.id },
            data: { status: "PROCESSING", confidentialityPolicyId: null },
          });
        })
      : await database.iomVersion.create({
          data: {
            documentId: document.id,
            uploadedFileId: uploaded.id,
            iomNumber: uploaded.originalName.replace(/\.[^.]+$/, ""),
            revision: 1,
            title: uploaded.originalName.replace(/\.[^.]+$/, ""),
            status: "PROCESSING",
            effectiveFrom: new Date(),
            sourceHash: uploaded.sha256,
          },
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
        progress: 55,
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
            progress: 70,
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
      const decision = await classify({
        policy,
        text: chunk.text,
        page: chunk.pageStart,
        ...(uploaded.batch.note ? { batchNote: uploaded.batch.note } : {}),
        manualConfidential: uploaded.batch.defaultConfidential,
        signal,
      });
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
        data: { stage: "REVIEWING", progress: 75 },
      }),
    ]);
  };
}
