import { Button, EmptyState, Field, Input, PageHeader, StatusStamp, Textarea } from "@iom/ui";
import { Flask, Gear, Lightning, Warning } from "@phosphor-icons/react";
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
  _count?: { decisions: number };
  decisions?: Array<{ visibility: string; conflictsWithMarker: boolean }>;
}

export const Route = createFileRoute("/_app/hr/settings")({
  loader: () => apiFetch<{ policies: Policy[] }>("/confidentiality/policies"),
  component: SettingsPage,
});

function SettingsPage() {
  const { policies } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    const form = new FormData(formElement);
    try {
      await apiFetch("/confidentiality/policies", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          instructions: form.get("instructions"),
          examples: [],
        }),
      });
      formElement.reset();
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Policy gagal disimpan.");
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
        title="Pengaturan"
        description="Kelola kebijakan akses"
      />
      <div className="settings-grid">
        <form className="policy-editor" onSubmit={create}>
          <div className="section-heading">
            <span>NEW</span>
            <div>
              <h2>Draft kebijakan</h2>
              <p>Belum mengubah corpus</p>
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
          {error ? (
            <div className="form-alert" role="alert">
              <Warning /> {error}
            </div>
          ) : null}
        </form>
        <section className="policy-history">
          <div className="section-heading">
            <span>VERSIONS</span>
            <div>
              <h2>Riwayat kebijakan</h2>
              <p>Semua versi tersimpan</p>
            </div>
          </div>
          {policies.length === 0 ? (
            <EmptyState title="Belum ada kebijakan" description="Buat kebijakan pertama" />
          ) : (
            policies.map((policy) => (
              <article key={policy.id}>
                <header>
                  <code>V{policy.version}</code>
                  <strong>{policy.name}</strong>
                  <StatusStamp status={policy.status} />
                </header>
                <p>{policy.instructions}</p>
                <div className="policy-impact">
                  <span>{policy._count?.decisions ?? 0} chunks dianalisis</span>
                  <span>
                    {policy.decisions?.filter(
                      (decision) =>
                        decision.visibility === "NEEDS_REVIEW" || decision.conflictsWithMarker,
                    ).length ?? 0}{" "}
                    masalah perlu review
                  </span>
                </div>
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
