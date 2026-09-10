import type { Prisma } from "./generated/prisma/client.js";
import type { Database } from "./index.js";

export interface LeasedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

export async function enqueueJob(
  database: Pick<Database, "backgroundJob">,
  input: {
    type: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
    maxAttempts?: number;
  },
) {
  return database.backgroundJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 3,
    },
    update: {},
  });
}

export async function leaseNextJob(
  database: Database,
  workerId: string,
  leaseSeconds: number,
): Promise<LeasedJob | null> {
  const rows = await database.$queryRaw<LeasedJob[]>`
    UPDATE "BackgroundJob"
    SET status = 'RUNNING',
        "leaseOwner" = ${workerId},
        "leaseExpiresAt" = NOW() + (${leaseSeconds} * INTERVAL '1 second'),
        "heartbeatAt" = NOW(),
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "BackgroundJob"
      WHERE (
        (status = 'QUEUED' AND "availableAt" <= NOW()) OR
        (status = 'RUNNING' AND "leaseExpiresAt" < NOW())
      )
      AND attempts < "maxAttempts"
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, "maxAttempts"
  `;
  return rows[0] ?? null;
}

export async function heartbeatJob(
  database: Database,
  jobId: string,
  workerId: string,
  leaseSeconds: number,
) {
  return database.backgroundJob.updateMany({
    where: { id: jobId, leaseOwner: workerId, status: "RUNNING" },
    data: {
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000),
    },
  });
}

export async function completeJob(database: Database, jobId: string, workerId: string) {
  return database.backgroundJob.updateMany({
    where: { id: jobId, leaseOwner: workerId, status: "RUNNING" },
    data: { status: "COMPLETED", leaseOwner: null, leaseExpiresAt: null },
  });
}

export async function failJob(
  database: Database,
  job: LeasedJob,
  workerId: string,
  errorCode: string,
  transient: boolean,
) {
  const terminal = !transient || job.attempts >= job.maxAttempts;
  return database.backgroundJob.updateMany({
    where: { id: job.id, leaseOwner: workerId, status: "RUNNING" },
    data: {
      status: terminal ? "DEAD_LETTER" : "QUEUED",
      lastErrorCode: errorCode,
      availableAt: terminal ? new Date() : new Date(Date.now() + 2 ** job.attempts * 1_000),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
}
