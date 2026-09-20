import type { EmbeddingModel } from "@anvia/core/embeddings";
import type { VectorStore } from "@anvia/core/vector-store";
import type { IomEvidence } from "@iom/contracts";
import { describe, expect, it } from "vitest";
import {
  createPageEmbeddingTexts,
  PAGE_EMBEDDING_WINDOW_CHARACTERS,
  RoleScopedKnowledgeIndex,
} from "./retrieval.js";

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

  it("keeps a short one-page memo in one embedding window", () => {
    const texts = createPageEmbeddingTexts(evidence("page-1", "EMPLOYEE_SAFE"));

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Halaman 1");
    expect(texts[0]).toContain("Isi aturan");
  });

  it("covers a dense page with multiple vectors while retaining one logical page id", async () => {
    const employee = fakeStore();
    const hr = fakeStore();
    const embeddedTexts: string[] = [];
    const capturingModel: EmbeddingModel = {
      ...model,
      embedTexts: async (texts) => {
        embeddedTexts.push(...texts);
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    const index = new RoleScopedKnowledgeIndex({
      model: capturingModel,
      employeeStore: employee.store,
      hrStore: hr.store,
      authorizer: { authorize: async (items) => [...items] },
    });
    const page = evidence("page-1", "EMPLOYEE_SAFE");
    page.text = `${"ketentuan perjalanan dinas ".repeat(80)}AKHIR_UNIK`;

    await index.index([page], 2);

    const pageWindows = createPageEmbeddingTexts(page);
    expect(pageWindows.length).toBeGreaterThan(1);
    expect(pageWindows.at(-1)).toContain("AKHIR_UNIK");
    expect(pageWindows.every((text) => text.length <= PAGE_EMBEDDING_WINDOW_CHARACTERS + 180)).toBe(
      true,
    );
    expect(employee.upserted).toEqual([["page-1"]]);
    expect(embeddedTexts).toEqual([...pageWindows, ...pageWindows]);
  });

  it("embeds overlap probes in bounded batches and searches the HR store", async () => {
    const hr = fakeStore();
    const embeddedBatches: string[][] = [];
    const probeModel: EmbeddingModel = {
      ...model,
      embedTexts: async (texts) => {
        embeddedBatches.push([...texts]);
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    const index = new RoleScopedKnowledgeIndex({
      model: probeModel,
      employeeStore: fakeStore().store,
      hrStore: hr.store,
      authorizer: { authorize: async (items) => [...items] },
    });

    const results = await index.searchProbes(["probe-1", "probe-2", "probe-3"], {
      actorId: "worker",
      accessScope: "HR",
      policyVersion: 2,
    });

    expect(embeddedBatches).toEqual([["probe-1", "probe-2", "probe-3"]]);
    expect(results).toHaveLength(3);
  });
});
