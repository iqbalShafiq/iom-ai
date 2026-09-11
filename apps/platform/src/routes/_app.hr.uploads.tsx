import { Button, Field, PageHeader, ProgressBar, StatusStamp, Textarea } from "@iom/ui";
import { FileArrowUp, Files, Warning } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { useUploadManager } from "@/features/upload-manager";
import { apiFetch } from "@/lib/api";
import type { UploadBatchRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/uploads")({
  loader: () => apiFetch<{ batches: UploadBatchRow[] }>("/uploads/batches"),
  component: UploadsPage,
});

function UploadsPage() {
  const { batches } = Route.useLoaderData();
  const manager = useUploadManager();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  async function retry(fileId: string) {
    setRetrying(fileId);
    setError("");
    try {
      await apiFetch(`/uploads/files/${fileId}/retry`, { method: "POST" });
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retry gagal dijadwalkan.");
    } finally {
      setRetrying(null);
    }
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list)].slice(0, 500));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await manager.upload(
        files,
        String(form.get("note") ?? ""),
        form.get("confidential") === "on",
      );
      setFiles([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Batch gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }
  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="INGESTION / BATCH"
        title="Upload batches"
        description="Hingga 500 file per batch. PDF scan akan dialihkan ke OCR lokal secara otomatis."
      />
      <form className="upload-workbench" onSubmit={submit}>
        <button
          type="button"
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={drop}
        >
          <FileArrowUp size={42} weight="bold" />
          <strong>Tarik PDF, DOCX, MD, atau TXT ke sini</strong>
          <span>Maksimum 25 MB dan 200 halaman per file. ZIP tidak diterima.</span>
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          multiple
          accept=".pdf,.docx,.md,.markdown,.txt"
          onChange={(event) => addFiles(event.target.files)}
        />
        <div className="upload-options">
          <Field label="Catatan batch" hint="Opsional; AI tetap memeriksa seluruh isi.">
            <Textarea
              name="note"
              rows={4}
              placeholder="Contoh: lampiran budget dan evaluasi individu perlu perhatian khusus."
            />
          </Field>
          <label className="check-field">
            <input type="checkbox" name="confidential" />
            <span>
              <strong>Tandai seluruh batch confidential</strong>
              <small>Marker ini merupakan batas keras dan tidak dapat diturunkan AI.</small>
            </span>
          </label>
        </div>
        <div className="upload-selection">
          <span>
            <Files /> {files.length} file dipilih
          </span>
          <Button type="submit" disabled={busy || files.length === 0}>
            {busy ? "Menyiapkan batch..." : "Mulai upload"}
          </Button>
        </div>
        {error ? (
          <div className="form-alert">
            <Warning /> {error}
          </div>
        ) : null}
      </form>
      {manager.uploads.length ? (
        <section>
          <div className="section-heading">
            <span>LIVE</span>
            <div>
              <h2>Upload aktif</h2>
              <p>Antrean ini tetap hidup selama Anda bekerja di aplikasi.</p>
            </div>
          </div>
          <div className="upload-queue">
            {manager.uploads.map((file) => (
              <div key={file.key}>
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.error ?? file.status}</small>
                </span>
                <ProgressBar value={file.progress} />
                <StatusStamp status={file.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <div className="section-heading">
          <span>HISTORY</span>
          <div>
            <h2>Batch tersimpan</h2>
            <p>Status server akan tetap tersedia setelah refresh.</p>
          </div>
        </div>
        <div className="batch-history">
          {batches.map((batch) => (
            <details key={batch.id}>
              <summary>
                <code>{batch.id.slice(0, 8)}</code>
                <span>{batch.files.length} file</span>
                <time>{new Date(batch.createdAt).toLocaleString("id-ID")}</time>
              </summary>
              {batch.files.map((file) => (
                <div key={file.id}>
                  <strong>{file.originalName}</strong>
                  <ProgressBar value={file.progress} />
                  <StatusStamp status={file.stage} />
                  {file.stage === "FAILED" ? (
                    <Button
                      type="button"
                      disabled={retrying === file.id}
                      onClick={() => retry(file.id)}
                    >
                      {retrying === file.id ? "Menjadwalkan..." : "Coba lagi"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
