import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import type { ParsedPage } from "./chunking.js";
import { MAX_PAGES, type ValidatedFile } from "./validation.js";

export interface ParsedDocument {
  pages: ParsedPage[];
  usedOcr: boolean;
  needsReview: boolean;
}

export async function parseDocument(
  path: string,
  file: Pick<ValidatedFile, "mimeType">,
  ocrLanguages: string,
): Promise<ParsedDocument> {
  const buffer = await readFile(path);
  if (file.mimeType === "application/pdf") return parsePdf(buffer, ocrLanguages);
  if (file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return { pages: [{ page: 1, text: result.value }], usedOcr: false, needsReview: false };
  }
  return {
    pages: [{ page: 1, text: buffer.toString("utf8") }],
    usedOcr: false,
    needsReview: false,
  };
}

async function parsePdf(buffer: Uint8Array, ocrLanguages: string): Promise<ParsedDocument> {
  const document = await getDocument({ data: buffer }).promise;
  if (document.numPages > MAX_PAGES) throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
  const pages: ParsedPage[] = [];
  let usedOcr = false;
  let needsReview = false;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      if (text.length >= 80) {
        pages.push({ page: pageNumber, text });
        continue;
      }

      usedOcr = true;
      worker ??= await createWorker(ocrLanguages);
      const viewport = page.getViewport({ scale: 1.75 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const result = await worker.recognize(canvas.toBuffer("image/png"));
      const confidence = result.data.confidence / 100;
      if (confidence < 0.75) needsReview = true;
      pages.push({ page: pageNumber, text: result.data.text, ocrConfidence: confidence });
    }
  } finally {
    await worker?.terminate();
  }

  return { pages, usedOcr, needsReview };
}
