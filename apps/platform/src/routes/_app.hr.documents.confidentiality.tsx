import { EmptyState, PageHeader, StatusStamp, Tabs } from "@iom/ui";
import { ArrowRight, ClockCounterClockwise, LockKey, ShieldWarning } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

type RestrictedItem = {
  chunkId: string;
  versionId: string;
  iomNumber: string;
  title: string;
  status: string;
  page?: number | null;
  section?: string | null;
  excerpt: string;
  rationale: string;
  source: "AI" | "HR";
  updatedAt: string;
};

type HistoryItem = {
  id: string;
  versionId: string;
  iomNumber: string;
  title: string;
  page?: number | null;
  visibility: string;
  rationale: string;
  source: "AI" | "HR";
  actorName: string;
  createdAt: string;
};

type Overview = {
  pending: IomVersionRow[];
  restricted: RestrictedItem[];
  history: HistoryItem[];
};

type ConfidentialityTab = "pending" | "restricted" | "history";

function accessLabel(visibility: string) {
  if (visibility === "HR_ONLY") return "Akses Tertutup";
  if (visibility === "EMPLOYEE_SAFE") return "Akses Terbuka";
  return "Perlu keputusan HR";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export const Route = createFileRoute("/_app/hr/documents/confidentiality")({
  loader: () => apiFetch<Overview>("/iom/confidentiality-overview"),
  component: ReviewsPage,
});

function ReviewsPage() {
  const overview = Route.useLoaderData();
  const [activeTab, setActiveTab] = useState<ConfidentialityTab>("pending");
  return (
    <div className="page-stack confidentiality-page">
      <PageHeader title="Kerahasiaan dokumen" />
      <Tabs
        aria-label="Daftar kerahasiaan"
        value={activeTab}
        onChange={(value) => setActiveTab(value as ConfidentialityTab)}
        items={[
          { value: "pending", label: "Perlu ditinjau", count: overview.pending.length },
          { value: "restricted", label: "Akses terbatas", count: overview.restricted.length },
          { value: "history", label: "Riwayat keputusan", count: overview.history.length },
        ]}
      />

      {activeTab === "pending" ? (
        overview.pending.length === 0 ? (
          <EmptyState
            title="Tidak ada keputusan tertunda"
            description="Semua dokumen sudah memiliki keputusan akses."
          />
        ) : (
          <div className="review-list">
            {overview.pending.map((version) => (
              <Link
                key={version.id}
                to="/hr/documents/$versionId"
                params={{ versionId: version.id }}
                search={{}}
              >
                <ShieldWarning weight="bold" />
                <span>
                  <code>{version.iomNumber}</code>
                  <strong>{version.title}</strong>
                </span>
                <StatusStamp status={version.status} />
                <ArrowRight />
              </Link>
            ))}
          </div>
        )
      ) : null}

      {activeTab === "restricted" ? (
        overview.restricted.length === 0 ? (
          <EmptyState
            title="Belum ada bagian khusus HR"
            description="Bagian yang dibatasi hanya untuk HR akan muncul di sini."
          />
        ) : (
          <div className="confidentiality-records">
            {overview.restricted.map((item) => (
              <article key={item.chunkId}>
                <header>
                  <span>
                    <LockKey weight="bold" />
                    <code>{item.iomNumber}</code>
                  </span>
                  <StatusStamp status="HR_ONLY" label="Akses terbatas" />
                </header>
                <h2>{item.title}</h2>
                <p>{item.excerpt}</p>
                <div className="confidentiality-records__meta">
                  <span>{item.page ? `Halaman ${item.page}` : "Seluruh dokumen"}</span>
                  <span>{item.source === "HR" ? "Ditandai HR" : "Rekomendasi AI"}</span>
                  <span>{item.rationale}</span>
                </div>
                <Link
                  to="/hr/documents/$versionId"
                  params={{ versionId: item.versionId }}
                  search={item.page ? { page: item.page } : {}}
                >
                  Buka keputusan <ArrowRight weight="bold" />
                </Link>
              </article>
            ))}
          </div>
        )
      ) : null}

      {activeTab === "history" ? (
        overview.history.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat keputusan"
            description="Keputusan HR akan tercatat di sini."
          />
        ) : (
          <ol className="confidentiality-timeline">
            {overview.history.map((item) => (
              <li key={item.id}>
                <ClockCounterClockwise weight="bold" />
                <div>
                  <header>
                    <span>
                      <code>{item.iomNumber}</code> · {item.title}
                    </span>
                    <StatusStamp status={item.visibility} label={accessLabel(item.visibility)} />
                  </header>
                  <p>{item.rationale}</p>
                  <span>
                    {item.actorName} · {formatTimestamp(item.createdAt)}
                    {item.page ? ` · Halaman ${item.page}` : ""}
                  </span>
                  <Link
                    to="/hr/documents/$versionId"
                    params={{ versionId: item.versionId }}
                    search={item.page ? { page: item.page } : {}}
                  >
                    Lihat dokumen <ArrowRight weight="bold" />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
