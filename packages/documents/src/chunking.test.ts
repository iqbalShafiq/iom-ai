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
});
