import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { UploadManagerProvider } from "@/features/upload-manager";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    try {
      return await apiFetch<{ user: User }>("/auth/me");
    } catch {
      throw redirect({ to: "/login" });
    }
  },
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
