import { createDatabase } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const database = createDatabase(databaseUrl);
// Akun dan policy sengaja tidak memiliki default credential. Jalankan `pnpm user:create`,
// kemudian buat policy pertama melalui dashboard agar actor audit-nya valid.
await database.$disconnect();
