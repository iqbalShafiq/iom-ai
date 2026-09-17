type ReviewableChunk = {
  visibility: string;
  decisions: ReadonlyArray<{ reviewedAt: Date | null }>;
};

export function needsConfidentialityReview(chunks: ReadonlyArray<ReviewableChunk>): boolean {
  return chunks.some(
    (chunk) => chunk.visibility === "NEEDS_REVIEW" || !chunk.decisions[0]?.reviewedAt,
  );
}
