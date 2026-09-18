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

type PolicyImpactItem = {
  chunkId: string;
  versionId: string;
  iomNumber: string;
  title: string;
  currentVisibility: string;
  proposedVisibility: string;
  hasDecision: boolean;
  confidence: number;
  rationale: string;
  conflictsWithMarker: boolean;
  page?: number | null;
  section?: string | null;
  excerpt: string;
};

type PolicyImpact = {
  analyzedCount: number;
  pendingCount: number;
  items: PolicyImpactItem[];
  truncated: boolean;
};

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
  loader: async () => {
    const { policies } = await apiFetch<{ policies: Policy[] }>("/confidentiality/policies");
    const evaluating = policies.find((policy) => policy.status === "EVALUATING");
    const impact = evaluating
      ? (
          await apiFetch<{ impact: PolicyImpact }>(
            `/confidentiality/policies/${evaluating.id}/impact`,
          )
        ).impact
      : null;
    return { policies, evaluatingPolicyId: evaluating?.id ?? null, impact };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { policies, evaluatingPolicyId, impact } = Route.useLoaderData();
  const router = useRouter();
  const latestPolicy = policies[0];
  const [activeTab, setActiveTab] = useState<SettingsTab>("draft");
  const [draftInstructions, setDraftInstructions] = useState(
    () => latestPolicy?.instructions ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [impactChoices, setImpactChoices] = useState<Record<string, "EMPLOYEE_SAFE" | "HR_ONLY">>(
    {},
  );
  const [impactReasons, setImpactReasons] = useState<Record<string, string>>({});

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
    setError("");
    try {
      await apiFetch(`/confidentiality/policies/${policy.id}/${actionName}`, { method: "POST" });
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aksi policy gagal diproses.");
    } finally {
      setBusy(false);
    }
  }

  async function saveImpactDecision(item: PolicyImpactItem) {
    if (!evaluatingPolicyId) return;
    const visibility = impactChoices[item.chunkId];
    const reason = impactReasons[item.chunkId]?.trim();
    if (!visibility || !reason || reason.length < 3) {
      setError("Pilih akses final dan isi alasan minimal 3 karakter.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        `/confidentiality/policies/${evaluatingPolicyId}/decisions/${item.chunkId}/review`,
        { method: "POST", body: JSON.stringify({ visibility, reason }) },
      );
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review impact gagal disimpan.");
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
            {impact ? (
              <section className="policy-impact-review" aria-labelledby="policy-impact-title">
                <header>
                  <div>
                    <h3 id="policy-impact-title">Review perubahan akses</h3>
                    <p>
                      {impact.pendingCount} dari {impact.analyzedCount} chunk perlu keputusan HR
                      sebelum policy dapat diaktifkan.
                    </p>
                  </div>
                  {impact.truncated ? (
                    <span>Menampilkan 100 item pertama. Selesaikan lalu muat ulang.</span>
                  ) : null}
                </header>
                {impact.items.length === 0 ? (
                  <EmptyState
                    title="Impact policy sudah terselesaikan"
                    description="Policy siap diaktifkan setelah pemeriksaan terakhir."
                  />
                ) : (
                  <div className="policy-impact-review__list">
                    {impact.items.map((item) => (
                      <article key={item.chunkId}>
                        <header>
                          <div>
                            <code>{item.iomNumber}</code>
                            <strong>{item.title}</strong>
                          </div>
                          <StatusStamp status={item.proposedVisibility} />
                        </header>
                        <p>{item.excerpt}</p>
                        <div className="policy-impact-review__meta">
                          <span>Akses saat ini: {item.currentVisibility.replaceAll("_", " ")}</span>
                          <span>Confidence {Math.round(item.confidence * 100)}%</span>
                          {item.page ? <span>Halaman {item.page}</span> : null}
                          {item.conflictsWithMarker ? (
                            <span>Konflik dengan marker manual</span>
                          ) : null}
                        </div>
                        <p>
                          <strong>Alasan AI:</strong> {item.rationale}
                        </p>
                        {item.hasDecision ? (
                          <div className="policy-impact-review__form">
                            <Field label="Akses final">
                              <select
                                value={impactChoices[item.chunkId] ?? ""}
                                onChange={(event) =>
                                  setImpactChoices((current) => ({
                                    ...current,
                                    [item.chunkId]: event.target.value as
                                      | "EMPLOYEE_SAFE"
                                      | "HR_ONLY",
                                  }))
                                }
                              >
                                <option value="">Pilih keputusan</option>
                                <option value="EMPLOYEE_SAFE">Employee safe</option>
                                <option value="HR_ONLY">HR only</option>
                              </select>
                            </Field>
                            <Field label="Alasan keputusan HR">
                              <Textarea
                                rows={3}
                                minLength={3}
                                maxLength={2_000}
                                value={impactReasons[item.chunkId] ?? ""}
                                onChange={(event) =>
                                  setImpactReasons((current) => ({
                                    ...current,
                                    [item.chunkId]: event.target.value,
                                  }))
                                }
                              />
                            </Field>
                            <Button disabled={busy} onClick={() => void saveImpactDecision(item)}>
                              Simpan keputusan impact
                            </Button>
                          </div>
                        ) : (
                          <div className="form-alert" role="status">
                            Analisis chunk ini masih berjalan. Muat ulang setelah worker selesai.
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
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
                      <Button
                        disabled={
                          busy ||
                          (policy.id === evaluatingPolicyId && (impact?.pendingCount ?? 0) > 0)
                        }
                        onClick={() => action(policy, "activate")}
                      >
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
