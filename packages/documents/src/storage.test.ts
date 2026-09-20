import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileStorage,
  type FileStorageConfig,
  LocalFileStorage,
  R2FileStorage,
} from "./storage.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "iom-storage-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

class FakeS3Client {
  readonly sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  readonly objects = new Map<string, Buffer>();

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const name = command.constructor.name;
    this.sent.push({ name, input: command.input });
    const key = String(command.input.Key);
    if (name === "PutObjectCommand") {
      this.objects.set(key, Buffer.from(command.input.Body as Uint8Array));
      return {};
    }
    if (name === "GetObjectCommand") {
      const body = this.objects.get(key);
      if (!body) throw new Error(`NoSuchKey: ${key}`);
      return { Body: Readable.from([body]) };
    }
    if (name === "DeleteObjectCommand") {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`Unexpected command: ${name}`);
  }
}

function r2Storage(client: FakeS3Client, tempRoot: string) {
  return new R2FileStorage({
    bucket: "iom-ai",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    accountId: "account-id",
    endpoint: undefined,
    client: client as unknown as S3Client,
    tempRoot,
  });
}

function storageSettings(overrides: Partial<FileStorageConfig> = {}): FileStorageConfig {
  return {
    STORAGE_DRIVER: "local",
    STORAGE_ROOT: "/tmp/iom-storage-root",
    R2_BUCKET_NAME: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    R2_ACCOUNT_ID: undefined,
    R2_ENDPOINT: undefined,
    ...overrides,
  };
}

describe("LocalFileStorage", () => {
  it("stores, reads, materializes, and deletes an object", async () => {
    const storage = new LocalFileStorage(await createTemporaryRoot());
    const key = "uploads/batch/file.txt";

    expect(await storage.put(key, Readable.from([Buffer.from("halo")]))).toEqual({ size: 4 });

    const materialized = await storage.materialize(key);
    expect(await readFile(materialized.path, "utf8")).toBe("halo");
    await materialized.release();

    expect(await readStream(await storage.read(key))).toBe("halo");

    await storage.delete(key);
    await expect(storage.read(key)).rejects.toThrow();
  });

  it("rejects keys that escape the configured root", async () => {
    const storage = new LocalFileStorage(await createTemporaryRoot());
    await expect(storage.materialize("../outside.txt")).rejects.toThrow("escapes configured root");
  });
});

describe("R2FileStorage", () => {
  it("uploads the streamed bytes and reports the stored size", async () => {
    const client = new FakeS3Client();
    const storage = r2Storage(client, await createTemporaryRoot());
    const key = "uploads/batch/document.pdf";

    expect(await storage.put(key, Readable.from([Buffer.from("pdf-bytes")]))).toEqual({
      size: 9,
    });

    expect(client.objects.get(key)?.toString("utf8")).toBe("pdf-bytes");
    expect(client.sent[0]).toMatchObject({
      name: "PutObjectCommand",
      input: { Bucket: "iom-ai", Key: key, ContentLength: 9 },
    });
  });

  it("refuses to store an empty object", async () => {
    const storage = r2Storage(new FakeS3Client(), await createTemporaryRoot());
    await expect(storage.put("uploads/empty.pdf", Readable.from([]))).rejects.toThrow(
      "Refusing to store an empty object.",
    );
  });

  it("reads an object back and fails for a missing key", async () => {
    const client = new FakeS3Client();
    const storage = r2Storage(client, await createTemporaryRoot());
    await storage.put("uploads/batch/file.txt", Readable.from([Buffer.from("halo")]));

    expect(await readStream(await storage.read("uploads/batch/file.txt"))).toBe("halo");
    await expect(storage.read("uploads/missing.txt")).rejects.toThrow("NoSuchKey");
  });

  it("materializes an object into a temporary file and releases it", async () => {
    const client = new FakeS3Client();
    const tempRoot = await createTemporaryRoot();
    const storage = r2Storage(client, tempRoot);
    await storage.put("uploads/batch/file.txt", Readable.from([Buffer.from("halo")]));

    const materialized = await storage.materialize("uploads/batch/file.txt");
    expect(materialized.path.startsWith(tempRoot)).toBe(true);
    expect(await readFile(materialized.path, "utf8")).toBe("halo");

    await materialized.release();
    await expect(readFile(materialized.path, "utf8")).rejects.toThrow();
  });

  it("deletes an object", async () => {
    const client = new FakeS3Client();
    const storage = r2Storage(client, await createTemporaryRoot());
    await storage.put("uploads/batch/file.txt", Readable.from([Buffer.from("halo")]));

    await storage.delete("uploads/batch/file.txt");
    expect(client.objects.has("uploads/batch/file.txt")).toBe(false);
  });
});

describe("createFileStorage", () => {
  it("builds local storage by default", () => {
    expect(createFileStorage(storageSettings())).toBeInstanceOf(LocalFileStorage);
  });

  it("builds R2 storage when the driver is configured", () => {
    const storage = createFileStorage(
      storageSettings({
        STORAGE_DRIVER: "r2",
        R2_BUCKET_NAME: "iom-ai",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
        R2_ACCOUNT_ID: "account-id",
      }),
    );
    expect(storage).toBeInstanceOf(R2FileStorage);
  });

  it("rejects R2 storage without credentials", () => {
    expect(() =>
      createFileStorage(storageSettings({ STORAGE_DRIVER: "r2", R2_BUCKET_NAME: "iom-ai" })),
    ).toThrow("R2 storage requires R2_BUCKET_NAME");
  });

  it("rejects R2 storage without an account id or endpoint", () => {
    expect(() =>
      createFileStorage(
        storageSettings({
          STORAGE_DRIVER: "r2",
          R2_BUCKET_NAME: "iom-ai",
          R2_ACCESS_KEY_ID: "access-key",
          R2_SECRET_ACCESS_KEY: "secret-key",
        }),
      ),
    ).toThrow("R2 storage requires R2_ACCOUNT_ID or R2_ENDPOINT.");
  });
});
