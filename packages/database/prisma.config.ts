import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    // Generation does not need a live database. Runtime configuration still fails fast in @iom/config.
    url: process.env.DATABASE_URL ?? "postgresql://iom:iom@localhost:5432/iom",
  },
});
