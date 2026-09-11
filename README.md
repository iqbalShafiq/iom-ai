# Ruang IOM — HR Regulation Assistant

Monorepo TypeScript untuk batch ingestion, review kerahasiaan berbantuan AI, versioning temporal,
hybrid overlap analysis, dan chat IOM berbasis evidence yang terotorisasi.

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

Tidak ada password default. Seluruh root command memuat konfigurasi melalui `dotenv-cli`.

## Quality gates

```text
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Arsitektur, model keamanan, dan prosedur operasi berada di `docs/`.
