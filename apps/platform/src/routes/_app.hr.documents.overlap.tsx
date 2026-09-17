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
  existingVersion: IomVersionRow;
  decision?: { decision: string } | null;
}

interface OverlapRun {
  id: string;
  status: string;
  createdAt: string;
  candidateVersion: IomVersionRow;
  matches: OverlapMatchRow[];
}

interface PendingDecision {
  matchId: string;
  decision: string;
  candidateTitle: string;
  existingTitle: string;
}

interface DecisionPresentation {
  label: string;
  confirmLabel: string;
  description: string;
}

const DECISION_PRESENTATIONS: Record<string, DecisionPresentation> = {
  ARCHIVE_EXISTING: {
    label: "Ganti aturan lama",
    confirmLabel: "Konfirmasi penggantian",
    description: "Draft akan dicatat sebagai pengganti dokumen existing.",
  },
  PUBLISH_AS_COMPLEMENT: {
    label: "Jadikan pelengkap",
    confirmLabel: "Konfirmasi sebagai pelengkap",
    description: "Draft akan dicatat sebagai pelengkap dokumen existing.",
  },
  NO_MATERIAL_OVERLAP: {
    label: "Tidak ada tumpang tindih",
    confirmLabel: "Tandai tidak tumpang tindih",
    description: "Dokumen tidak memiliki aturan yang saling tumpang tindih.",
  },
  MANUAL_REVIEW: {
    label: "Perlu review manual",
    confirmLabel: "Catat review manual",
    description: "Dokumen akan tetap diblokir untuk pemeriksaan HR lebih lanjut.",
  },
};

const RUN_STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  QUEUED: "Menunggu",
  RUNNING: "Diproses",
};

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
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const selectedMatch =
    selectedRun?.matches.find((match) => match.id === selectedMatchId) ??
    selectedRun?.matches.find((match) => !match.decision) ??
    selectedRun?.matches[0];
  const pendingDecisionCount = runs.reduce(
    (total, run) => total + run.matches.filter((match) => !match.decision).length,
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
    try {
      await apiFetch("/overlap/runs", {
        method: "POST",
        body: JSON.stringify({ candidateVersionId }),
      });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function recordDecision(matchId: string, decision: string) {
    setBusy(true);
    try {
      await apiFetch(`/overlap/matches/${matchId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setPendingDecision(null);
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  function requestDecision(match: OverlapMatchRow, decision: string) {
    if (!selectedRun) return;
    setPendingDecision({
      matchId: match.id,
      decision,
      candidateTitle: selectedRun.candidateVersion.title,
      existingTitle: match.existingVersion.title,
    });
  }

  const confirmation = pendingDecision
    ? decisionPresentation(pendingDecision.decision)
    : decisionPresentation("MANUAL_REVIEW");

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
                const pendingCount = runItem.matches.filter((match) => !match.decision).length;
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
                    <strong>{selectedRun.matches.filter((match) => !match.decision).length}</strong>
                    <small>belum diputuskan</small>
                  </span>
                  <time dateTime={selectedRun.createdAt}>
                    {formatRunDate(selectedRun.createdAt)}
                  </time>
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
                <EmptyState
                  title="Tidak ditemukan tumpang tindih"
                  description="Sistem tidak menemukan dokumen existing yang perlu dibandingkan."
                />
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
                        ...(!match.decision ? { count: 1 } : {}),
                      }))}
                    />
                  ) : null}

                  {selectedMatch ? (
                    <OverlapComparison
                      run={selectedRun}
                      match={selectedMatch}
                      busy={busy}
                      onDecision={(decision) => requestDecision(selectedMatch, decision)}
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
        title={confirmation.label}
        description={
          pendingDecision ? (
            <>
              {confirmation.description} Keputusan untuk{" "}
              <strong>{pendingDecision.candidateTitle}</strong> terhadap{" "}
              <strong>{pendingDecision.existingTitle}</strong> akan masuk ke audit log. Perubahan
              lifecycle tetap menunggu konfirmasi publish.
            </>
          ) : (
            confirmation.description
          )
        }
        confirmLabel={confirmation.confirmLabel}
        busy={busy}
        onCancel={() => setPendingDecision(null)}
        onConfirm={() => {
          if (pendingDecision)
            void recordDecision(pendingDecision.matchId, pendingDecision.decision);
        }}
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
  onDecision(decision: string): void;
}) {
  const recommendation = decisionPresentation(match.recommendation);
  const confidence = Math.round(match.confidence * 100);
  const decided = match.decision ? decisionPresentation(match.decision.decision) : null;
  const hasOverlapEvidence = match.recommendation !== "NO_MATERIAL_OVERLAP";

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
            <StatusStamp status={match.decision?.decision ?? ""} label={decided.label} />
          ) : null}
        </div>
        {!decided ? (
          <div className="overlap-decision__actions">
            <Button disabled={busy} type="button" onClick={() => onDecision(match.recommendation)}>
              <Check weight="bold" /> {recommendation.confirmLabel}
            </Button>
            {match.recommendation !== "MANUAL_REVIEW" ? (
              <Button
                variant="secondary"
                disabled={busy}
                type="button"
                onClick={() => onDecision("MANUAL_REVIEW")}
              >
                Review manual
              </Button>
            ) : null}
            {match.recommendation !== "NO_MATERIAL_OVERLAP" ? (
              <Button
                variant="neutral"
                disabled={busy}
                type="button"
                onClick={() => onDecision("NO_MATERIAL_OVERLAP")}
              >
                Tidak tumpang tindih
              </Button>
            ) : null}
          </div>
        ) : null}
      </footer>
    </article>
  );
}
