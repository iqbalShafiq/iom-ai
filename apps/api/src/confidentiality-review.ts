type ReviewableChunk = {
  visibility: string;
  decisions: ReadonlyArray<{ reviewedAt: Date | null }>;
};

export function needsConfidentialityReview(chunks: ReadonlyArray<ReviewableChunk>): boolean {
  return chunks.some(
    (chunk) => chunk.visibility === "NEEDS_REVIEW" || !chunk.decisions[0]?.reviewedAt,
  );
}

type PolicyImpactDecision = {
  visibility: string;
  conflictsWithMarker: boolean;
  reviewedAt: Date | null;
};

export function needsPolicyImpactReview(
  currentVisibility: string,
  decision: PolicyImpactDecision | undefined,
): boolean {
  if (!decision) return true;
  if (decision.visibility === "NEEDS_REVIEW" || decision.conflictsWithMarker) return true;
  return decision.visibility !== currentVisibility && !decision.reviewedAt;
}
