import { describe, expect, it } from "vitest";
import { chunkPages, normalizeText } from "./chunking.js";

describe("document chunking", () => {
  it("normalizes text and creates stable IDs", () => {
    const pages = [{ page: 1, text: "Judul\r\n\r\n  Isi   aturan " }];
    const first = chunkPages(pages, "abc");
    const second = chunkPages(pages, "abc");
    expect(first).toEqual(second);
    expect(first[0]?.text).toBe("Judul\n\nIsi aturan");
  });

  it("normalizes unicode compatibility characters", () => {
    expect(normalizeText("ＡＢＣ")).toBe("ABC");
  });

  it("keeps all normalized content from one page in one logical chunk", () => {
    const chunks = chunkPages(
      [
        {
          page: 1,
          text: `${"Aturan umum untuk seluruh karyawan. ".repeat(8)}\n\nLampiran terbatas untuk HR\n\nAnggaran internal hanya untuk HR.`,
        },
      ],
      "source",
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("Aturan umum");
    expect(chunks[0]?.text).toContain("Lampiran terbatas untuk HR");
  });

  it("creates exactly one chunk for every non-empty physical page", () => {
    const chunks = chunkPages(
      [
        { page: 1, text: "Halaman pertama" },
        { page: 2, text: "Halaman kedua" },
        { page: 3, text: "   " },
      ],
      "source",
    );

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => [chunk.ordinal, chunk.pageStart, chunk.pageEnd])).toEqual([
      [0, 1, 1],
      [1, 2, 2],
    ]);
  });

  it("keeps a long single-page memo as one logical chunk", () => {
    const chunks = chunkPages([{ page: 1, text: "aturan ".repeat(1_000) }], "source");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("aturan aturan");
  });

  it("changes only the stable ID of the page whose content changed", () => {
    const original = chunkPages(
      [
        { page: 1, text: "Ketentuan tetap" },
        { page: 2, text: "Ketentuan lama" },
      ],
      "source",
    );
    const revised = chunkPages(
      [
        { page: 1, text: "Ketentuan tetap" },
        { page: 2, text: "Ketentuan baru" },
      ],
      "source",
    );

    expect(revised[0]?.id).toBe(original[0]?.id);
    expect(revised[1]?.id).not.toBe(original[1]?.id);
  });

  it("rejects duplicate page numbers to preserve stable page provenance", () => {
    expect(() =>
      chunkPages(
        [
          { page: 1, text: "A" },
          { page: 1, text: "B" },
        ],
        "source",
      ),
    ).toThrow("unique positive page numbers");
  });
});
