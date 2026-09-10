import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 200;
export const MAX_BATCH_FILES = 500;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);

const allowedExtensions: Record<string, ReadonlySet<string>> = {
  "application/pdf": new Set(["pdf"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set(["docx"]),
  "text/markdown": new Set(["md", "markdown"]),
  "text/plain": new Set(["txt"]),
};

export interface ValidatedFile {
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export async function validateDocumentFile(
  buffer: Uint8Array,
  fileName: string,
  claimedMime: string,
): Promise<ValidatedFile> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("FILE_SIZE_INVALID");
  }

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const detected = await fileTypeFromBuffer(buffer);
  const mimeType = detected?.mime ?? claimedMime.split(";")[0]?.trim() ?? "";
  if (!allowedMimeTypes.has(mimeType) || !allowedExtensions[mimeType]?.has(extension)) {
    throw new Error("FILE_TYPE_INVALID");
  }
  if (detected && detected.mime !== mimeType) throw new Error("FILE_SIGNATURE_MISMATCH");

  return {
    mimeType,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
  };
}
