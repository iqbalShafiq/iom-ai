import { Button, EmptyState, Field, Input, PageHeader, StatusStamp, Textarea } from "@iom/ui";
import { Flask, Gear, Lightning } from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";

interface Policy {
  id: string;
  version: number;
  name: string;
  instructions: string;
  status: "DRAFT" | "EVALUATING" | "ACTIVE" | "RETIRED";
  createdAt: string;
}

export const Route = createFileRoute("/_app/hr/settings")({
  loader: () => apiFetch<{ policies: Policy[] }>("/confidentiality/policies"),
  component: SettingsPage,
});

function SettingsPage() {
  const { policies } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/confidentiality/policies", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          instructions: form.get("instructions"),
          examples: [],
        }),
      });
      event.currentTarget.reset();
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }
  async function action(policy: Policy, actionName: "evaluate" | "activate") {
    setBusy(true);
    try {
      await apiFetch(`/confidentiality/policies/${policy.id}/${actionName}`, { method: "POST" });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CONFIDENTIALITY / VERSIONED POLICY"
        title="Settings"
        description="Tuliskan batas kerahasiaan dalam bahasa natural. Draft selalu dievaluasi sebelum mengganti corpus aktif."
      />
      <div className="settings-grid">
        <form className="policy-editor" onSubmit={create}>
          <div className="section-heading">
            <span>NEW</span>
            <div>
              <h2>Draft policy</h2>
              <p>Tidak langsung mengubah production corpus.</p>
            </div>
          </div>
          <Field label="Nama policy">
            <Input name="name" required placeholder="Kebijakan kerahasiaan Q1" />
          </Field>
          <Field
            label="Instruksi global"
            hint="Jelaskan makna dan konteks; hindari aturan kata tunggal."
          >
            <Textarea
              name="instructions"
              required
              minLength={20}
              rows={12}
              placeholder="Nominal gaji, budget divisi, identitas personal, dan evaluasi individu hanya boleh diakses HR. Prosedur umum pengajuan dapat diakses seluruh karyawan..."
            />
          </Field>
          <Button disabled={busy} type="submit">
            <Gear /> Simpan draft
          </Button>
        </form>
        <section className="policy-history">
          <div className="section-heading">
            <span>VERSIONS</span>
            <div>
              <h2>Riwayat policy</h2>
              <p>Semua versi dipertahankan untuk audit.</p>
            </div>
          </div>
          {policies.length === 0 ? (
            <EmptyState
              title="Belum ada policy"
              description="Buat policy pertama sebelum memulai chat atau publish."
            />
          ) : (
            policies.map((policy) => (
              <article key={policy.id}>
                <header>
                  <code>V{policy.version}</code>
                  <strong>{policy.name}</strong>
                  <StatusStamp status={policy.status} />
                </header>
                <p>{policy.instructions}</p>
                <footer>
                  {policy.status === "DRAFT" ? (
                    <Button disabled={busy} onClick={() => action(policy, "evaluate")}>
                      <Flask /> Impact analysis
                    </Button>
                  ) : null}
                  {policy.status === "EVALUATING" ? (
                    <Button disabled={busy} onClick={() => action(policy, "activate")}>
                      <Lightning /> Aktifkan atomik
                    </Button>
                  ) : null}
                </footer>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
