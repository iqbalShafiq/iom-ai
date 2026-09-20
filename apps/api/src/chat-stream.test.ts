import type { AgentStreamEvent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { projectIomAgentEvents } from "./chat.js";

async function* mockAgentEvents(): AsyncIterable<AgentStreamEvent> {
  yield {
    type: "generation_start",
    turn: 1,
    request: { chatHistory: [], documents: [], tools: [] },
    modelInfo: { provider: "openai", modelId: "deepseek-v4-flash-0731" },
  };
  yield {
    type: "reasoning_delta",
    turn: 1,
    delta: "Memeriksa aturan",
    contentType: "summary",
  };
  yield {
    type: "tool_call_delta",
    turn: 1,
    id: "tool-1",
    name: "search_iom",
    argumentsDelta: '{"query":"cuti"}',
  };
  yield { type: "text_delta", turn: 1, delta: "Aturan ditemukan." };
  yield { type: "error", error: new Error("test terminal"), usage: Usage.empty() };
}

describe("chat stream projection", () => {
  it("streams reasoning summaries, tool calls, and answer text through Client Protocol v3", async () => {
    const events = [];
    for await (const event of projectIomAgentEvents({
      runId: "run-1",
      events: mockAgentEvents(),
      metadata: {
        conversationId: "00000000-0000-4000-8000-000000000001",
        accessScope: "EMPLOYEE",
        modelId: "deepseek-v4-flash-0731",
        reasoningEffort: "low",
      },
      mapError: () => ({ code: "CHAT_RUN_FAILED", message: "Aman untuk pengguna." }),
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "reasoning_start",
        "reasoning_delta",
        "tool_call_start",
        "tool_call_delta",
        "text_start",
        "text_delta",
      ]),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "reasoning_delta", delta: "Memeriksa aturan" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_call_delta", toolName: "search_iom" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text_delta", delta: "Aturan ditemukan." }),
    );
  });
});
