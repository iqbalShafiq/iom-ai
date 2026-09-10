import { IconButton } from "@iom/ui";
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
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

const hrNavigation = [
  { to: "/hr", label: "Overview", icon: HouseLine },
  { to: "/hr/documents", label: "Documents", icon: Files },
  { to: "/hr/uploads", label: "Upload batches", icon: UploadSimple },
  { to: "/hr/reviews", label: "Confidentiality", icon: ListChecks },
  { to: "/hr/overlap", label: "Overlap", icon: CirclesThreePlus },
  { to: "/hr/audit", label: "Audit log", icon: Archive },
  { to: "/hr/settings", label: "Settings", icon: Gear },
] as const;

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const navigate = useNavigate();
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
            <ChatCircleDots weight="bold" /> Chat regulasi
          </Link>
          {user.role === "HR_ADMIN"
            ? hrNavigation.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/hr" }}
                  activeProps={{ "data-active": true }}
                >
                  <item.icon weight="bold" /> {item.label}
                </Link>
              ))
            : null}
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
