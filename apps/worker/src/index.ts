import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";
import { LocalFileStorage } from "@iom/documents";
import { createIngestionHandler } from "./ingestion.js";
import { WorkerRunner } from "./runner.js";

const config = parseServerConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const storage = new LocalFileStorage(config.STORAGE_ROOT);
const openai = new OpenAIClient({ apiKey: config.OPENAI_API_KEY });
const classifier = createConfidentialityClassifier(
  createOpenAIModel(openai, config.CLASSIFIER_MODEL_ID),
);
const handlers = new Map([
  [
    "INGEST_DOCUMENT",
    createIngestionHandler(database, storage, config.OCR_LANGUAGES, async (input) =>
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
await database.$disconnect();

import { OpenAIClient } from "@anvia/openai";
import {
  classifyConfidentiality,
  createConfidentialityClassifier,
  createOpenAIModel,
} from "@iom/agents";
