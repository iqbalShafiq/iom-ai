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
) {
  return async (job: LeasedJob, signal: AbortSignal): Promise<void> => {
    const { uploadedFileId } = parsePayload(job);
    const uploaded = await database.uploadedFile.findUnique({ where: { id: uploadedFileId } });
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

    const document = await database.iomDocument.create({ data: { stableKey: uploaded.sha256 } });
    const version = await database.iomVersion.create({
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
    await database.$transaction([
      database.iomVersion.update({ where: { id: version.id }, data: { status: "IN_REVIEW" } }),
      database.uploadedFile.update({
        where: { id: uploaded.id },
        data: {
          stage: "CLASSIFYING",
          progress: 55,
          pageCount: parsed.pages.length,
          safeError: parsed.needsReview ? "OCR confidence rendah; dokumen wajib ditinjau." : null,
        },
      }),
    ]);
    // AI classification and indexing handlers extend this durable pipeline in packages/agents.
  };
}
