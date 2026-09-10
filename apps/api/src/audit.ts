import type { Database, Prisma } from "@iom/database";

export interface AuditInput {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  correlationId: string;
  resultStatus: string;
  modelId?: string;
  reasoningEffort?: string;
  policyVersion?: number;
  sourceIds?: Prisma.InputJsonValue;
  safeMetadata?: Prisma.InputJsonValue;
}

export async function audit(database: Database, input: AuditInput): Promise<void> {
  await database.auditEvent.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      correlationId: input.correlationId,
      resultStatus: input.resultStatus,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
      ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
      ...(input.safeMetadata ? { safeMetadata: input.safeMetadata } : {}),
    },
  });
}
