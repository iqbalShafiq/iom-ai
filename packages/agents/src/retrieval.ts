import { type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments, type VectorStore } from "@anvia/core/vector-store";
import { QdrantVectorClient } from "@anvia/qdrant";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";
import type { AccessScope, IomEvidence, SearchIomInput, SearchIomOutput } from "@iom/contracts";

export const EMBEDDING_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBEDDING_DIMENSIONS = 384;

export interface RetrievalScope {
  actorId: string;
  accessScope: AccessScope;
  policyVersion: number;
}

export interface RetrievalService {
  search(
    input: SearchIomInput,
    scope: RetrievalScope,
    signal?: AbortSignal,
  ): Promise<SearchIomOutput>;
}

export interface EvidenceAuthorizer {
  authorize(
    evidence: readonly IomEvidence[],
    input: SearchIomInput,
    scope: RetrievalScope,
  ): Promise<IomEvidence[]>;
}

type EvidenceMetadata = {
  versionId: string;
  visibility: string;
  policyVersion: number;
};

export class RoleScopedKnowledgeIndex implements RetrievalService {
  readonly #model: EmbeddingModel;
  readonly #employeeStore: VectorStore<IomEvidence, EvidenceMetadata>;
  readonly #hrStore: VectorStore<IomEvidence, EvidenceMetadata>;
  readonly #authorizer: EvidenceAuthorizer;

  constructor(options: {
    model: EmbeddingModel;
    employeeStore: VectorStore<IomEvidence, EvidenceMetadata>;
    hrStore: VectorStore<IomEvidence, EvidenceMetadata>;
    authorizer: EvidenceAuthorizer;
  }) {
    this.#model = options.model;
    this.#employeeStore = options.employeeStore;
    this.#hrStore = options.hrStore;
    this.#authorizer = options.authorizer;
  }

  async ensure(): Promise<void> {
    await Promise.all([this.#employeeStore.ensure(), this.#hrStore.ensure()]);
  }

  async index(evidence: IomEvidence[], policyVersion: number, signal?: AbortSignal): Promise<void> {
    const employee = evidence.filter((item) => item.visibility === "EMPLOYEE_SAFE");
    const embeddedEmployee = await embedDocuments({
      model: this.#model,
      documents: employee,
      id: (item) => item.chunkId,
      content: (item) => item.text,
      metadata: (item) => ({
        versionId: item.versionId,
        visibility: item.visibility,
        policyVersion,
      }),
      abortSignal: signal,
    });
    const embeddedHr = await embedDocuments({
      model: this.#model,
      documents: evidence,
      id: (item) => item.chunkId,
      content: (item) => item.text,
      metadata: (item) => ({
        versionId: item.versionId,
        visibility: item.visibility,
        policyVersion,
      }),
      abortSignal: signal,
    });
    await Promise.all([
      this.#employeeStore.upsert({ documents: embeddedEmployee.documents }),
      this.#hrStore.upsert({ documents: embeddedHr.documents }),
    ]);
  }

  async search(
    input: SearchIomInput,
    scope: RetrievalScope,
    signal?: AbortSignal,
  ): Promise<SearchIomOutput> {
    const store = scope.accessScope === "EMPLOYEE" ? this.#employeeStore : this.#hrStore;
    const candidates = await retrieveDocuments({
      store,
      model: this.#model,
      query: input.query,
      topK: 10,
      minScore: 0.35,
      abortSignal: signal,
    });
    const authorized = await this.#authorizer.authorize(
      candidates.map((candidate) => ({ ...candidate.document, score: candidate.score })),
      input,
      scope,
    );
    const asOf = input.asOf ? new Date(`${input.asOf}T23:59:59.999Z`) : new Date();
    return {
      evidence: authorized.slice(0, 5),
      temporalScope: { asOf: asOf.toISOString(), includesHistory: input.includeHistory },
      insufficientEvidence: authorized.length === 0,
    };
  }
}

export async function createQdrantKnowledgeIndex(options: {
  qdrantUrl: string;
  qdrantApiKey?: string;
  cacheDir?: string;
  authorizer: EvidenceAuthorizer;
}) {
  const model = await loadTransformersEmbeddingModel({
    modelId: EMBEDDING_MODEL_ID,
    revision: "main",
    pooling: "mean",
    normalize: true,
    maxBatchSize: 16,
    cacheDir: options.cacheDir,
  });
  const client = new QdrantVectorClient({
    url: options.qdrantUrl,
    ...(options.qdrantApiKey ? { apiKey: options.qdrantApiKey } : {}),
  });
  const index = new RoleScopedKnowledgeIndex({
    model,
    employeeStore: client.vectorStore({
      collectionName: "iom_employee_active",
      dimensions: EMBEDDING_DIMENSIONS,
      metric: "cosine",
    }),
    hrStore: client.vectorStore({
      collectionName: "iom_hr_active",
      dimensions: EMBEDDING_DIMENSIONS,
      metric: "cosine",
    }),
    authorizer: options.authorizer,
  });
  return {
    index,
    close: async () => Promise.all([model.close(), client.close()]).then(() => undefined),
  };
}
