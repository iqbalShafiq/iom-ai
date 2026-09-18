import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";
import { observabilityFromServerConfig } from "@iom/observability";
import { createApp } from "./app.js";

const parsedConfig = parseServerConfig(process.env);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const config = {
  ...parsedConfig,
  STORAGE_ROOT: resolve(workspaceRoot, parsedConfig.STORAGE_ROOT),
  MODEL_CACHE_ROOT: resolve(workspaceRoot, parsedConfig.MODEL_CACHE_ROOT),
};
const database = createDatabase(config.DATABASE_URL);
const observability = observabilityFromServerConfig(config, "iom-api");
const app = createApp(database, config, observability);

const server = serve({ fetch: app.fetch, port: config.API_PORT }, ({ port }) => {
  console.info(JSON.stringify({ level: "info", message: "API started", port }));
});

async function shutdown() {
  server.close();
  await observability.close();
  await database.$disconnect();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
