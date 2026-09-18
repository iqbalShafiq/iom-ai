import type { ModelOption } from "@iom/contracts";
import { describe, expect, it } from "vitest";
import { reconcileModelPreference } from "./model-preference";

const models = [
  {
    id: "deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash 0731",
    description: "Fast",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "low",
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoningSummary: true,
  },
] satisfies ModelOption[];

describe("reconcileModelPreference", () => {
  it("keeps a supported reasoning effort", () => {
    expect(reconcileModelPreference(models, "deepseek-v4-flash-0731", "xhigh")?.effort).toBe(
      "xhigh",
    );
  });

  it("falls back to the server default for an unsupported effort", () => {
    expect(reconcileModelPreference(models, "deepseek-v4-flash-0731", "none")?.effort).toBe("low");
  });

  it("fails closed when the catalog is empty", () => {
    expect(reconcileModelPreference([], "arbitrary-model", "medium")).toBeNull();
  });

  it("uses the official reasoning effort labels in order", () => {
    expect(models[0]?.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
  });
});
