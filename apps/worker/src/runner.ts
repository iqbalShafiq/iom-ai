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
      await failJob(this.#options.database, job, this.#id, jobError.code, jobError.transient);
    } finally {
      clearInterval(heartbeat);
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
