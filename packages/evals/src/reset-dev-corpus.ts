import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";

const DOCUMENT_JOB_TYPES = [
  "INGEST_DOCUMENT",
  "INDEX_VERSION",
  "ANALYZE_OVERLAP",
  "EVALUATE_POLICY",
  "LANGFUSE_SCORE",
] as const;

export async function resetDevCorpus(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseServerConfig(environment);
  if (config.NODE_ENV !== "development") {
    throw new Error("DEV_CORPUS_RESET_REQUIRES_DEVELOPMENT");
  }

  const database = createDatabase(config.DATABASE_URL);
  try {
    const runningJobs = await database.backgroundJob.count({
      where: { type: { in: [...DOCUMENT_JOB_TYPES] }, status: "RUNNING" },
    });
    if (runningJobs > 0) throw new Error("DEV_CORPUS_RESET_HAS_RUNNING_JOBS");

    const [documents, versions, files, conversations, jobs, relations] = await Promise.all([
      database.iomDocument.count(),
      database.iomVersion.count(),
      database.uploadedFile.findMany({ select: { storageKey: true } }),
      database.conversation.count(),
      database.backgroundJob.count({ where: { type: { in: [...DOCUMENT_JOB_TYPES] } } }),
      database.iomRelation.count(),
    ]);
    const before = {
      documents,
      versions,
      uploadedFiles: files.length,
      conversations,
      jobs,
      relations,
    };
    console.info(JSON.stringify({ phase: "before", counts: before }));

    await database.$transaction(async (transaction) => {
      await transaction.iomRelation.deleteMany();
      await transaction.overlapDecision.deleteMany();
      await transaction.overlapMatch.deleteMany();
      await transaction.overlapRun.deleteMany();
      await transaction.confidentialityDecision.deleteMany();
      await transaction.iomAnnotation.deleteMany();
      await transaction.iomChunk.deleteMany();
      await transaction.iomVersion.deleteMany();
      await transaction.iomDocument.deleteMany();
      await transaction.uploadedFile.deleteMany();
      await transaction.uploadBatch.deleteMany();
      await transaction.conversation.deleteMany();
      await transaction.backgroundJob.deleteMany({
        where: { type: { in: [...DOCUMENT_JOB_TYPES] } },
      });
      await transaction.auditEvent.create({
        data: {
          action: "DEV_CORPUS_RESET",
          entityType: "DevelopmentCorpus",
          correlationId: randomUUID(),
          resultStatus: "SUCCESS",
          safeMetadata: before,
        },
      });
    });

    const storageRoot = resolve(config.STORAGE_ROOT);
    await Promise.all(
      files.map((file) => rm(resolve(storageRoot, file.storageKey), { force: true })),
    );

    for (const collection of ["iom_employee_active", "iom_hr_active"]) {
      const response = await fetch(new URL(`/collections/${collection}`, config.QDRANT_URL), {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error("DEV_CORPUS_RESET_VECTOR_DELETE_FAILED");
      }
    }

    console.info(
      JSON.stringify({
        phase: "after",
        counts: {
          documents: await database.iomDocument.count(),
          versions: await database.iomVersion.count(),
          uploadedFiles: await database.uploadedFile.count(),
          conversations: await database.conversation.count(),
          jobs: await database.backgroundJob.count({
            where: { type: { in: [...DOCUMENT_JOB_TYPES] } },
          }),
          relations: await database.iomRelation.count(),
        },
      }),
    );
  } finally {
    await database.$disconnect();
  }
}
