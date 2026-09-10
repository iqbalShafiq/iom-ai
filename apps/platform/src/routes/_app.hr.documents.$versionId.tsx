import { Button, PageHeader, Panel, StatusStamp } from "@iom/ui";
import { Calendar, Check, EyeSlash, FilePdf, GitBranch, Warning } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents/$versionId")({
  loader: ({ params }) => apiFetch<{ version: IomVersionRow }>(`/iom/${params.versionId}`),
  component: DocumentDetail,
});

type ReviewChoice = "EMPLOYEE_SAFE" | "HR_ONLY";

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
  const { version } = Route.useLoaderData();
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const unresolved = version.chunks?.filter((chunk) => chunk.visibility === "NEEDS_REVIEW") ?? [];
  async function saveReview() {
    const decisions = Object.entries(choices).map(([chunkId, visibility]) => ({
      chunkId,
      visibility,
      reason: notes[chunkId] || "Diverifikasi oleh HR melalui review dokumen.",
    }));
    if (!decisions.length) return;
    setBusy(true);
    try {
      await apiFetch(`/iom/${version.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decisions }),
      });
      await router.invalidate();
      setChoices({});
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (
      !window.confirm(
        "Publish akan membuat bagian employee-safe tersedia untuk retrieval. Lanjutkan?",
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/iom/${version.id}/publish`, { method: "POST" });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack document-detail">
      <PageHeader
        eyebrow={`${version.iomNumber} / REVISION ${version.revision}`}
        title={version.title}
        description="Review evidence, tetapkan visibility, lalu publish saat tidak ada keputusan tersisa."
        actions={
          <div className="header-action-group">
            <StatusStamp status={version.status} />
            {version.status === "READY_TO_PUBLISH" ? (
              <Button disabled={busy} onClick={publish}>
                <Check /> Publish
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="version-strip">
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
      <div className="review-split">
        <div className="document-preview">
          {version.uploadedFile?.mimeType === "application/pdf" ? (
            <iframe title={`Preview ${version.title}`} src={apiUrl(`/iom/${version.id}/file`)} />
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
                  <span>Confidence {Math.round((chunk.classificationConfidence ?? 0) * 100)}%</span>
                </div>
                {chunk.visibility === "NEEDS_REVIEW" ? (
                  <div className="decision-controls">
                    <div>
                      <button
                        type="button"
                        data-selected={selected === "EMPLOYEE_SAFE"}
                        onClick={() =>
                          setChoices((current) => ({ ...current, [chunk.id]: "EMPLOYEE_SAFE" }))
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
                        setNotes((current) => ({ ...current, [chunk.id]: event.target.value }))
                      }
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
      {Object.keys(choices).length ? (
        <div className="sticky-review-bar">
          <span>
            <Warning /> {Object.keys(choices).length} perubahan belum disimpan
          </span>
          <Button disabled={busy} onClick={saveReview}>
            Simpan keputusan
          </Button>
        </div>
      ) : null}
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
      </Panel>
    </div>
  );
}
