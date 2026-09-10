import { randomUUID } from "node:crypto";
import {
  agentToClientStream,
  type ClientStreamEvent,
  parseClientStreamRequest,
} from "@anvia/client";
import type { AgentStreamEvent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { createClientStreamResponse } from "@anvia/server";
import {
  createIomAgent,
  createOpenAIModel,
  createQdrantKnowledgeIndex,
  modelCatalog,
  type RoleScopedKnowledgeIndex,
  resolveModelSelection,
  StreamReleaseGuard,
} from "@iom/agents";
import type { ServerConfig } from "@iom/config";
import { type AccessScope, chatRunMetadataSchema } from "@iom/contracts";
import type { Database, Prisma } from "@iom/database";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "./audit.js";
import { authMiddleware } from "./auth.js";
import { PrismaEvidenceAuthorizer } from "./evidence.js";
import { rateLimit } from "./rate-limit.js";
import type { AppBindings } from "./types.js";

const conversationSchema = z.object({
  accessScope: z.enum(["EMPLOYEE", "HR"]).default("EMPLOYEE"),
  modelId: z.string().default("gpt-5.6-terra"),
  reasoningEffort: z.string().default("medium"),
});

async function deniedFingerprints(database: Database) {
  const decisions = await database.confidentialityDecision.findMany({
    where: { visibility: "HR_ONLY" },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { chunk: true },
  });
  return decisions.flatMap((decision) => {
    const spans = decision.sensitiveSpans as Array<{ start?: number; end?: number }>;
    return spans
      .filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end))
      .map((span) => decision.chunk.text.slice(span.start, span.end))
      .filter((value) => value.length >= 8)
      .map((value) => ({ kind: "entity_value" as const, value }));
  });
}

async function* guardedAgentEvents(
  events: AsyncIterable<AgentStreamEvent>,
  fingerprints: Awaited<ReturnType<typeof deniedFingerprints>>,
  cancel: () => void,
): AsyncIterable<AgentStreamEvent> {
  const textGuard = new StreamReleaseGuard(fingerprints);
  const reasoningGuard = new StreamReleaseGuard(fingerprints);
  let turn = 1;
  for await (const event of events) {
    if ("turn" in event && typeof event.turn === "number") turn = event.turn;
    if (event.type === "text_delta" || event.type === "reasoning_delta") {
      const checked = (event.type === "text_delta" ? textGuard : reasoningGuard).push(event.delta);
      if (checked.blocked) {
        cancel();
        throw new Error("STREAM_CONFIDENTIALITY_BLOCKED");
      }
      if (checked.released) yield { ...event, delta: checked.released };
      continue;
    }
    if (["response", "blocked", "interaction", "error"].includes(event.type)) {
      const finalText = textGuard.flush();
      const finalReasoning = reasoningGuard.flush();
      if (finalText.blocked || finalReasoning.blocked) {
        cancel();
        throw new Error("STREAM_CONFIDENTIALITY_BLOCKED");
      }
      if (finalReasoning.released) {
        yield {
          type: "reasoning_delta",
          turn,
          delta: finalReasoning.released,
          contentType: "summary",
        };
      }
      if (finalText.released) yield { type: "text_delta", turn, delta: finalText.released };
    }
    yield event;
  }
}

async function* withGuardStatus(
  events: AsyncIterable<ClientStreamEvent>,
  runId: string,
): AsyncIterable<ClientStreamEvent> {
  yield {
    runId,
    type: "data",
    name: "stream_guard",
    data: { status: "checking" },
    transient: true,
  };
  try {
    for await (const event of events) yield event;
    yield {
      runId,
      type: "data",
      name: "stream_guard",
      data: { status: "passed" },
      transient: true,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "STREAM_CONFIDENTIALITY_BLOCKED") {
      yield {
        runId,
        type: "data",
        name: "stream_guard",
        data: { status: "blocked" },
        transient: false,
      };
      yield {
        runId,
        type: "error",
        error: {
          code: "OUTPUT_BLOCKED",
          message: "Jawaban dihentikan oleh pemeriksaan kerahasiaan.",
        },
      };
      return;
    }
    throw error;
  }
}

