import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../../server/db/schema";
import { sessions, userSettings, users } from "../../server/db/schema";
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
  db.insert(userSettings)
    .values({ id: 1, taxSettings: SAMPLE_TAX, updatedAt: new Date() })
    .run();

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

/** Insert a verified user directly. Returns id. */
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
      isVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get();
  return result.id;
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

/** Convenience: create user + login → return cookie. */
export async function loginAs(
  env: TestEnv,
  email: string,
  password: string,
  role: "admin" | "user" = "user",
): Promise<{ cookie: string; userId: number }> {
  const existing = env.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  const userId = existing
    ? existing.id
    : createUserDirect(env.db, email, password, role);
  const cookie = await loginAndGetCookie(env.app, email, password);
  return { cookie, userId };
}

/** Sync admin-cookie path for legacy tests: creates admin user + inserts a
 * session row directly. Avoids the bcrypt cost of going through /login. */
export function adminSessionCookie(env: TestEnv): string {
  const userId = createUserDirect(
    env.db,
    "test-admin@example.com",
    "password",
    "admin",
  );
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
