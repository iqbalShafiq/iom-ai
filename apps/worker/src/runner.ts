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
  readonly #controller = new AbortController();

  constructor(options: WorkerRunnerOptions) {
    this.#options = options;
  }

  stop(): void {
    this.#controller.abort();
  }

  async run(): Promise<void> {
    await this.#reconcileDeadLetters();
    await Promise.all(
      Array.from({ length: this.#options.concurrency }, (_, index) => this.#runSlot(index)),
    );
  }

  async #runSlot(slot: number): Promise<void> {
    while (!this.#controller.signal.aborted) {
      const job = await leaseNextJob(this.#options.database, this.#id, this.#options.leaseSeconds);
      if (!job) {
        await delay(this.#options.pollMilliseconds ?? 1_000, undefined, {
          signal: this.#controller.signal,
        }).catch(() => undefined);
        continue;
      }
      await this.#process(job, slot);
    }
  }

  async #process(job: LeasedJob, slot: number): Promise<void> {
    const startedAt = Date.now();
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
      console.info(
        JSON.stringify({
          level: "info",
          message: "Background job completed",
          jobType: job.type,
          attempt: job.attempts,
          durationMs: Date.now() - startedAt,
          slot,
        }),
      );
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
      where: {
        status: "DEAD_LETTER",
        type: {
          in: ["INGEST_DOCUMENT", "INDEX_VERSION", "ANALYZE_OVERLAP", "EVALUATE_POLICY"],
        },
      },
      select: { type: true, payload: true, lastErrorCode: true },
    });
    for (const job of jobs) {
      await this.#markPayloadFailed(
        job.type,
        job.payload as Record<string, unknown>,
        job.lastErrorCode ?? "JOB_FAILED",
      );
    }
  }

  async #markRelatedEntityFailed(job: LeasedJob, errorCode: string): Promise<void> {
    await this.#markPayloadFailed(job.type, job.payload as Record<string, unknown>, errorCode);
  }

  async #markPayloadFailed(
    jobType: string,
    payload: Record<string, unknown>,
    errorCode: string,
  ): Promise<void> {
    if (jobType === "INGEST_DOCUMENT" && typeof payload.uploadedFileId === "string") {
      await this.#options.database.$transaction([
        this.#options.database.uploadedFile.updateMany({
          where: { id: payload.uploadedFileId, stage: { not: "COMPLETED" } },
          data: {
            stage: "FAILED",
            safeError: "Pemrosesan dokumen gagal. Periksa file lalu coba lagi.",
            errorCode,
          },
        }),
        this.#options.database.iomVersion.updateMany({
          where: { uploadedFileId: payload.uploadedFileId, status: "PROCESSING" },
          data: { status: "FAILED" },
        }),
      ]);
    }
    if (jobType === "INDEX_VERSION" && typeof payload.versionId === "string") {
      await this.#options.database.uploadedFile.updateMany({
        where: { version: { id: payload.versionId }, stage: { not: "COMPLETED" } },
        data: {
          stage: "FAILED",
          safeError: "IOM sudah dipublish, tetapi indexing gagal. Coba indexing lagi.",
          errorCode,
        },
      });
    }
    if (jobType === "ANALYZE_OVERLAP" && typeof payload.runId === "string") {
      await this.#options.database.overlapRun.updateMany({
        where: { id: payload.runId, status: { not: "COMPLETED" } },
        data: { status: "FAILED", errorCode },
      });
    }
    if (jobType === "EVALUATE_POLICY" && typeof payload.policyId === "string") {
      await this.#options.database.confidentialityPolicy.updateMany({
        where: { id: payload.policyId, status: "EVALUATING" },
        data: { status: "DRAFT" },
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
