import { enqueueJob } from "@iom/database/jobs";
import { langfuseScoreIdempotencyKey, langfuseScoreJobType } from "@iom/observability";

export async function enqueueLangfuseScore(
  database: Parameters<typeof enqueueJob>[0],
  input: {
    kind: "confidentiality" | "overlap";
    entityId: string;
    revision: string;
  },
) {
  await enqueueJob(database, {
    type: langfuseScoreJobType(),
    payload: { kind: input.kind, entityId: input.entityId },
    idempotencyKey: langfuseScoreIdempotencyKey(input),
  });
}
