import { CountIndicator, IconButton } from "@iom/ui";
import {
  Archive,
  ChatCircleDots,
  CirclesThreePlus,
  Files,
  Gear,
  HouseLine,
  ListChecks,
  SignOut,
  UploadSimple,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

const documentNavigation = [
  { to: "/hr/documents/upload", label: "Upload", icon: UploadSimple },
  {
    to: "/hr/documents/confidentiality",
    label: "Confidentiality",
    icon: ListChecks,
  },
  { to: "/hr/documents/overlap", label: "Overlap", icon: CirclesThreePlus },
] as const;

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // AppShell stays mounted across navigation, so the pathname is the trigger that
  // keeps the counter fresh after review work.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the refetch trigger
  useEffect(() => {
    if (user.role !== "HR_ADMIN") {
      setReviewCount(null);
      return;
    }
    let cancelled = false;
    void apiFetch<{ count: number }>("/iom/review-count")
      .then(({ count }) => {
        if (!cancelled) setReviewCount(Number.isInteger(count) && count >= 0 ? count : null);
      })
      .catch(() => {
        // The counter is an optional navigation aid; keep it quiet if its read fails.
        if (!cancelled) setReviewCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, user.role]);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    await navigate({ to: "/login" });
  }
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link
          to={user.role === "HR_ADMIN" ? "/hr" : "/chat"}
          className="brand-lockup brand-lockup--sidebar"
        >
          <span className="brand-mark">IO</span>
          <span>RUANG IOM</span>
        </Link>
        <nav aria-label="Navigasi utama">
          <Link to="/chat" activeProps={{ "data-active": true }}>
            <ChatCircleDots weight="bold" /> Chats
          </Link>
          {user.role === "HR_ADMIN" ? (
            <>
              <Link to="/hr" activeOptions={{ exact: true }} activeProps={{ "data-active": true }}>
                <HouseLine weight="bold" /> Overview
              </Link>
              <div className="sidebar-nav-group">
                <Link
                  to="/hr/documents"
                  activeOptions={{ exact: true }}
                  activeProps={{ "data-active": true }}
                >
                  <Files weight="bold" /> <span className="sidebar-link-label">Documents</span>
                </Link>
                <div className="sidebar-subnav">
                  {documentNavigation.map((item) => {
                    const showReviewCount =
                      item.to === "/hr/documents/confidentiality" &&
                      reviewCount !== null &&
                      reviewCount > 0;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        activeProps={{ "data-active": true }}
                        aria-label={
                          showReviewCount
                            ? `${item.label}, ${reviewCount} dokumen perlu review HR`
                            : undefined
                        }
                      >
                        <item.icon weight="bold" />
                        <span className="sidebar-link-label">{item.label}</span>
                        {showReviewCount ? (
                          <CountIndicator value={reviewCount} className="sidebar-review-counter" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
              <Link to="/hr/audit" activeProps={{ "data-active": true }}>
                <Archive weight="bold" /> Audit log
              </Link>
              <Link to="/hr/settings" activeProps={{ "data-active": true }}>
                <Gear weight="bold" /> Settings
              </Link>
            </>
          ) : null}
        </nav>
        <footer>
          <div className="user-tile">
            <span className="user-tile__avatar">{user.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === "HR_ADMIN" ? "HR / GA Admin" : "Karyawan"}</small>
            </span>
            <IconButton aria-label="Keluar" onClick={logout}>
              <SignOut weight="bold" />
            </IconButton>
          </div>
        </footer>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
