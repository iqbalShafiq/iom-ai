import { EmptyState, PageHeader, StatusStamp } from "@iom/ui";
import { ArrowRight, ShieldWarning } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents/confidentiality")({
  loader: () => apiFetch<{ versions: IomVersionRow[] }>("/iom"),
  component: ReviewsPage,
});

function ReviewsPage() {
  const pending = Route.useLoaderData().versions.filter(
    (version) => version.status === "IN_REVIEW",
  );
  return (
    <div className="page-stack">
      <PageHeader title="Review kerahasiaan" />
      {pending.length === 0 ? (
        <EmptyState title="Antrean sudah bersih" description="Semua keputusan selesai" />
      ) : (
        <div className="review-list">
          {pending.map((version) => (
            <Link key={version.id} to="/hr/documents/$versionId" params={{ versionId: version.id }}>
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
      )}
    </div>
  );
}
