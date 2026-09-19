import type { OpenAIClient, OpenAICompletionModel, OpenAIReasoningControls } from "@anvia/openai";
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_RUNTIME_MODEL_ID,
  type ModelOption,
  type ReasoningEffort,
} from "@iom/contracts";

export const defaultOpenAIModelId = DEFAULT_RUNTIME_MODEL_ID;

export const agentReasoningEfforts = {
  confidentiality: DEFAULT_REASONING_EFFORT,
  overlap: DEFAULT_REASONING_EFFORT,
} as const satisfies Record<string, ReasoningEffort>;

export type IomOpenAIModel = OpenAICompletionModel<OpenAIReasoningControls>;

export const modelCatalog = [
  {
    id: defaultOpenAIModelId,
    label: "GPT-5.6 Luna",
    description: "Model runtime untuk chat, klasifikasi kerahasiaan, overlap, dan evaluasi.",
    supportedReasoningEfforts: [DEFAULT_REASONING_EFFORT],
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
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

export function resolveModelApi(
  modelId: string,
  catalog: readonly ModelOption[] = modelCatalog,
): "responses" {
  if (!catalog.some((option) => option.id === modelId)) throw new Error("MODEL_NOT_ALLOWED");
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

export function modelSupportsReasoningEffort(model: IomOpenAIModel | undefined) {
  return model?.controls?.reasoningEffort !== undefined;
}

export function reasoningPlacement(
  model: IomOpenAIModel | undefined,
  reasoningEffort: ReasoningEffort,
) {
  const reasoning = openaiReasoning(reasoningEffort);
  if (!modelSupportsReasoningEffort(model)) {
    return { providerOptions: reasoning.providerOptions };
  }
  return reasoning;
}

export function createOpenAIModel(
  client: OpenAIClient,
  modelId: string,
  catalog: readonly ModelOption[] = modelCatalog,
): IomOpenAIModel {
  return client.completionModel({ modelId, api: resolveModelApi(modelId, catalog) });
}
