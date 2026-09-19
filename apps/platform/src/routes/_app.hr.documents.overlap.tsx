import {
  Button,
  ConfirmDialog,
  CountIndicator,
  EmptyState,
  PageHeader,
  StatusStamp,
  Tabs,
} from "@iom/ui";
import { ArrowsLeftRight, Check, Play, WarningCircle } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

interface OverlapMatchRow {
  id: string;
  recommendation: string;
  confidence: number;
  sharedTopics: string[];
  changedRules: Array<{
    subject: string;
    previousValue: string | null;
    proposedValue: string | null;
    effectiveFrom: string | null;
  }>;
  conflicts: string[];
  hasConflict: boolean;
  evidenceStatus: "CURRENT" | "STALE" | "MISSING";
  evidence: Array<{
    explanation: string;
    candidate: {
      versionId: string;
      iomNumber: string;
      title: string;
      page?: number;
      section?: string;
      excerpt: string;
    };
    existing: {
      versionId: string;
      iomNumber: string;
      title: string;
      page?: number;
      section?: string;
      excerpt: string;
    };
  }>;
  existingVersion: IomVersionRow;
  decision?: {
    status: "PENDING_REVIEW" | "FINAL";
    outcome?: string;
    rationale?: string;
    topicScope: string[];
    decidedByName: string;
    updatedAt: string;
  } | null;
}

interface OverlapRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  coverageComplete: boolean;
  safeErrorCode?: string;
  metrics: { analyzedCandidateCount: number; queryWindowCount: number };
  noMatchConfirmation: { confirmedAt: string; confirmedByName: string; note?: string } | null;
  candidateVersion: IomVersionRow;
  matches: OverlapMatchRow[];
}

interface DecisionPresentation {
  label: string;
  confirmLabel: string;
  description: string;
}

const DECISION_PRESENTATIONS: Record<string, DecisionPresentation> = {
  REPLACES: {
    label: "Menggantikan seluruh aturan lama",
    confirmLabel: "Simpan keputusan menggantikan",
    description: "Dokumen lama akan menjadi superseded saat draft dipublish.",
  },
  PARTIALLY_OVERRIDES: {
    label: "Mengubah sebagian aturan",
    confirmLabel: "Simpan partial override",
    description: "Dokumen lama tetap berlaku di luar topic scope yang dipilih.",
  },
  COMPLEMENTS: {
    label: "Melengkapi",
    confirmLabel: "Simpan sebagai pelengkap",
    description: "Kedua dokumen tetap berlaku dan saling melengkapi.",
  },
  NO_MATERIAL_OVERLAP: {
    label: "Tidak ada tumpang tindih",
    confirmLabel: "Tandai tidak tumpang tindih",
    description: "Dokumen tidak memiliki aturan yang saling tumpang tindih.",
  },
  MANUAL_REVIEW: {
    label: "Perlu diselesaikan HR",
    confirmLabel: "Tandai perlu review lanjutan",
    description: "Publish tetap diblokir sampai HR memilih outcome final.",
  },
};

const RUN_STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  QUEUED: "Menunggu",
  RUNNING: "Diproses",
};

type DecisionPayload =
  | { status: "PENDING_REVIEW"; rationale: string }
  | {
      status: "FINAL";
      outcome: "REPLACES" | "PARTIALLY_OVERRIDES" | "COMPLEMENTS" | "NO_MATERIAL_OVERLAP";
      rationale?: string;
      topicScope?: string[];
    };
type FinalOutcome = "REPLACES" | "PARTIALLY_OVERRIDES" | "COMPLEMENTS" | "NO_MATERIAL_OVERLAP";

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function decisionPresentation(decision: string) {
  return (
    DECISION_PRESENTATIONS[decision] ?? {
      label: humanize(decision),
      confirmLabel: "Catat keputusan",
      description: "Keputusan ini akan dicatat untuk dokumen yang dipilih.",
    }
  );
}

function runStatusLabel(status: string) {
  return RUN_STATUS_LABELS[status] ?? humanize(status);
}

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export const Route = createFileRoute("/_app/hr/documents/overlap")({
  loader: async () => {
    const [overlap, documents] = await Promise.all([
      apiFetch<{ runs: OverlapRun[] }>("/overlap/runs"),
      apiFetch<{ versions: IomVersionRow[] }>("/iom"),
    ]);
    return { overlap, documents };
  },
  component: OverlapPage,
});

