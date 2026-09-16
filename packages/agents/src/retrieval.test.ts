import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { VectorStore } from "@anvia/core/vector-store";
import type { IomEvidence } from "@iom/contracts";
import { describe, expect, it } from "vitest";
import { RoleScopedKnowledgeIndex } from "./retrieval.js";

type Metadata = { versionId: string; visibility: string; policyVersion: number };

function fakeStore() {
  const deleted: string[][] = [];
  const upserted: string[][] = [];
  const store = {
    ensure: async () => undefined,
    validate: async () => undefined,
    delete: async ({ documentIds }: { documentIds: string[] }) => {
      deleted.push(documentIds);
    },
    upsert: async ({ documents }: { documents: Array<{ id: string }> }) => {
      upserted.push(documents.map((document) => document.id));
    },
    search: async () => [],
  } as unknown as VectorStore<IomEvidence, Metadata> & {
    delete(options: { documentIds: string[] }): Promise<void>;
  };
  return { store, deleted, upserted };
}

const model: EmbeddingModel = {
  provider: "test",
  modelId: "test",
  dimensions: 2,
  embedTexts: async (texts) => texts.map((document) => ({ document, vector: [1, 0] })),
};

function evidence(chunkId: string, visibility: "EMPLOYEE_SAFE" | "HR_ONLY"): IomEvidence {
  return {
    documentId: "document",
    versionId: "version",
    chunkId,
    sourceId: chunkId,
    iomNumber: "IOM-1",
    title: "Aturan",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    text: "Isi aturan",
    score: 1,
    visibility,
    relationContext: [],
  };
}

describe("RoleScopedKnowledgeIndex", () => {
  it("removes stale employee vectors before a policy reindex", async () => {
    const employee = fakeStore();
    const hr = fakeStore();
    const index = new RoleScopedKnowledgeIndex({
      model,
      employeeStore: employee.store,
      hrStore: hr.store,
      authorizer: { authorize: async (items) => [...items] },
    });

    await index.index([evidence("public", "EMPLOYEE_SAFE"), evidence("revoked", "HR_ONLY")], 2);

    expect(employee.deleted).toEqual([["public", "revoked"]]);
    expect(employee.upserted).toEqual([["public"]]);
    expect(hr.upserted).toEqual([["public", "revoked"]]);
  });
});
