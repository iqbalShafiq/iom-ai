import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyConfidentiality,
  createConfidentialityClassifier,
  createIomOpenAIClient,
  createOpenAIModel,
  createQdrantKnowledgeIndex,
} from "@iom/agents";
import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";
import { LocalFileStorage } from "@iom/documents";
import { confidentialityTrace, observabilityFromServerConfig } from "@iom/observability";
import {
  createIndexVersionHandler,
  createOverlapHandler,
  createPolicyEvaluationHandler,
} from "./ai-jobs.js";
import { createIngestionHandler } from "./ingestion.js";
import { createLangfuseScoreHandler } from "./langfuse-scores.js";
import { WorkerRunner } from "./runner.js";

const parsedConfig = parseServerConfig(process.env);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const config = {
  ...parsedConfig,
  STORAGE_ROOT: resolve(workspaceRoot, parsedConfig.STORAGE_ROOT),
  MODEL_CACHE_ROOT: resolve(workspaceRoot, parsedConfig.MODEL_CACHE_ROOT),
};
const database = createDatabase(config.DATABASE_URL);
const storage = new LocalFileStorage(config.STORAGE_ROOT);
const openai = createIomOpenAIClient({
  apiKey: config.OPENAI_API_KEY,
  ...(config.OPENAI_BASE_URL === undefined ? {} : { baseUrl: config.OPENAI_BASE_URL }),
});
const observability = observabilityFromServerConfig(config, "iom-worker");
const classifier = createConfidentialityClassifier(
  createOpenAIModel(openai, config.CLASSIFIER_MODEL_ID),
  observability.agentObservability,
);
const knowledge = await createQdrantKnowledgeIndex({
  qdrantUrl: config.QDRANT_URL,
  ...(config.QDRANT_API_KEY ? { qdrantApiKey: config.QDRANT_API_KEY } : {}),
  cacheDir: config.MODEL_CACHE_ROOT,
  authorizer: {
    authorize: async (evidence, input, scope) => {
      const ids = [...new Set(evidence.map((item) => item.chunkId))];
      if (ids.length === 0) return [];
      const asOf = input.asOf ? new Date(`${input.asOf}T23:59:59.999Z`) : new Date();
      const chunks = await database.iomChunk.findMany({
        where: {
          id: { in: ids },
          visibility: {
            in: scope.accessScope === "EMPLOYEE" ? ["EMPLOYEE_SAFE"] : ["EMPLOYEE_SAFE", "HR_ONLY"],
          },
          vectorGeneration: scope.policyVersion,
          version: {
            status: input.includeHistory ? { in: ["PUBLISHED", "SUPERSEDED"] } : "PUBLISHED",
            ...(scope.actorId === "worker"
              ? {}
              : {
                  effectiveFrom: { lte: asOf },
                  OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: asOf } }],
                }),
          },
        },
        select: { id: true },
      });
      const authorized = new Set(chunks.map((chunk) => chunk.id));
      return evidence.filter((item) => authorized.has(item.chunkId));
    },
  },
});
await knowledge.index.ensure();

const handlers = new Map([
  [
    "INGEST_DOCUMENT",
    createIngestionHandler(
      database,
      storage,
      config.OCR_LANGUAGES,
      config.CLASSIFIER_MODEL_ID,
      config.WORKER_AI_TIMEOUT_MS,
      async (input) => {
        let capturedTrace: { traceId: string; observationId?: string } | undefined;
        const decision = await classifyConfidentiality({
          agent: classifier,
          policy: input.policy,
          input: {
            text: input.text,
            ...(input.page === undefined ? {} : { page: input.page }),
            ...(input.batchNote === undefined ? {} : { batchNote: input.batchNote }),
            manualMarkers: input.manualConfidential ? [{ kind: "CONFIDENTIAL" }] : [],
          },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          trace: confidentialityTrace({
            sessionId: input.versionId,
            modelId: config.CLASSIFIER_MODEL_ID,
            policyVersion: input.policy.version,
            ...(input.page === undefined ? {} : { page: input.page }),
            service: "worker",
            environment: config.LANGFUSE_ENVIRONMENT,
            release: config.LANGFUSE_RELEASE,
          }),
          onTrace: (trace) => {
            capturedTrace = { traceId: trace.traceId };
            if (trace.observationId !== undefined)
              capturedTrace.observationId = trace.observationId;
          },
        });
        return {
          decision,
          ...(capturedTrace?.traceId ? { observabilityTraceId: capturedTrace.traceId } : {}),
          ...(capturedTrace?.observationId
            ? { observabilityObservationId: capturedTrace.observationId }
            : {}),
        };
      },
    ),
  ],
  ["INDEX_VERSION", createIndexVersionHandler(database, knowledge.index)],
  [
    "EVALUATE_POLICY",
    createPolicyEvaluationHandler(
      database,
      openai,
      config.CLASSIFIER_MODEL_ID,
      config.WORKER_AI_TIMEOUT_MS,
      observability,
      config.LANGFUSE_ENVIRONMENT,
      config.LANGFUSE_RELEASE,
    ),
  ],
  [
    "ANALYZE_OVERLAP",
    createOverlapHandler(
      database,
      knowledge.index,
      openai,
      config.OVERLAP_MODEL_ID,
      config.WORKER_AI_TIMEOUT_MS,
      observability,
      config.LANGFUSE_ENVIRONMENT,
      config.LANGFUSE_RELEASE,
    ),
  ],
  ["PUBLISH_LANGFUSE_SCORE", createLangfuseScoreHandler(database, observability)],
]);
const runner = new WorkerRunner({
  database,
  handlers,
  concurrency: config.WORKER_CONCURRENCY,
  leaseSeconds: config.JOB_LEASE_SECONDS,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => runner.stop());
}

await runner.run();
await knowledge.close();
await observability.close();
await database.$disconnect();
