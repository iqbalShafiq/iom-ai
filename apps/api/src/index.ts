import { serve } from "@hono/node-server";
import { parseServerConfig } from "@iom/config";
import { createDatabase } from "@iom/database";
import { createApp } from "./app.js";

const config = parseServerConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const app = createApp(database, config);

const server = serve({ fetch: app.fetch, port: config.API_PORT }, ({ port }) => {
  console.info(JSON.stringify({ level: "info", message: "API started", port }));
});

async function shutdown() {
  server.close();
  await database.$disconnect();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
