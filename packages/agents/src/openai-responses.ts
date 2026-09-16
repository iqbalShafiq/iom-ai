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
 * Luna on the Responses API streams tool calls and reasoning in a shape that
 * Anvia 1.1 rejects:
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
  for await (const event of stream) {
    const coerced = coerceOpenAIResponsesEvent(event);
    if (coerced !== undefined) yield coerced as T;
  }
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
