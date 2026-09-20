import { Button, HoverPopover, PageHeader, ProgressBar, StatusStamp } from "@iom/ui";
import {
  ClockCounterClockwise,
  FileArrowUp,
  Files,
  Globe,
  LockKey,
  Pulse,
  Warning,
} from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { useUploadManager } from "@/features/upload-manager";
import { apiFetch } from "@/lib/api";
import type { UploadBatchRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents/upload")({
  loader: () => apiFetch<{ batches: UploadBatchRow[] }>("/uploads/batches"),
  component: UploadsPage,
});

function UploadsPage() {
  const { batches } = Route.useLoaderData();
  const manager = useUploadManager();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => {
    const hasActiveBatch = batches.some((batch) =>
      batch.files.some((file) => !["REVIEWING", "COMPLETED", "FAILED"].includes(file.stage)),
    );
    if (!hasActiveBatch) return;
    const timer = window.setInterval(() => void router.invalidate(), 2_000);
    return () => window.clearInterval(timer);
  }, [batches, router]);
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
    setBusy(true);
    setError("");
    try {
      await manager.upload(files, "", confidential);
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
      <PageHeader title="Upload dokumen" />
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
        <div className="upload-selection">
          <span>
            <Files /> {files.length} file dipilih
          </span>
          <div className="upload-selection__actions">
            <label className={`confidential-switch${confidential ? " is-confidential" : ""}`}>
              <input
                type="checkbox"
                name="confidential"
                checked={confidential}
                onChange={(event) => setConfidential(event.target.checked)}
                aria-label="Tandai seluruh batch confidential"
              />
              <span className="confidential-switch__control">
                <HoverPopover
                  className="upload-confidential-popover upload-confidential-popover--public"
                  trigger={
                    <span className="confidential-switch__icon" aria-hidden="true">
                      <Globe weight="bold" />
                    </span>
                  }
                >
                  <strong>Non-confidential</strong>
                  <span>Dokumen employee-safe dapat tersedia untuk karyawan.</span>
                </HoverPopover>
                <span className="confidential-switch__thumb" aria-hidden="true" />
                <HoverPopover
                  className="upload-confidential-popover upload-confidential-popover--confidential"
                  trigger={
                    <span className="confidential-switch__icon" aria-hidden="true">
                      <LockKey weight="bold" />
                    </span>
                  }
                >
                  <strong>Confidential</strong>
                  <span>Marker ini berlaku untuk seluruh batch dan tidak dapat diturunkan AI.</span>
                </HoverPopover>
              </span>
            </label>
            <Button type="submit" disabled={busy || files.length === 0}>
              {busy ? "Menyiapkan batch..." : "Mulai upload"}
            </Button>
          </div>
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
            <span aria-hidden="true" title="Upload aktif">
              <Pulse weight="bold" />
            </span>
            <div>
              <h2>Upload aktif</h2>
              <p>Tetap aktif antarlaman</p>
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
          <span aria-hidden="true" title="Riwayat unggahan">
            <ClockCounterClockwise weight="bold" />
          </span>
          <div>
            <h2>Batch tersimpan</h2>
            <p>Tersimpan setelah refresh</p>
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
