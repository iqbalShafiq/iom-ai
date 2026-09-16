import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export interface FileStorage {
  put(key: string, source: NodeJS.ReadableStream): Promise<{ size: number }>;
  read(key: string): NodeJS.ReadableStream;
  delete(key: string): Promise<void>;
  absolutePath(key: string): string;
}

export class LocalFileStorage implements FileStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  absolutePath(key: string): string {
    const path = resolve(this.#root, key);
    if (path !== this.#root && !path.startsWith(`${this.#root}${sep}`)) {
      throw new Error("Storage key escapes configured root.");
    }
    return path;
  }

  async put(key: string, source: NodeJS.ReadableStream): Promise<{ size: number }> {
    const path = this.absolutePath(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(source, createWriteStream(path, { flags: "wx" }));
    return { size: (await stat(path)).size };
  }

  read(key: string): NodeJS.ReadableStream {
    return createReadStream(this.absolutePath(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.absolutePath(key), { force: true });
  }
}
