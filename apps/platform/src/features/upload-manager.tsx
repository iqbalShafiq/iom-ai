import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";

export interface ClientUpload {
  key: string;
  batchId: string;
  fileId?: string;
  name: string;
  progress: number;
  status: "queued" | "uploading" | "processing" | "reviewing" | "completed" | "failed";
  error?: string;
}

interface UploadManagerValue {
  uploads: ClientUpload[];
  upload(files: File[], note: string, defaultConfidential: boolean): Promise<string>;
}

const UploadManagerContext = createContext<UploadManagerValue | null>(null);

function sendFile(batchId: string, file: File, update: (patch: Partial<ClientUpload>) => void) {
  return new Promise<void>((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl(`/uploads/batches/${batchId}/files`));
    request.withCredentials = true;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        update({ progress: Math.round((event.loaded / event.total) * 70), status: "uploading" });
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        const response = JSON.parse(request.responseText) as { file: { id: string } };
        update({ fileId: response.file.id, progress: 75, status: "processing" });
      } else
        update({
          status: "failed",
          error: request.status === 409 ? "File duplikat." : "Upload gagal.",
        });
      resolve();
    });
    request.addEventListener("error", () => {
      update({ status: "failed", error: "Koneksi upload terputus." });
      resolve();
    });
    const body = new FormData();
    body.append("file", file);
    request.send(body);
  });
}

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<ClientUpload[]>([]);
  const upload = useCallback(async (files: File[], note: string, defaultConfidential: boolean) => {
    const { batch } = await apiFetch<{ batch: { id: string } }>("/uploads/batches", {
      method: "POST",
      body: JSON.stringify({ note: note || undefined, defaultConfidential }),
    });
    const entries = files.map((file) => ({
      key: `${batch.id}:${file.name}:${file.lastModified}`,
      batchId: batch.id,
      name: file.name,
      progress: 0,
      status: "queued" as const,
    }));
    setUploads((current) => [...entries, ...current]);
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index];
        const entry = entries[index];
        if (!file || !entry) continue;
        await sendFile(batch.id, file, (patch) => {
          setUploads((current) =>
            current.map((item) => (item.key === entry.key ? { ...item, ...patch } : item)),
          );
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
    const stream = new EventSource(apiUrl(`/uploads/batches/${batch.id}/events`), {
      withCredentials: true,
    });
    stream.addEventListener("message", (event) => {
      const update = JSON.parse(event.data) as {
        type: string;
        files: Array<{ id: string; stage: string; progress: number; safeError?: string | null }>;
      };
      if (update.type !== "batch_progress") return;
      setUploads((current) =>
        current.map((item) => {
          if (item.batchId !== batch.id || !item.fileId) return item;
          const serverFile = update.files.find((file) => file.id === item.fileId);
          if (!serverFile) return item;
          return {
            ...item,
            progress: serverFile.progress,
            status:
              serverFile.stage === "COMPLETED"
                ? "completed"
                : serverFile.stage === "FAILED"
                  ? "failed"
                  : serverFile.stage === "REVIEWING"
                    ? "reviewing"
                    : "processing",
            ...(serverFile.safeError ? { error: serverFile.safeError } : {}),
          };
        }),
      );
      if (
        update.files.length > 0 &&
        update.files.every(
          (file) =>
            file.stage === "REVIEWING" || file.stage === "COMPLETED" || file.stage === "FAILED",
        )
      )
        stream.close();
    });
    return batch.id;
  }, []);
  const value = useMemo(() => ({ uploads, upload }), [uploads, upload]);
  return <UploadManagerContext.Provider value={value}>{children}</UploadManagerContext.Provider>;
}

export function useUploadManager() {
  const value = useContext(UploadManagerContext);
  if (!value) throw new Error("Upload manager is unavailable.");
  return value;
}
