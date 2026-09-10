import type { ServerConfig } from "@iom/config";
import { loginSchema } from "@iom/contracts";
import { createSession, resolveSession, revokeSession } from "@iom/database/auth";
import argon2 from "argon2";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "./types.js";

export const SESSION_COOKIE = "iom_session";

export function authMiddleware() {
  return createMiddleware<AppBindings>(async (context, next) => {
    const token = getCookie(context, SESSION_COOKIE);
    if (!token) return context.json({ error: "Autentikasi diperlukan." }, 401);
    const session = await resolveSession(context.get("database"), token);
    if (!session) return context.json({ error: "Sesi tidak valid atau kedaluwarsa." }, 401);
    context.set("actor", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      sessionId: session.id,
    });
    await next();
  });
}

export function requireHr() {
  return createMiddleware<AppBindings>(async (context, next) => {
    if (context.get("actor").role !== "HR_ADMIN")
      return context.json({ error: "Akses HR diperlukan." }, 403);
    await next();
  });
}

export function registerAuthRoutes(app: import("hono").Hono<AppBindings>, config: ServerConfig) {
  app.post("/auth/login", async (context) => {
    const input = loginSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Email atau password tidak valid." }, 400);
    const user = await context
      .get("database")
      .user.findUnique({ where: { email: input.data.email } });
    const valid =
      user?.isActive &&
      (await argon2.verify(user.passwordHash, input.data.password).catch(() => false));
    if (!user || !valid) return context.json({ error: "Email atau password tidak valid." }, 401);
    const { token } = await createSession(context.get("database"), user.id);
    setCookie(context, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return context.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.post("/auth/logout", authMiddleware(), async (context) => {
    const token = getCookie(context, SESSION_COOKIE);
    if (token) await revokeSession(context.get("database"), token);
    deleteCookie(context, SESSION_COOKIE, { path: "/" });
    return context.body(null, 204);
  });

  app.get("/auth/me", authMiddleware(), (context) => {
    const { sessionId: _, ...user } = context.get("actor");
    return context.json({ user });
  });

  app.get("/auth/me", authMiddleware(), (context) => {
    const actor = context.get("actor");
    return context.json({
      user: { id: actor.id, email: actor.email, name: actor.name, role: actor.role },
    });
  });
}
