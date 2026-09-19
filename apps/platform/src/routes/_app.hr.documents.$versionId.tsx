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
  ClockCounterClockwise,
  EyeSlash,
  FilePdf,
  GitBranch,
  LockKey,
  Selection,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, apiUrl } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents/$versionId")({
  validateSearch: (search) => {
    const page = Number(search.page);
    return Number.isInteger(page) && page > 0 ? { page } : {};
  },
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
type MarkerSelection = {
  chunkId: string;
  start: number;
  end: number;
  text: string;
  anchor?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
};

function visibilityLabel(visibility: string) {
  if (visibility === "HR_ONLY") return "Akses Terbatas";
  if (visibility === "EMPLOYEE_SAFE") return "Akses Tertutup";
  return "Perlu keputusan HR";
}

function formatDecisionTimestamp(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

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

function PdfPreview({ versionId, title }: { versionId: string; title: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(apiUrl(`/iom/${versionId}/file`), { credentials: "include" });
        if (!response.ok) throw new Error("Preview gagal dimuat.");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setError("Preview PDF tidak dapat dimuat. Gunakan panel review di kanan.");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [versionId]);
  if (error) {
    return (
      <div className="preview-placeholder">
        <FilePdf size={44} />
        <strong>Preview gagal dimuat</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!src) {
    return (
      <div className="preview-placeholder" aria-busy="true">
        <strong>Memuat preview</strong>
        <span>Menyiapkan PDF untuk ditinjau.</span>
      </div>
    );
  }
  return <iframe title={`Preview ${title}`} src={src} />;
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
  chunkId,
  text,
  spans,
  onSelect,
}: {
  chunkId: string;
  text: string;
  spans: Array<{ start: number; end: number; reason: string }>;
  onSelect(selection: MarkerSelection): void;
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
  function captureSelection(event: SyntheticEvent<HTMLParagraphElement>) {
    const container = event.currentTarget;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const prefix = document.createRange();
    prefix.selectNodeContents(container);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const selectedText = range.toString();
    const end = start + selectedText.length;
    if (!selectedText.trim() || end <= start) return;
    const bounds = range.getBoundingClientRect();
    onSelect({
      chunkId,
      start,
      end,
      text: selectedText,
      anchor: {
        top: bounds.top,
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
      },
    });
  }

  return (
    <div className="chunk-copy">
      <p className="chunk-text" onMouseUp={captureSelection} onKeyUp={captureSelection}>
        {segments.map((segment) =>
          segment.sensitive ? (
            <mark key={segment.key}>{segment.text}</mark>
          ) : (
            <span key={segment.key}>{segment.text}</span>
          ),
        )}
      </p>
      {spans.length > 0 ? (
        <ul className="sensitive-evidence" aria-label="Alasan bagian sensitif">
          {spans.map((span) => (
            <li key={`${span.start}:${span.end}:${span.reason}`}>
              <LockKey weight="bold" />
              <span>{span.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ReviewWorkspaceProps = {
  version: IomVersionRow;
  focusPage?: number;
  unresolved: IomChunk[];
  hasUnreviewedDecisions: boolean;
  choices: Record<string, ReviewChoice>;
  notes: Record<string, string>;
  busy: boolean;
  onConfirmAiDecisions(): void;
  onSelectChoice(chunkId: string, choice: ReviewChoice): void;
  onChangeNote(chunkId: string, note: string): void;
  onCreateMarker(selection: MarkerSelection, category: string, reason: string): Promise<boolean>;
  onRevokeMarker(annotationId: string, reason: string): Promise<boolean>;
};

function markerAppliesToChunk(
  marker: NonNullable<IomVersionRow["annotations"]>[number],
  chunk: IomChunk,
) {
  if (marker.pageStart == null && marker.pageEnd == null && !marker.section) return true;
  if (marker.pageStart != null && chunk.pageStart !== marker.pageStart) return false;
  if (marker.section && marker.section !== chunk.section) return false;
  return true;
}

function SelectionPopover({
  selection,
  category,
  reason,
  busy,
  onChangeCategory,
  onChangeReason,
  onCancel,
  onSubmit,
}: {
  selection: MarkerSelection;
  category: string;
  reason: string;
  busy: boolean;
  onChangeCategory(value: string): void;
  onChangeReason(value: string): void;
  onCancel(): void;
  onSubmit(): void;
}) {
  const anchor = selection.anchor;
  const compactWidth = 320;
  const viewportGap = 12;
  const popoverGap = 8;
  const estimatedHeight = 300;
  const style =
    anchor && typeof window !== "undefined"
      ? {
          top:
            anchor.bottom + estimatedHeight + viewportGap <= window.innerHeight
              ? anchor.bottom + popoverGap
              : Math.max(viewportGap, anchor.top - estimatedHeight - popoverGap),
          left: Math.min(
            Math.max(viewportGap, anchor.left),
            Math.max(viewportGap, window.innerWidth - compactWidth - viewportGap),
          ),
          width: `min(${compactWidth}px, calc(100vw - ${viewportGap * 2}px))`,
        }
      : undefined;
  const content = (
    <div
      className={`selection-popover${anchor ? " selection-popover--floating" : ""}`}
      role="dialog"
      aria-label="Tambah penanda rahasia"
      style={style}
    >
      <div className="selection-popover__preview">
        <Selection weight="bold" />
        <span>“{selection.text.trim().slice(0, 180)}”</span>
      </div>
      <p>Bagian terpilih akan membuat chunk ini hanya dapat diakses HR.</p>
      <Field label="Kategori">
        <Input
          value={category}
          onChange={(event) => onChangeCategory(event.target.value)}
          placeholder="Contoh: Data personal"
        />
      </Field>
      <Field label="Alasan HR">
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => onChangeReason(event.target.value)}
          placeholder="Mengapa bagian ini dibatasi?"
        />
      </Field>
      <div className="selection-popover__actions">
        <Button variant="neutral" type="button" onClick={onCancel}>
          Batal
        </Button>
        <Button
          type="button"
          disabled={busy || category.trim().length < 2 || reason.trim().length < 3}
          onClick={onSubmit}
        >
          <LockKey weight="bold" /> Tandai rahasia
        </Button>
      </div>
    </div>
  );
  if (!anchor || typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

function ReviewWorkspace({
  version,
  focusPage,
  unresolved,
  hasUnreviewedDecisions,
  choices,
  notes,
  busy,
  onConfirmAiDecisions,
  onSelectChoice,
  onChangeNote,
  onCreateMarker,
  onRevokeMarker,
}: ReviewWorkspaceProps) {
  const [selection, setSelection] = useState<MarkerSelection | null>(null);
  const [markerCategory, setMarkerCategory] = useState("");
  const [markerReason, setMarkerReason] = useState("");
  const [revokingMarkerId, setRevokingMarkerId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const focusedChunk = focusPage
    ? version.chunks?.find((chunk) => chunk.pageStart === focusPage)
    : undefined;
  useEffect(() => {
    if (!focusedChunk || !focusPage) return;
    const element = document.querySelector<HTMLElement>(
      `[data-document-page="${focusedChunk.pageStart}"]`,
    );
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    element?.scrollIntoView({ block: "start", behavior });
    element?.focus({ preventScroll: true });
  }, [focusedChunk, focusPage]);
  const reviewMutable = version.status === "IN_REVIEW" || version.status === "READY_TO_PUBLISH";
  const markerMutable = [
    "IN_REVIEW",
    "READY_TO_PUBLISH",
    "PUBLISHED",
    "SUPERSEDED",
    "ARCHIVED",
  ].includes(version.status);

  async function createMarker() {
    if (!selection || markerCategory.trim().length < 2 || markerReason.trim().length < 3) return;
    if (await onCreateMarker(selection, markerCategory.trim(), markerReason.trim())) {
      setSelection(null);
      setMarkerCategory("");
      setMarkerReason("");
      window.getSelection()?.removeAllRanges();
    }
  }

  async function revokeMarker(annotationId: string) {
    if (revokeReason.trim().length < 3) return;
    if (await onRevokeMarker(annotationId, revokeReason.trim())) {
      setRevokingMarkerId(null);
      setRevokeReason("");
    }
  }

  return (
    <div className="review-split">
      <section className="document-preview" aria-label="Preview dokumen">
        {version.uploadedFile?.mimeType === "application/pdf" ? (
          <PdfPreview versionId={version.id} title={version.title} />
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
          <span>REVIEW KERAHASIAAN</span>
          <div className="review-panel__head-actions">
            <strong>{version.chunks?.length ?? 0} chunks</strong>
          </div>
        </header>
        <div className="review-panel__body">
          <section className="confidentiality-summary" aria-label="Ringkasan akses dokumen">
            <span>
              <strong>
                {version.chunks?.filter((chunk) => chunk.visibility === "EMPLOYEE_SAFE").length ??
                  0}
              </strong>
              Akses Terbuka
            </span>
            <span>
              <strong>
                {version.chunks?.filter((chunk) => chunk.visibility === "HR_ONLY").length ?? 0}
              </strong>
              Hanya HR
            </span>
            <span>
              <strong>{unresolved.length}</strong>
              Perlu keputusan
            </span>
            <span>
              Preferensi HR{" "}
              <strong>
                {version.confidentialityPolicy
                  ? `v${version.confidentialityPolicy.version}`
                  : "belum tersedia"}
              </strong>
            </span>
          </section>
          {focusPage && !focusedChunk ? (
            <div className="form-alert" role="status">
              Halaman sumber {focusPage} tidak tersedia pada versi dokumen ini. Menampilkan review
              dokumen secara umum.
            </div>
          ) : null}
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
            const decision =
              chunk.decisions.find((item) => item.isCurrentPolicy) ?? chunk.decisions[0];
            const selected =
              choices[chunk.id] ??
              (chunk.visibility === "NEEDS_REVIEW"
                ? undefined
                : (chunk.visibility as ReviewChoice));
            return (
              <article
                key={chunk.id}
                className="chunk-review"
                data-document-page={chunk.pageStart ?? undefined}
                tabIndex={-1}
                data-state={chunk.visibility.toLowerCase()}
              >
                <header>
                  <span>
                    CHUNK {String(chunk.ordinal + 1).padStart(2, "0")} / PAGE{" "}
                    {chunk.pageStart ?? "—"}
                  </span>
                  <StatusStamp
                    status={chunk.visibility}
                    label={visibilityLabel(chunk.visibility)}
                  />
                </header>
                <MarkedText
                  chunkId={chunk.id}
                  text={chunk.text}
                  spans={decision?.sensitiveSpans ?? []}
                  onSelect={setSelection}
                />
                {markerMutable && selection?.chunkId === chunk.id ? (
                  <SelectionPopover
                    selection={selection}
                    category={markerCategory}
                    reason={markerReason}
                    busy={busy}
                    onChangeCategory={setMarkerCategory}
                    onChangeReason={setMarkerReason}
                    onCancel={() => setSelection(null)}
                    onSubmit={() => void createMarker()}
                  />
                ) : null}
                <div className="ai-rationale">
                  <strong>
                    {decision?.modelId === "human-review"
                      ? "Keputusan HR saat ini"
                      : "Rekomendasi AI saat ini"}
                  </strong>
                  <p>{decision?.rationale ?? "Klasifikasi belum tersedia."}</p>
                  <div className="decision-provenance">
                    {decision?.modelId === "human-review" ? (
                      <span>
                        <ShieldCheck weight="bold" /> Diputuskan oleh{" "}
                        {decision.reviewedByName ?? "HR"}
                      </span>
                    ) : (
                      <span>
                        Keyakinan rekomendasi AI {Math.round((decision?.confidence ?? 0) * 100)}%
                      </span>
                    )}
                    {version.confidentialityPolicy ? (
                      <span>Preferensi HR v{version.confidentialityPolicy.version}</span>
                    ) : null}
                  </div>
                </div>
                {reviewMutable || markerMutable ? (
                  <div className="decision-controls">
                    {reviewMutable ? (
                      <>
                        <div>
                          <button
                            type="button"
                            data-selected={selected === "EMPLOYEE_SAFE"}
                            onClick={() => onSelectChoice(chunk.id, "EMPLOYEE_SAFE")}
                          >
                            Akses Terbuka
                          </button>
                          <button
                            type="button"
                            data-selected={selected === "HR_ONLY"}
                            onClick={() => onSelectChoice(chunk.id, "HR_ONLY")}
                          >
                            Hanya HR
                          </button>
                        </div>
                        <textarea
                          aria-label={`Alasan chunk ${chunk.ordinal + 1}`}
                          placeholder="Alasan keputusan HR"
                          value={notes[chunk.id] ?? ""}
                          onChange={(event) => onChangeNote(chunk.id, event.target.value)}
                        />
                      </>
                    ) : null}
                    <Button
                      variant="neutral"
                      type="button"
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setSelection({
                          chunkId: chunk.id,
                          start: 0,
                          end: chunk.text.length,
                          text: `Seluruh halaman ${chunk.pageStart ?? chunk.ordinal + 1}`,
                          anchor: {
                            top: bounds.top,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            right: bounds.right,
                          },
                        });
                      }}
                    >
                      <LockKey weight="bold" /> Tandai seluruh halaman
                    </Button>
                  </div>
                ) : null}
                {version.annotations
                  ?.filter(
                    (marker) =>
                      marker.kind === "CONFIDENTIAL" &&
                      !marker.revokedAt &&
                      markerAppliesToChunk(marker, chunk),
                  )
                  .map((marker) => (
                    <div className="manual-marker" key={marker.id}>
                      <div>
                        <LockKey weight="bold" />
                        <span>
                          <strong>Penanda manual oleh {marker.createdByName}</strong>
                          <small>{marker.note ?? "Tanpa alasan"}</small>
                        </span>
                      </div>
                      {markerMutable && revokingMarkerId !== marker.id ? (
                        <Button
                          variant="neutral"
                          type="button"
                          onClick={() => setRevokingMarkerId(marker.id)}
                        >
                          Cabut penanda
                        </Button>
                      ) : null}
                      {revokingMarkerId === marker.id ? (
                        <div className="manual-marker__revoke">
                          <Field label="Alasan pencabutan">
                            <textarea
                              rows={2}
                              value={revokeReason}
                              onChange={(event) => setRevokeReason(event.target.value)}
                            />
                          </Field>
                          <div>
                            <Button
                              variant="neutral"
                              type="button"
                              onClick={() => setRevokingMarkerId(null)}
                            >
                              Batal
                            </Button>
                            <Button
                              type="button"
                              disabled={busy || revokeReason.trim().length < 3}
                              onClick={() => void revokeMarker(marker.id)}
                            >
                              Cabut dan tinjau ulang
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                <details className="decision-history">
                  <summary>
                    <ClockCounterClockwise weight="bold" /> Riwayat keputusan (
                    {chunk.decisions.length})
                  </summary>
                  <ol>
                    {chunk.decisions.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>
                            {item.modelId === "human-review" ? "Keputusan HR" : "Rekomendasi AI"}
                          </strong>
                          <StatusStamp
                            status={item.visibility}
                            label={visibilityLabel(item.visibility)}
                          />
                        </div>
                        <p>{item.rationale}</p>
                        <span>
                          {item.modelId === "human-review"
                            ? (item.reviewedByName ?? "HR")
                            : `${Math.round(item.confidence * 100)}% keyakinan AI`}
                          {" · "}
                          {formatDecisionTimestamp(item.createdAt)} · Preferensi v
                          {item.policyVersion}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
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
  const { page: focusPage } = Route.useSearch();
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
    version.chunks?.some(
      (chunk) => !chunk.decisions.find((decision) => decision.isCurrentPolicy)?.reviewedAt,
    ) ?? false;
  const decisionCount = Object.keys(choices).length;
  const fileName = version.uploadedFile?.originalName || version.title;
  const statusLabel = version.status.replaceAll("_", " ");
  const effectiveDate = formatDocumentDate(version.effectiveFrom);

  async function saveReview() {
    const missingReason = Object.keys(choices).some(
      (chunkId) => (notes[chunkId]?.trim().length ?? 0) < 3,
    );
    if (missingReason) {
      setError("Tuliskan alasan HR minimal 3 karakter untuk setiap perubahan akses.");
      return;
    }
    const decisions = Object.entries(choices).map(([chunkId, visibility]) => ({
      chunkId,
      visibility,
      reason: notes[chunkId]?.trim() ?? "",
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
      setNotes({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Keputusan review gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  function confirmAiDecisions() {
    const confirmable = (version.chunks ?? []).filter(
      (chunk) => chunk.visibility === "EMPLOYEE_SAFE" || chunk.visibility === "HR_ONLY",
    );
    setChoices(
      Object.fromEntries(confirmable.map((chunk) => [chunk.id, chunk.visibility as ReviewChoice])),
    );
    setNotes((current) => ({
      ...current,
      ...Object.fromEntries(
        confirmable.map((chunk) => [chunk.id, "HR menyetujui rekomendasi AI setelah review."]),
      ),
    }));
  }

  async function createMarker(
    selection: MarkerSelection,
    category: string,
    reason: string,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/iom/${version.id}/confidentiality/markers`, {
        method: "POST",
        body: JSON.stringify({
          chunkId: selection.chunkId,
          start: selection.start,
          end: selection.end,
          category,
          reason,
        }),
      });
      await router.invalidate();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Penanda rahasia gagal disimpan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function revokeMarker(annotationId: string, reason: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/iom/${version.id}/confidentiality/markers/${annotationId}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await router.invalidate();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Penanda rahasia gagal dicabut.");
      return false;
    } finally {
      setBusy(false);
    }
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
            label: "Kerahasiaan",
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
            {...(focusPage !== undefined ? { focusPage } : {})}
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
            onCreateMarker={createMarker}
            onRevokeMarker={revokeMarker}
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
          onCreateMarker={createMarker}
          onRevokeMarker={revokeMarker}
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
