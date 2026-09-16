import { describe, expect, it } from "vitest";
import { chunkPages, normalizeText } from "./chunking.js";

describe("document chunking", () => {
  it("normalizes text and creates stable IDs", () => {
    const pages = [{ page: 1, text: "Judul\r\n\r\n  Isi   aturan " }];
    const first = chunkPages(pages, "abc", 50);
    const second = chunkPages(pages, "abc", 50);
    expect(first).toEqual(second);
    expect(first[0]?.text).toBe("Judul\n\nIsi aturan");
  });

  it("normalizes unicode compatibility characters", () => {
    expect(normalizeText("ＡＢＣ")).toBe("ABC");
  });

  it("starts a new chunk at a heading after substantive content", () => {
    const chunks = chunkPages(
      [
        {
          page: 1,
          text: `${"Aturan umum untuk seluruh karyawan. ".repeat(8)}\n\nLampiran terbatas untuk HR\n\nAnggaran internal hanya untuk HR.`,
        },
      ],
      "source",
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).not.toContain("Lampiran terbatas");
    expect(chunks[1]?.text).toContain("Lampiran terbatas untuk HR");
  });

  it("bounds a single paragraph that is larger than the configured chunk size", () => {
    const chunks = chunkPages([{ page: 1, text: "aturan ".repeat(100) }], "source", 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 80)).toBe(true);
  });
});
