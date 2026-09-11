import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { passwordSchema } from "@iom/contracts";
import argon2 from "argon2";
import { createDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const email = (await terminal.question("Email: ")).trim().toLowerCase();
  const name = (await terminal.question("Nama: ")).trim();
  const roleInput = (await terminal.question("Role (EMPLOYEE/HR_ADMIN): ")).trim().toUpperCase();
  const password = await terminal.question("Password (input visible): ");
  if (roleInput !== "EMPLOYEE" && roleInput !== "HR_ADMIN") throw new Error("Role tidak valid.");
  if (!passwordSchema.safeParse(password).success)
    throw new Error("Password harus 8-256 karakter.");

  const database = createDatabase(databaseUrl);
  await database.user.create({
    data: {
      email,
      name,
      role: roleInput,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  await database.$disconnect();
  stdout.write(`Akun ${email} berhasil dibuat.\n`);
} finally {
  terminal.close();
}
