import { Button, Field, Input } from "@iom/ui";
import { ArrowRight, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const { user } = await apiFetch<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      await navigate({ to: user.role === "HR_ADMIN" ? "/hr" : "/chat" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story" aria-labelledby="product-title">
        <div className="brand-lockup">
          <span className="brand-mark">IO</span>
          <span>RUANG IOM</span>
        </div>
        <div>
          <span className="section-index">01 / SUMBER KEBIJAKAN INTERNAL</span>
          <h1 id="product-title">
            Aturan kantor,
            <br />
            tanpa tebak-tebakan.
          </h1>
          <p>
            Cari IOM yang berlaku, pahami apa yang berubah, dan tetap berada di batas akses Anda.
          </p>
        </div>
        <div className="login-principles">
          <span>
            <ShieldCheck weight="bold" /> Sumber terotorisasi
          </span>
          <span>
            <LockKey weight="bold" /> Batas rahasia aktif
          </span>
        </div>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <header>
            <span className="section-index">AKSES INTERNAL</span>
            <h2>Masuk ke ruang kerja</h2>
            <p>Gunakan akun yang dibuat oleh administrator.</p>
          </header>
          <Field label="Email kantor">
            <Input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="nama@perusahaan.id"
            />
          </Field>
          <Field
            label="Password"
            {...(capsLock ? { hint: "Caps Lock sedang aktif." } : {})}
            {...(error ? { error } : {})}
          >
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
              onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            <span>{busy ? "Memeriksa akses..." : "Masuk"}</span>
            <ArrowRight weight="bold" aria-hidden />
          </Button>
          <small>Aktivitas akses dicatat untuk keamanan internal.</small>
        </form>
      </section>
    </main>
  );
}
