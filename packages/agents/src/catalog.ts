import type { OpenAIClient, OpenAICompletionModel } from "@anvia/openai";
import type { ModelOption, ReasoningEffort } from "@iom/contracts";

export const modelCatalog = [
  {
    id: "gpt-5.6-luna",
    label: "GPT 5.6 Luna",
    description: "Cepat dan hemat untuk pertanyaan regulasi sehari-hari.",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "low",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: false,
  },
] as const satisfies readonly ModelOption[];

export type AllowedModelId = (typeof modelCatalog)[number]["id"];

export function resolveModelSelection(
  modelId: string,
  effort: string,
  catalog: readonly ModelOption[] = modelCatalog,
) {
  const model = catalog.find((option) => option.id === modelId);
  if (!model) throw new Error("MODEL_NOT_ALLOWED");
  if (!(model.supportedReasoningEfforts as readonly string[]).includes(effort)) {
    throw new Error("REASONING_EFFORT_NOT_SUPPORTED");
  }
  return { modelId: model.id, reasoningEffort: effort as ReasoningEffort };
}

const builtInApis: Record<string, "chat" | "responses"> = {
  "gpt-5.6-luna": "chat",
};

export function resolveModelApi(
  modelId: string,
  catalog: readonly ModelOption[] = modelCatalog,
): "chat" | "responses" {
  const overridden = catalog.find((option) => option.id === modelId);
  if (overridden) return builtInApis[modelId] ?? "chat";
  return builtInApis[modelId] ?? "chat";
}

export function createOpenAIModel(
  client: OpenAIClient,
  modelId: string,
  catalog: readonly ModelOption[] = modelCatalog,
): OpenAICompletionModel {
  return client.completionModel({ modelId, api: resolveModelApi(modelId, catalog) });
}
