import {
  applyClientStreamEvent,
  type ClientStreamEvent,
  messagesToUIMessages,
  type UIMessage,
  type UIMessagePart,
  uiMessagesToMessages,
} from "@anvia/client";
import type { Message } from "@anvia/core/completion";

function persistablePart(part: UIMessagePart): UIMessagePart | undefined {
  if (part.type === "tool" && part.state === "input-streaming") return undefined;
  if (part.type !== "reasoning") return part;
  const details = part.content?.filter((item) => item.type !== "encrypted");
  return {
    id: part.id,
    type: "reasoning",
    text: part.text,
    ...(part.reasoningId === undefined ? {} : { reasoningId: part.reasoningId }),
    ...(details && details.length > 0 ? { content: details } : {}),
  };
}

function persistableMessages(messages: readonly UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts.flatMap((part) => {
      const next = persistablePart(part);
      return next === undefined ? [] : [next];
    });
    if (parts.length === 0) return [];
    return [{ ...message, parts }];
  });
}

function toUiMessages(messages: readonly Message[]): UIMessage[] {
  try {
    return messagesToUIMessages(messages);
  } catch {
    return [];
  }
}

export async function* persistChatTranscript(options: {
  events: AsyncIterable<ClientStreamEvent>;
  initialMessages: readonly Message[];
  save: (messages: Message[]) => Promise<void>;
}): AsyncIterable<ClientStreamEvent> {
  let ui: readonly UIMessage[] = toUiMessages(options.initialMessages);
  try {
    for await (const event of options.events) {
      try {
        ui = applyClientStreamEvent(ui, event);
      } catch {
        // Keep the last snapshot that still converted.
      }
      yield event;
    }
  } finally {
    try {
      await options.save(uiMessagesToMessages(persistableMessages(ui)));
    } catch {
      // Persistence must not fail the in-flight HTTP stream.
    }
  }
}