export function registerChatRoutes(app: Hono<AppBindings>, config: ServerConfig) {
  const openai = new OpenAIClient({ apiKey: config.OPENAI_API_KEY });
  let knowledgePromise:
    | Promise<{ index: RoleScopedKnowledgeIndex; close: () => Promise<void> }>
    | undefined;
  const knowledge = (database: Database) => {
    knowledgePromise ??= createQdrantKnowledgeIndex({
      qdrantUrl: config.QDRANT_URL,
      ...(config.QDRANT_API_KEY ? { qdrantApiKey: config.QDRANT_API_KEY } : {}),
      cacheDir: "./models",
      authorizer: new PrismaEvidenceAuthorizer(database),
    }).then(async (service) => {
      await service.index.ensure();
      return service;
    });
    return knowledgePromise;
  };

  app.use("/ai/*", authMiddleware());
  app.use("/chat/*", authMiddleware());

  app.get("/ai/models", (context) =>
    context.json({
      models: modelCatalog,
      defaults: { modelId: "gpt-5.6-terra", reasoningEffort: "medium" },
    }),
  );

  app.get("/chat/conversations", async (context) => {
    const conversations = await context.get("database").conversation.findMany({
      where: { ownerId: context.get("actor").id },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return context.json({ conversations });
  });

  app.post("/chat/conversations", async (context) => {
    const parsed = conversationSchema.safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return context.json({ error: "Preferensi percakapan tidak valid." }, 400);
    const actor = context.get("actor");
    if (parsed.data.accessScope === "HR" && actor.role !== "HR_ADMIN")
      return context.json({ error: "Scope HR tidak tersedia." }, 403);
    const selection = resolveModelSelection(parsed.data.modelId, parsed.data.reasoningEffort);
    const policy = await context.get("database").confidentialityPolicy.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!policy) return context.json({ error: "Policy kerahasiaan aktif belum tersedia." }, 409);
    const conversation = await context.get("database").conversation.create({
      data: {
        ownerId: actor.id,
        accessScope: parsed.data.accessScope,
        modelId: selection.modelId,
        reasoningEffort: selection.reasoningEffort,
        corpusPolicyVersion: policy.version,
      },
    });
    return context.json({ conversation }, 201);
  });

  app.get("/chat/conversations/:conversationId", async (context) => {
    const conversation = await context.get("database").conversation.findFirst({
      where: {
        id: context.req.param("conversationId"),
        ownerId: context.get("actor").id,
      },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!conversation) return context.json({ error: "Percakapan tidak ditemukan." }, 404);
    return context.json({ conversation });
  });

  app.delete("/chat/conversations/:conversationId", async (context) => {
    const deleted = await context.get("database").conversation.deleteMany({
      where: { id: context.req.param("conversationId"), ownerId: context.get("actor").id },
    });
    if (deleted.count === 0) return context.json({ error: "Percakapan tidak ditemukan." }, 404);
    return context.body(null, 204);
  });

  app.post(
    "/chat/stream",
    rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: "chat" }),
    async (context) => {
      const rawRequest = await context.req.json().catch(() => null);
      let request: ReturnType<typeof parseClientStreamRequest>;
      try {
        request = parseClientStreamRequest(rawRequest);
      } catch {
        return context.json({ error: "Format stream request tidak valid." }, 400);
      }
      if (request.type !== "messages")
        return context.json({ error: "Interaction tidak digunakan oleh agent ini." }, 400);
      const metadata = chatRunMetadataSchema.safeParse(request.metadata);
      if (!metadata.success) return context.json({ error: "Metadata chat tidak valid." }, 400);
      const actor = context.get("actor");
      const database = context.get("database");
      const conversation = await database.conversation.findFirst({
        where: { id: metadata.data.conversationId, ownerId: actor.id },
      });
      if (!conversation) return context.json({ error: "Percakapan tidak ditemukan." }, 404);
      if (conversation.accessScope !== metadata.data.accessScope)
        return context.json({ error: "Scope percakapan tidak dapat diubah." }, 409);
      if (conversation.accessScope === "HR" && actor.role !== "HR_ADMIN")
        return context.json({ error: "Scope HR tidak tersedia." }, 403);
      const selection = resolveModelSelection(metadata.data.modelId, metadata.data.reasoningEffort);
      const currentPolicy = await database.confidentialityPolicy.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (!currentPolicy || currentPolicy.version !== conversation.corpusPolicyVersion) {
        return context.json(
          { error: "Percakapan memakai generasi corpus lama. Buat percakapan baru." },
          409,
        );
      }
      const { index } = await knowledge(database);
      const accessScope = conversation.accessScope as AccessScope;
      const agent = createIomAgent({
        model: createOpenAIModel(openai, selection.modelId),
        retrieval: index,
        scope: {
          actorId: actor.id,
          role: actor.role,
          accessScope,
          policyVersion: currentPolicy.version,
        },
      });
      const stream = agent.stream({
        messages: request.messages,
        controls: { reasoningEffort: selection.reasoningEffort },
        abortSignal: context.req.raw.signal,
      });
      const fingerprints = await deniedFingerprints(database);
      const runId = randomUUID();
      const projected = agentToClientStream({
        runId,
        events: guardedAgentEvents(stream.events, fingerprints, () =>
          stream.cancel("stream-guard"),
        ),
        metadata: metadata.data,
        mapError: (error) => ({
          code: "CHAT_RUN_FAILED",
          message:
            error instanceof Error && error.message === "STREAM_CONFIDENTIALITY_BLOCKED"
              ? "Jawaban dihentikan oleh pemeriksaan kerahasiaan."
              : "Chat gagal diproses. Silakan coba lagi.",
        }),
      });
      void audit(database, {
        actorId: actor.id,
        action: "CHAT_RUN",
        entityType: "Conversation",
        entityId: conversation.id,
        correlationId: context.get("correlationId"),
        resultStatus: "STARTED",
        modelId: selection.modelId,
        reasoningEffort: selection.reasoningEffort,
        policyVersion: currentPolicy.version,
      });
      await database.conversation.update({
        where: { id: conversation.id },
        data: { modelId: selection.modelId, reasoningEffort: selection.reasoningEffort },
      });
      await database.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: "request",
          content: request.messages as unknown as Prisma.InputJsonValue,
          modelId: selection.modelId,
          reasoningEffort: selection.reasoningEffort,
        },
      });
      return createClientStreamResponse({
        events: withGuardStatus(projected, runId),
        format: "jsonl",
      });
    },
  );
}
