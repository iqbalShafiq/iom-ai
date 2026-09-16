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
import {
  createIndexVersionHandler,
  createOverlapHandler,
  createPolicyEvaluationHandler,
} from "./ai-jobs.js";
import { createIngestionHandler } from "./ingestion.js";
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
const classifier = createConfidentialityClassifier(
  createOpenAIModel(openai, config.CLASSIFIER_MODEL_ID),
);
const knowledge = await createQdrantKnowledgeIndex({
  qdrantUrl: config.QDRANT_URL,
  ...(config.QDRANT_API_KEY ? { qdrantApiKey: config.QDRANT_API_KEY } : {}),
  cacheDir: config.MODEL_CACHE_ROOT,
  authorizer: { authorize: async (evidence) => [...evidence] },
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
      async (input) =>
        classifyConfidentiality({
          agent: classifier,
          policy: input.policy,
          input: {
            text: input.text,
            ...(input.page === undefined ? {} : { page: input.page }),
            ...(input.batchNote === undefined ? {} : { batchNote: input.batchNote }),
            manualMarkers: input.manualConfidential ? [{ kind: "CONFIDENTIAL" }] : [],
          },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
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
    ),
  ],
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
await database.$disconnect();
