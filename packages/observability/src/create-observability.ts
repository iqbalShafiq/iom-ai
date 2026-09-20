import type { Agent } from "@anvia/core/agent";
import type { EvalReporter } from "@anvia/core/evals";
import {
  LangfuseClient,
  type LangfuseEvalExperimentOptions,
  type LangfuseEvalReporterOptions,
  type LangfuseScoreArgs,
} from "@anvia/langfuse";
import { allowAnviaLangfuseSpanExport } from "./export-anvia-spans.js";
import { hashObservabilityId } from "./ids.js";
import { observabilityRedactionPatterns, observabilityRedactionReplacement } from "./masking.js";

type AgentObservability = NonNullable<ConstructorParameters<typeof Agent>[0]["observability"]>;

export type IomObservabilityConfig = {
  enabled: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  environment: string;
  release: string;
  serviceName: string;
  captureMaxBytes: number;
  idSecret?: string;
};

export type IomObservability = {
  readonly enabled: boolean;
  readonly agentObservability: AgentObservability | undefined;
  hashActorId(actorId: string): string | undefined;
  score(args: LangfuseScoreArgs): Promise<void>;
  evalReporter<Input, Output, Expected>(
    options?: LangfuseEvalReporterOptions,
  ): EvalReporter<Input, Output, Expected> | undefined;
  runEvalExperiment<Input, Output, Expected>(
    options: LangfuseEvalExperimentOptions<Input, Output, Expected>,
  ): Promise<unknown>;
  flush(): Promise<void>;
  close(): Promise<void>;
};

function createNoopObservability(): IomObservability {
  const close = async () => undefined;
  return {
    enabled: false,
    agentObservability: undefined,
    hashActorId: () => undefined,
    score: async () => undefined,
    evalReporter: () => undefined,
    runEvalExperiment: async () => {
      throw new Error("LANGFUSE_DISABLED");
    },
    flush: async () => undefined,
    close,
  };
}

export function createIomObservability(config: IomObservabilityConfig): IomObservability {
  if (!config.enabled) return createNoopObservability();
  if (!config.publicKey || !config.secretKey || !config.idSecret) {
    throw new Error("LANGFUSE_CONFIG_INCOMPLETE");
  }

  allowAnviaLangfuseSpanExport();
  // Anvia constructs LangfuseSpanProcessor without exportMode; a tiny batch
  // plus short interval makes forceFlush actually send OTLP spans.
  process.env.LANGFUSE_FLUSH_AT ??= "1";
  process.env.LANGFUSE_FLUSH_INTERVAL ??= "0.05";
  process.env.LANGFUSE_TIMEOUT ??= "30";
  const client = new LangfuseClient({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    release: config.release,
    serviceName: config.serviceName,
    scores: {
      batchSize: 20,
      flushIntervalMs: 250,
      retries: { maxAttempts: 3 },
    },
  });

  const observer = client.observer({
    captureMode: "full",
    captureMaxBytes: config.captureMaxBytes,
    redactInputs: true,
    redactOutputs: "deep",
    redaction: {
      patterns: observabilityRedactionPatterns,
      replacement: observabilityRedactionReplacement,
    },
  });

  const agentObservability: AgentObservability = {
    observers: { langfuse: observer },
    primaryTrace: "langfuse",
    errorPolicy: "ignore",
  };

  const idSecret = config.idSecret;
  let closed = false;

  return {
    enabled: true,
    agentObservability,
    hashActorId: (actorId) => hashObservabilityId(idSecret, actorId),
    score: async (args) => {
      if (closed) return;
      await client.score(args);
    },
    evalReporter: (options) =>
      client.evalReporter({
        onMissingTrace: "throw",
        includeMessages: true,
        includeContext: true,
        ...options,
      }),
    runEvalExperiment: (options) => client.runEvalExperiment(options),
    flush: () => client.flush(),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

export function observabilityFromServerConfig(
  config: {
    LANGFUSE_ENABLED: boolean;
    LANGFUSE_PUBLIC_KEY?: string | undefined;
    LANGFUSE_SECRET_KEY?: string | undefined;
    LANGFUSE_BASE_URL: string;
    LANGFUSE_ENVIRONMENT: string;
    LANGFUSE_RELEASE: string;
    LANGFUSE_CAPTURE_MAX_BYTES: number;
    OBSERVABILITY_ID_SECRET?: string | undefined;
  },
  serviceName: "iom-api" | "iom-worker" | "iom-eval",
): IomObservability {
  const input: IomObservabilityConfig = {
    enabled: config.LANGFUSE_ENABLED,
    baseUrl: config.LANGFUSE_BASE_URL,
    environment: config.LANGFUSE_ENVIRONMENT,
    release: config.LANGFUSE_RELEASE,
    serviceName,
    captureMaxBytes: config.LANGFUSE_CAPTURE_MAX_BYTES,
  };
  if (config.LANGFUSE_PUBLIC_KEY !== undefined) input.publicKey = config.LANGFUSE_PUBLIC_KEY;
  if (config.LANGFUSE_SECRET_KEY !== undefined) input.secretKey = config.LANGFUSE_SECRET_KEY;
  if (config.OBSERVABILITY_ID_SECRET !== undefined) input.idSecret = config.OBSERVABILITY_ID_SECRET;
  return createIomObservability(input);
}
