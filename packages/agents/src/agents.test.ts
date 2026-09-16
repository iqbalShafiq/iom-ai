import { describe, expect, it } from "vitest";
import { modelCatalog, resolveModelSelection } from "./catalog.js";
import { reciprocalRankFusion } from "./overlap.js";
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
