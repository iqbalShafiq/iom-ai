import { type EmbeddingModel, embedDocuments, embedTexts } from "@anvia/core/embeddings";
import { retrieveDocuments, type VectorStore } from "@anvia/core/vector-store";
import { QdrantVectorClient } from "@anvia/qdrant";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";
import type { AccessScope, IomEvidence, SearchIomInput, SearchIomOutput } from "@iom/contracts";
import { normalizeText } from "@iom/documents";

export const EMBEDDING_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBEDDING_DIMENSIONS = 384;
export const PAGE_EMBEDDING_WINDOW_CHARACTERS = 260;
export const PAGE_EMBEDDING_WINDOW_OVERLAP = 50;

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
    options?: { maxResults?: number; topK?: number },
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

type ReplaceableVectorStore = VectorStore<IomEvidence, EvidenceMetadata> & {
  delete(options: { documentIds: string[] }): Promise<void>;
};

function splitPageForEmbedding(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length <= PAGE_EMBEDDING_WINDOW_CHARACTERS) return [normalized];

  const windows: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const maximumEnd = Math.min(start + PAGE_EMBEDDING_WINDOW_CHARACTERS, normalized.length);
    let end = maximumEnd;
    if (maximumEnd < normalized.length) {
      const paragraphBoundary = normalized.lastIndexOf("\n", maximumEnd);
      const wordBoundary = normalized.lastIndexOf(" ", maximumEnd);
      const preferredBoundary = Math.max(paragraphBoundary, wordBoundary);
      if (preferredBoundary > start + PAGE_EMBEDDING_WINDOW_CHARACTERS / 2) {
        end = preferredBoundary;
      }
    }
    windows.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;

    const overlapStart = Math.max(start + 1, end - PAGE_EMBEDDING_WINDOW_OVERLAP);
    const nextWord = normalized.indexOf(" ", overlapStart);
    start = nextWord >= 0 && nextWord < end ? nextWord + 1 : overlapStart;
  }
  return windows.filter(Boolean);
}

function withoutRelationNotes(evidence: IomEvidence): IomEvidence {
  return {
    ...evidence,
    relationContext: evidence.relationContext.map(({ note: _note, ...relation }) => relation),
  };
}

export function createPageEmbeddingTexts(evidence: IomEvidence): string[] {
  const header = [
    `IOM ${evidence.iomNumber.slice(0, 40)}`,
    `Judul ${evidence.title.slice(0, 80)}`,
    `Halaman ${evidence.page ?? 1}`,
  ].join("\n");
  return splitPageForEmbedding(evidence.text).map((window) => `${header}\n${window}`);
}

export class RoleScopedKnowledgeIndex implements RetrievalService {
  readonly #model: EmbeddingModel;
  readonly #employeeStore: ReplaceableVectorStore;
  readonly #hrStore: ReplaceableVectorStore;
  readonly #authorizer: EvidenceAuthorizer;

  constructor(options: {
    model: EmbeddingModel;
    employeeStore: ReplaceableVectorStore;
    hrStore: ReplaceableVectorStore;
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
    const employee = evidence
      .filter((item) => item.visibility === "EMPLOYEE_SAFE")
      .map(withoutRelationNotes);
    const embeddedEmployee = await embedDocuments({
      model: this.#model,
      documents: employee,
      id: (item) => item.chunkId,
      content: createPageEmbeddingTexts,
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
      content: createPageEmbeddingTexts,
      metadata: (item) => ({
        versionId: item.versionId,
        visibility: item.visibility,
        policyVersion,
      }),
      abortSignal: signal,
    });
    const documentIds = evidence.map((item) => item.chunkId);
    await Promise.all([
      (async () => {
        await this.#employeeStore.delete({ documentIds });
        await this.#employeeStore.upsert({ documents: embeddedEmployee.documents });
      })(),
      (async () => {
        await this.#hrStore.delete({ documentIds });
        await this.#hrStore.upsert({ documents: embeddedHr.documents });
      })(),
    ]);
  }

  async search(
    input: SearchIomInput,
    scope: RetrievalScope,
    signal?: AbortSignal,
    options?: { maxResults?: number; topK?: number },
  ): Promise<SearchIomOutput> {
    const store = scope.accessScope === "EMPLOYEE" ? this.#employeeStore : this.#hrStore;
    const candidates = await retrieveDocuments({
      store,
      model: this.#model,
      query: input.query,
      // A logical page can own several window vectors. Ask Qdrant for extra points so vectors
      // from one dense page do not crowd out other relevant pages before document-level dedupe.
      topK: options?.topK ?? 30,
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
      evidence: authorized.slice(0, options?.maxResults ?? 5),
      temporalScope: { asOf: asOf.toISOString(), includesHistory: input.includeHistory },
      insufficientEvidence: authorized.length === 0,
    };
  }

  async searchProbes(
    queries: readonly string[],
    scope: RetrievalScope,
    signal?: AbortSignal,
  ): Promise<SearchIomOutput[]> {
    if (queries.length === 0) return [];
    const store = scope.accessScope === "EMPLOYEE" ? this.#employeeStore : this.#hrStore;
    const outputs: SearchIomOutput[] = [];
    for (let offset = 0; offset < queries.length; offset += 4) {
      const batch = queries.slice(offset, offset + 4);
      const embedded = await embedTexts({
        model: this.#model,
        texts: [...batch],
        concurrency: 4,
        abortSignal: signal,
      });
      const batchResults = await Promise.all(
        embedded.embeddings.map(async (embedding, index) => {
          const query = batch[index] ?? "";
          const candidates = await store.search({
            vector: embedding.vector,
            topK: 10,
            minScore: 0.35,
            abortSignal: signal,
          });
          const input: SearchIomInput = { query, includeHistory: true };
          const authorized = await this.#authorizer.authorize(
            candidates.map((candidate) => ({ ...candidate.document, score: candidate.score })),
            input,
            scope,
          );
          const asOf = new Date();
          return {
            evidence: authorized,
            temporalScope: { asOf: asOf.toISOString(), includesHistory: true },
            insufficientEvidence: authorized.length === 0,
          } satisfies SearchIomOutput;
        }),
      );
      outputs.push(...batchResults);
    }
    return outputs;
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
