import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkPages, type DocumentChunk, parseDocument } from "@iom/documents";

const fixturesRoot = resolve(fileURLToPath(new URL("../../../test-fixtures/e2e", import.meta.url)));

export const EVAL_PDF_FILES = {
  leave2014: "iom-014-2014-kebijakan-cuti-tahunan.pdf",
  leave2026: "iom-021-2026-kebijakan-cuti-tahunan.pdf",
  hybrid2026: "iom-028-2026-pedoman-kerja-hibrida.pdf",
  security2026: "iom-033-2026-keamanan-informasi.pdf",
} as const;

export type EvalPdfId = keyof typeof EVAL_PDF_FILES;

export type EvalPdfDocument = {
  id: EvalPdfId;
  filename: string;
  path: string;
  sourceHash: string;
  pages: Array<{ page: number; text: string }>;
  chunks: DocumentChunk[];
};

export type EvalPdfCorpus = Record<EvalPdfId, EvalPdfDocument>;

let cachedCorpus: EvalPdfCorpus | undefined;

export function evalPdfPath(filename: string) {
  return resolve(fixturesRoot, filename);
}

export async function loadEvalPdfCorpus(): Promise<EvalPdfCorpus> {
  if (cachedCorpus) return cachedCorpus;
  const entries = await Promise.all(
    (Object.entries(EVAL_PDF_FILES) as Array<[EvalPdfId, string]>).map(async ([id, filename]) => {
      const path = evalPdfPath(filename);
      const bytes = await readFile(path);
      const parsed = await parseDocument(path, { mimeType: "application/pdf" }, "ind+eng");
      const sourceHash = createHash("sha256").update(bytes).digest("hex");
      const document: EvalPdfDocument = {
        id,
        filename,
        path,
        sourceHash,
        pages: parsed.pages.map((page) => ({ page: page.page, text: page.text })),
        chunks: chunkPages(parsed.pages, sourceHash),
      };
      return [id, document] as const;
    }),
  );
  cachedCorpus = Object.fromEntries(entries) as EvalPdfCorpus;
  return cachedCorpus;
}

export function requirePage(document: EvalPdfDocument, page: number): DocumentChunk {
  const chunk = document.chunks.find((item) => item.pageStart === page);
  if (!chunk) {
    throw new Error(`PDF ${document.filename} is missing parsed page ${page}.`);
  }
  return chunk;
}
