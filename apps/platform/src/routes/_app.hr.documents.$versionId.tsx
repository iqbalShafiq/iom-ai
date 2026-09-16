import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  SelectOption,
  StatusStamp,
} from "@iom/ui";
import { Calendar, Check, EyeSlash, FilePdf, GitBranch, Warning } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents/$versionId")({
  loader: async ({ params }) => {
    const [detail, list] = await Promise.all([
      apiFetch<{ version: IomVersionRow }>(`/iom/${params.versionId}`),
      apiFetch<{ versions: IomVersionRow[] }>("/iom"),
    ]);
    return { ...detail, versions: list.versions };
  },
  component: DocumentDetail,
});

type ReviewChoice = "EMPLOYEE_SAFE" | "HR_ONLY";
type DetailTab = "review" | "metadata" | "relations";

function MarkedText({
  text,
  spans,
}: {
  text: string;
  spans: Array<{ start: number; end: number; reason: string }>;
}) {
  const segments = useMemo(() => {
    const valid = spans
      .filter((span) => span.start >= 0 && span.end > span.start && span.end <= text.length)
      .sort((a, b) => a.start - b.start);
    const result: Array<{ key: string; text: string; sensitive: boolean; reason?: string }> = [];
    let cursor = 0;
    for (const span of valid) {
      if (span.start > cursor) {
        result.push({
          key: `${cursor}:${span.start}`,
          text: text.slice(cursor, span.start),
          sensitive: false,
        });
      }
      result.push({
        key: `${span.start}:${span.end}`,
        text: text.slice(span.start, span.end),
        sensitive: true,
        reason: span.reason,
      });
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < text.length) {
      result.push({
        key: `${cursor}:${text.length}`,
        text: text.slice(cursor),
        sensitive: false,
      });
    }
    return result;
  }, [text, spans]);
  return (
    <p className="chunk-text">
      {segments.map((segment) =>
        segment.sensitive ? (
          <mark key={segment.key} title={segment.reason}>
            {segment.text}
          </mark>
        ) : (
          <span key={segment.key}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function DocumentDetail() {
  const { version, versions } = Route.useLoaderData();
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState("REPLACES");
  const [activeTab, setActiveTab] = useState<DetailTab>("review");
  const unresolved = version.chunks?.filter((chunk) => chunk.visibility === "NEEDS_REVIEW") ?? [];
  const decisionCount = Object.keys(choices).length;

  async function saveReview() {
    const decisions = Object.entries(choices).map(([chunkId, visibility]) => ({
      chunkId,
      visibility,
      reason: notes[chunkId] || "Diverifikasi oleh HR melalui review dokumen.",
    }));
    if (!decisions.length) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/iom/${version.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decisions }),
      });
      await router.invalidate();
      setChoices({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Keputusan review gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  function confirmAiDecisions() {
    setChoices(
      Object.fromEntries(
        (version.chunks ?? [])
          .filter((chunk) => chunk.visibility === "EMPLOYEE_SAFE" || chunk.visibility === "HR_ONLY")
          .map((chunk) => [chunk.id, chunk.visibility as ReviewChoice]),
      ),
    );
  }

  async function publish() {
    setBusy(true);
    try {
      await apiFetch(`/iom/${version.id}/publish`, { method: "POST" });
      setPublishOpen(false);
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const previousVersionId = String(form.get("previousVersionId") ?? "");
    setBusy(true);
    try {
      await apiFetch(`/iom/${version.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          iomNumber: form.get("iomNumber"),
          title: form.get("title"),
          effectiveFrom: form.get("effectiveFrom"),
          effectiveUntil: form.get("effectiveUntil") || null,
          ...(previousVersionId ? { previousVersionId } : {}),
        }),
      });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function saveRelation() {
    if (!relationTarget) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/iom/${version.id}/relations`, {
        method: "POST",
        body: JSON.stringify({ targetVersionId: relationTarget, type: relationType }),
      });
      setRelationTarget("");
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relasi IOM gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  const isPublished = ["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(version.status);

  return (
    <div className="page-stack document-detail">
      <PageHeader
        eyebrow={`${version.iomNumber} / REVISION ${version.revision}`}
        title="Detail dokumen"
        description="Review dan publikasi"
        actions={
          <div className="header-action-group">
            <StatusStamp status={version.status} />
            {version.status === "READY_TO_PUBLISH" ? (
              <Button disabled={busy} onClick={() => setPublishOpen(true)}>
                <Check /> Publish
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="version-strip">
        <span title={version.title}>
          <FilePdf /> {version.title}
        </span>
        <span>
          <Calendar /> Efektif{" "}
          {new Date(version.effectiveFrom).toLocaleDateString("id-ID", { dateStyle: "long" })}
        </span>
        <span>
          <GitBranch /> Revision {version.revision}
        </span>
        <span>
          <EyeSlash /> {unresolved.length} belum diputuskan
        </span>
      </div>
      <nav className="detail-tabs" aria-label="Bagian dokumen">
        <button
          type="button"
          data-active={activeTab === "review"}
          onClick={() => setActiveTab("review")}
        >
          Review <strong>{version.chunks?.length ?? 0}</strong>
        </button>
        {!isPublished ? (
          <button
            type="button"
            data-active={activeTab === "metadata"}
            onClick={() => setActiveTab("metadata")}
          >
            Metadata
          </button>
        ) : null}
        <button
          type="button"
          data-active={activeTab === "relations"}
          onClick={() => setActiveTab("relations")}
        >
          Jejak aturan
        </button>
      </nav>
      {error ? (
        <div className="form-alert" role="alert">
          <Warning /> {error}
        </div>
      ) : null}
      <div className="detail-main" role="tabpanel">
        {activeTab === "review" ? (
          <div className="review-split">
            <div className="document-preview">
              {version.uploadedFile?.mimeType === "application/pdf" ? (
                <iframe
                  title={`Preview ${version.title}`}
                  src={apiUrl(`/iom/${version.id}/file`)}
                />
              ) : (
                <div className="preview-placeholder">
                  <FilePdf size={44} />
                  <strong>Preview teks tersedia di panel review</strong>
                  <span>Format asli bukan PDF atau preview browser tidak tersedia.</span>
                </div>
              )}
            </div>
            <div className="review-panel">
              <div className="review-panel__head">
                <span>AI + HR REVIEW</span>
                <strong>{version.chunks?.length ?? 0} chunks</strong>
              </div>
              {version.status === "IN_REVIEW" && unresolved.length === 0 ? (
                <div className="ai-rationale">
                  <strong>Persetujuan HR diperlukan</strong>
                  <p>
                    AI telah memberi klasifikasi pada semua chunk. Konfirmasikan hasilnya sebelum
                    IOM dapat dipublish.
                  </p>
                  <Button disabled={busy} onClick={confirmAiDecisions}>
                    Konfirmasi semua keputusan AI
                  </Button>
                </div>
              ) : null}
              {version.chunks?.map((chunk) => {
                const decision = chunk.decisions[0];
                const selected =
                  choices[chunk.id] ??
                  (chunk.visibility === "NEEDS_REVIEW"
                    ? undefined
                    : (chunk.visibility as ReviewChoice));
                return (
                  <article
                    key={chunk.id}
                    className="chunk-review"
                    data-state={chunk.visibility.toLowerCase()}
                  >
                    <header>
                      <span>
                        CHUNK {String(chunk.ordinal + 1).padStart(2, "0")} / PAGE{" "}
                        {chunk.pageStart ?? "—"}
                      </span>
                      <StatusStamp status={chunk.visibility} />
                    </header>
                    <MarkedText text={chunk.text} spans={decision?.sensitiveSpans ?? []} />
                    <div className="ai-rationale">
                      <strong>Alasan AI</strong>
                      <p>{decision?.rationale ?? "Klasifikasi belum tersedia."}</p>
                      <span>
                        Confidence {Math.round((chunk.classificationConfidence ?? 0) * 100)}%
                      </span>
                    </div>
                    {chunk.visibility === "NEEDS_REVIEW" ? (
                      <div className="decision-controls">
                        <div>
                          <button
                            type="button"
                            data-selected={selected === "EMPLOYEE_SAFE"}
                            onClick={() =>
                              setChoices((current) => ({
                                ...current,
                                [chunk.id]: "EMPLOYEE_SAFE",
                              }))
                            }
                          >
                            Employee safe
                          </button>
                          <button
                            type="button"
                            data-selected={selected === "HR_ONLY"}
                            onClick={() =>
                              setChoices((current) => ({ ...current, [chunk.id]: "HR_ONLY" }))
                            }
                          >
                            HR only
                          </button>
                        </div>
                        <textarea
                          aria-label={`Alasan chunk ${chunk.ordinal + 1}`}
                          placeholder="Alasan keputusan HR"
                          value={notes[chunk.id] ?? ""}
                          onChange={(event) =>
                            setNotes((current) => ({
                              ...current,
                              [chunk.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
        {activeTab === "metadata" && !isPublished ? (
          <form className="metadata-editor" onSubmit={saveMetadata}>
            <Field label="Nomor IOM">
              <Input name="iomNumber" defaultValue={version.iomNumber} required />
            </Field>
            <Field label="Judul">
              <Input name="title" defaultValue={version.title} required />
            </Field>
            <Field label="Berlaku sejak">
              <Input
                name="effectiveFrom"
                type="date"
                defaultValue={version.effectiveFrom.slice(0, 10)}
                required
              />
            </Field>
            <Field label="Berlaku sampai" hint="Kosongkan jika belum ada tanggal akhir.">
              <Input
                name="effectiveUntil"
                type="date"
                defaultValue={version.effectiveUntil?.slice(0, 10) ?? ""}
              />
            </Field>
            <Field
              label="Versi sebelumnya"
              hint="Opsional. Pilih jika file ini adalah revisi dari identitas IOM yang sama."
            >
              <Select name="previousVersionId" defaultValue="">
                <SelectOption value="">IOM independen / belum ditentukan</SelectOption>
                {versions
                  .filter((candidate) => candidate.id !== version.id)
                  .map((candidate) => (
                    <SelectOption key={candidate.id} value={candidate.id}>
                      {candidate.iomNumber} · rev {candidate.revision} · {candidate.title}
                    </SelectOption>
                  ))}
              </Select>
            </Field>
            <Button disabled={busy} type="submit">
              Simpan metadata
            </Button>
          </form>
        ) : null}
        {activeTab === "relations" ? (
          <Panel className="version-timeline">
            <span className="section-index">VERSION RELATIONSHIPS</span>
            <h2>Jejak aturan</h2>
            <div>
              {version.incomingRelations?.map((relation) => (
                <span key={relation.id}>
                  <StatusStamp status={relation.type} />
                  <strong>{relation.sourceVersion.iomNumber}</strong> menuju versi ini
                </span>
              ))}
              <span className="timeline-current">
                <StatusStamp status="CURRENT" />
                <strong>{version.iomNumber}</strong> revision {version.revision}
              </span>
              {version.outgoingRelations?.map((relation) => (
                <span key={relation.id}>
                  <StatusStamp status={relation.type} />
                  <strong>{relation.targetVersion.iomNumber}</strong> terdampak versi ini
                </span>
              ))}
            </div>
            {!version.outgoingRelations?.length ? (
              <div className="inline-control">
                <Select
                  aria-label="IOM terdampak"
                  value={relationTarget}
                  onChange={(event) => setRelationTarget(event.target.value)}
                >
                  <SelectOption value="">Pilih IOM terdampak</SelectOption>
                  {versions
                    .filter((candidate) => candidate.id !== version.id)
                    .map((candidate) => (
                      <SelectOption key={candidate.id} value={candidate.id}>
                        {candidate.iomNumber} — {candidate.title}
                      </SelectOption>
                    ))}
                </Select>
                <Select
                  aria-label="Jenis relasi"
                  value={relationType}
                  onChange={(event) => setRelationType(event.target.value)}
                >
                  <SelectOption value="REPLACES">Menggantikan</SelectOption>
                  <SelectOption value="COMPLEMENTS">Melengkapi</SelectOption>
                  <SelectOption value="PARTIALLY_OVERRIDES">Mengubah sebagian</SelectOption>
                  <SelectOption value="RELATED">Terkait</SelectOption>
                </Select>
                <Button disabled={busy || !relationTarget} type="button" onClick={saveRelation}>
                  Konfirmasi relasi
                </Button>
              </div>
            ) : null}
          </Panel>
        ) : null}
      </div>
      {decisionCount ? (
        <div className="sticky-review-bar">
          <span>
            <Warning /> {decisionCount} perubahan belum disimpan
          </span>
          <Button disabled={busy} onClick={saveReview}>
            Simpan keputusan
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={publishOpen}
        title="Publish IOM ini?"
        description="Bagian employee-safe akan masuk ke retrieval karyawan. Bagian HR-only tetap hanya tersedia bagi HR."
        confirmLabel="Ya, publish"
        busy={busy}
        onCancel={() => setPublishOpen(false)}
        onConfirm={publish}
      />
    </div>
  );
}
