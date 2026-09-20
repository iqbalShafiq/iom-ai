import { describe, expect, it } from "vitest";
import { hydrateStoredChatMessages } from "./hydrate-chat-messages";

describe("hydrateStoredChatMessages", () => {
  it("keeps user and assistant text from a stored request snapshot", () => {
    const messages = hydrateStoredChatMessages([
      { role: "user", content: [{ type: "text", text: "haloo!" }] },
      { role: "assistant", content: [{ type: "text", text: "Halo!" }] },
    ]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.parts).toEqual([expect.objectContaining({ type: "text", text: "haloo!" })]);
  });

  it("falls back to text when stored tool results cannot be replayed", () => {
    const messages = hydrateStoredChatMessages([
      { role: "user", content: [{ type: "text", text: "berapa cuti?" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "missing",
            toolName: "search_iom",
            output: { type: "text", value: "bukti" },
          },
        ],
      },
    ]);
    expect(messages).toEqual([
      expect.objectContaining({
        role: "user",
        parts: [expect.objectContaining({ type: "text", text: "berapa cuti?" })],
      }),
    ]);
  });
});
