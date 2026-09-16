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

function splitOversizedText(text: string, maxCharacters: number): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxCharacters) {
    const wordBoundary = remaining.lastIndexOf(" ", maxCharacters);
    const cutAt = wordBoundary >= Math.floor(maxCharacters / 2) ? wordBoundary : maxCharacters;
    parts.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkPages(
  pages: ParsedPage[],
  sourceHash: string,
  maxCharacters = 2_400,
): DocumentChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer.");
  }
  const chunks: DocumentChunk[] = [];
  let ordinal = 0;

  for (const page of pages) {
    const paragraphs = normalizeText(page.text)
      .split(/\n\s*\n/)
      .filter(Boolean);
    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      const stableKey = `${sourceHash}:p${page.page}:c${ordinal}:${createHash("sha1").update(buffer).digest("hex")}`;
      chunks.push({
        id: stableUuid(stableKey),
        stableKey,
        ordinal,
        pageStart: page.page,
        pageEnd: page.page,
        text: buffer,
      });
      ordinal += 1;
      buffer = "";
    };
    for (const paragraphPart of paragraphs.flatMap((paragraph) =>
      splitOversizedText(paragraph, maxCharacters),
    )) {
      const paragraph = paragraphPart;
      const looksLikeHeading = paragraph.length <= 120 && !/[.!?;:]$/.test(paragraph);
      if (
        buffer &&
        (buffer.length + paragraph.length + 2 > maxCharacters ||
          (looksLikeHeading && buffer.length >= 200))
      )
        flush();
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
    flush();
  }
  return chunks;
}
