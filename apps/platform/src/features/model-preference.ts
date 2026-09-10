import type { ModelOption } from "@iom/contracts";

export function reconcileModelPreference(
  models: readonly ModelOption[],
  requestedModelId: string,
  requestedEffort: string,
) {
  const model = models.find((option) => option.id === requestedModelId) ?? models[0];
  if (!model) return null;
  return {
    model,
    effort: model.supportedReasoningEfforts.includes(requestedEffort as never)
      ? requestedEffort
      : model.defaultReasoningEffort,
  };
}
