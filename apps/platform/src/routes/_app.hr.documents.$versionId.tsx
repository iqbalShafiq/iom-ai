import {
  Button,
  ConfirmDialog,
  DatePicker,
  Field,
  FullscreenDialog,
  HoverPopover,
  HoverStat,
  IconButton,
  Input,
  PageHeader,
  Panel,
  Select,
  SelectOption,
  StatusIcon,
  StatusStamp,
  Tabs,
} from "@iom/ui";
import {
  ArrowsOut,
  Calendar,
  Check,
  EyeSlash,
  FilePdf,
  GitBranch,
  Warning,
} from "@phosphor-icons/react";
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
type IomChunk = NonNullable<IomVersionRow["chunks"]>[number];

function splitFileName(fileName: string) {
  const extensionStart = fileName.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === fileName.length - 1) {
    return { stem: fileName, extension: "" };
  }
  return {
    stem: fileName.slice(0, extensionStart),
    extension: fileName.slice(extensionStart),
  };
}

function FileNameTitle({ fileName }: { fileName: string }) {
  const { stem, extension } = splitFileName(fileName);
  return (
    <span className="document-detail__file-name" title={fileName}>
      <span>{stem}</span>
      {extension ? <small>{extension}</small> : null}
    </span>
  );
}

function formatDocumentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tanggal tidak tersedia";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatEffectiveRange(version: Pick<IomVersionRow, "effectiveFrom" | "effectiveUntil">) {
  const start = formatDocumentDate(version.effectiveFrom);
  return version.effectiveUntil
    ? `${start} — ${formatDocumentDate(version.effectiveUntil)}`
    : `${start} — sekarang`;
}

function DetailSectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="detail-section-heading">
      <span className="section-index">{eyebrow}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

type TimelineDirection = "incoming" | "current" | "outgoing";

function VersionTimelineItem({
  direction,
  relationType,
  version,
}: {
  direction: TimelineDirection;
  relationType: string;
  version: Pick<IomVersionRow, "iomNumber" | "revision" | "effectiveFrom" | "effectiveUntil">;
}) {
  const directionLabel =
    direction === "incoming"
      ? "Relasi masuk"
      : direction === "outgoing"
        ? "Relasi keluar"
        : "Versi saat ini";
  const description =
    direction === "incoming"
      ? "Versi terkait mengarah ke dokumen yang sedang dibuka."
      : direction === "outgoing"
        ? "Dokumen ini mengarah ke versi terkait yang terdampak."
        : "Versi dokumen yang sedang dibuka.";

  return (
    <li className="version-timeline__item" data-direction={direction}>
      <span className="version-timeline__marker" aria-hidden="true">
        <StatusIcon status={relationType} size={18} />
      </span>
      <div className="version-timeline__entry">
        <header>
          <StatusStamp status={relationType} />
          <span className="version-timeline__direction">{directionLabel}</span>
        </header>
        <div className="version-timeline__identity">
          <strong>{version.iomNumber}</strong>
          <span>Revision {version.revision}</span>
        </div>
        <span className="version-timeline__date">Efektif {formatEffectiveRange(version)}</span>
        <p>{description}</p>
      </div>
    </li>
  );
}

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

type ReviewWorkspaceProps = {
  version: IomVersionRow;
  unresolved: IomChunk[];
  hasUnreviewedDecisions: boolean;
  choices: Record<string, ReviewChoice>;
  notes: Record<string, string>;
  busy: boolean;
  onConfirmAiDecisions(): void;
  onSelectChoice(chunkId: string, choice: ReviewChoice): void;
  onChangeNote(chunkId: string, note: string): void;
};

