import { describe, expect, it } from "vitest";
import { persistChatTranscript } from "./chat-transcript.js";

describe("persistChatTranscript", () => {
  it("does not save an empty transcript", async () => {
    const saved: unknown[] = [];

    async function* events() {
      yield {
        runId: "run-empty",
        type: "data" as const,
        name: "stream_guard",
        data: { status: "passed" },
        transient: true,
      };
    }

    for await (const _event of persistChatTranscript({
      events: events(),
      initialMessages: [],
      save: async (messages) => {
        saved.push(messages);
      },
    })) {
      // Drain the stream so the final persistence hook runs.
    }

    expect(saved).toHaveLength(0);
  });

  it("saves assistant answer text after the stream ends", async () => {
    const saved: unknown[] = [];
    async function* events() {
      yield {
        runId: "run-1",
        type: "message_start" as const,
        messageId: "msg-1",
        role: "assistant" as const,
      };
      yield {
        runId: "run-1",
        type: "text_start" as const,
        messageId: "msg-1",
        partId: "text-1",
      };
      yield {
        runId: "run-1",
        type: "text_delta" as const,
        messageId: "msg-1",
        partId: "text-1",
        delta: "11 hari kerja.",
      };
    }

    for await (const _event of persistChatTranscript({
      events: events(),
      initialMessages: [{ role: "user", content: [{ type: "text", text: "berapa cuti?" }] }],
      save: async (messages) => {
        saved.push(messages);
      },
    })) {
      // Drain the stream so persistence runs.
    }

    expect(saved).toHaveLength(1);
    const transcript = saved[0] as Array<{ role: string; content: unknown }>;
    expect(transcript.some((message) => message.role === "user")).toBe(true);
    expect(transcript.some((message) => message.role === "assistant")).toBe(true);
    expect(JSON.stringify(transcript)).toContain("11 hari kerja.");
  });
});
