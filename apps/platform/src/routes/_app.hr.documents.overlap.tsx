import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Select,
  SelectOption,
  StatusStamp,
} from "@iom/ui";
import { ArrowsLeftRight, Check, Play } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

interface OverlapRun {
  id: string;
  status: string;
  createdAt: string;
  candidateVersion: IomVersionRow;
  matches: Array<{
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
  }>;
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
  const [candidate, setCandidate] = useState(
    documents.versions.find(
      (item) => ["IN_REVIEW", "READY_TO_PUBLISH"].includes(item.status) && item.metadataConfirmedAt,
    )?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<{
    matchId: string;
    decision: string;
  } | null>(null);
  useEffect(() => {
    if (!overlap.runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING")) return;
    const timer = window.setInterval(() => void router.invalidate(), 2_000);
    return () => window.clearInterval(timer);
  }, [overlap.runs, router]);
  async function run() {
    if (!candidate) return;
    setBusy(true);
    try {
      await apiFetch("/overlap/runs", {
        method: "POST",
        body: JSON.stringify({ candidateVersionId: candidate }),
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
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="HYBRID SEARCH / HUMAN DECISION"
        title="Analisis overlap"
        description="Bandingkan aturan terkait"
        actions={
          <div className="inline-control">
            <Select value={candidate} onChange={(event) => setCandidate(event.target.value)}>
              <SelectOption value="">Pilih draft</SelectOption>
              {documents.versions
                .filter(
                  (item) =>
                    ["IN_REVIEW", "READY_TO_PUBLISH"].includes(item.status) &&
                    item.metadataConfirmedAt,
                )
                .map((item) => (
                  <SelectOption key={item.id} value={item.id}>
                    {item.iomNumber} — {item.title}
                  </SelectOption>
                ))}
            </Select>
            <Button disabled={!candidate || busy} onClick={run}>
              <Play /> Analisis
            </Button>
          </div>
        }
      />
      {overlap.runs.length === 0 ? (
        <EmptyState title="Belum ada analisis" description="Pilih draft IOM" />
      ) : (
        <div className="overlap-runs">
          {overlap.runs.map((run) => (
            <section key={run.id}>
              <header>
                <span>
                  <ArrowsLeftRight />
                  <strong>{run.candidateVersion.iomNumber}</strong>
                </span>
                <StatusStamp status={run.status} />
              </header>
              {run.matches.length === 0 ? (
                <p className="inline-empty">Belum ada match atau worker masih memproses.</p>
              ) : (
                run.matches.map((match) => (
                  <article key={match.id} className="overlap-comparison">
                    <div className="comparison-heading">
                      <span>
                        <small>DRAFT</small>
                        <strong>{run.candidateVersion.title}</strong>
                      </span>
                      <ArrowsLeftRight />
                      <span>
                        <small>EXISTING</small>
                        <strong>{match.existingVersion.title}</strong>
                      </span>
                    </div>
                    <div className="recommendation-stamp">
                      <small>REKOMENDASI SISTEM</small>
                      <StatusStamp status={match.recommendation} />
                      <strong>{Math.round(match.confidence * 100)}%</strong>
                    </div>
                    {match.changedRules.map((rule) => (
                      <div className="rule-diff" key={rule.subject}>
                        <strong>{rule.subject}</strong>
                        <del>{rule.previousValue ?? "Tidak disebutkan"}</del>
                        <ins>{rule.proposedValue ?? "Tidak disebutkan"}</ins>
                        <time>{rule.effectiveFrom ?? "Tanggal perlu review"}</time>
                      </div>
                    ))}
                    {match.conflicts.length ? (
                      <ul>
                        {match.conflicts.map((conflict) => (
                          <li key={conflict}>{conflict}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="overlap-actions">
                      {match.decision ? (
                        <StatusStamp status={`HR: ${match.decision.decision}`} />
                      ) : (
                        <>
                          <small>KEPUTUSAN HR</small>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              setPendingDecision({
                                matchId: match.id,
                                decision: match.recommendation,
                              })
                            }
                          >
                            <Check /> Terima rekomendasi
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              setPendingDecision({ matchId: match.id, decision: "MANUAL_REVIEW" })
                            }
                          >
                            Review manual
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              setPendingDecision({
                                matchId: match.id,
                                decision: "NO_MATERIAL_OVERLAP",
                              })
                            }
                          >
                            Tidak overlap
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                ))
              )}
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pendingDecision !== null}
        title="Catat keputusan HR?"
        description="Keputusan masuk ke audit log. Jika diterima sebagai pengganti atau pelengkap, relasi dokumen ikut dibuat; perubahan lifecycle baru terjadi saat publish dikonfirmasi."
        confirmLabel="Catat keputusan"
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
