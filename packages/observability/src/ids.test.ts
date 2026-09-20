import { describe, expect, it } from "vitest";
import { hashObservabilityId } from "./ids.js";

describe("hashObservabilityId", () => {
  it("returns a stable opaque identifier", () => {
    const secret = "a-secure-test-secret-with-32-characters";
    expect(hashObservabilityId(secret, "actor-1")).toEqual(hashObservabilityId(secret, "actor-1"));
    expect(hashObservabilityId(secret, "actor-1")).not.toEqual(
      hashObservabilityId(secret, "actor-2"),
    );
    expect(hashObservabilityId(secret, "actor-1")).not.toContain("actor-1");
  });
});
