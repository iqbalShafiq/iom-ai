# Operations Runbook

## Bootstrap

Salin `.env.example` menjadi `.env`, isi OpenAI key dan cookie secret minimal 32 karakter. Default
`OPENAI_BASE_URL` adalah `https://api.openai.com/v1`; operator dapat menggantinya dengan endpoint
OpenAI-compatible yang sudah lulus smoke test streaming, tools, structured output, reasoning, error,
timeout, dan cancellation. Setelah itu jalankan:

```text
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm user:create
pnpm dev
```

API berjalan di port 3001, platform 5173, PostgreSQL 5432, dan Qdrant 6333. Jalankan API, worker,
dan platform sebagai tiga process/service terpisah di production.

`pnpm user:create` memakai kebijakan password yang sama dengan login: panjang 8–256 karakter.

Runtime mengunci classifier dan overlap ke `gpt-5.6-luna` di konfigurasi aplikasi; nilai model lama
di environment diabaikan agar tidak dapat mengubah model production. Katalog chat juga hanya
menyediakan model tersebut. Ketiga workload memakai reasoning `high` dan tidak mempunyai fallback
stub.

## Worker recovery

Job memakai lease dan heartbeat. Worker yang mati boleh langsung direstart; job `RUNNING` dengan
lease kedaluwarsa akan diambil worker lain. Error transient diulang maksimal tiga kali dengan
backoff. `DEAD_LETTER` tidak diulang otomatis: baca `lastErrorCode`, perbaiki akar masalah, lalu
gunakan retry dari dashboard/API agar idempotency key tetap dipertahankan.

Setiap slot worker hanya mengambil satu job dan langsung menjalankannya; job tidak boleh menunggu
di antrean memory setelah lease diambil. `INGEST_DOCUMENT`, `INDEX_VERSION`, dan `ANALYZE_OVERLAP`
yang terminal direkonsiliasi ke status user-facing saat startup. Kegagalan indexing tidak
membatalkan status published: file menjadi `FAILED` dan retry hanya menjadwalkan indexing ulang,
tanpa mengulang parsing/OCR/classification.

`WORKER_AI_TIMEOUT_MS` membatasi satu operasi model. Naikkan hanya berdasarkan ukuran dokumen dan
latency provider yang terukur; timeout tetap dianggap transient dan mengikuti bounded retry.

## Overlap resolution

`ANALYZE_OVERLAP` memproses seluruh logical page draft, menjalankan semantic dan lexical retrieval
dengan concurrency terbatas, lalu menyimpan metrics aman pada `OverlapRun`. Status run mengikuti
`QUEUED → RUNNING → COMPLETED|FAILED`; kegagalan retrieval atau model tidak boleh ditampilkan
sebagai zero overlap. `FAILED` dianalisis ulang dengan membuat run baru.

Keputusan HR final hanya dapat diubah sebelum candidate dipublish. `REPLACES` mengubah existing
menjadi `SUPERSEDED` pada transaksi publish; partial dan complement tidak menurunkan existing.
Jika migration menemukan keputusan manual lama, UI menampilkannya sebagai `PENDING_REVIEW` dan HR
wajib menyelesaikannya ulang. Backup PostgreSQL dilakukan sebelum migration overlap dan Qdrant tidak
pernah menjadi sumber kebenaran authorization.

## Policy rollout

Jangan mengaktifkan draft secara langsung. Jalankan impact analysis, selesaikan semua conflict dan
`NEEDS_REVIEW`, lalu aktifkan. Aktivasi memperbarui visibility/public text dan policy generation
dalam transaksi yang sama, kemudian mengantrikan reindex untuk version published. Selama reindex,
reauthorization PostgreSQL menolak vector generation lama.

## Backup dan restore

Backup PostgreSQL dan storage original sebagai satu recovery unit. Qdrant boleh dibangun ulang dari
PostgreSQL/chunks dengan job indexing. Verifikasi checksum original setelah restore. AuditEvent
append-only tidak boleh dipangkas tanpa retention policy formal.

Migration `upload_pipeline_hardening` memeriksa duplicate SHA-256 sebelum membuat unique index dan
akan gagal dengan pesan eksplisit bila data lama mengandung duplikat. Selesaikan duplikat melalui
prosedur data-governance yang menjaga audit trail; jangan menghapus record otomatis.

Migration `page_chunking` menandai versi lama sebagai `LEGACY_SECTION`; versi yang baru diproses
memakai `PAGE`. Versi published lama tidak diubah diam-diam karena rechunking juga mengubah unit
review kerahasiaan dan citation. Migrasikan corpus lama melalui upload revision/reingestion yang
melewati classification dan persetujuan HR lagi, lalu publish dan supersede melalui flow normal.

## Incident kerahasiaan

1. Nonaktifkan akses platform/API atau scope terdampak.
2. Archive/supersede version yang bocor dan revoke active sessions bila perlu.
3. Simpan correlation ID, audit event, policy version, model, dan authorized source IDs.
4. Perbarui versioned safety fixture; jangan masukkan payload confidential ke generic log.
5. Reclassify, review, activate policy baru, reindex, lalu jalankan seluruh quality gates.
