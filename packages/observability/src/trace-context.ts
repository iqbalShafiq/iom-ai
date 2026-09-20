import type { AccessScope, ObservabilityTraceRef } from "@iom/contracts";

export const TRACE_NAMES = {
  confidentialityClassify: "iom.confidentiality.classify",
  confidentialityPolicyEvaluate: "iom.confidentiality.policy-evaluate",
  overlapCompare: "iom.overlap.compare",
  overlapConsolidate: "iom.overlap.consolidate",
  chatTurn: "iom.chat.turn",
} as const;

export type IomTraceRequest = {
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, string | number | boolean>;
  tags?: string[];
};

export function confidentialityTrace(input: {
  sessionId: string;
  userId?: string;
  modelId: string;
  policyVersion: number;
  page?: number;
  section?: string;
  attempt?: number;
  service: "api" | "worker" | "eval";
  environment: string;
  release: string;
  reevaluate?: boolean;
}): IomTraceRequest {
  const metadata: Record<string, string | number | boolean> = {
    service: input.service,
    environment: input.environment,
    release: input.release,
    modelId: input.modelId,
    reasoningEffort: "high",
    policyVersion: input.policyVersion,
  };
  if (input.page !== undefined) metadata.page = input.page;
  if (input.section !== undefined) metadata.section = input.section;
  if (input.attempt !== undefined) metadata.attempt = input.attempt;
  const request: IomTraceRequest = {
    name: input.reevaluate
      ? TRACE_NAMES.confidentialityPolicyEvaluate
      : TRACE_NAMES.confidentialityClassify,
    sessionId: input.sessionId,
    metadata,
    tags: ["confidentiality", input.reevaluate ? "policy-evaluate" : "classify"],
  };
  if (input.userId !== undefined) request.userId = input.userId;
  return request;
}

export function overlapTrace(input: {
  sessionId: string;
  userId?: string;
  modelId: string;
  phase: "compare" | "consolidation";
  candidateVersionId: string;
  existingVersionId: string;
  batchOrdinal?: number;
  pairCount?: number;
  service: "api" | "worker" | "eval";
  environment: string;
  release: string;
}): IomTraceRequest {
  const metadata: Record<string, string | number | boolean> = {
    service: input.service,
    environment: input.environment,
    release: input.release,
    modelId: input.modelId,
    reasoningEffort: "high",
    phase: input.phase,
    candidateVersionId: input.candidateVersionId,
    existingVersionId: input.existingVersionId,
  };
  if (input.batchOrdinal !== undefined) metadata.batchOrdinal = input.batchOrdinal;
  if (input.pairCount !== undefined) metadata.pairCount = input.pairCount;
  const request: IomTraceRequest = {
    name:
      input.phase === "consolidation" ? TRACE_NAMES.overlapConsolidate : TRACE_NAMES.overlapCompare,
    sessionId: input.sessionId,
    metadata,
    tags: ["overlap", input.phase],
  };
  if (input.userId !== undefined) request.userId = input.userId;
  return request;
}

export function chatTurnTrace(input: {
  sessionId: string;
  userId?: string;
  modelId: string;
  reasoningEffort: string;
  accessScope: AccessScope;
  policyVersion: number;
  service: "api" | "worker" | "eval";
  environment: string;
  release: string;
}): IomTraceRequest {
  const request: IomTraceRequest = {
    name: TRACE_NAMES.chatTurn,
    sessionId: input.sessionId,
    metadata: {
      service: input.service,
      environment: input.environment,
      release: input.release,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      accessScope: input.accessScope,
      policyVersion: input.policyVersion,
    },
    tags: ["chat", input.accessScope.toLowerCase()],
  };
  if (input.userId !== undefined) request.userId = input.userId;
  return request;
}

export function observabilityTraceRef(
  name: string,
  trace: { traceId?: string; observationId?: string } | undefined,
): ObservabilityTraceRef | undefined {
  if (!trace?.traceId) return undefined;
  const ref: ObservabilityTraceRef = { name, traceId: trace.traceId };
  if (trace.observationId) ref.observationId = trace.observationId;
  return ref;
}
