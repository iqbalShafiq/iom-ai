import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "@iom/database";
import {
  completeJob,
  failJob,
  heartbeatJob,
  type LeasedJob,
  leaseNextJob,
} from "@iom/database/jobs";
import pLimit from "p-limit";

export type JobHandler = (job: LeasedJob, signal: AbortSignal) => Promise<void>;

export interface WorkerRunnerOptions {
  database: Database;
  concurrency: number;
  leaseSeconds: number;
  handlers: ReadonlyMap<string, JobHandler>;
  pollMilliseconds?: number;
}

export class WorkerRunner {
  readonly #id = randomUUID();
  readonly #options: WorkerRunnerOptions;
  readonly #limit;
  readonly #controller = new AbortController();

  constructor(options: WorkerRunnerOptions) {
    this.#options = options;
    this.#limit = pLimit(options.concurrency);
  }

  stop(): void {
    this.#controller.abort();
  }

  async run(): Promise<void> {
    await this.#reconcileDeadLetters();
    while (!this.#controller.signal.aborted) {
      const job = await leaseNextJob(this.#options.database, this.#id, this.#options.leaseSeconds);
      if (!job) {
        await delay(this.#options.pollMilliseconds ?? 1_000, undefined, {
          signal: this.#controller.signal,
        }).catch(() => undefined);
        continue;
      }
      void this.#limit(() => this.#process(job));
    }
    await this.#limit.clearQueue();
  }

  async #process(job: LeasedJob): Promise<void> {
    const handler = this.#options.handlers.get(job.type);
    if (!handler) {
      await failJob(this.#options.database, job, this.#id, "UNKNOWN_JOB_TYPE", false);
      return;
    }
    const heartbeat = setInterval(
      () => {
        void heartbeatJob(this.#options.database, job.id, this.#id, this.#options.leaseSeconds);
      },
      Math.max(5_000, (this.#options.leaseSeconds * 1_000) / 3),
    );
    try {
      await handler(job, this.#controller.signal);
      await completeJob(this.#options.database, job.id, this.#id);
    } catch (error) {
      const jobError =
        error instanceof JobProcessingError ? error : new JobProcessingError("JOB_FAILED", true);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Background job failed",
          jobType: job.type,
          errorCode: jobError.code,
          errorKind: error instanceof Error ? error.constructor.name : "UnknownError",
          providerStatus:
            typeof (error as { status?: unknown })?.status === "number"
              ? (error as { status: number }).status
              : undefined,
          providerCode:
            typeof (error as { code?: unknown })?.code === "string"
              ? (error as { code: string }).code
              : undefined,
          providerParam:
            typeof (error as { param?: unknown })?.param === "string"
              ? (error as { param: string }).param
              : undefined,
          attempt: job.attempts,
          terminal: !jobError.transient || job.attempts >= job.maxAttempts,
        }),
      );
      await failJob(this.#options.database, job, this.#id, jobError.code, jobError.transient);
      const terminal = !jobError.transient || job.attempts >= job.maxAttempts;
      if (terminal) await this.#markRelatedEntityFailed(job, jobError.code);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async #reconcileDeadLetters(): Promise<void> {
    const jobs = await this.#options.database.backgroundJob.findMany({
      where: { status: "DEAD_LETTER", type: "INGEST_DOCUMENT" },
      select: { payload: true, lastErrorCode: true },
    });
    for (const job of jobs) {
      const uploadedFileId = (job.payload as Record<string, unknown>).uploadedFileId;
      if (typeof uploadedFileId !== "string") continue;
      await this.#options.database.uploadedFile.updateMany({
        where: { id: uploadedFileId, stage: { notIn: ["COMPLETED", "FAILED"] } },
        data: {
          stage: "FAILED",
          safeError: "Pemrosesan dokumen gagal. Periksa file lalu coba lagi.",
          errorCode: job.lastErrorCode ?? "JOB_FAILED",
        },
      });
    }
  }

  async #markRelatedEntityFailed(job: LeasedJob, errorCode: string): Promise<void> {
    const payload = job.payload as Record<string, unknown>;
    if (job.type === "INGEST_DOCUMENT" && typeof payload.uploadedFileId === "string") {
      await this.#options.database.uploadedFile.updateMany({
        where: { id: payload.uploadedFileId, stage: { not: "COMPLETED" } },
        data: {
          stage: "FAILED",
          safeError: "Pemrosesan dokumen gagal. Periksa file lalu coba lagi.",
          errorCode,
        },
      });
    }
    if (job.type === "ANALYZE_OVERLAP" && typeof payload.runId === "string") {
      await this.#options.database.overlapRun.updateMany({
        where: { id: payload.runId, status: { not: "COMPLETED" } },
        data: { status: "FAILED", errorCode },
      });
    }
  }
}

export class JobProcessingError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
  ) {
    super(code);
  }
}