function ReviewWorkspace({
  version,
  unresolved,
  hasUnreviewedDecisions,
  choices,
  notes,
  busy,
  onConfirmAiDecisions,
  onSelectChoice,
  onChangeNote,
}: ReviewWorkspaceProps) {
  return (
    <div className="review-split">
      <section className="document-preview" aria-label="Preview dokumen">
        {version.uploadedFile?.mimeType === "application/pdf" ? (
          <iframe title={`Preview ${version.title}`} src={apiUrl(`/iom/${version.id}/file`)} />
        ) : (
          <div className="preview-placeholder">
            <FilePdf size={44} />
            <strong>Preview teks tersedia di panel review</strong>
            <span>Format asli bukan PDF atau preview browser tidak tersedia.</span>
          </div>
        )}
      </section>
      <section className="review-panel" aria-label="AI dan HR review">
        <header className="review-panel__head">
          <span>AI + HR REVIEW</span>
          <div className="review-panel__head-actions">
            <strong>{version.chunks?.length ?? 0} chunks</strong>
          </div>
        </header>
        <div className="review-panel__body">
          {version.status === "IN_REVIEW" && unresolved.length === 0 && hasUnreviewedDecisions ? (
            <div className="ai-rationale">
              <strong>Persetujuan HR diperlukan</strong>
              <p>
                AI telah memberi klasifikasi pada semua chunk. Konfirmasikan hasilnya sebelum IOM
                dapat dipublish.
              </p>
              <Button disabled={busy} onClick={onConfirmAiDecisions}>
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
                  <span>Confidence {Math.round((chunk.classificationConfidence ?? 0) * 100)}%</span>
                </div>
                {chunk.visibility === "NEEDS_REVIEW" ? (
                  <div className="decision-controls">
                    <div>
                      <button
                        type="button"
                        data-selected={selected === "EMPLOYEE_SAFE"}
                        onClick={() => onSelectChoice(chunk.id, "EMPLOYEE_SAFE")}
                      >
                        Employee safe
                      </button>
                      <button
                        type="button"
                        data-selected={selected === "HR_ONLY"}
                        onClick={() => onSelectChoice(chunk.id, "HR_ONLY")}
                      >
                        HR only
                      </button>
                    </div>
                    <textarea
                      aria-label={`Alasan chunk ${chunk.ordinal + 1}`}
                      placeholder="Alasan keputusan HR"
                      value={notes[chunk.id] ?? ""}
                      onChange={(event) => onChangeNote(chunk.id, event.target.value)}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
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
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState("REPLACES");
  const [activeTab, setActiveTab] = useState<DetailTab>("review");
  const unresolved = version.chunks?.filter((chunk) => chunk.visibility === "NEEDS_REVIEW") ?? [];
  const hasUnreviewedDecisions =
    version.chunks?.some((chunk) => !chunk.decisions[0]?.reviewedAt) ?? false;
  const decisionCount = Object.keys(choices).length;
  const fileName = version.uploadedFile?.originalName || version.title;
  const statusLabel = version.status.replaceAll("_", " ");
  const effectiveDate = formatDocumentDate(version.effectiveFrom);

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
        title={<FileNameTitle fileName={fileName} />}
        titleAdornment={
          <HoverPopover
            className="document-detail__status"
            trigger={
              <IconButton
                className="document-detail__status-trigger"
                variant="ghost"
                size="sm"
                type="button"
                aria-label={`Status dokumen: ${statusLabel}`}
              >
                <StatusIcon status={version.status} size={22} />
              </IconButton>
            }
          >
            <strong>Status dokumen</strong>
            <span>{statusLabel}</span>
          </HoverPopover>
        }
        actions={
          <div className="document-detail__header-actions">
            <div className="document-detail__stats">
              <HoverStat
                icon={<Calendar weight="bold" />}
                label="Tanggal efektif"
                value={effectiveDate}
              />
              <HoverStat
                icon={<GitBranch weight="bold" />}
                label="Revision"
                value={`R${version.revision}`}
              />
              <HoverStat
                icon={<EyeSlash weight="bold" />}
                label="Belum diputuskan"
                value={unresolved.length}
              />
            </div>
            {version.status === "READY_TO_PUBLISH" ? (
              <Button disabled={busy} onClick={() => setPublishOpen(true)}>
                <Check /> Publish
              </Button>
            ) : null}
          </div>
        }
      />
      <Tabs
        className="detail-tabs"
        size="compact"
        value={activeTab}
        onChange={(value) => setActiveTab(value as DetailTab)}
        aria-label="Bagian dokumen"
        trailingAction={
          <IconButton
            className="detail-tabs__fullscreen"
            variant="primary"
            size="lg"
            type="button"
            aria-label="Buka preview dan review layar penuh"
            title="Buka preview dan review layar penuh"
            onClick={() => setFullscreenOpen(true)}
          >
            <ArrowsOut weight="bold" />
          </IconButton>
        }
        items={[
          {
            value: "review",
            label: "Review",
            count: version.chunks?.length ?? 0,
          },
          ...(!isPublished ? [{ value: "metadata", label: "Metadata" }] : []),
          { value: "relations", label: "Jejak aturan" },
        ]}
      />
      <div className="detail-main" role="tabpanel">
        {error ? (
          <div className="form-alert" role="alert">
            <Warning /> {error}
          </div>
        ) : null}
        {activeTab === "review" ? (
          <ReviewWorkspace
            version={version}
            unresolved={unresolved}
            hasUnreviewedDecisions={hasUnreviewedDecisions}
            choices={choices}
            notes={notes}
            busy={busy}
            onConfirmAiDecisions={confirmAiDecisions}
            onSelectChoice={(chunkId, choice) =>
              setChoices((current) => ({ ...current, [chunkId]: choice }))
            }
            onChangeNote={(chunkId, note) =>
              setNotes((current) => ({ ...current, [chunkId]: note }))
            }
          />
        ) : null}
        {activeTab === "metadata" && !isPublished ? (
          <form className="metadata-editor" onSubmit={saveMetadata}>
            <DetailSectionHeading
              eyebrow="DOCUMENT METADATA"
              title="Metadata dokumen"
              description="Atur identitas dan periode berlaku sebelum dokumen dipublikasikan."
            />
            <div className="metadata-editor__fields">
              <Field label="Nomor IOM">
                <Input name="iomNumber" defaultValue={version.iomNumber} required />
              </Field>
              <Field label="Judul">
                <Input name="title" defaultValue={version.title} required />
              </Field>
              <Field label="Berlaku sejak">
                <DatePicker
                  name="effectiveFrom"
                  defaultValue={version.effectiveFrom.slice(0, 10)}
                  required
                />
              </Field>
              <Field label="Berlaku sampai" hint="Kosongkan jika belum ada tanggal akhir.">
                <DatePicker
                  name="effectiveUntil"
                  defaultValue={version.effectiveUntil?.slice(0, 10) ?? ""}
                  clearable
                />
              </Field>
              <div className="metadata-editor__field--full">
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
              </div>
            </div>
            <div className="metadata-editor__actions">
              <span>Perubahan metadata hanya berlaku untuk versi ini.</span>
              <Button disabled={busy} type="submit">
                Simpan metadata
              </Button>
            </div>
          </form>
        ) : null}
        {activeTab === "relations" ? (
          <Panel className="version-timeline">
            <DetailSectionHeading
              eyebrow="VERSION RELATIONSHIPS"
              title="Jejak aturan"
              description="Lihat hubungan versi ini dengan dokumen IOM lain yang telah dikonfirmasi HR."
            />
            <ol className="version-timeline__list">
              {version.incomingRelations?.map((relation) => (
                <VersionTimelineItem
                  key={relation.id}
                  direction="incoming"
                  relationType={relation.type}
                  version={relation.sourceVersion}
                />
              ))}
              <VersionTimelineItem direction="current" relationType="CURRENT" version={version} />
              {version.outgoingRelations?.map((relation) => (
                <VersionTimelineItem
                  key={relation.id}
                  direction="outgoing"
                  relationType={relation.type}
                  version={relation.targetVersion}
                />
              ))}
            </ol>
            {!version.outgoingRelations?.length ? (
              <section
                className="version-timeline__composer"
                aria-labelledby="relation-composer-title"
              >
                <div className="version-timeline__composer-heading">
                  <span className="section-index">ADD RELATION</span>
                  <h3 id="relation-composer-title">Hubungkan ke IOM lain</h3>
                  <p>Tambahkan relasi setelah memastikan dokumen tujuan dan jenis perubahannya.</p>
                </div>
                <div className="version-timeline__composer-grid">
                  <Field label="IOM terdampak">
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
                  </Field>
                  <Field label="Jenis relasi">
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
                  </Field>
                  <div className="version-timeline__composer-action">
                    <Button disabled={busy || !relationTarget} type="button" onClick={saveRelation}>
                      Konfirmasi relasi
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
          </Panel>
        ) : null}
      </div>
      <FullscreenDialog
        open={fullscreenOpen}
        title="Preview dan review dokumen"
        onClose={() => setFullscreenOpen(false)}
      >
        <ReviewWorkspace
          version={version}
          unresolved={unresolved}
          hasUnreviewedDecisions={hasUnreviewedDecisions}
          choices={choices}
          notes={notes}
          busy={busy}
          onConfirmAiDecisions={confirmAiDecisions}
          onSelectChoice={(chunkId, choice) =>
            setChoices((current) => ({ ...current, [chunkId]: choice }))
          }
          onChangeNote={(chunkId, note) => setNotes((current) => ({ ...current, [chunkId]: note }))}
        />
      </FullscreenDialog>
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
