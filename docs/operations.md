# Operations Runbook

## Bootstrap

Salin `.env.example` menjadi `.env`, isi OpenAI key dan cookie secret minimal 32 karakter, lalu:

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

## Worker recovery

Job memakai lease dan heartbeat. Worker yang mati boleh langsung direstart; job `RUNNING` dengan
lease kedaluwarsa akan diambil worker lain. Error transient diulang maksimal tiga kali dengan
backoff. `DEAD_LETTER` tidak diulang otomatis: baca `lastErrorCode`, perbaiki akar masalah, lalu
gunakan retry dari dashboard/API agar idempotency key tetap dipertahankan.

## Policy rollout

Jangan mengaktifkan draft secara langsung. Jalankan impact analysis, selesaikan semua conflict dan
`NEEDS_REVIEW`, lalu aktifkan. Aktivasi memperbarui visibility/public text dan policy generation
dalam transaksi yang sama, kemudian mengantrikan reindex untuk version published. Selama reindex,
reauthorization PostgreSQL menolak vector generation lama.

## Backup dan restore

Backup PostgreSQL dan storage original sebagai satu recovery unit. Qdrant boleh dibangun ulang dari
PostgreSQL/chunks dengan job indexing. Verifikasi checksum original setelah restore. AuditEvent
append-only tidak boleh dipangkas tanpa retention policy formal.

## Incident kerahasiaan

1. Nonaktifkan akses platform/API atau scope terdampak.
2. Archive/supersede version yang bocor dan revoke active sessions bila perlu.
3. Simpan correlation ID, audit event, policy version, model, dan authorized source IDs.
4. Perbarui versioned safety fixture; jangan masukkan payload confidential ke generic log.
5. Reclassify, review, activate policy baru, reindex, lalu jalankan seluruh quality gates.
