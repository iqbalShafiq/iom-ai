import { describe, expect, it } from "vitest";
import { EVAL_PDF_FILES, loadEvalPdfCorpus, requirePage } from "./corpus.js";
import { buildChatCases, buildConfidentialityCases, buildOverlapCases } from "./datasets.js";

describe("PDF IOM eval corpus", () => {
  it("parses and chunks every canonical repo PDF by page", async () => {
    const corpus = await loadEvalPdfCorpus();
    expect(Object.keys(EVAL_PDF_FILES)).toEqual(Object.keys(corpus));
    for (const document of Object.values(corpus)) {
      expect(document.chunks.length).toBeGreaterThan(0);
      expect(document.pages.length).toBe(document.chunks.length);
      expect(document.chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
    }
    expect(requirePage(corpus.leave2026, 1).text).toMatch(/014\/2014/);
    expect(requirePage(corpus.security2026, 2).text).toMatch(/184/);
  });

  it("builds PDF-backed eval cases without exact target sentences", async () => {
    const corpus = await loadEvalPdfCorpus();
    const confidentiality = buildConfidentialityCases(corpus);
    const overlap = buildOverlapCases(corpus);
    const chat = buildChatCases(corpus);
    expect(confidentiality.length).toBeGreaterThanOrEqual(5);
    expect(overlap.length).toBeGreaterThanOrEqual(5);
    expect(chat.length).toBeGreaterThanOrEqual(5);
    expect(confidentiality.every((item) => item.expected.expectedBehavior.length > 20)).toBe(true);
    expect(overlap.some((item) => /menggantikan/i.test(item.expected.expectedBehavior))).toBe(true);
    expect(chat.some((item) => item.expected.mustNotDiscloseHrOnly === true)).toBe(true);
  });
});
