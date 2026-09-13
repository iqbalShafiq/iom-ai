import type { OpenAIClient, OpenAICompletionModel } from "@anvia/openai";
import type { ModelOption, ReasoningEffort } from "@iom/contracts";
import { modelOptionSchema } from "@iom/contracts";

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

// Deployment-specific gateway models (e.g. OpenAI-compatible proxies). When
// provided, the override REPLACES the built-in catalog: the configured gateway
// is the single source of truth for which models exist. Entries are validated
// against the shared ModelOption contract; malformed entries are dropped.
export function resolveCatalog(overrideJson?: string): readonly ModelOption[] {
  if (!overrideJson) return modelCatalog;
  let parsed: unknown;
  try {
    parsed = JSON.parse(overrideJson);
  } catch {
    return modelCatalog;
  }
  if (!Array.isArray(parsed)) return modelCatalog;
  const valid = parsed
    .map((entry) => modelOptionSchema.safeParse(entry).data as ModelOption | undefined)
    .filter((entry) => entry !== undefined);
  return valid.length > 0 ? valid : modelCatalog;
}

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
  "gpt-5.6-terra": "responses",
  "gpt-5.6-sol": "responses",
  "gpt-6-astra": "responses",
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
