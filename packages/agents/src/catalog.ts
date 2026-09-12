import type { OpenAIClient, OpenAICompletionModel } from "@anvia/openai";
import type { ModelOption, ReasoningEffort } from "@iom/contracts";

export const modelCatalog = [
  {
    id: "gpt-5.6-luna",
    label: "Luna",
    description: "Cepat dan hemat untuk pertanyaan regulasi sehari-hari.",
    supportedReasoningEfforts: ["none"],
    defaultReasoningEffort: "none",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: false,
  },
  {
    id: "gpt-5.6-terra",
    label: "Terra",
    description: "Pilihan seimbang untuk sebagian besar percakapan.",
    supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "medium",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
  },
  {
    id: "gpt-5.6-sol",
    label: "Sol",
    description: "Analisis lebih mendalam untuk kasus kebijakan kompleks.",
    supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
  },
  {
    id: "gpt-6-astra",
    label: "Astra",
    description: "Model paling kuat untuk hubungan regulasi yang paling rumit.",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
  },
] as const satisfies readonly ModelOption[];

export type AllowedModelId = (typeof modelCatalog)[number]["id"];

export function resolveModelSelection(modelId: string, effort: string) {
  const model = modelCatalog.find((option) => option.id === modelId);
  if (!model) throw new Error("MODEL_NOT_ALLOWED");
  if (!(model.supportedReasoningEfforts as readonly string[]).includes(effort)) {
    throw new Error("REASONING_EFFORT_NOT_SUPPORTED");
  }
  return { modelId: model.id, reasoningEffort: effort as ReasoningEffort };
}

export function createOpenAIModel(
  client: OpenAIClient,
  modelId: AllowedModelId,
): OpenAICompletionModel {
  switch (modelId) {
    case "gpt-5.6-luna":
      return client.completionModel({ modelId, api: "chat" });
    case "gpt-5.6-terra":
    case "gpt-5.6-sol":
    case "gpt-6-astra":
      return client.completionModel({ modelId, api: "responses" });
  }
}
