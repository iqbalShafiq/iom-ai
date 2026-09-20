# Ruang IOM — HR Regulation Assistant

Monorepo TypeScript untuk batch ingestion, review kerahasiaan berbantuan AI, versioning temporal,
hybrid overlap analysis, dan chat IOM berbasis evidence yang terotorisasi.

Seluruh tangkapan layar di dokumen ini diambil dari aplikasi yang benar-benar berjalan
(platform + API + worker + PostgreSQL + Qdrant + Langfuse), bukan mock. Bukti mentah observability,
evaluasi, dan penyimpanan objek tersimpan di [`docs/evidence`](docs/evidence).

## Fitur utama

- **Ingestion batch** — PDF/DOCX/MD/TXT, validasi tipe dan ukuran, OCR untuk dokumen scan, serta job
  queue dengan lease, heartbeat, bounded retry, dan terminal dead-letter.
- **Review kerahasiaan** — klasifikasi AI per halaman/chunk, keputusan HR yang mengikat, penanda
  manual yang tidak dapat diturunkan, dan publish yang tetap diblokir selama ada `NEEDS_REVIEW`.
- **Temporal dan overlap** — metadata efektif, analisis overlap semantic + lexical, keputusan HR
  (`REPLACES`, `PARTIALLY_OVERRIDES`, `COMPLEMENTS`, `NO_MATERIAL_OVERLAP`), dan supersede otomatis.
- **Chat terotorisasi** — retrieval role-scoped, HR-only tidak pernah masuk corpus karyawan, dan
  stream guard yang menghentikan jawaban yang melanggar kerahasiaan.
- **Observability dan evaluasi** — trace Langfuse per operasi serta suite evaluasi deterministik dan
  LLM judge untuk confidentiality, overlap, dan chat.

## Galeri alur aplikasi

Skenario yang direkam: lima dokumen simulasi diunggah berurutan — `IOM-014/2014` (aturan cuti lama),
`IOM-021/2026` (aturan cuti baru), `IOM-028/2026` (kerja hibrida), `IOM-029/2026` (scan prosedur
darurat, melewati OCR), dan `IOM-033/2026` (keamanan informasi dengan lampiran HR-only).

### 1. Login dan Overview HR

<p align="center"><img src="docs/screenshots/01-login.png" alt="Login internal" width="900"></p>

<p align="center"><img src="docs/screenshots/02-hr-overview.png" alt="Overview HR" width="900"></p>

### 2. Upload batch dan perubahan status

Upload satu file (aturan cuti lama) diproses terpisah agar belum berpotongan dengan aturan lain.

<p align="center"><img src="docs/screenshots/03-upload-single-selected.png" alt="Pilih satu file" width="900"></p>

<p align="center"><img src="docs/screenshots/04-upload-single-reviewing.png" alt="Status upload berubah menuju review" width="900"></p>

<p align="center"><img src="docs/screenshots/05-documents-in-review.png" alt="Dokumen masuk tahap review" width="900"></p>

Batch kedua berisi tiga file sekaligus; file scan melewati tahap OCR sebelum klasifikasi.

<p align="center"><img src="docs/screenshots/11-upload-multi-selected.png" alt="Tiga file dipilih" width="900"></p>

<p align="center"><img src="docs/screenshots/12-upload-multi-processing.png" alt="Status QUEUED, EXTRACTING, dan OCR berjalan" width="900"></p>

<p align="center"><img src="docs/screenshots/13-upload-multi-reviewing.png" alt="Semua file selesai diproses" width="900"></p>

<p align="center"><img src="docs/screenshots/14-documents-multi.png" alt="Daftar dokumen dengan status beragam" width="900"></p>

### 3. Review kerahasiaan

Antrian review menampilkan dokumen yang perlu keputusan HR; halaman aman dan lampiran HR-only
dipisahkan per chunk. Penanda `CONFIDENTIAL` manual tidak dapat diturunkan oleh AI.

<p align="center"><img src="docs/screenshots/06-confidentiality-queue.png" alt="Antrian kerahasiaan" width="900"></p>

<p align="center"><img src="docs/screenshots/07-confidentiality-review.png" alt="Rekomendasi AI per chunk" width="900"></p>

<p align="center"><img src="docs/screenshots/15-confidentiality-keamanan.png" alt="Dokumen keamanan informasi" width="900"></p>

<p align="center"><img src="docs/screenshots/16-confidentiality-keamanan-hr-only.png" alt="Lampiran HR-only dipisahkan" width="900"></p>

<p align="center"><img src="docs/screenshots/09-confidentiality-confirmed.png" alt="Keputusan HR tersimpan" width="900"></p>

<p align="center"><img src="docs/screenshots/17-confidentiality-restricted.png" alt="Riwayat bagian akses terbatas" width="900"></p>