function OverlapPage() {
  const { overlap, documents } = Route.useLoaderData();
  const router = useRouter();
  const latestCandidateIds = new Set<string>();
  const runs = overlap.runs.filter((run) => {
    if (latestCandidateIds.has(run.candidateVersion.id)) return false;
    latestCandidateIds.add(run.candidateVersion.id);
    return true;
  });
  const analysisCandidates = documents.versions.filter(
    (item) =>
      ["IN_REVIEW", "READY_TO_PUBLISH"].includes(item.status) &&
      item.metadataConfirmedAt &&
      !latestCandidateIds.has(item.id),
  );
  const [selectedRunId, setSelectedRunId] = useState(runs[0]?.id ?? "");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{
    matchId: string;
    payload: DecisionPayload;
  } | null>(null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const selectedMatch =
    selectedRun?.matches.find((match) => match.id === selectedMatchId) ??
    selectedRun?.matches.find((match) => match.decision?.status !== "FINAL") ??
    selectedRun?.matches[0];
  const pendingDecisionCount = runs.reduce(
    (total, run) =>
      total + run.matches.filter((match) => match.decision?.status !== "FINAL").length,
    0,
  );
  const activeRunCount = runs.filter(
    (run) => run.status === "QUEUED" || run.status === "RUNNING",
  ).length;

  useEffect(() => {
    if (!overlap.runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING")) return;
    const timer = window.setInterval(() => void router.invalidate(), 2_000);
    return () => window.clearInterval(timer);
  }, [overlap.runs, router]);

  async function run(candidateVersionId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch("/overlap/runs", {
        method: "POST",
        body: JSON.stringify({ candidateVersionId }),
      });
      await router.invalidate();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Analisis overlap gagal dijalankan.");
    } finally {
      setBusy(false);
    }
  }

  async function recordDecision(matchId: string, payload: DecisionPayload): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/overlap/matches/${matchId}/decision`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await router.invalidate();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Keputusan overlap gagal disimpan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmDecision() {
    if (!pendingDecision) return;
    const confirmed = await recordDecision(pendingDecision.matchId, pendingDecision.payload);
    if (confirmed) setPendingDecision(null);
  }

  async function confirmNoMatch(runId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/overlap/runs/${runId}/no-match-confirmation`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      await router.invalidate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Konfirmasi zero-match gagal disimpan.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack overlap-page">
      <PageHeader
        title="Analisis overlap"
        actions={
          <div className="overlap-page-summary">
            <span>
              <strong>{pendingDecisionCount}</strong>
              <small>perlu keputusan</small>
            </span>
            <span>
              <strong>{activeRunCount}</strong>
              <small>sedang diproses</small>
            </span>
          </div>
        }
      />
      {actionError ? (
        <p role="alert" className="overlap-inline-note">
          {actionError}
        </p>
      ) : null}

      {runs.length === 0 ? (
        <div className="overlap-empty-layout">
          <EmptyState
            title="Belum ada analisis overlap"
            description="Analisis tersedia setelah metadata draft dikonfirmasi oleh HR."
          />
          {analysisCandidates.length ? (
            <section className="overlap-candidate-list" aria-labelledby="candidate-list-title">
              <header>
                <span className="section-index">DRAFT SIAP</span>
                <h2 id="candidate-list-title">Mulai analisis</h2>
              </header>
              {analysisCandidates.map((candidate) => (
                <article key={candidate.id}>
                  <div>
                    <strong>{candidate.iomNumber}</strong>
                    <span>{candidate.title}</span>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => void run(candidate.id)}
                  >
                    <Play weight="bold" /> Analisis
                  </Button>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="overlap-workspace">
          <aside className="overlap-run-rail" aria-labelledby="overlap-run-list-title">
            <header>
              <div>
                <span className="section-index">ANALISIS TERBARU</span>
                <h2 id="overlap-run-list-title">Daftar pemeriksaan</h2>
              </div>
              <CountIndicator value={runs.length} />
            </header>
            <div className="overlap-run-list">
              {runs.map((runItem) => {
                const pendingCount = runItem.matches.filter(
                  (match) => match.decision?.status !== "FINAL",
                ).length;
                const active = runItem.id === selectedRun?.id;
                return (
                  <button
                    key={runItem.id}
                    className="overlap-run-item"
                    type="button"
                    data-active={active}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedRunId(runItem.id);
                      setSelectedMatchId("");
                    }}
                  >
                    <span className="overlap-run-item__topline">
                      <strong>{runItem.candidateVersion.iomNumber}</strong>
                      <StatusStamp status={runItem.status} label={runStatusLabel(runItem.status)} />
                    </span>
                    <span className="overlap-run-item__title">
                      {runItem.candidateVersion.title}
                    </span>
                    <span className="overlap-run-item__meta">
                      {pendingCount} perlu keputusan · {runItem.matches.length} perbandingan
                    </span>
                  </button>
                );
              })}
            </div>

            {analysisCandidates.length ? (
              <section className="overlap-new-analysis" aria-labelledby="new-analysis-title">
                <span className="section-index">DRAFT BARU</span>
                <h3 id="new-analysis-title">Belum dianalisis</h3>
                {analysisCandidates.map((candidate) => (
                  <article key={candidate.id}>
                    <div>
                      <strong>{candidate.iomNumber}</strong>
                      <span>{candidate.title}</span>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => void run(candidate.id)}
                    >
                      <Play weight="bold" /> Analisis
                    </Button>
                  </article>
                ))}
              </section>
            ) : null}
          </aside>

          {selectedRun ? (
            <section className="overlap-review" aria-labelledby="selected-run-title">
              <header className="overlap-run-summary">
                <div>
                  <span className="section-index">SEDANG DITINJAU</span>
                  <h2 id="selected-run-title">{selectedRun.candidateVersion.iomNumber}</h2>
                  <p>{selectedRun.candidateVersion.title}</p>
                </div>
                <div className="overlap-run-summary__facts">
                  <span>
                    <strong>{selectedRun.matches.length}</strong>
                    <small>perbandingan</small>
                  </span>
                  <span>
                    <strong>
                      {
                        selectedRun.matches.filter((match) => match.decision?.status !== "FINAL")
                          .length
                      }
                    </strong>
                    <small>belum diputuskan</small>
                  </span>
                  <time dateTime={selectedRun.createdAt}>
                    {formatRunDate(selectedRun.createdAt)}
                  </time>
                  {selectedRun.status === "COMPLETED" &&
                  ["IN_REVIEW", "READY_TO_PUBLISH"].includes(selectedRun.candidateVersion.status) &&
                  selectedRun.candidateVersion.metadataConfirmedAt &&
                  new Date(selectedRun.candidateVersion.metadataConfirmedAt).getTime() >
                    new Date(selectedRun.createdAt).getTime() ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => void run(selectedRun.candidateVersion.id)}
                    >
                      <Play weight="bold" /> Analisis ulang
                    </Button>
                  ) : null}
                </div>
              </header>

              {selectedRun.status === "FAILED" ? (
                <div className="overlap-process-state" data-status="failed">
                  <WarningCircle weight="bold" />
                  <div>
                    <h3>Analisis gagal diproses</h3>
                    <p>
                      Jalankan ulang analisis untuk draft ini. Keputusan lama tidak akan dihapus.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => void run(selectedRun.candidateVersion.id)}
                  >
                    Analisis ulang
                  </Button>
                </div>
              ) : selectedRun.status === "QUEUED" || selectedRun.status === "RUNNING" ? (
                <div className="overlap-process-state" data-status="active">
                  <ArrowsLeftRight weight="bold" />
                  <div>
                    <h3>
                      {selectedRun.status === "QUEUED"
                        ? "Menunggu antrean analisis"
                        : "Analisis sedang berjalan"}
                    </h3>
                    <p>Hasil akan diperbarui otomatis. Anda boleh meninggalkan halaman ini.</p>
                  </div>
                </div>
              ) : selectedRun.matches.length === 0 ? (
                <section className="overlap-no-overlap" aria-labelledby="zero-match-title">
                  <span className="section-index">COVERAGE ANALISIS</span>
                  <h3 id="zero-match-title">Tidak ditemukan kandidat overlap</h3>
                  <p>
                    {selectedRun.metrics.queryWindowCount} probe halaman sudah diperiksa dan
                    {selectedRun.coverageComplete
                      ? " coverage lengkap."
                      : " coverage belum lengkap."}
                  </p>
                  {selectedRun.noMatchConfirmation ? (
                    <p>
                      Sudah dikonfirmasi oleh {selectedRun.noMatchConfirmation.confirmedByName}.
                    </p>
                  ) : selectedRun.coverageComplete ? (
                    <Button
                      disabled={busy}
                      type="button"
                      onClick={() => void confirmNoMatch(selectedRun.id)}
                    >
                      <Check weight="bold" /> Konfirmasi tidak ada overlap
                    </Button>
                  ) : (
                    <p>Konfirmasi belum tersedia karena coverage belum lengkap.</p>
                  )}
                </section>
              ) : (
                <>
                  {selectedRun.matches.length > 1 && selectedMatch ? (
                    <Tabs
                      className="overlap-match-tabs"
                      aria-label="Perbandingan dokumen"
                      size="default"
                      value={selectedMatch.id}
                      onChange={setSelectedMatchId}
                      items={selectedRun.matches.map((match, index) => ({
                        value: match.id,
                        label: `Perbandingan ${index + 1}`,
                        ...(match.decision?.status !== "FINAL" ? { count: 1 } : {}),
                      }))}
                    />
                  ) : null}

                  {selectedMatch ? (
                    <OverlapComparison
                      key={selectedMatch.id}
                      run={selectedRun}
                      match={selectedMatch}
                      busy={busy}
                      onDecision={(payload) =>
                        setPendingDecision({ matchId: selectedMatch.id, payload })
                      }
                    />
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={pendingDecision !== null}
        title="Simpan keputusan HR?"
        description={
          pendingDecision?.payload.status === "PENDING_REVIEW"
            ? "Perbandingan ini tetap memblokir publish sampai HR menetapkan outcome final."
            : pendingDecision
              ? decisionPresentation(pendingDecision.payload.outcome).description
              : ""
        }
        confirmLabel="Ya, simpan keputusan"
        busy={busy}
        onCancel={() => {
          if (!busy) setPendingDecision(null);
        }}
        onConfirm={() => void confirmDecision()}
      />
    </div>
  );
}

function OverlapComparison({
  run,
  match,
  busy,
  onDecision,
}: {
  run: OverlapRun;
  match: OverlapMatchRow;
  busy: boolean;
  onDecision(payload: DecisionPayload): void;
}) {
  const recommendation = decisionPresentation(match.recommendation);
  const confidence = Math.round(match.confidence * 100);
  const decided = match.decision?.outcome
    ? decisionPresentation(match.decision.outcome)
    : match.decision?.status === "PENDING_REVIEW"
      ? decisionPresentation("MANUAL_REVIEW")
      : null;
  const hasOverlapEvidence = match.recommendation !== "NO_MATERIAL_OVERLAP";
  const savedOutcome = match.decision?.outcome;
  const initialOutcome: FinalOutcome | "" = [
    "REPLACES",
    "PARTIALLY_OVERRIDES",
    "COMPLEMENTS",
    "NO_MATERIAL_OVERLAP",
  ].includes(savedOutcome ?? "")
    ? (savedOutcome as FinalOutcome)
    : ["REPLACES", "PARTIALLY_OVERRIDES", "COMPLEMENTS", "NO_MATERIAL_OVERLAP"].includes(
          match.recommendation,
        )
      ? (match.recommendation as FinalOutcome)
      : "";
  const [outcome, setOutcome] = useState<FinalOutcome | "">(initialOutcome);
  const [rationale, setRationale] = useState(match.decision?.rationale ?? "");
  const [topicScope, setTopicScope] = useState<string[]>(match.decision?.topicScope ?? []);
  const [customTopic, setCustomTopic] = useState("");
  const locked =
    run.candidateVersion.status === "PUBLISHED" || run.candidateVersion.status === "SUPERSEDED";
  const finalNeedsRationale = outcome === "REPLACES" || outcome === "PARTIALLY_OVERRIDES";
  const canSave = outcome !== "" && (!finalNeedsRationale || rationale.trim().length >= 3);

  return (
    <article className="overlap-comparison">
      <header className="comparison-heading">
        <div>
          <span className="section-index">DRAFT</span>
          <h3>{run.candidateVersion.title}</h3>
          <strong>{run.candidateVersion.iomNumber}</strong>
        </div>
        <ArrowsLeftRight weight="bold" aria-hidden />
        <div>
          <span className="section-index">Dokumen pembanding</span>
          <h3>{match.existingVersion.title}</h3>
          <strong>{match.existingVersion.iomNumber}</strong>
        </div>
      </header>

      <section className="overlap-recommendation" data-low-confidence={match.confidence < 0.75}>
        <div>
          <span className="section-index">REKOMENDASI SISTEM</span>
          <div className="overlap-recommendation__title">
            <StatusStamp status={match.recommendation} label={recommendation.label} />
            <p>{recommendation.description}</p>
          </div>
        </div>
        <div className="overlap-confidence">
          <strong>{confidence}%</strong>
          <span>confidence sistem</span>
        </div>
      </section>

      {hasOverlapEvidence ? (
        <>
          {match.sharedTopics.length ? (
            <section className="overlap-topics" aria-labelledby={`topics-${match.id}`}>
              <header>
                <h3 className="section-index" id={`topics-${match.id}`}>
                  KONTEKS BERSAMA
                </h3>
              </header>
              <ol>
                {match.sharedTopics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="overlap-evidence" aria-labelledby={`rules-${match.id}`}>
            <header>
              <h3 className="section-index" id={`rules-${match.id}`}>
                BUKTI PERBANDINGAN
              </h3>
              <p>Bandingkan aturan aktif dengan isi draft sebelum mencatat keputusan HR.</p>
            </header>
            {match.evidenceStatus !== "CURRENT" ? (
              <p className="overlap-inline-note">
                Evidence sudah stale atau tidak tersedia. Jalankan analisis ulang sebelum keputusan
                material.
              </p>
            ) : null}
            {match.evidence.map((item) => (
              <article
                className="overlap-evidence-card"
                key={`${item.candidate.versionId}-${item.existing.versionId}-${item.explanation}`}
              >
                <div>
                  <strong>Draft — halaman {item.candidate.page ?? "?"}</strong>
                  <p>{item.candidate.excerpt}</p>
                  <a
                    href={`/hr/documents/${item.candidate.versionId}?page=${item.candidate.page ?? 1}`}
                  >
                    Buka halaman sumber
                  </a>
                </div>
                <div>
                  <strong>Existing — halaman {item.existing.page ?? "?"}</strong>
                  <p>{item.existing.excerpt}</p>
                  <a
                    href={`/hr/documents/${item.existing.versionId}?page=${item.existing.page ?? 1}`}
                  >
                    Buka halaman sumber
                  </a>
                </div>
                <p>
                  <em>{item.explanation}</em>
                </p>
              </article>
            ))}
            {match.changedRules.length ? (
              <div className="overlap-rule-list">
                {match.changedRules.map((rule, index) => (
                  <article key={rule.subject}>
                    <h4>
                      <span aria-hidden="true">{index + 1}.</span>
                      {rule.subject}
                    </h4>
                    <dl>
                      <div>
                        <dt>Aturan aktif</dt>
                        <dd data-kind="previous">{rule.previousValue ?? "Tidak disebutkan"}</dd>
                      </div>
                      <div>
                        <dt>Isi draft</dt>
                        <dd data-kind="proposed">{rule.proposedValue ?? "Tidak disebutkan"}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <p className="overlap-inline-note">
                Tidak ada perubahan aturan terstruktur pada dokumen ini.
              </p>
            )}
          </section>

          {match.conflicts.length ? (
            <section className="overlap-findings" aria-labelledby={`findings-${match.id}`}>
              <header>
                <h3 className="section-index" id={`findings-${match.id}`}>
                  TEMUAN UNTUK HR
                </h3>
              </header>
              <ol>
                {match.conflicts.map((conflict) => (
                  <li key={conflict}>
                    <p>{conflict}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : (
        <section className="overlap-no-overlap" aria-labelledby={`no-overlap-${match.id}`}>
          <span className="section-index">HASIL PERBANDINGAN</span>
          <h3 id={`no-overlap-${match.id}`}>Tidak ditemukan tumpang tindih</h3>
          <p>Tidak ada aturan yang perlu disandingkan dari kedua dokumen ini.</p>
        </section>
      )}

      <footer className="overlap-decision">
        <div className="overlap-decision__label">
          <span className="section-index">KEPUTUSAN HR</span>
          {decided ? (
            <StatusStamp
              status={match.decision?.outcome ?? match.decision?.status ?? ""}
              label={decided.label}
            />
          ) : null}
        </div>
        <div className="overlap-decision__form">
          <label>
            Outcome keputusan HR
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as FinalOutcome | "")}
              disabled={busy || locked}
            >
              <option value="" disabled>
                Pilih outcome keputusan HR
              </option>
              <option value="REPLACES">Menggantikan seluruh aturan lama</option>
              <option value="PARTIALLY_OVERRIDES">Mengubah sebagian aturan</option>
              <option value="COMPLEMENTS">Melengkapi</option>
              <option value="NO_MATERIAL_OVERLAP">Tidak ada overlap material</option>
            </select>
          </label>
          {outcome === "PARTIALLY_OVERRIDES" ? (
            <div>
              <span>Topic scope (wajib)</span>
              <div>
                {[
                  ...new Set([
                    ...match.sharedTopics,
                    ...match.changedRules.map((rule) => rule.subject),
                    ...topicScope,
                  ]),
                ].map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    aria-pressed={topicScope.includes(topic)}
                    disabled={busy || locked}
                    onClick={() =>
                      setTopicScope((current) =>
                        current.includes(topic)
                          ? current.filter((item) => item !== topic)
                          : [...current, topic],
                      )
                    }
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <input
                value={customTopic}
                onChange={(event) => setCustomTopic(event.target.value)}
                placeholder="Topik tambahan"
                disabled={busy || locked}
              />
              <Button
                variant="secondary"
                type="button"
                disabled={!customTopic.trim() || topicScope.length >= 20 || busy || locked}
                onClick={() => {
                  const value = customTopic.trim();
                  setTopicScope((current) =>
                    current.includes(value) ? current : [...current, value],
                  );
                  setCustomTopic("");
                }}
              >
                Tambah topik
              </Button>
              <small>{topicScope.length}/20 topik</small>
              {topicScope.length === 0 ? <small>Tambahkan minimal satu topik.</small> : null}
            </div>
          ) : null}
          <label>
            Alasan {finalNeedsRationale ? "(wajib)" : "(opsional)"}
            <textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              maxLength={2_000}
              rows={4}
              placeholder={
                locked ? "Tidak ada keterangan yang ditambahkan" : "Tuliskan alasan keputusan HR"
              }
              disabled={busy || locked}
            />
          </label>
          {locked ? (
            <p className="overlap-inline-note">
              Keputusan tidak dapat diubah karena versi sudah dipublish
            </p>
          ) : null}
          <div className="overlap-decision__actions">
            <Button
              disabled={
                busy ||
                locked ||
                !canSave ||
                (outcome === "PARTIALLY_OVERRIDES" && topicScope.length === 0)
              }
              type="button"
              onClick={() =>
                outcome
                  ? onDecision({
                      status: "FINAL",
                      outcome,
                      ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
                      ...(outcome === "PARTIALLY_OVERRIDES" ? { topicScope } : {}),
                    })
                  : undefined
              }
            >
              <Check weight="bold" />
              {outcome ? decisionPresentation(outcome).confirmLabel : "Simpan keputusan"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || locked || rationale.trim().length < 3}
              type="button"
              onClick={() => onDecision({ status: "PENDING_REVIEW", rationale: rationale.trim() })}
            >
              Tandai perlu review lanjutan
            </Button>
          </div>
        </div>
      </footer>
    </article>
  );
}
