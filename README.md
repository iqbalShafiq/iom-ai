# IOM HR Regulation Assistant

Monorepo TypeScript untuk ingestion, review kerahasiaan, versioning, overlap analysis, dan
chat regulasi IOM berbasis bukti.

## Mulai lokal

1. Salin `.env.example` menjadi `.env` dan isi secret yang diperlukan.
2. Jalankan `docker compose up -d`.
3. Jalankan `pnpm install` dan `pnpm db:generate`.
4. Jalankan `pnpm db:migrate`, lalu buat akun pertama dengan `pnpm user:create`.
5. Jalankan seluruh aplikasi dengan `pnpm dev`.

Seluruh root command memuat konfigurasi melalui `dotenv-cli`. Lihat dokumentasi operasi di
`docs/` setelah setiap milestone implementasi.