<p align="center"><img src="docs/screenshots/10-document-published.png" alt="Dokumen berstatus published" width="900"></p>

### 4. Overlap, keputusan HR, dan versioning

Saat aturan cuti baru diunggah, sistem membandingkannya dengan aturan lama dan merekomendasikan
`REPLACES` dengan bukti per halaman. Keputusan HR memicu supersede otomatis.

<p align="center"><img src="docs/screenshots/18-documents-all-published.png" alt="Empat dokumen pertama sudah published" width="900"></p>

<p align="center"><img src="docs/screenshots/19-upload-new-cuti-selected.png" alt="Aturan cuti baru diunggah terpisah" width="900"></p>

<p align="center"><img src="docs/screenshots/20-overlap-draft.png" alt="Draft menunggu analisis overlap" width="900"></p>

<p align="center"><img src="docs/screenshots/21-overlap-recommendation.png" alt="Rekomendasi menggantikan seluruh aturan lama" width="900"></p>

<p align="center"><img src="docs/screenshots/22-overlap-evidence.png" alt="Bukti perbandingan antar dokumen" width="900"></p>

<p align="center"><img src="docs/screenshots/23-overlap-decision-filled.png" alt="Keputusan HR diisi" width="900"></p>

<p align="center"><img src="docs/screenshots/24-overlap-decision-saved.png" alt="Keputusan HR tersimpan" width="900"></p>

<p align="center"><img src="docs/screenshots/25-versioning-superseded.png" alt="Aturan lama menjadi SUPERSEDED" width="900"></p>

<p align="center"><img src="docs/screenshots/26-rule-trace.png" alt="Jejak aturan dan relasi versi" width="900"></p>

Dokumen pertama juga dianalisis sejak awal; karena belum ada kandidat pembanding, HR mengonfirmasi
tidak ada overlap melalui alur yang sama.

<p align="center"><img src="docs/screenshots/08-overlap-first-document.png" alt="Konfirmasi tidak ada kandidat overlap" width="900"></p>

### 5. Preferensi HR dan audit

Preferensi akses disimpan sebagai draft kebijakan baru; seluruh keputusan HR tercatat di audit log.

<p align="center"><img src="docs/screenshots/27-settings-draft.png" alt="Draft preferensi HR" width="900"></p>

<p align="center"><img src="docs/screenshots/28-settings-history.png" alt="Riwayat kebijakan" width="900"></p>

<p align="center"><img src="docs/screenshots/29-audit-log.png" alt="Audit log" width="900"></p>

### 6. Chat HR dan karyawan

HR dapat membaca aturan terkini sekaligus lampiran HR-only. Karyawan hanya menerima bagian
`EMPLOYEE_SAFE`: pertanyaan tentang lampiran terbatas dijawab dengan penolakan aman beserta sumbernya,
dan pertanyaan temporal mengikuti aturan yang sudah menggantikan aturan lama.

<p align="center"><img src="docs/screenshots/30-chat-hr-cuti.png" alt="Chat HR tentang aturan cuti aktif" width="900"></p>

<p align="center"><img src="docs/screenshots/31-chat-hr-restricted.png" alt="Chat HR membaca lampiran HR-only" width="900"></p>

<p align="center"><img src="docs/screenshots/32-chat-employee-cuti.png" alt="Chat karyawan tentang aturan cuti" width="900"></p>

<p align="center"><img src="docs/screenshots/33-chat-employee-temporal.png" alt="Chat karyawan soal aturan yang digantikan" width="900"></p>

<p align="center"><img src="docs/screenshots/34-chat-employee-restricted.png" alt="Karyawan tidak dapat mengakses lampiran HR-only" width="900"></p>

## Observability (Langfuse)

Trace produksi dikirim ke Langfuse Cloud (US) dengan redaksi payload, actor hashing, dan
`errorPolicy: ignore` agar outage observability tidak menggagalkan klasifikasi, overlap, atau chat.
Data berikut dibaca langsung dari Langfuse Public API setelah seluruh skenario di atas berjalan:

- 100 trace terakhir terdiri dari 3 operasi: `iom.confidentiality.classify` (55),
  `iom.chat.turn` (23), dan `iom.overlap.compare` (21).
- Session mencakup percakapan `chat-*`, analisis `overlap-*`, klasifikasi dokumen, kasus evaluasi,
  dan probe `obs-probe-*`.
- Trace menyimpan span `AGENT`, `GENERATION` (model `deepseek-v4-flash-0731`), `TOOL`
  (`search_iom`), beserta latency dan usage.

<p align="center"><img src="docs/screenshots/35-observability-langfuse.png" alt="Trace Langfuse Ruang IOM" width="900"></p>

