import { OpenAIClient } from "@anvia/openai";
import OpenAI from "openai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canParseJsonValue(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenAI reasoning models on the Responses API stream tool calls and reasoning
 * in a shape that Anvia 1.1 rejects:
 *
 * - The final `response.completed` payload repeats the reasoning items with an
 *   extra `encrypted_content` part the stream accumulator never saw, and
 *   `mergeFinalResponse` rejects any non-tool mismatch as an invalid stream
 *   event.
 * - A function call can be marked `cancelled`/`incomplete` after its JSON
 *   arguments already streamed, which `assertFinalToolCalls` rejects.
 * - `function_call_arguments.done` replays the full JSON in replace mode after
 *   the deltas were appended, which the accumulator rejects.
 *
 * Rewrite those raw OpenAI events before they reach the Anvia adapter.
 */
export function coerceOpenAIResponsesEvent(event: unknown): unknown {
  if (!isRecord(event) || typeof event.type !== "string") return event;
  if (event.type === "response.function_call_arguments.done") return undefined;
  if (
    (event.type === "response.completed" ||
      event.type === "response.incomplete" ||
      event.type === "response.failed") &&
    isRecord(event.response)
  ) {
    const output = Array.isArray(event.response.output) ? event.response.output : [];
    return {
      ...event,
      response: { ...event.response, output: output.map(sanitizeOutputItem) },
    };
  }
  if (event.type !== "response.output_item.done" || !isRecord(event.item)) return event;
  return { ...event, item: sanitizeOutputItem(event.item) };
}

function sanitizeOutputItem(item: unknown): unknown {
  if (!isRecord(item)) return item;
  if (item.type === "reasoning") {
    const { encrypted_content: _encrypted, ...rest } = item;
    return rest;
  }
  if (item.type !== "function_call") return item;
  const status = item.status;
  if (status === undefined || status === "completed") return item;
  if (typeof item.arguments !== "string" || !canParseJsonValue(item.arguments)) {
    return item;
  }
  return { ...item, status: "completed" };
}

export async function* mapOpenAIResponsesStream<T>(stream: AsyncIterable<T>): AsyncIterable<T> {
  const reasoningSummaries = new Map<string, string>();
  for await (const event of stream) {
    rememberReasoningSummary(event, reasoningSummaries);
    // OpenAI may stream hidden reasoning text separately from the public
    // summary. The final response intentionally omits that text, so forwarding
    // it would make Anvia's final-response integrity check fail and would risk
    // exposing chain-of-thought. Keep only the provider's safe summary stream.
    if (isRecord(event) && event.type === "response.reasoning_text.delta") continue;
    const coerced = normalizeOpenAIResponsesEvent(event, reasoningSummaries);
    if (coerced !== undefined) yield coerced as T;
  }
}

function rememberReasoningSummary(event: unknown, summaries: Map<string, string>) {
  if (!isRecord(event) || event.type !== "response.reasoning_summary_text.delta") return;
  const itemId = typeof event.item_id === "string" ? event.item_id : undefined;
  const delta = typeof event.delta === "string" ? event.delta : undefined;
  if (!itemId || !delta) return;
  summaries.set(itemId, `${summaries.get(itemId) ?? ""}${delta}`);
}

function normalizeOpenAIResponsesEvent(
  event: unknown,
  reasoningSummaries: Map<string, string>,
): unknown {
  if (!isRecord(event) || typeof event.type !== "string") return event;
  if (
    (event.type !== "response.completed" &&
      event.type !== "response.incomplete" &&
      event.type !== "response.failed") ||
    !isRecord(event.response) ||
    !Array.isArray(event.response.output)
  ) {
    return coerceOpenAIResponsesEvent(event);
  }

  const preserveEmptyReasoning = event.response.output.some(
    (item) => isRecord(item) && item.type === "function_call",
  );
  const output = event.response.output
    .map((item) => normalizeFinalOutputItem(item, reasoningSummaries, preserveEmptyReasoning))
    .filter((item): item is Record<string, unknown> => item !== undefined);

  return coerceOpenAIResponsesEvent({
    ...event,
    response: { ...event.response, output },
  });
}

function normalizeFinalOutputItem(
  item: unknown,
  reasoningSummaries: Map<string, string>,
  preserveEmptyReasoning: boolean,
): unknown {
  const sanitized = sanitizeOutputItem(item);
  if (!isRecord(sanitized) || sanitized.type !== "reasoning") return sanitized;

  const itemId = typeof sanitized.id === "string" ? sanitized.id : undefined;
  const summary = Array.isArray(sanitized.summary) ? sanitized.summary : [];
  const hasVisibleSummary = summary.some(
    (part) => isRecord(part) && typeof part.text === "string" && part.text.length > 0,
  );
  const streamedSummary = itemId ? reasoningSummaries.get(itemId) : undefined;
  if (streamedSummary) {
    // The accumulator compares its streamed reasoning with the final
    // response byte-for-byte. Treat the streamed public summary as the
    // source of truth when the provider's terminal payload differs.
    return {
      ...sanitized,
      summary: [{ type: "summary_text", text: streamedSummary }],
    };
  }
  if (hasVisibleSummary && !preserveEmptyReasoning) {
    // A terminal summary without a corresponding delta was never seen by the
    // accumulator. Drop it rather than turning a valid answer into an
    // invalid-stream-event; hidden reasoning is never forwarded to clients.
    return undefined;
  }

  // Keep an empty reasoning item when the provider returned encrypted-only
  // reasoning. Responses requires that item to remain adjacent to a function
  // call on the next turn, even though its encrypted payload is not exposed.
  const content = Array.isArray(sanitized.content) ? sanitized.content : [];
  if (!preserveEmptyReasoning && !hasVisibleSummary && content.length === 0) {
    return undefined;
  }
  return sanitized;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isRecord(value) && Symbol.asyncIterator in value;
}

export function createIomOpenAIClient(options: { apiKey: string; baseUrl?: string }) {
  const sdk = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
  });
  const originalCreate = sdk.responses.create.bind(sdk.responses);
  sdk.responses.create = ((
    params: Parameters<typeof originalCreate>[0],
    extra?: Parameters<typeof originalCreate>[1],
  ) => {
    const created = originalCreate(params, extra);
    if (!isRecord(params) || params.stream !== true) return created;
    return Promise.resolve(created).then((stream) => {
      if (!isAsyncIterable(stream)) return stream;
      return mapOpenAIResponsesStream(stream);
    });
  }) as typeof sdk.responses.create;
  return new OpenAIClient({ client: sdk as never });
}
