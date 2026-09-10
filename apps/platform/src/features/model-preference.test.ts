import type { ModelOption } from "@iom/contracts";
import { describe, expect, it } from "vitest";
import { reconcileModelPreference } from "./model-preference";

const models = [
  {
    id: "gpt-5.6-terra",
    label: "Terra",
    description: "Balanced",
    supportedReasoningEfforts: ["none", "medium", "max"],
    defaultReasoningEffort: "medium",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
  },
] satisfies ModelOption[];

describe("reconcileModelPreference", () => {
  it("keeps a supported reasoning effort", () => {
    expect(reconcileModelPreference(models, "gpt-5.6-terra", "max")?.effort).toBe("max");
  });

  it("falls back to the server default for an unsupported effort", () => {
    expect(reconcileModelPreference(models, "gpt-5.6-terra", "ultra")?.effort).toBe("medium");
  });

  it("fails closed when the catalog is empty", () => {
    expect(reconcileModelPreference([], "arbitrary-model", "medium")).toBeNull();
  });
});
