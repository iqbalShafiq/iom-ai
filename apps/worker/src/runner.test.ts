import type { Database } from "@iom/database";
import type { LeasedJob } from "@iom/database/jobs";
import { describe, expect, it, vi } from "vitest";
import { JobProcessingError, WorkerRunner } from "./runner.js";

describe("worker errors", () => {
  it("distinguishes transient from terminal failures", () => {
    expect(new JobProcessingError("OCR_TIMEOUT", true).transient).toBe(true);
    expect(new JobProcessingError("INVALID_FILE", false).transient).toBe(false);
  });
});

describe("WorkerRunner leasing", () => {
  it("does not lease another job while its only execution slot is busy", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const jobs: LeasedJob[] = [
      { id: "job-1", type: "TEST", payload: {}, attempts: 1, maxAttempts: 3 },
      { id: "job-2", type: "TEST", payload: {}, attempts: 1, maxAttempts: 3 },
    ];
    let leaseCalls = 0;
    const database = {
      $queryRaw: async () => {
        leaseCalls += 1;
        const job = jobs.shift();
        return job ? [job] : [];
      },
      backgroundJob: {
        findMany: async () => [],
        updateMany: async () => ({ count: 1 }),
      },
    } as unknown as Database;
    let runner: WorkerRunner;
    const started: string[] = [];
    runner = new WorkerRunner({
      database,
      concurrency: 1,
      leaseSeconds: 60,
      pollMilliseconds: 1,
      handlers: new Map([
        [
          "TEST",
          async (job) => {
            started.push(job.id);
            if (job.id === "job-1") await firstFinished;
            if (job.id === "job-2") runner.stop();
          },
        ],
      ]),
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const running = runner.run();
    await vi.waitFor(() => expect(started).toEqual(["job-1"]));
    expect(leaseCalls).toBe(1);
    releaseFirst?.();
    await vi.waitFor(() => expect(started).toEqual(["job-1", "job-2"]));
    await running;
  });
});
