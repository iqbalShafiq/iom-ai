import type { IomStatus } from "@iom/contracts";

const transitions: Record<IomStatus, ReadonlySet<IomStatus>> = {
  DRAFT: new Set(["PROCESSING", "ARCHIVED"]),
  PROCESSING: new Set(["IN_REVIEW", "FAILED"]),
  IN_REVIEW: new Set(["READY_TO_PUBLISH", "PROCESSING", "ARCHIVED"]),
  READY_TO_PUBLISH: new Set(["PUBLISHED", "IN_REVIEW", "ARCHIVED"]),
  PUBLISHED: new Set(["SUPERSEDED", "ARCHIVED"]),
  SUPERSEDED: new Set(["PUBLISHED", "ARCHIVED"]),
  ARCHIVED: new Set([]),
  FAILED: new Set(["PROCESSING", "ARCHIVED"]),
};

export function canTransitionIom(from: IomStatus, to: IomStatus): boolean {
  return transitions[from].has(to);
}

export function assertIomTransition(from: IomStatus, to: IomStatus): void {
  if (!canTransitionIom(from, to)) {
    throw new Error(`Invalid IOM status transition: ${from} -> ${to}`);
  }
}
