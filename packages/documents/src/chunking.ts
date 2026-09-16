import { createHash } from "node:crypto";

export const MAX_NORMALIZED_DOCUMENT_CHARACTERS = 2_000_000;
export const MAX_DOCUMENT_CHUNKS = 2_000;

export interface ParsedPage {
  page: number;
  text: string;
  ocrConfidence?: number;
}

export interface DocumentChunk {
  id: string;
  stableKey: string;
  ordinal: number;
  pageStart: number;
  pageEnd: number;
  section?: string;
  text: string;
}

function stableUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const joined = hash.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkPages(pages: ParsedPage[], sourceHash: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const seenPages = new Set<number>();

  for (const page of pages) {
    if (!Number.isSafeInteger(page.page) || page.page < 1 || seenPages.has(page.page)) {
      throw new Error("Parsed pages must have unique positive page numbers.");
    }
    seenPages.add(page.page);
    const text = normalizeText(page.text);
    if (!text) continue;
    const stableKey = `${sourceHash}:page:${page.page}:${createHash("sha1").update(text).digest("hex")}`;
    chunks.push({
      id: stableUuid(stableKey),
      stableKey,
      ordinal: chunks.length,
      pageStart: page.page,
      pageEnd: page.page,
      text,
    });
  }
  return chunks;
}
