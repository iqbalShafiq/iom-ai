import { createFileRoute, redirect } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    let user: User;
    try {
      ({ user } = await apiFetch<{ user: User }>("/auth/me"));
    } catch {
      throw redirect({ to: "/login" });
    }
    throw redirect({ to: user.role === "HR_ADMIN" ? "/hr" : "/chat" });
  },
});
