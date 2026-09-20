import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** A local file that can be handed to parsers and previews. */
export interface MaterializedFile {
  path: string;
  /** Removes the temporary copy. No-op when the object already lives on disk. */
  release(): Promise<void>;
}

export interface FileStorage {
  put(key: string, source: NodeJS.ReadableStream): Promise<{ size: number }>;
  /** Opens the object bytes. Rejects when the object does not exist. */
  read(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /**
   * Exposes the object as a local file so local parsers and the preview route
   * work the same for every driver. Callers must always `release()`.
   */
  materialize(key: string): Promise<MaterializedFile>;
}

export class LocalFileStorage implements FileStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #path(key: string): string {
    const path = resolve(this.#root, key);
    if (path !== this.#root && !path.startsWith(`${this.#root}${sep}`)) {
      throw new Error("Storage key escapes configured root.");
    }
    return path;
  }

  async put(key: string, source: NodeJS.ReadableStream): Promise<{ size: number }> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(source, createWriteStream(path, { flags: "wx" }));
    return { size: (await stat(path)).size };
  }

  async read(key: string): Promise<Readable> {
    const path = this.#path(key);
    await stat(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  async materialize(key: string): Promise<MaterializedFile> {
    return { path: this.#path(key), release: async () => {} };
  }
}

export interface R2FileStorageOptions {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required unless `endpoint` points at the bucket explicitly. */
  accountId: string | undefined;
  endpoint: string | undefined;
  /** Injection point for tests; production builds the default S3 client. */
  client?: S3Client;
  /** Directory for materialized downloads; defaults to the OS temp directory. */
  tempRoot?: string;
}

/**
 * Cloudflare R2 through the S3-compatible API. Keys are application-owned, the
 * bucket stays private, and every byte reaches a client through the API
 * authorization boundary.
 */
export class R2FileStorage implements FileStorage {
  readonly #bucket: string;
  readonly #client: S3Client;
  readonly #tempRoot: string;

  constructor(options: R2FileStorageOptions) {
    this.#bucket = options.bucket;
    this.#tempRoot = options.tempRoot ?? tmpdir();
    this.#client =
      options.client ??
      new S3Client({
        region: "auto",
        endpoint: options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
  }

  async put(key: string, source: NodeJS.ReadableStream): Promise<{ size: number }> {
    const body = await collectStream(source);
    if (body.byteLength === 0) throw new Error("Refusing to store an empty object.");
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
      }),
    );
    return { size: body.byteLength };
  }

  async read(key: string): Promise<Readable> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    const body: unknown = response.Body;
    if (body instanceof Readable) return body;
    if (body !== null && typeof body === "object" && Symbol.asyncIterator in body) {
      return Readable.from(body as AsyncIterable<Uint8Array>);
    }
    throw new Error(`Object ${key} has no readable body.`);
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async materialize(key: string): Promise<MaterializedFile> {
    const directory = await mkdtemp(join(this.#tempRoot, "iom-storage-"));
    const filename = (key.split("/").pop() ?? "object").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(directory, filename);
    try {
      await pipeline(await this.read(key), createWriteStream(path));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return {
      path,
      release: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  }
}

async function collectStream(source: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Validated server configuration slice needed to pick a storage driver. */
export interface FileStorageConfig {
  STORAGE_DRIVER: "local" | "r2";
  STORAGE_ROOT: string;
  R2_BUCKET_NAME?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_ACCOUNT_ID?: string | undefined;
  R2_ENDPOINT?: string | undefined;
}

export function createFileStorage(config: FileStorageConfig): FileStorage {
  if (config.STORAGE_DRIVER === "local") return new LocalFileStorage(config.STORAGE_ROOT);

  const { R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_ENDPOINT } =
    config;
  if (!R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2 storage requires R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
    );
  }
  if (!R2_ACCOUNT_ID && !R2_ENDPOINT) {
    throw new Error("R2 storage requires R2_ACCOUNT_ID or R2_ENDPOINT.");
  }
  return new R2FileStorage({
    bucket: R2_BUCKET_NAME,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    accountId: R2_ACCOUNT_ID,
    endpoint: R2_ENDPOINT,
  });
}
