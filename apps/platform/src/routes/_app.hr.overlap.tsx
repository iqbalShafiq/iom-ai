import { Button, EmptyState, PageHeader, StatusStamp } from "@iom/ui";
import { ArrowsLeftRight, Play } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
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
      previousValue?: string;
      proposedValue?: string;
      effectiveFrom?: string;
    }>;
    conflicts: string[];
    existingVersion: IomVersionRow;
    decision?: { decision: string } | null;
  }>;
}

export const Route = createFileRoute("/_app/hr/overlap")({
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
    documents.versions.find((item) => ["IN_REVIEW", "READY_TO_PUBLISH"].includes(item.status))
      ?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
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
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="HYBRID SEARCH / HUMAN DECISION"
        title="Overlap analysis"
        description="Semantic, lexical, dan metadata menemukan kandidat; model menjelaskan perubahan; HR menetapkan relasi."
        actions={
          <div className="inline-control">
            <select value={candidate} onChange={(event) => setCandidate(event.target.value)}>
              <option value="">Pilih draft</option>
              {documents.versions
                .filter((item) => ["IN_REVIEW", "READY_TO_PUBLISH"].includes(item.status))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.iomNumber} — {item.title}
                  </option>
                ))}
            </select>
            <Button disabled={!candidate || busy} onClick={run}>
              <Play /> Analisis
            </Button>
          </div>
        }
      />
      {overlap.runs.length === 0 ? (
        <EmptyState
          title="Belum ada analisis"
          description="Pilih draft IOM untuk mencari regulasi bermakna serupa."
        />
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
                  </article>
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
