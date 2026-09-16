import { Button, Field, Input } from "@iom/ui";
import {
  ArrowRight,
  ArrowsLeftRight,
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  FileArrowUp,
  GitDiff,
  LockKey,
  MagnifyingGlass,
  ShieldWarning,
  UploadSimple,
} from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/login")({ component: LoginPage });

const productFeatures = {
  chat: { label: "Chat kebijakan", icon: ChatCircleDots },
  upload: { label: "Upload dokumen", icon: UploadSimple },
  confidential: { label: "Review confidential", icon: ShieldWarning },
  overlap: { label: "Analisis overlap", icon: GitDiff },
  versioning: { label: "Versioning", icon: ClockCounterClockwise },
} as const;

const productFeatureIds = ["chat", "upload", "confidential", "overlap", "versioning"] as const;
type ProductFeatureId = (typeof productFeatureIds)[number];
const featureCycleMs = 4800;
const featureTransitionMs = 200;

function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="login-preview__frame">
      <header className="login-preview__page-head">
        <strong>{title}</strong>
      </header>
      {children}
    </div>
  );
}

function ChatPreview() {
  return (
    <PreviewFrame title="Tanya kebijakan internal">
      <div className="mini-chat">
        <div className="mini-chat__question">Aturan perjalanan dinas mana yang masih berlaku?</div>
        <div className="mini-tool">
          <MagnifyingGlass weight="bold" />
          <span>
            <small>SEARCH_IOM</small>
            <strong>Mencari sumber sesuai scope dan tanggal</strong>
          </span>
          <b>SELESAI</b>
        </div>
        <div className="mini-chat__answer">
          <p>Ketentuan yang aktif ditampilkan bersama periode berlaku dan bukti pendukung.</p>
          <div>
            <span>SUMBER TEROTORISASI</span>
            <strong>Bagian kebijakan aktif · halaman terkait</strong>
          </div>
        </div>
        <div className="mini-composer">
          <span>Tanyakan kebijakan kantor…</span>
          <i aria-hidden>↑</i>
        </div>
      </div>
    </PreviewFrame>
  );
}

function UploadPreview() {
  return (
    <PreviewFrame title="Upload">
      <div className="mini-upload">
        <div className="mini-dropzone">
          <FileArrowUp weight="bold" />
          <strong>PDF, DOCX, MD, atau TXT</strong>
          <span>Validasi file dan halaman sebelum diproses</span>
        </div>
        <div className="mini-upload__options">
          <small>ATURAN BATCH</small>
          <span>
            <LockKey /> Marker confidential tidak diturunkan AI
          </span>
          <b>MULAI UPLOAD</b>
        </div>
      </div>
      <div className="mini-queue">
        <div>
          <span>
            <strong>Dokumen kebijakan</strong>
            <small>Ekstraksi teks</small>
          </span>
          <b>PROCESSING</b>
        </div>
        <div>
          <span>
            <strong>Lampiran hasil scan</strong>
            <small>OCR lokal</small>
          </span>
          <b>QUEUED</b>
        </div>
      </div>
    </PreviewFrame>
  );
}

