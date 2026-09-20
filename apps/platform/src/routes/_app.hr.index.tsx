import { Button, PageHeader, Panel, ProgressBar } from "@iom/ui";
import { ArrowRight, UploadSimple } from "@phosphor-icons/react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";
import type { UploadBatchRow } from "@/lib/types";

export const Route = createFileRoute("/_app/hr/")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "HR_ADMIN") throw redirect({ to: "/chat" });
  },
  loader: async () => {
    const [uploads, reviews] = await Promise.all([
      apiFetch<{ batches: UploadBatchRow[] }>("/uploads/batches"),
      apiFetch<{ count: number }>("/iom/review-count"),
    ]);
    return { uploads, reviews };
  },
  component: HrOverview,
});

function HrOverview() {
  const { uploads, reviews } = Route.useLoaderData();
  const navigate = useNavigate();
  const reviewCount = reviews.count;
  return (
    <div className="page-stack">
      <PageHeader title="Overview" />
      <div className="operations-board">
        <section className="operations-main">
          <div className="section-heading">
            <span aria-hidden="true" title="Upload berjalan">
              <UploadSimple weight="bold" />
            </span>
            <div>
              <h2>Upload berjalan</h2>
              <p>Tetap diproses otomatis</p>
            </div>
            <Button
              type="button"
              onClick={() => void navigate({ to: "/hr/documents/confidentiality" })}
              rightIcon={<ArrowRight aria-hidden weight="bold" />}
            >
              {reviewCount} perlu review HR
            </Button>
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
        </section>
      </div>
    </div>
  );
}
