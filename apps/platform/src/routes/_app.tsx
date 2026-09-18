import { Button, EmptyState } from "@iom/ui";
import {
  createFileRoute,
  type ErrorComponentProps,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { UploadManagerProvider } from "@/features/upload-manager";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

function AppPending() {
  return (
    <div className="page-stack" aria-busy="true" aria-live="polite">
      <div className="inline-empty">Memuat workspace…</div>
    </div>
  );
}

function AppError({ reset }: ErrorComponentProps) {
  return (
    <div className="page-stack">
      <EmptyState
        title="Workspace gagal dimuat"
        description="Sesi atau data halaman tidak tersedia. Coba lagi, atau masuk ulang jika masalah berlanjut."
        action={
          <Button type="button" onClick={() => reset()}>
            Coba lagi
          </Button>
        }
      />
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    try {
      return await apiFetch<{ user: User }>("/auth/me");
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  pendingComponent: AppPending,
  errorComponent: AppError,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <UploadManagerProvider>
      <AppShell user={user}>
        <Outlet />
      </AppShell>
    </UploadManagerProvider>
  );
}
