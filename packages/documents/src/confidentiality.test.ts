import { describe, expect, it } from "vitest";
import { annotationAppliesToChunk } from "./confidentiality.js";

const base = {
  kind: "CONFIDENTIAL" as const,
  pageStart: null,
  pageEnd: null,
  charStart: null,
  charEnd: null,
  section: null,
  note: null,
};

describe("annotationAppliesToChunk", () => {
  it("applies an unscoped hard marker to every chunk", () => {
    expect(annotationAppliesToChunk(base, { pageStart: 8, pageEnd: 8, section: "Lampiran" })).toBe(
      true,
    );
  });

  it("keeps page markers on their own logical page", () => {
    const annotation = { ...base, pageStart: 2, pageEnd: 2 };
    expect(annotationAppliesToChunk(annotation, { pageStart: 2, pageEnd: 2, section: null })).toBe(
      true,
    );
    expect(annotationAppliesToChunk(annotation, { pageStart: 3, pageEnd: 3, section: null })).toBe(
      false,
    );
  });

  it("requires a scoped section to match", () => {
    const annotation = { ...base, section: "Kompensasi" };
    expect(
      annotationAppliesToChunk(annotation, {
        pageStart: null,
        pageEnd: null,
        section: "kompensasi",
      }),
    ).toBe(true);
    expect(
      annotationAppliesToChunk(annotation, {
        pageStart: null,
        pageEnd: null,
        section: "Prosedur",
      }),
    ).toBe(false);
  });
});
