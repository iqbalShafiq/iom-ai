import type { OpenAIClient, OpenAICompletionModel, OpenAIReasoningControls } from "@anvia/openai";
import type { ModelOption, ReasoningEffort } from "@iom/contracts";

export const defaultOpenAIModelId = "gpt-5.6-luna";

export const agentReasoningEfforts = {
  confidentiality: "high",
  overlap: "high",
} as const satisfies Record<string, ReasoningEffort>;

export type IomOpenAIModel = OpenAICompletionModel<OpenAIReasoningControls>;

export const modelCatalog = [
  {
    id: defaultOpenAIModelId,
    label: "GPT 5.6 Luna",
    description: "Cepat dan hemat untuk pertanyaan regulasi sehari-hari.",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "low",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
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

// Chat Completions does not stream Luna reasoning summaries and can fail the
// Anvia accumulator. Official Anvia v1 and the working chat-with-document
// agent both construct OpenAI reasoning models with api: "responses".
export function resolveModelApi(
  _modelId: string,
  _catalog: readonly ModelOption[] = modelCatalog,
): "chat" | "responses" {
  return "responses";
}

export function openaiReasoning(reasoningEffort: ReasoningEffort) {
  return {
    controls: { reasoningEffort } as const,
    providerOptions: {
      reasoning: {
        effort: reasoningEffort,
        summary: "auto" as const,
      },
    },
  };
}

export function reasoningControls(reasoningEffort: ReasoningEffort) {
  return openaiReasoning(reasoningEffort).controls;
}

export function createOpenAIModel(
  client: OpenAIClient,
  modelId: string,
  catalog: readonly ModelOption[] = modelCatalog,
): IomOpenAIModel {
  return client.completionModel({ modelId, api: resolveModelApi(modelId, catalog) });
}
