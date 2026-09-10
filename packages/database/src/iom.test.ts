import { describe, expect, it } from "vitest";
import { canTransitionIom } from "./iom.js";

describe("IOM lifecycle", () => {
  it("allows explicit publication flow", () => {
    expect(canTransitionIom("IN_REVIEW", "READY_TO_PUBLISH")).toBe(true);
    expect(canTransitionIom("READY_TO_PUBLISH", "PUBLISHED")).toBe(true);
  });

  it("does not infer replacement from dates", () => {
    expect(canTransitionIom("PUBLISHED", "SUPERSEDED")).toBe(true);
    expect(canTransitionIom("DRAFT", "SUPERSEDED")).toBe(false);
  });
});
