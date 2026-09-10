import { createHash } from "node:crypto";

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

export function chunkPages(
  pages: ParsedPage[],
  sourceHash: string,
  maxCharacters = 2_400,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let ordinal = 0;

  for (const page of pages) {
    const paragraphs = normalizeText(page.text)
      .split(/\n\s*\n/)
      .filter(Boolean);
    let buffer = "";
    for (const paragraph of paragraphs) {
      if (buffer && buffer.length + paragraph.length + 2 > maxCharacters) {
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
      }
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
    if (buffer) {
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
    }
  }
  return chunks;
}
