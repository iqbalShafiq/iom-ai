import { Button, EmptyState, Field, PageHeader, StatusStamp, Tabs, Textarea } from "@iom/ui";
import {
  Clock,
  Flask,
  Gear,
  Lightning,
  PlusCircle,
  StackSimple,
  Warning,
} from "@phosphor-icons/react";
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

type SettingsTab = "draft" | "history";

const settingsTabs = [
  {
    value: "draft",
    label: "Draft kebijakan",
    id: "settings-tab-draft",
    panelId: "settings-panel-draft",
  },
  {
    value: "history",
    label: "Riwayat kebijakan",
    id: "settings-tab-history",
    panelId: "settings-panel-history",
  },
] as const;

function formatPolicyTimestamp(date: Date) {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} WIB`;
}

export const Route = createFileRoute("/_app/hr/settings")({
  loader: () => apiFetch<{ policies: Policy[] }>("/confidentiality/policies"),
  component: SettingsPage,
});

function SettingsPage() {
  const { policies } = Route.useLoaderData();
  const router = useRouter();
  const latestPolicy = policies[0];
  const [activeTab, setActiveTab] = useState<SettingsTab>("draft");
  const [draftInstructions, setDraftInstructions] = useState(
    () => latestPolicy?.instructions ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const name = formatPolicyTimestamp(new Date());
    try {
      await apiFetch("/confidentiality/policies", {
        method: "POST",
        body: JSON.stringify({
          name,
          instructions: draftInstructions,
          examples: [],
        }),
      });
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

  function selectTab(value: string) {
    if (value === "draft" || value === "history") setActiveTab(value);
  }

  return (
    <div className="page-stack">
      <PageHeader title="Pengaturan" />
      <div className="settings-workspace">
        <Tabs
          items={settingsTabs}
          value={activeTab}
          onChange={selectTab}
          aria-label="Bagian pengaturan kebijakan"
        />
        {activeTab === "draft" ? (
          <form
            className="policy-editor"
            id="settings-panel-draft"
            role="tabpanel"
            aria-labelledby="settings-tab-draft"
            onSubmit={create}
          >
            <div className="section-heading">
              <span aria-hidden="true" title="Draft kebijakan baru">
                <PlusCircle weight="bold" />
              </span>
              <div>
                <h2>Draft kebijakan</h2>
                <p>Dimulai dari preferensi HR terakhir</p>
              </div>
            </div>
            <div className="policy-editor__source">
              <Clock weight="bold" aria-hidden />
              <span>
                {latestPolicy ? (
                  <>
                    <small>Terakhir diupdate pada</small>
                    <time dateTime={latestPolicy.createdAt}>
                      {formatPolicyTimestamp(new Date(latestPolicy.createdAt))}
                    </time>
                  </>
                ) : (
                  <small>Belum ada policy tersimpan</small>
                )}
              </span>
            </div>
            <Field
              label="Instruksi global"
              hint="Jelaskan makna dan konteks; hindari aturan kata tunggal."
            >
              <Textarea
                name="instructions"
                required
                minLength={20}
                rows={12}
                value={draftInstructions}
                onChange={(event) => setDraftInstructions(event.target.value)}
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
        ) : (
          <section
            className="policy-history"
            id="settings-panel-history"
            role="tabpanel"
            aria-labelledby="settings-tab-history"
          >
            <div className="section-heading">
              <span aria-hidden="true" title="Riwayat kebijakan">
                <StackSimple weight="bold" />
              </span>
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
        )}
      </div>
    </div>
  );
}
