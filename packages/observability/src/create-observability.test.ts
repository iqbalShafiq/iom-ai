import { describe, expect, it } from "vitest";
import { createIomObservability } from "./create-observability.js";

describe("createIomObservability", () => {
  it("returns a no-op client when disabled", async () => {
    const observability = createIomObservability({
      enabled: false,
      baseUrl: "https://cloud.langfuse.com",
      environment: "test",
      release: "local",
      serviceName: "iom-api",
      captureMaxBytes: 65_536,
    });
    expect(observability.enabled).toBe(false);
    expect(observability.agentObservability).toBeUndefined();
    expect(observability.hashActorId("user-1")).toBeUndefined();
    await observability.score({ traceId: "t", name: "n", value: 1 });
    await observability.flush();
    await observability.close();
    await observability.close();
  });

  it("fails fast when enabled without credentials", () => {
    expect(() =>
      createIomObservability({
        enabled: true,
        baseUrl: "https://cloud.langfuse.com",
        environment: "test",
        release: "local",
        serviceName: "iom-api",
        captureMaxBytes: 65_536,
      }),
    ).toThrow("LANGFUSE_CONFIG_INCOMPLETE");
  });
});
