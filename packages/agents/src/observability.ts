import type { AgentObservabilityOptions, AgentTraceOptions } from "@anvia/core/observability";

export type IomAgentObservability = AgentObservabilityOptions;
export type IomAgentTrace = AgentTraceOptions;

export type IomObservedTrace = {
  observer?: string;
  traceId: string;
  observationId?: string;
};

export function agentObservabilityOptions(
  observability: IomAgentObservability | undefined,
): { observability: AgentObservabilityOptions } | Record<string, never> {
  return observability === undefined ? {} : { observability };
}

export function agentTraceOptions(
  trace: IomAgentTrace | undefined,
): { trace: AgentTraceOptions } | Record<string, never> {
  return trace === undefined ? {} : { trace };
}

export function observedTrace(outcome: {
  trace?:
    | {
        observer?: string | undefined;
        traceId?: string | undefined;
        observationId?: string | undefined;
      }
    | undefined;
}): IomObservedTrace | undefined {
  const traceId = outcome.trace?.traceId;
  if (!traceId) return undefined;
  const result: IomObservedTrace = { traceId };
  if (outcome.trace?.observer !== undefined) result.observer = outcome.trace.observer;
  if (outcome.trace?.observationId !== undefined)
    result.observationId = outcome.trace.observationId;
  return result;
}
