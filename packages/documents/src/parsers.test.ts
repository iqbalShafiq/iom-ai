import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parsers.js";

const fixturesRoot = resolve(import.meta.dirname, "../../../test-fixtures/e2e");

describe("parseDocument", () => {
  it("passes a plain Uint8Array to pdfjs-dist for text-native PDFs", async () => {
    const result = await parseDocument(
      resolve(fixturesRoot, "iom-028-2026-pedoman-kerja-hibrida.pdf"),
      { mimeType: "application/pdf" },
      "ind+eng",
    );

    expect(result.usedOcr).toBe(false);
    expect(result.needsReview).toBe(false);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.pages[0]?.text).toContain("Pedoman Kerja Hibrida");
    expect(result.pages[1]?.text).toContain("Keamanan dan privasi");
  });
});
