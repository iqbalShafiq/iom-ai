import { messagesToUIMessages, type UIMessage } from "@anvia/client";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n")
    .trim();
}

function textFallback(content: readonly unknown[]): UIMessage[] {
  const messages: UIMessage[] = [];
  content.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") return;
    const text = textFromContent(record.content);
    if (!text) return;
    messages.push({
      id: `stored-${String(index)}`,
      role: record.role,
      parts: [{ id: `stored-${String(index)}-text`, type: "text", text }],
    });
  });
  return messages;
}

export function hydrateStoredChatMessages(content: unknown): UIMessage[] {
  if (!Array.isArray(content)) return [];
  try {
    return messagesToUIMessages(content as never);
  } catch {
    return textFallback(content);
  }
}