function ConfidentialPreview() {
  return (
    <PreviewFrame title="Keputusan confidentiality">
      <div className="mini-review">
        <div className="mini-document">
          <small>PREVIEW DOKUMEN</small>
          <span />
          <span />
          <mark>Bagian sensitif memerlukan pemeriksaan HR</mark>
          <span />
          <span />
        </div>
        <div className="mini-decision">
          <header>
            <span>CHUNK / PAGE</span>
            <b>NEEDS REVIEW</b>
          </header>
          <p>Teks di sekitar marker menunjukkan potensi informasi terbatas.</p>
          <div className="mini-rationale">
            <strong>Alasan AI</strong>
            <span>Marker dan konteks kebijakan terdeteksi berkonflik.</span>
          </div>
          <div className="mini-choice">
            <span>EMPLOYEE SAFE</span>
            <b>HR ONLY</b>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

function OverlapPreview() {
  return (
    <PreviewFrame title="Overlap analysis">
      <div className="mini-overlap">
        <div className="mini-overlap__heading">
          <span>
            <small>DRAFT</small>
            <strong>Kebijakan yang sedang direview</strong>
          </span>
          <ArrowsLeftRight weight="bold" />
          <span>
            <small>EXISTING</small>
            <strong>Aturan yang sudah berlaku</strong>
          </span>
        </div>
        <div className="mini-recommendation">
          <small>REKOMENDASI SISTEM</small>
          <b>MANUAL REVIEW</b>
        </div>
        <div className="mini-rule-diff">
          <strong>Cakupan ketentuan</strong>
          <del>Nilai pada aturan aktif</del>
          <ins>Nilai pada draft baru</ins>
        </div>
        <div className="mini-hr-action">
          <span>KEPUTUSAN HR</span>
          <b>
            <Check /> Review manual
          </b>
        </div>
      </div>
    </PreviewFrame>
  );
}

function VersioningPreview() {
  return (
    <PreviewFrame title="Jejak aturan">
      <div className="mini-version-strip">
        <span>EFEKTIF SESUAI TANGGAL</span>
        <span>RELASI DIKONFIRMASI HR</span>
      </div>
      <div className="mini-timeline">
        <div>
          <i>01</i>
          <span>
            <small>VERSI SEBELUMNYA</small>
            <strong>Riwayat tetap tersimpan</strong>
          </span>
          <b>SUPERSEDED</b>
        </div>
        <div data-current="true">
          <i>02</i>
          <span>
            <small>VERSI AKTIF</small>
            <strong>Digunakan untuk jawaban saat ini</strong>
          </span>
          <b>CURRENT</b>
        </div>
        <div>
          <i>03</i>
          <span>
            <small>VERSI MENDATANG</small>
            <strong>Menunggu tanggal efektif</strong>
          </span>
          <b>UPCOMING</b>
        </div>
      </div>
    </PreviewFrame>
  );
}

function ProductPreview({ feature }: { feature: ProductFeatureId }) {
  if (feature === "upload") return <UploadPreview />;
  if (feature === "confidential") return <ConfidentialPreview />;
  if (feature === "overlap") return <OverlapPreview />;
  if (feature === "versioning") return <VersioningPreview />;
  return <ChatPreview />;
}

function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ProductFeatureId>("chat");
  const [featureChanging, setFeatureChanging] = useState(false);
  const manualTransitionTimer = useRef<number | undefined>(undefined);
  const autoCycleTimer = useRef<number | undefined>(undefined);
  const autoTransitionTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const currentIndex = productFeatureIds.indexOf(activeFeature);
    const nextFeature = productFeatureIds[(currentIndex + 1) % productFeatureIds.length] ?? "chat";

    function scheduleRotation() {
      window.clearTimeout(autoCycleTimer.current);
      if (document.hidden || reducedMotion.matches) return;
      autoCycleTimer.current = window.setTimeout(rotateFeature, featureCycleMs);
    }

    function rotateFeature() {
      setFeatureChanging(true);
      autoTransitionTimer.current = window.setTimeout(() => {
        setActiveFeature(nextFeature);
        setFeatureChanging(false);
      }, featureTransitionMs);
    }

    function handlePlaybackChange() {
      window.clearTimeout(autoTransitionTimer.current);
      setFeatureChanging(false);
      scheduleRotation();
    }

    scheduleRotation();
    document.addEventListener("visibilitychange", handlePlaybackChange);
    reducedMotion.addEventListener("change", handlePlaybackChange);
    return () => {
      window.clearTimeout(autoCycleTimer.current);
      window.clearTimeout(autoTransitionTimer.current);
      document.removeEventListener("visibilitychange", handlePlaybackChange);
      reducedMotion.removeEventListener("change", handlePlaybackChange);
    };
  }, [activeFeature]);

  useEffect(
    () => () => {
      window.clearTimeout(manualTransitionTimer.current);
    },
    [],
  );

  function selectFeature(nextFeature: ProductFeatureId) {
    if (nextFeature === activeFeature) return;
    window.clearTimeout(autoCycleTimer.current);
    window.clearTimeout(autoTransitionTimer.current);
    window.clearTimeout(manualTransitionTimer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActiveFeature(nextFeature);
      setFeatureChanging(false);
      return;
    }
    setFeatureChanging(true);
    manualTransitionTimer.current = window.setTimeout(() => {
      setActiveFeature(nextFeature);
      setFeatureChanging(false);
    }, featureTransitionMs);
  }

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

  const activeIndex = productFeatureIds.indexOf(activeFeature);
  const ActiveIcon = productFeatures[activeFeature].icon;

  return (
    <main className="login-shell">
      <section className="login-story" aria-label="Pratinjau fitur Ruang IOM">
        <div className="brand-lockup">
          <span className="brand-mark">IO</span>
          <span>RUANG IOM</span>
        </div>
        <p className="login-demo-summary">
          Ruang IOM mencakup chat kebijakan, upload dokumen, review confidentiality, analisis
          overlap, dan versioning.
        </p>
        <section className="product-demo" aria-label="Demo fitur Ruang IOM">
          <header className="product-demo__header">
            <span>
              <ActiveIcon weight="bold" /> {productFeatures[activeFeature].label}
            </span>
            <code>{String(activeIndex + 1).padStart(2, "0")} / 05</code>
          </header>
          <div className="product-demo__scene" data-changing={featureChanging} aria-hidden="true">
            <ProductPreview feature={activeFeature} />
          </div>
          <nav className="product-demo__progress" aria-label="Pilih demo fitur">
            {productFeatureIds.map((featureId) => (
              <button
                key={featureId}
                type="button"
                title={productFeatures[featureId].label}
                aria-label={`Tampilkan ${productFeatures[featureId].label}`}
                aria-pressed={featureId === activeFeature}
                onClick={() => selectFeature(featureId)}
              />
            ))}
          </nav>
        </section>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <header>
            <span className="section-index">AKSES INTERNAL</span>
            <h1>Masuk</h1>
            <p>Gunakan akun internal</p>
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
