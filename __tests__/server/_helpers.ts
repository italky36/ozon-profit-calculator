import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
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
import { ensureDefaultChannel } from "../../server/chat/defaultChannel";
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

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:dev_password_change_me@localhost:5433/ozon_calc_test";

export type DB = NodePgDatabase<typeof schema>;

export interface TestEnv {
  app: ReturnType<typeof buildApp>;
  db: DB;
  pool: pg.Pool;
  emails: EmailMessage[];
}

let cachedPool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!cachedPool) {
    cachedPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  }
  return cachedPool;
}

/** Список таблиц для TRUNCATE между тестами. Порядок не важен, потому что
 *  RESTART IDENTITY CASCADE сама разруливает FK. ref_* НЕ чистим — тесты
 *  не зависят от их содержимого (тесты, использующие ref_*, заполняют их
 *  сами при необходимости). */
const TRUNCATE_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "shops",
  "shop_member",
  "shop_user_settings",
  "products",
  "finance_transactions",
  "import_runs",
  "logistics_cluster_tariff_sets",
  "logistics_cluster_tariffs",
  "sessions",
  "email_verification_tokens",
  "password_reset_tokens",
  "user_settings",
  "smtp_settings",
  "chat_channels",
  "chat_channel_members",
  "chat_messages",
  "chat_channel_reads",
  "chat_message_reactions",
  "chat_message_mentions",
  "chat_attachments",
  "chat_calls",
  "chat_call_participants",
  "push_subscriptions",
  "vapid_settings",
  "ice_servers",
  "ref_settings",
  "ref_commissions",
  "ref_storage",
  "ref_logistics_tariffs",
];

/** Подготовить чистую базу + Hono-app + захват email'ов. */
export async function setupTestEnv(): Promise<TestEnv> {
  const pool = getPool();
  const db = drizzle(pool, { schema });

  // TRUNCATE всех таблиц — быстро и не требует пересоздания схемы.
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );

  const emails: EmailMessage[] = [];
  const mock: EmailClient = {
    async send(msg) {
      emails.push(msg);
    },
  };
  setEmailClient(mock);

  const app = buildApp({ db });
  return { app, db, pool, emails };
}

export async function teardownTestEnv(_env: TestEnv): Promise<void> {
  setEmailClient(null);
  // Pool остаётся жив между тестами — закрытие в afterAll глобально (см. vitest globalTeardown).
}

/** Insert a verified user directly + auto-create their personal workspace as
 * owner. Returns the user id. The legacy `role` arg ("admin"|"user") still
 * exists for ergonomic test setup; "admin" maps to is_sysadmin=true. */
export async function createUserDirect(
  db: DB,
  email: string,
  password: string,
  role: "admin" | "user" = "user",
): Promise<number> {
  const now = new Date();
  const hash = bcrypt.hashSync(password, 4);
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: hash,
      isSysadmin: role === "admin",
      isVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id });
  const userId = u.id;
  const prefix = email.split("@")[0];
  const slug = `${prefix.replace(/\./g, "-").toLowerCase()}-${userId}`;
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: `Workspace ${prefix}`,
      slug,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: workspaces.id });
  await db.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId,
    role: "owner",
    status: "active",
    createdAt: now,
  });
  await ensureDefaultChannel(db, ws.id, userId, now);
  return userId;
}

/** Look up the user's single workspace id. */
export async function workspaceIdOf(db: DB, userId: number): Promise<number> {
  const [row] = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  if (!row) throw new Error(`no workspace for user ${userId}`);
  return row.id;
}

/** Create a shop in `userId`'s workspace with SAMPLE_TAX and set it as
 * active. Returns the shop's id. */
export async function createShopFor(
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
): Promise<number> {
  const now = new Date();
  const workspaceId = await workspaceIdOf(db, userId);
  const [inserted] = await db
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
    .returning({ id: shops.id });
  const [settings] = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (settings) {
    await db
      .update(userSettings)
      .set({ activeShopId: inserted.id, updatedAt: now })
      .where(eq(userSettings.userId, userId));
  } else {
    await db
      .insert(userSettings)
      .values({ userId, activeShopId: inserted.id, updatedAt: now });
  }
  return inserted.id;
}

/** Issue POST /api/auth/login and return Set-Cookie session token. */
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

/** Convenience: create user + workspace + default shop + login. */
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
  const [existing] = await env.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  let userId: number;
  let shopId: number;
  if (existing) {
    userId = existing.id;
    const wsId = await workspaceIdOf(env.db, userId);
    const [existingShop] = await env.db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.workspaceId, wsId));
    shopId = existingShop?.id ?? (await createShopFor(env.db, userId));
  } else {
    userId = await createUserDirect(env.db, email, password, role);
    shopId = await createShopFor(env.db, userId);
  }
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
    workspaceId: await workspaceIdOf(env.db, userId),
  };
}

/** Sync admin-cookie path for legacy tests. */
export async function adminSessionCookie(env: TestEnv): Promise<string> {
  const userId = await createUserDirect(
    env.db,
    "test-admin@example.com",
    "password",
    "admin",
  );
  await createShopFor(env.db, userId);
  const sessionId = "test-admin-session";
  await env.db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    createdAt: new Date(),
  });
  return `ozon_calc_sysadmin_session=${sessionId}`;
}
