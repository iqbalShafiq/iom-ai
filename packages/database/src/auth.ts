import { createHash, randomBytes } from "node:crypto";
import type { Database } from "./index.js";

const SESSION_BYTES = 32;
const SESSION_DAYS = 7;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(database: Database, userId: string) {
  const token = randomBytes(SESSION_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1_000);
  const session = await database.authSession.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });
  return { token, session };
}

export async function resolveSession(database: Database, token: string) {
  const session = await database.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  void database.authSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return session;
}

export async function revokeSession(database: Database, token: string): Promise<void> {
  await database.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
