import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../../server/db/schema";
import {
  sessions,
  shops,
  userSettings,
  users,
  workspaceMembers,
  workspaces,
} from "../../server/db/schema";
import { buildApp } from "../../server/index";
import { setEmailClient, type EmailClient, type EmailMessage } from "../../server/email/client";
import type { TaxSettings } from "../../src/types";

export const SAMPLE_TAX: TaxSettings = {
  damageRate: 0.01,
  taxSystem: "УСН Доходы минус расходы",
  usnIncomeRate: 0.06,
  usnIncomeMinusRate: 0.07,
  ausnIncomeRate: 0.08,
  ausnIncomeMinusRate: 0.2,
  osnoOooRate: 0.25,
  osnoIpAnnualIncome: 2400000,
  npdRate: 0.04,
  partyExtraExpenses: 100,
};

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export interface TestEnv {
  app: ReturnType<typeof buildApp>;
  db: DB;
  sqlite: Database.Database;
  emails: EmailMessage[];
}

/** Apply all migrations + seed tax settings. Mirrors `openDb` runtime path
 * but in :memory: for fast isolation between tests. */
export function setupTestEnv(): TestEnv {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = path.resolve(import.meta.dirname, "../../server/db/migrations");
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  const db = drizzle(sqlite, { schema });
  // Per-user settings rows are created lazily on first GET /api/settings via
  // ensureUserRow. Tests that exercise tax settings should login first; that
  // path will seed the user's row.

  const emails: EmailMessage[] = [];
  const mock: EmailClient = {
    async send(msg) {
      emails.push(msg);
    },
  };
  setEmailClient(mock);

  const app = buildApp({ db });
  return { app, db, sqlite, emails };
}

export function teardownTestEnv(env: TestEnv): void {
  setEmailClient(null);
  env.sqlite.close();
}

/** Insert a verified user directly + auto-create their personal workspace
 * (Stage 1: each user has exactly one workspace). Returns the user id. */
export function createUserDirect(
  db: DB,
  email: string,
  password: string,
  role: "admin" | "user" = "user",
): number {
  const now = new Date();
  const hash = bcrypt.hashSync(password, 4);
  const result = db
    .insert(users)
    .values({
      email,
      passwordHash: hash,
      role,
      isSysadmin: role === "admin",
      isVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get();
  const userId = result.id;
  const prefix = email.split("@")[0];
  const slug = `${prefix.replace(/\./g, "-").toLowerCase()}-${userId}`;
  const ws = db
    .insert(workspaces)
    .values({
      name: `Workspace ${prefix}`,
      slug,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: workspaces.id })
    .get();
  db.insert(workspaceMembers)
    .values({
      workspaceId: ws.id,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
    })
    .run();
  return userId;
}

/** Look up the user's single workspace id (Stage 1 invariant). */
export function workspaceIdOf(db: DB, userId: number): number {
  const row = db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .get();
  if (!row) throw new Error(`no workspace for user ${userId}`);
  return row.id;
}

/** Create a shop for `userId` with SAMPLE_TAX and set it as active. Returns the
 * shop's id. Used by tests that need a user with a default shop (multi-shop
 * model requires every user to have ≥1 shop). */
export function createShopFor(
  db: DB,
  userId: number,
  opts: { name?: string; shortName?: string; color?: string | null } = {},
): number {
  const now = new Date();
  const workspaceId = workspaceIdOf(db, userId);
  const inserted = db
    .insert(shops)
    .values({
      userId,
      workspaceId,
      name: opts.name ?? "Тестовый магазин",
      shortName: opts.shortName ?? `T${userId % 9}`,
      color: opts.color ?? null,
      taxSettings: SAMPLE_TAX,
      autoRefreshEnabled: false,
      autoRefreshIntervalMin: 30,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: shops.id })
    .get();
  const settings = db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  if (settings) {
    db.update(userSettings)
      .set({ activeShopId: inserted.id, updatedAt: now })
      .where(eq(userSettings.userId, userId))
      .run();
  } else {
    db.insert(userSettings)
      .values({ userId, activeShopId: inserted.id, updatedAt: now })
      .run();
  }
  return inserted.id;
}

/** Issue POST /api/auth/login and return Set-Cookie session token. */
export async function loginAndGetCookie(
  app: TestEnv["app"],
  email: string,
  password: string,
): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200)
    throw new Error(`login ${res.status}: ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on login response");
  const match = /(?:^|;\s*|,\s*)([A-Za-z0-9_-]+=[^;]+)(?:;|$)/.exec(setCookie);
  // Hono sets ozon_calc_session=<value>; HttpOnly; ... — extract first kv pair
  const cookieValue = setCookie.split(";")[0];
  if (!cookieValue) throw new Error("could not parse cookie");
  void match;
  return cookieValue; // "ozon_calc_session=..."
}

/** Convenience: create user + default shop + login → return cookie & ids.
 * Multi-shop model requires every authenticated user to have ≥1 shop, so a
 * fresh user gets one automatically (mirrors the verifyEmail path). */
export async function loginAs(
  env: TestEnv,
  email: string,
  password: string,
  role: "admin" | "user" = "user",
): Promise<{ cookie: string; userId: number; shopId: number }> {
  const existing = env.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  let userId: number;
  let shopId: number;
  if (existing) {
    userId = existing.id;
    const existingShop = env.db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.userId, userId))
      .get();
    shopId = existingShop?.id ?? createShopFor(env.db, userId);
  } else {
    userId = createUserDirect(env.db, email, password, role);
    shopId = createShopFor(env.db, userId);
  }
  const cookie = await loginAndGetCookie(env.app, email, password);
  return { cookie, userId, shopId };
}

/** Sync admin-cookie path for legacy tests: creates admin user + default
 * shop + inserts a session row directly. Avoids the bcrypt cost of /login.
 * Returns `cookie` only for backwards compatibility; call sites that need
 * shopId/userId should use loginAs instead. */
export function adminSessionCookie(env: TestEnv): string {
  const userId = createUserDirect(
    env.db,
    "test-admin@example.com",
    "password",
    "admin",
  );
  createShopFor(env.db, userId);
  const sessionId = "test-admin-session";
  env.db
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
    })
    .run();
  return `ozon_calc_session=${sessionId}`;
}
