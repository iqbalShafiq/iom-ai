import { randomUUID } from "node:crypto";
import type { ServerConfig } from "@iom/config";
import type { Database } from "@iom/database";
import type { IomObservability } from "@iom/observability";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { registerAuthRoutes } from "./auth.js";
import { registerChatRoutes } from "./chat.js";
import { registerDocumentRoutes } from "./documents.js";
import { registerOverlapRoutes } from "./overlap.js";
import { rateLimit } from "./rate-limit.js";
import type { AppBindings } from "./types.js";

export function createApp(
  database: Database,
  config: ServerConfig,
  observability?: IomObservability,
) {
  const app = new Hono<AppBindings>();
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: false,
      crossOriginResourcePolicy: false,
    }),
  );
  app.use(
    "*",
    cors({
      origin: config.PLATFORM_ORIGIN,
      credentials: true,
      allowHeaders: ["Content-Type", "X-CSRF-Token"],
      // @anvia/client validates this protocol header on streamed responses.
      exposeHeaders: ["x-anvia-stream-protocol", "x-iom-conversation-id"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use("*", async (context, next) => {
    context.set("database", database);
    context.set("correlationId", context.req.header("x-request-id") ?? randomUUID());
    await next();
  });
  app.use("*", async (context, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      if (origin && origin !== config.PLATFORM_ORIGIN)
        return context.json({ error: "Origin tidak diizinkan." }, 403);
    }
    await next();
  });
  app.use("/auth/login", rateLimit({ limit: 10, windowMs: 15 * 60_000, keyPrefix: "login" }));
  app.get("/health", (context) => context.json({ status: "ok" }));

  registerAuthRoutes(app, config);
  registerChatRoutes(app, config, observability);
  registerDocumentRoutes(app, config);
  registerOverlapRoutes(app, config.OVERLAP_MODEL_ID);

  app.notFound((context) => context.json({ error: "Endpoint tidak ditemukan." }, 404));
  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        level: "error",
        correlationId: context.get("correlationId"),
        message: "Unhandled API error",
        errorKind: error.constructor.name,
      }),
    );
    return context.json(
      { error: "Permintaan gagal diproses.", correlationId: context.get("correlationId") },
      500,
    );
  });
  return app;
}
