import { randomUUID } from "node:crypto";
import {
  agentToClientStream,
  type ClientStreamEvent,
  parseClientStreamRequest,
} from "@anvia/client";
import type { AgentStream, AgentStreamEvent } from "@anvia/core/agent";
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

// Provider output errors that are safe to retry: the model produced a malformed,
// truncated, or cancelled tool call. They happen non-deterministically while
// streaming, and Anvia's internal retry is skipped once reasoning is exposed.
const RETRYABLE_PROVIDER_OUTPUT_KINDS = new Set([
  "malformed-tool-arguments",
  "invalid-tool-arguments",
  "invalid-stream-event",
  "incomplete-stream",
  "incomplete-tool-call",
  "invalid-tool-call",
  "truncated-tool-call",
]);

function isRetryableProviderOutputError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== "ANVIA_COMPLETION_PROVIDER_OUTPUT") return false;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind !== "string" || RETRYABLE_PROVIDER_OUTPUT_KINDS.has(kind);
}

// Runs the agent stream with retries. Reasoning and tool events are buffered
// until the first answer text is released; a retryable provider error before
// that point restarts the run silently, so the client never sees partial
// reasoning from a discarded attempt. After text starts, the stream is live.
// A failed attempt is cancelled before retrying so its in-flight provider
// call cannot interleave with the replacement run. Only the confidentiality
// guard also needs cancel: it throws after detecting blocked content.
async function* runAgentWithRetries(options: {
  start: () => AgentStream;
  fingerprints: Awaited<ReturnType<typeof deniedFingerprints>>;
  maxRetries: number;
  onRetry?: (attempt: number, error: unknown) => void;
}): AsyncIterable<AgentStreamEvent> {
  const { start, fingerprints, maxRetries, onRetry } = options;
  let attempt = 0;
  for (;;) {
    const run = start();
    const events = guardedAgentEvents(run.events, fingerprints, () => {
      try {
        run.cancel("stream-guard");
      } catch {
        // Best effort: the run may already be finished when the guard fires.
      }
    });
    const pending: AgentStreamEvent[] = [];
    let released = false;
    let retry = false;
    for await (const event of events) {
      if (released) {
        yield event;
        continue;
      }
      if (event.type === "text_delta" && event.delta.length > 0) {
        released = true;
        yield* pending;
        pending.length = 0;
        yield event;
        continue;
      }
      if (event.type === "error") {
        if (attempt < maxRetries && isRetryableProviderOutputError(event.error)) {
          onRetry?.(attempt + 1, event.error);
          try {
            run.cancel("stream-retry");
          } catch {
            // Best effort: the failed attempt owns no resources worth failing for.
          }
          retry = true;
          break;
        }
        released = true;
        yield* pending;
        pending.length = 0;
        yield event;
        continue;
      }
      pending.push(event);
    }
    if (!retry) {
      yield* pending;
      return;
    }
    attempt += 1;
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
  const openai = new OpenAIClient({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL,
  });
  let knowledgePromise:
    | Promise<{ index: RoleScopedKnowledgeIndex; close: () => Promise<void> }>
    | undefined;
  const knowledge = (database: Database) => {
    knowledgePromise ??= createQdrantKnowledgeIndex({
      qdrantUrl: config.QDRANT_URL,
      ...(config.QDRANT_API_KEY ? { qdrantApiKey: config.QDRANT_API_KEY } : {}),
      cacheDir: config.MODEL_CACHE_ROOT,
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
      const stream = runAgentWithRetries({
        maxRetries: 2,
        fingerprints: await deniedFingerprints(database),
        onRetry: (attempt, error) => {
          console.error(
            JSON.stringify({
              level: "warn",
              correlationId: context.get("correlationId"),
              message: "Chat run retried after provider output error",
              conversationId: conversation.id,
              modelId: selection.modelId,
              reasoningEffort: selection.reasoningEffort,
              attempt,
              providerMessage:
                typeof (error as { message?: unknown })?.message === "string"
                  ? (error as { message: string }).message
                  : undefined,
            }),
          );
        },
        start: () =>
          agent.stream({
            messages: request.messages,
            controls: { reasoningEffort: selection.reasoningEffort },
            abortSignal: context.req.raw.signal,
          }),
      });
      const runId = randomUUID();
      const logError = (error: unknown) => {
        const providerStatus =
          typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status
            : undefined;
        const providerMessage =
          typeof (error as { message?: unknown })?.message === "string"
            ? (error as { message: string }).message
            : undefined;
        console.error(
          JSON.stringify({
            level: "error",
            correlationId: context.get("correlationId"),
            message: "Chat run failed",
            conversationId: conversation.id,
            modelId: selection.modelId,
            reasoningEffort: selection.reasoningEffort,
            errorKind: error instanceof Error ? error.constructor.name : "UnknownError",
            providerStatus,
            providerMessage,
            // Config keys are not logged; OpenAI SDK may embed key fragments in error messages.
            providerKind:
              typeof (error as { kind?: unknown })?.kind === "string"
                ? (error as { kind: string }).kind
                : undefined,
            providerCode:
              typeof (error as { code?: unknown })?.code === "string"
                ? (error as { code: string }).code
                : undefined,
            providerParam:
              typeof (error as { param?: unknown })?.param === "string"
                ? (error as { param: string }).param
                : undefined,
          }),
        );
      };
      const projected = agentToClientStream({
        runId,
        events: stream,
        metadata: metadata.data,
        mapError: (error) => {
          logError(error);
          return {
            code: "CHAT_RUN_FAILED",
            message:
              error instanceof Error && error.message === "STREAM_CONFIDENTIALITY_BLOCKED"
                ? "Jawaban dihentikan oleh pemeriksaan kerahasiaan."
                : "Chat gagal diproses. Silakan coba lagi.",
          };
        },
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
