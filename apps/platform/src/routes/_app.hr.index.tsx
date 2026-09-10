import { Metric, PageHeader, Panel, ProgressBar, StatusStamp } from "@iom/ui";
import { ArrowRight, ShieldWarning } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";
import type { IomVersionRow, UploadBatchRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "HR_ADMIN") throw new Error("FORBIDDEN");
  },
  loader: async () => {
    const [uploads, documents, overlaps] = await Promise.all([
      apiFetch<{ batches: UploadBatchRow[] }>("/uploads/batches"),
      apiFetch<{ versions: IomVersionRow[] }>("/iom"),
      apiFetch<{ runs: Array<{ id: string; status: string; createdAt: string }> }>("/overlap/runs"),
    ]);
    return { uploads, documents, overlaps };
  },
  component: HrOverview,
});

function HrOverview() {
  const { uploads, documents, overlaps } = Route.useLoaderData();
  const files = uploads.batches.flatMap((batch) => batch.files);
  const reviewCount = documents.versions.filter((item) => item.status === "IN_REVIEW").length;
  const activeCount = documents.versions.filter((item) => item.status === "PUBLISHED").length;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="HR OPERATIONS / LIVE"
        title="Selamat datang di meja kendali IOM."
        description="Prioritas operasional, bukan angka hiasan. Semua data berasal dari status sistem saat ini."
      />
      <div className="operations-board">
        <section className="operations-main">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h2>Batch yang sedang berjalan</h2>
              <p>Upload tetap diproses saat Anda berpindah halaman.</p>
            </div>
            <Link to="/hr/uploads">
              Buka semua <ArrowRight />
            </Link>
          </div>
          {uploads.batches.slice(0, 4).map((batch) => {
            const progress = batch.files.length
              ? Math.round(
                  batch.files.reduce((sum, file) => sum + file.progress, 0) / batch.files.length,
                )
              : 0;
            return (
              <Panel key={batch.id} className="batch-row">
                <div>
                  <strong>Batch {batch.id.slice(0, 8)}</strong>
                  <small>
                    {batch.files.length} file / {new Date(batch.createdAt).toLocaleString("id-ID")}
                  </small>
                </div>
                <ProgressBar value={progress} label={`${progress}%`} />
              </Panel>
            );
          })}
          {uploads.batches.length === 0 ? (
            <div className="inline-empty">
              Belum ada batch. Upload dokumen pertama untuk memulai pipeline.
            </div>
          ) : null}
          <div className="section-heading section-heading--second">
            <span>02</span>
            <div>
              <h2>Antrean review</h2>
              <p>Conflict dan confidence rendah selalu diperiksa individual.</p>
            </div>
            <Link to="/hr/reviews">
              Tinjau <ArrowRight />
            </Link>
          </div>
          <div className="review-stripe">
            <ShieldWarning size={30} weight="bold" />
            <strong>{reviewCount}</strong>
            <span>dokumen menunggu keputusan HR</span>
          </div>
        </section>
        <aside className="operations-rail">
          <span className="rail-title">STATUS SISTEM</span>
          <Metric label="IOM aktif" value={activeCount} detail="tersedia untuk retrieval" />
          <Metric
            label="File diproses"
            value={files.filter((file) => !["COMPLETED", "FAILED"].includes(file.stage)).length}
            detail="seluruh batch"
          />
          <Metric label="Overlap runs" value={overlaps.runs.length} detail="riwayat analisis" />
          <div className="health-list">
            <span>
              <i /> API <StatusStamp status="ONLINE" />
            </span>
            <span>
              <i /> Queue{" "}
              <StatusStamp
                status={files.some((file) => file.stage === "FAILED") ? "CHECK" : "HEALTHY"}
              />
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
