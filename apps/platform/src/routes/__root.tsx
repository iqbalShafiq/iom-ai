import { Button, EmptyState } from "@iom/ui";
import { createRootRoute, type ErrorComponentProps, Outlet } from "@tanstack/react-router";

function RootPending() {
  return (
    <div className="page-stack" aria-busy="true" aria-live="polite">
      <div className="inline-empty">Memuat halaman…</div>
    </div>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  const message =
    error instanceof Error && error.message === "FORBIDDEN"
      ? "Anda tidak memiliki akses ke halaman ini."
      : "Permintaan gagal diproses. Muat ulang atau kembali ke halaman sebelumnya.";
  return (
    <div className="page-stack">
      <EmptyState
        title="Halaman tidak dapat dimuat"
        description={message}
        action={
          <Button type="button" onClick={() => reset()}>
            Coba lagi
          </Button>
        }
      />
    </div>
  );
}

export const Route = createRootRoute({
  component: () => <Outlet />,
  pendingComponent: RootPending,
  errorComponent: RootError,
});
