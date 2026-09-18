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
import { classifyConfidentiality, createConfidentialityClassifier } from "./confidentiality.js";
import { coerceOpenAIResponsesEvent } from "./openai-responses.js";
import {
  analyzeOverlap,
  createOverlapAnalyzer,
  OverlapModelTimeoutError,
  reciprocalRankFusion,
} from "./overlap.js";
import { StreamReleaseGuard } from "./stream-guard.js";

describe("agent policies", () => {
  it("routes an out-of-bounds confidentiality span to HR review", async () => {
    const result = await classifyConfidentiality({
      agent: {
        generate: async () => ({
          type: "response",
          output: {
            visibility: "HR_ONLY",
            confidence: 0.98,
            categories: ["PERSONAL_DATA"],
            rationale: "Memuat data personal.",
            sensitiveSpans: [{ start: 0, end: 999, reason: "Data personal" }],
            conflictsWithMarker: false,
          },
        }),
      } as never,
      policy: {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Policy",
        instructions: "Pisahkan informasi publik dan informasi terbatas secara konservatif.",
        examples: [],
        status: "ACTIVE",
      },
      input: { text: "Nama karyawan", manualMarkers: [] },
    });

    expect(result.visibility).toBe("NEEDS_REVIEW");
    expect(result.sensitiveSpans).toEqual([]);
    expect(result.categories).toContain("INVALID_SENSITIVE_SPAN");
  });

  it("forces unsafe overlap model output to manual review", async () => {
    const candidateId = "00000000-0000-0000-0000-000000000001";
    const existingId = "00000000-0000-0000-0000-000000000002";
    const agent = {
      generate: async () => ({
        type: "response",
        output: {
          existingVersionId: "00000000-0000-0000-0000-000000000003",
          recommendation: "REPLACES",
          confidence: 0.99,
          sharedTopics: ["cuti"],
          changedRules: [],
          hasConflict: false,
          conflicts: [],
          evidence: [
            {
              candidateChunkId: candidateId,
              existingChunkId: existingId,
              explanation: "berkaitan",
            },
          ],
        },
      }),
    } as never;
    const result = await analyzeOverlap({
      agent,
      candidateVersionId: "00000000-0000-0000-0000-000000000010",
      existingVersionId: "00000000-0000-0000-0000-000000000020",
      candidateChunks: [{ id: candidateId, text: "aturan baru" }],
      existingChunks: [{ id: existingId, text: "aturan lama" }],
    });
    expect(result.recommendation).toBe("MANUAL_REVIEW");
  });

  it("forces a batch response with cross-batch evidence to manual review", async () => {
    const candidateChunks = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-0000000010${String(index).padStart(2, "0")}`,
      text: `draft ${index}`,
    }));
    const existingChunks = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-0000000020${String(index).padStart(2, "0")}`,
      text: `existing ${index}`,
    }));
    const evidencePairs = candidateChunks.map((chunk, index) => ({
      candidateChunkId: chunk.id,
      existingChunkId: existingChunks[index]?.id ?? "",
    }));
    const firstBatchPair = evidencePairs[0];
    if (!firstBatchPair) throw new Error("Test fixture is incomplete.");
    const agent = {
      generate: async () => {
        const pair = firstBatchPair;
        return {
          type: "response",
          output: {
            existingVersionId: "00000000-0000-4000-8000-000000000020",
            recommendation: "REPLACES",
            confidence: 0.99,
            sharedTopics: ["cuti"],
            changedRules: [],
            hasConflict: false,
            conflicts: [],
            evidence: [
              {
                candidateChunkId: pair.candidateChunkId,
                existingChunkId: pair.existingChunkId,
                explanation: "cross-batch",
              },
            ],
          },
        };
      },
    } as never;
    const result = await analyzeOverlap({
      agent,
      candidateVersionId: "00000000-0000-4000-8000-000000000010",
      existingVersionId: "00000000-0000-4000-8000-000000000020",
      candidateChunks,
      existingChunks,
      evidencePairs,
    });
    expect(result.recommendation).toBe("MANUAL_REVIEW");
    expect(result.conflicts.join(" ")).toContain("provenance");
  });

  it("applies the model timeout independently to each comparison call", async () => {
    const agent = {
      generate: async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    } as never;
    await expect(
      analyzeOverlap({
        agent,
        candidateVersionId: "00000000-0000-4000-8000-000000000010",
        existingVersionId: "00000000-0000-4000-8000-000000000020",
        candidateChunks: [],
        existingChunks: [],
        modelTimeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(OverlapModelTimeoutError);
  });

  it("exposes only the approved Luna chat configuration", () => {
    expect(modelCatalog).toEqual([
      expect.objectContaining({
        id: "gpt-5.6-luna",
        label: "GPT 5.6 Luna",
        supportedReasoningEfforts: ["high"],
        defaultReasoningEffort: "high",
      }),
    ]);
  });

  it("rejects arbitrary models and unsupported effort", () => {
    expect(() => resolveModelSelection("custom-model", "high")).toThrow("MODEL_NOT_ALLOWED");
    expect(() => resolveModelSelection("gpt-5.6-terra", "medium")).toThrow("MODEL_NOT_ALLOWED");
  });

  it("locks Luna chat runs to high reasoning", () => {
    expect(resolveModelSelection("gpt-5.6-luna", "high")).toEqual({
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    expect(() => resolveModelSelection("gpt-5.6-luna", "low")).toThrow(
      "REASONING_EFFORT_NOT_SUPPORTED",
    );
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
    expect(chat.instructions).toContain("PARTIALLY_OVERRIDES");
    expect(chat.instructions).toContain("topicScope");
    expect(chat.instructions).toContain("source lama tetap berlaku untuk topik lain");
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
