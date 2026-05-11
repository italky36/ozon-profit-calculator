import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  emailVerificationTokens,
  sessions,
  users,
} from "../db/schema";

const BCRYPT_ROUNDS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Cryptographically random hex token (32 bytes → 64 hex chars). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export interface SessionInfo {
  sessionId: string;
  expiresAt: Date;
}

export function createSession(db: DB, userId: number): SessionInfo {
  const sessionId = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      expiresAt,
      createdAt: now,
    })
    .run();
  return { sessionId, expiresAt };
}

export interface SessionUser {
  id: number;
  email: string;
  role: "admin" | "user";
  isVerified: boolean;
}

/** Validates a session token. Returns the associated user, or null if the
 * session is missing/expired. Expired sessions are deleted lazily. */
export function validateSession(db: DB, sessionId: string): SessionUser | null {
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      isBlocked: users.isBlocked,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }
  if (row.isBlocked) {
    // Defence-in-depth: even if sessions weren't revoked at block time
    // (e.g. due to a race), a blocked user must not pass auth.
    return null;
  }
  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    isVerified: row.isVerified,
  };
}

export function deleteSession(db: DB, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export interface VerificationTokenInfo {
  token: string;
  expiresAt: Date;
}

export function createVerificationToken(
  db: DB,
  userId: number,
): VerificationTokenInfo {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
  db.insert(emailVerificationTokens)
    .values({ token, userId, expiresAt, createdAt: now })
    .run();
  return { token, expiresAt };
}

/** Consumes a verification token: validates expiry, deletes it, returns userId. */
export function consumeVerificationToken(
  db: DB,
  token: string,
): { userId: number } | null {
  const row = db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .get();
  if (!row) return null;
  db.delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .run();
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}
