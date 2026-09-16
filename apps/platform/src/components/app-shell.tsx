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
                  <Files weight="bold" /> Documents
                </Link>
                <div className="sidebar-subnav">
                  {documentNavigation.map((item) => (
                    <Link key={item.to} to={item.to} activeProps={{ "data-active": true }}>
                      <item.icon weight="bold" /> {item.label}
                    </Link>
                  ))}
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
