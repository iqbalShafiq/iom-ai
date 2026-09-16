import { Button, EmptyState, PageHeader, StatusStamp } from "@iom/ui";
import { FileText, UploadSimple } from "@phosphor-icons/react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/documents")({
  loader: () => apiFetch<{ versions: IomVersionRow[] }>("/iom"),
  component: DocumentsPage,
});

function DocumentsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { versions } = Route.useLoaderData();
  if (pathname !== "/hr/documents") return <Outlet />;
  return (
    <div className="page-stack">
      <PageHeader
        title="Dokumen IOM"
        actions={
          <Link to="/hr/documents/upload">
            <Button>
              <UploadSimple /> Upload IOM
            </Button>
          </Link>
        }
      />
      {versions.length === 0 ? (
        <EmptyState title="Belum ada dokumen" description="Upload IOM pertama" />
      ) : (
        <div className="data-table">
          <div className="data-table__head">
            <span>No. IOM</span>
            <span>Judul</span>
            <span>Efektif</span>
            <span>Revision</span>
            <span>Status</span>
          </div>
          {versions.map((version) => (
            <Link
              key={version.id}
              to="/hr/documents/$versionId"
              params={{ versionId: version.id }}
              className="data-table__row"
            >
              <code>{version.iomNumber}</code>
              <span>
                <FileText /> {version.title}
              </span>
              <time>{new Date(version.effectiveFrom).toLocaleDateString("id-ID")}</time>
              <code>R{version.revision}</code>
              <StatusStamp status={version.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
