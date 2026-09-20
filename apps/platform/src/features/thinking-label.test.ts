import { describe, expect, it } from "vitest";
import { formatThinkingDuration, thinkingStatusLabel } from "./thinking-label";

describe("thinking labels", () => {
  it("rounds duration to whole seconds", () => {
    expect(formatThinkingDuration(200)).toBe("Berpikir selama 1 detik");
    expect(formatThinkingDuration(1500)).toBe("Berpikir selama 2 detik");
    expect(formatThinkingDuration(8000)).toBe("Berpikir selama 8 detik");
  });

  it("uses a live label until the first half-second elapses", () => {
    expect(thinkingStatusLabel({ isLive: true, elapsedMs: null })).toBe("Berpikir…");
    expect(thinkingStatusLabel({ isLive: true, elapsedMs: 200 })).toBe("Berpikir…");
    expect(thinkingStatusLabel({ isLive: true, elapsedMs: 1200 })).toBe("Berpikir selama 1 detik");
  });

  it("falls back when duration was not observed", () => {
    expect(thinkingStatusLabel({ isLive: false, elapsedMs: null })).toBe("Berpikir sejenak");
    expect(thinkingStatusLabel({ isLive: false, elapsedMs: 4300 })).toBe("Berpikir selama 4 detik");
  });
});
