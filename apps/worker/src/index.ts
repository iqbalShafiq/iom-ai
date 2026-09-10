import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";
import { LocalFileStorage } from "@iom/documents";
import { createIngestionHandler } from "./ingestion.js";
import { WorkerRunner } from "./runner.js";

const config = parseServerConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const storage = new LocalFileStorage(config.STORAGE_ROOT);
const handlers = new Map([
  ["INGEST_DOCUMENT", createIngestionHandler(database, storage, config.OCR_LANGUAGES)],
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