`pnpm eval:observability` mencetak trace probe confidentiality dan chat pada run ini; probe overlap
tidak menghasilkan trace sehingga perintah keluar dengan status 1
([log](docs/evidence/eval-observability.log)). Selain itu, publishing **score** dari
`@anvia/langfuse` 1.2.0 ditolak Langfuse Cloud saat ini (`POST /api/public/scores` mengharapkan objek
tunggal, klien mengirim array), jadi skor evaluasi dilaporkan melalui output `pnpm eval:all` dan
`docs/evidence`, bukan di UI Langfuse. Trace dan span tetap lengkap dan dapat ditelusuri.

## Evaluasi

`pnpm eval:all` menjalankan 20 kasus (7 confidentiality, 5 overlap, 8 chat) dengan model
`deepseek-v4-flash-0731` dan reasoning `high`. Setiap kasus dinilai LLM judge pada total 147 metrik.

| Suite                      | Kasus | Metrik | Hasil                                     |
| -------------------------- | ----- | ------ | ----------------------------------------- |
| `iom/confidentiality/pdf-v1` | 7/7   | 42/42  | Lulus penuh                               |
| `iom/overlap/pdf-v1`         | 4/5   | 24/25  | 1 kasus abstain dinilai gagal oleh judge  |
| `iom/chat/pdf-v1`            | 8/8   | 80/80  | Lulus penuh                               |
| **Total**                  | **19/20** | **146/147** |                                       |

Cakupan keamanan yang lulus: klasifikasi HR-only, konflik marker manual, prompt injection di dalam
dokumen, abstention saat evidence kurang, sitasi terotorisasi, precedence temporal
(`IOM-014/2014` sudah digantikan), serta batas HR/karyawan pada chat.

Satu kegagalan berasal dari metrik `no_invented_relation` untuk output `MANUAL_REVIEW` pada kasus
`overlap-pdf-hybrid-vs-security`. Re-run suite overlap menghasilkan variasi berbeda (2 kasus lain
gagal), termasuk judge yang alasan penjelasannya menyatakan `should pass` tetapi mengembalikan
`passed: false`. Ini variasi LLM judge, bukan regresi keamanan: model memilih abstain yang selalu
mengarah ke keputusan HR dan tidak mengarang relasi. Invariant keamanan deterministik tetap dijaga
oleh `pnpm test` (`quality-gates.test.ts`): release guard, citation authorization, overlap
confidence rendah/konflik tanpa provenance → `MANUAL_REVIEW`, dan publish-readiness.

Log mentah dan ringkasan: [`eval-all.log`](docs/evidence/eval-all.log),
[`eval-overlap-rerun.log`](docs/evidence/eval-overlap-rerun.log),
[`eval-summary.json`](docs/evidence/eval-summary.json).

## Penyimpanan berkas (Cloudflare R2)

Aplikasi berjalan dengan `STORAGE_DRIVER=r2`; bucket tetap privat dan setiap byte dibaca melalui API
dengan otorisasi yang sama. Verifikasi read-only terhadap seluruh 5 objek hasil skenario:

- semua objek ada di bucket (`5/5`),
- ukuran dan SHA-256 identik dengan catatan PostgreSQL (`5/5`),
- tidak ada salinan pada disk lokal (`0`).

Bukti lengkap per objek: [`r2-verification.json`](docs/evidence/r2-verification.json).

## Aplikasi

- `apps/platform`: React, Vite, TanStack Router, Anvia headless chat UI.
- `apps/api`: Hono, database sessions, RBAC, JSONL Client Protocol v3, SSE progress.
- `apps/worker`: OCR, klasifikasi, indexing, policy impact, dan overlap jobs.
- `packages/agents`: scoped Anvia agents/tools tanpa akses langsung ke Prisma atau environment.
- `packages/database`, `documents`, `contracts`, `config`, `ui`, `evals`: shared capabilities.

## Mulai lokal

1. Salin `.env.example` menjadi `.env` dan isi secret yang diperlukan.
2. Jalankan `docker compose up -d`.
3. Jalankan `pnpm install` dan `pnpm db:generate`.
4. Jalankan `pnpm db:migrate`, lalu buat akun pertama dengan `pnpm user:create`.
5. Jalankan seluruh aplikasi dengan `pnpm dev`.

Gunakan Node.js 22 atau lebih baru; `pdfjs-dist` 6 membutuhkan `Promise.withResolvers`.

Tidak ada password default. Seluruh root command memuat konfigurasi melalui `dotenv-cli`.

## Quality gates

```text
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Evaluasi model dijalankan manual (bukan CI release gate):

```text
pnpm eval:smoke          # 9 kasus smoke
pnpm eval:all            # 20 kasus lengkap
pnpm eval:observability  # probe trace ke Langfuse
pnpm eval:reset-corpus   # reset korpus development
```

Arsitektur, model keamanan, dan prosedur operasi berada di `docs/`.
