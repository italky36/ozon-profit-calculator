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

/** Insert a verified user directly + auto-create their personal workspace as
 * owner. Returns the user id. The legacy `role` arg ("admin"|"user") still
 * exists for ergonomic test setup; "admin" maps to is_sysadmin=true. */
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

/** Look up the user's single workspace id. */
export function workspaceIdOf(db: DB, userId: number): number {
  const row = db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .get();
  if (!row) throw new Error(`no workspace for user ${userId}`);
  return row.id;
}

/** Create a shop in `userId`'s workspace with SAMPLE_TAX and set it as
 * active. Returns the shop's id. */
export function createShopFor(
  db: DB,
  userId: number,
  opts: {
    name?: string;
    shortName?: string;
    color?: string | null;
    /** Who creates the shop (sets `shops.created_by`). Defaults to `userId`
     * — meaning «this is `userId`'s own shop». Pass a different id to model
     * a shop created by another team member. */
    createdBy?: number;
  } = {},
): number {
  const now = new Date();
  const workspaceId = workspaceIdOf(db, userId);
  const inserted = db
    .insert(shops)
    .values({
      workspaceId,
      name: opts.name ?? "Тестовый магазин",
      shortName: opts.shortName ?? `T${userId % 9}`,
      color: opts.color ?? null,
      taxSettings: SAMPLE_TAX,
      autoRefreshEnabled: false,
      autoRefreshIntervalMin: 30,
      createdBy: opts.createdBy ?? userId,
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

/** Issue POST /api/auth/login and return Set-Cookie session token.
 * `scope` chooses which cookie/auth-scope the server returns; "sysadmin" sets
 * the sysadmin cookie and is required when `email` is a sysadmin account. */
export async function loginAndGetCookie(
  app: TestEnv["app"],
  email: string,
  password: string,
  scope: "workspace" | "sysadmin" = "workspace",
): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Scope": scope,
    },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200)
    throw new Error(`login ${res.status}: ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on login response");
  const cookieValue = setCookie.split(";")[0];
  if (!cookieValue) throw new Error("could not parse cookie");
  return cookieValue;
}

/** Convenience: create user + workspace + default shop + login → return
 * cookie & ids + workspaceId. */
export async function loginAs(
  env: TestEnv,
  email: string,
  password: string,
  role: "admin" | "user" = "user",
): Promise<{
  cookie: string;
  userId: number;
  shopId: number;
  workspaceId: number;
}> {
  const existing = env.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  let userId: number;
  let shopId: number;
  if (existing) {
    userId = existing.id;
    const wsId = workspaceIdOf(env.db, userId);
    const existingShop = env.db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.workspaceId, wsId))
      .get();
    shopId = existingShop?.id ?? createShopFor(env.db, userId);
  } else {
    userId = createUserDirect(env.db, email, password, role);
    shopId = createShopFor(env.db, userId);
  }
  // Admins log in via the sysadmin scope (sets the sysadmin cookie); regular
  // users via the workspace scope.
  const cookie = await loginAndGetCookie(
    env.app,
    email,
    password,
    role === "admin" ? "sysadmin" : "workspace",
  );
  return {
    cookie,
    userId,
    shopId,
    workspaceId: workspaceIdOf(env.db, userId),
  };
}

/** Sync admin-cookie path for legacy tests. Returns the sysadmin cookie since
 * the workspace cookie now refuses to resolve a sysadmin user. */
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
  return `ozon_calc_sysadmin_session=${sessionId}`;
}
