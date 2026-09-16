import { OpenAIClient } from "@anvia/openai";
import { describe, expect, it } from "vitest";
import {
  agentReasoningEfforts,
  createOpenAIModel,
  modelCatalog,
  openaiReasoning,
  resolveModelApi,
  resolveModelSelection,
} from "./catalog.js";
import { createIomAgent, sanitizeIomChatHistory } from "./chat.js";
import { createConfidentialityClassifier } from "./confidentiality.js";
import { coerceOpenAIResponsesEvent } from "./openai-responses.js";
import { createOverlapAnalyzer, reciprocalRankFusion } from "./overlap.js";
import { StreamReleaseGuard } from "./stream-guard.js";

describe("agent policies", () => {
  it("exposes only the approved Luna chat configuration", () => {
    expect(modelCatalog).toEqual([
      expect.objectContaining({
        id: "gpt-5.6-luna",
        label: "GPT 5.6 Luna",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        defaultReasoningEffort: "low",
      }),
    ]);
  });

  it("rejects arbitrary models and unsupported effort", () => {
    expect(() => resolveModelSelection("custom-model", "high")).toThrow("MODEL_NOT_ALLOWED");
    expect(() => resolveModelSelection("gpt-5.6-terra", "medium")).toThrow("MODEL_NOT_ALLOWED");
  });

  it("allows the documented Luna reasoning levels exposed by the product", () => {
    expect(resolveModelSelection("gpt-5.6-luna", "low")).toEqual({
      modelId: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    expect(resolveModelSelection("gpt-5.6-luna", "xhigh")).toEqual({
      modelId: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
    expect(() => resolveModelSelection("gpt-5.6-luna", "none")).toThrow(
      "REASONING_EFFORT_NOT_SUPPORTED",
    );
  });

  it("uses the Responses API and shared reasoning options for every IOM agent model", () => {
    expect(resolveModelApi("gpt-5.6-luna")).toBe("responses");
    expect(resolveModelApi("gpt-5.6-sol")).toBe("responses");
    expect(resolveModelApi("gpt-5.6-terra")).toBe("responses");
    expect(resolveModelApi("gpt-6-astra")).toBe("responses");
    const model = createOpenAIModel(new OpenAIClient({ apiKey: "test-key" }), "gpt-5.6-luna");
    expect(model.controls?.reasoningEffort?.options).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(openaiReasoning(agentReasoningEfforts.confidentiality)).toEqual({
      controls: { reasoningEffort: "high" },
      providerOptions: { reasoning: { effort: "high", summary: "auto" } },
    });
  });

  it("configures chat, confidentiality, and overlap with the same reasoning placement", () => {
    const model = createOpenAIModel(new OpenAIClient({ apiKey: "test-key" }), "gpt-5.6-luna");
    const chat = createIomAgent({
      model,
      reasoningEffort: "medium",
      retrieval: {
        search: async () => ({
          evidence: [],
          temporalScope: { asOf: new Date().toISOString(), includesHistory: false },
          insufficientEvidence: true,
        }),
      },
      scope: {
        actorId: "actor-1",
        role: "EMPLOYEE",
        accessScope: "EMPLOYEE",
        policyVersion: 1,
      },
    });
    const classifier = createConfidentialityClassifier(model);
    const overlap = createOverlapAnalyzer(model);
    expect(chat.controls).toEqual({ reasoningEffort: "medium" });
    expect(chat.providerOptions).toEqual({
      reasoning: { effort: "medium", summary: "auto" },
    });
    expect(classifier.controls).toEqual({ reasoningEffort: "high" });
    expect(classifier.providerOptions).toEqual({
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(overlap.controls).toEqual({ reasoningEffort: "high" });
    expect(overlap.providerOptions).toEqual({
      reasoning: { effort: "high", summary: "auto" },
    });
  });

  it("replays only user and assistant text so Responses tool calls stay valid", () => {
    expect(
      sanitizeIomChatHistory([
        { role: "user", content: [{ type: "text", text: "haloo!" }] },
        {
          role: "assistant",
          id: "resp_123",
          content: [
            { type: "reasoning", text: "sapaan" },
            { type: "text", text: "Halo!" },
          ],
        },
        { role: "user", content: [{ type: "text", text: "aturan cuti?" }] },
      ]),
    ).toEqual([
      { role: "user", content: [{ type: "text", text: "haloo!" }] },
      { role: "assistant", content: [{ type: "text", text: "Halo!" }] },
      { role: "user", content: [{ type: "text", text: "aturan cuti?" }] },
    ]);
  });

  it("completes cancelled Luna function calls that already have JSON arguments", () => {
    expect(coerceOpenAIResponsesEvent({ type: "response.function_call_arguments.done" })).toBe(
      undefined,
    );
    const cancelled = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        status: "cancelled",
        name: "search_iom",
        arguments: '{"query":"cuti"}',
      },
    };
    expect(coerceOpenAIResponsesEvent(cancelled)).toEqual({
      ...cancelled,
      item: { ...cancelled.item, status: "completed" },
    });
  });

  it("drops encrypted reasoning that the accumulator never saw", () => {
    expect(
      coerceOpenAIResponsesEvent({
        type: "response.output_item.done",
        item: {
          id: "rs_1",
          type: "reasoning",
          content: [],
          encrypted_content: "gAAAAAB",
          summary: [{ type: "summary_text", text: "Mencari aturan cuti." }],
        },
      }),
    ).toEqual({
      type: "response.output_item.done",
      item: {
        id: "rs_1",
        type: "reasoning",
        content: [],
        summary: [{ type: "summary_text", text: "Mencari aturan cuti." }],
      },
    });
  });

  it("fuses independent retrieval rankings", () => {
    const ranked = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ]);
    expect(ranked[0]?.id).toBe("b");
  });

  it("holds a rolling buffer and blocks denied values", () => {
    const guard = new StreamReleaseGuard(
      [{ kind: "entity_value", value: "rekening 123456789" }],
      12,
    );
    expect(guard.push("Nomor rekening ").blocked).toBe(false);
    expect(guard.push("123456789 tersedia").blocked).toBe(true);
    expect(guard.flush()).toEqual({ released: "", blocked: true });
  });
});
