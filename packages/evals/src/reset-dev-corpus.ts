import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";

const REPO_PDF_NAMES = new Set([
  "iom-014-2014-kebijakan-cuti-tahunan.pdf",
  "iom-021-2026-kebijakan-cuti-tahunan.pdf",
  "iom-028-2026-pedoman-kerja-hibrida.pdf",
  "iom-033-2026-keamanan-informasi.pdf",
]);

export async function resetDevCorpus(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseServerConfig(environment);
  const database = createDatabase(config.DATABASE_URL);
  try {
    const files = await database.uploadedFile.findMany({
      select: { id: true, originalName: true, storageKey: true },
    });
    const extra = files.filter((file) => !REPO_PDF_NAMES.has(file.originalName));
    const extraIds = extra.map((file) => file.id);
    console.info(
      JSON.stringify({
        kept: files
          .filter((file) => REPO_PDF_NAMES.has(file.originalName))
          .map((file) => file.originalName),
        removed: extra.map((file) => file.originalName),
      }),
    );
    if (extraIds.length > 0) {
      const versions = await database.iomVersion.findMany({
        where: { uploadedFileId: { in: extraIds } },
        select: { id: true, documentId: true },
      });
      const versionIds = versions.map((version) => version.id);
      const documentIds = [...new Set(versions.map((version) => version.documentId))];
      const matches = await database.overlapMatch.findMany({
        where: {
          OR: [
            { existingVersionId: { in: versionIds } },
            { run: { candidateVersionId: { in: versionIds } } },
          ],
        },
        select: { id: true },
      });
      const matchIds = matches.map((match) => match.id);
      await database.iomRelation.deleteMany({
        where: {
          OR: [{ sourceVersionId: { in: versionIds } }, { targetVersionId: { in: versionIds } }],
        },
      });
      await database.overlapDecision.deleteMany({ where: { matchId: { in: matchIds } } });
      await database.overlapMatch.deleteMany({ where: { id: { in: matchIds } } });
      await database.overlapRun.deleteMany({
        where: { OR: [{ candidateVersionId: { in: versionIds } }] },
      });
      await database.confidentialityDecision.deleteMany({
        where: { chunk: { versionId: { in: versionIds } } },
      });
      await database.iomAnnotation.deleteMany({ where: { versionId: { in: versionIds } } });
      await database.iomChunk.deleteMany({ where: { versionId: { in: versionIds } } });
      await database.iomVersion.deleteMany({ where: { id: { in: versionIds } } });
      await database.iomDocument.deleteMany({
        where: { id: { in: documentIds }, versions: { none: {} } },
      });
      await database.uploadedFile.deleteMany({ where: { id: { in: extraIds } } });
      await database.uploadBatch.deleteMany({ where: { files: { none: {} } } });
      const storageRoot = resolve(config.STORAGE_ROOT);
      await Promise.all(
        extra.map((file) => rm(resolve(storageRoot, file.storageKey), { force: true })),
      );
    }
    await database.backgroundJob.deleteMany({
      where: {
        type: { in: ["INGEST_DOCUMENT", "INDEX_VERSION", "ANALYZE_OVERLAP", "EVALUATE_POLICY"] },
        status: { in: ["QUEUED", "FAILED", "DEAD_LETTER"] },
      },
    });
    for (const collection of ["iom_employee_active", "iom_hr_active"]) {
      await fetch(new URL(`/collections/${collection}`, config.QDRANT_URL), { method: "DELETE" });
    }
  } finally {
    await database.$disconnect();
  }
}
