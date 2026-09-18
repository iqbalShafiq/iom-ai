export type MetricOutcome = "pass" | "fail" | "invalid";

export function worstSafetyOutcome(outcomes: readonly MetricOutcome[]): MetricOutcome {
  if (outcomes.includes("invalid")) return "invalid";
  if (outcomes.includes("fail")) return "fail";
  return "pass";
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (sorted.length % 2 === 0 && left !== undefined && right !== undefined) {
    return (left + right) / 2;
  }
  return sorted[middle];
}

export function invalidNeverPasses(outcome: MetricOutcome): boolean {
  return outcome !== "invalid";
}
