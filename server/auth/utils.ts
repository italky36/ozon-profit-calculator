import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "../db/schema";

const BCRYPT_ROUNDS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export async function createSession(
  db: DB,
  userId: number,
): Promise<SessionInfo> {
  const sessionId = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
    createdAt: now,
  });
  return { sessionId, expiresAt };
}

export type WorkspaceRole = "owner" | "manager" | "member";

export interface SessionUser {
  id: number;
  email: string;
  isSysadmin: boolean;
  isVerified: boolean;
  fullName: string;
  jobTitle: string | null;
  avatarDataUrl: string | null;
  /** The user's single workspace (Stage 2 invariant). 0 means «not yet
   * assigned» — used during registration before workspace creation; routes
   * that scope by workspace will reject with 403 until the user has one. */
  workspaceId: number;
  workspaceRole: WorkspaceRole;
}

/** Validates a session token. Returns the associated user, or null if the
 * session is missing/expired. Expired sessions are deleted lazily. */
export async function validateSession(
  db: DB,
  sessionId: string,
): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      isSysadmin: users.isSysadmin,
      isVerified: users.isVerified,
      isBlocked: users.isBlocked,
      fullName: users.fullName,
      jobTitle: users.jobTitle,
      avatarDataUrl: users.avatarDataUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId));

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  if (row.isBlocked) {
    // Defence-in-depth: even if sessions weren't revoked at block time
    // (e.g. due to a race), a blocked user must not pass auth.
    return null;
  }

  const [member] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, row.userId));

  // Suspended workspace: lock out everyone except sysadmins (who don't belong
  // to a workspace anyway). Mirrors the isBlocked branch above — same intent,
  // different scope.
  if (!row.isSysadmin && member) {
    const [ws] = await db
      .select({ suspendedAt: workspaces.suspendedAt })
      .from(workspaces)
      .where(eq(workspaces.id, member.workspaceId));
    if (ws?.suspendedAt) return null;
  }

  return {
    id: row.userId,
    email: row.email,
    isSysadmin: row.isSysadmin,
    isVerified: row.isVerified,
    fullName: row.fullName,
    jobTitle: row.jobTitle,
    avatarDataUrl: row.avatarDataUrl,
    workspaceId: member?.workspaceId ?? 0,
    workspaceRole: member?.role ?? "member",
  };
}

export async function deleteSession(
  db: DB,
  sessionId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export interface VerificationTokenInfo {
  token: string;
  expiresAt: Date;
}

export async function createVerificationToken(
  db: DB,
  userId: number,
): Promise<VerificationTokenInfo> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
  await db
    .insert(emailVerificationTokens)
    .values({ token, userId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

/** Consumes a verification token: validates expiry, deletes it, returns userId. */
export async function consumeVerificationToken(
  db: DB,
  token: string,
): Promise<{ userId: number } | null> {
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token));
  if (!row) return null;
  await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token));
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}

export interface PasswordResetTokenInfo {
  token: string;
  expiresAt: Date;
}

/** Issues a single-use password-reset token. Any previous unused tokens for
 * the same user are invalidated (marked used) so the latest «forgot password»
 * always supersedes earlier attempts. */
export async function createPasswordResetToken(
  db: DB,
  userId: number,
): Promise<PasswordResetTokenInfo> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.usedAt),
      ),
    );
  await db
    .insert(passwordResetTokens)
    .values({ token, userId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

export type PasswordResetTokenStatus =
  | { ok: true; userId: number }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** Validates a reset token without consuming it. Use for the GET probe before
 * showing the «new password» form. */
export async function checkPasswordResetToken(
  db: DB,
  token: string,
): Promise<PasswordResetTokenStatus> {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token));
  if (!row) return { ok: false, reason: "not_found" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now())
    return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

/** Marks a reset token as used. Idempotent: re-marking a used token is a no-op. */
export async function consumePasswordResetToken(
  db: DB,
  token: string,
): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.token, token));
}
