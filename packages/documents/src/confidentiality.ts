type ScopedAnnotation = {
  kind: "CONFIDENTIAL" | "EMPLOYEE_SAFE" | "NOTE";
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  section: string | null;
  note: string | null;
  revokedAt?: Date | null;
};

type ChunkLocation = {
  pageStart: number | null;
  pageEnd: number | null;
  section: string | null;
};

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function annotationAppliesToChunk(
  annotation: ScopedAnnotation,
  chunk: ChunkLocation,
): boolean {
  const hasPageScope = annotation.pageStart !== null || annotation.pageEnd !== null;
  const hasSectionScope = annotation.section !== null;
  const hasCharacterScope = annotation.charStart !== null || annotation.charEnd !== null;
  if (!hasPageScope && !hasSectionScope && !hasCharacterScope) return true;

  if (hasPageScope) {
    if (chunk.pageStart === null && chunk.pageEnd === null) return false;
    const annotationStart = annotation.pageStart ?? annotation.pageEnd;
    const annotationEnd = annotation.pageEnd ?? annotation.pageStart;
    const chunkStart = chunk.pageStart ?? chunk.pageEnd;
    const chunkEnd = chunk.pageEnd ?? chunk.pageStart;
    if (
      annotationStart === null ||
      annotationEnd === null ||
      chunkStart === null ||
      chunkEnd === null ||
      !rangesOverlap(annotationStart, annotationEnd, chunkStart, chunkEnd)
    ) {
      return false;
    }
  }

  if (
    hasSectionScope &&
    annotation.section?.trim().toLocaleLowerCase("id-ID") !==
      chunk.section?.trim().toLocaleLowerCase("id-ID")
  ) {
    return false;
  }

  // Character offsets are relative to the logical page/section. Once that parent scope matches,
  // the marker belongs to this chunk; page chunks are never split at the authorization boundary.
  return true;
}

export function relevantAnnotations<T extends ScopedAnnotation>(
  annotations: readonly T[],
  chunk: ChunkLocation,
): T[] {
  return annotations.filter(
    (annotation) => annotation.revokedAt == null && annotationAppliesToChunk(annotation, chunk),
  );
}
