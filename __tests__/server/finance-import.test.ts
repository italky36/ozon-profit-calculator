import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../server/db/schema";
import { financeTransactions, sessions } from "../../server/db/schema";
import { buildApp } from "../../server/index";
import { runFinanceImport } from "../../server/routes/import";
import type { OzonClient } from "../../server/ozon/client";
import fixture from "../fixtures/ozon-finance.json" with { type: "json" };
import { createShopFor, createUserDirect, workspaceIdOf } from "./_helpers";

const makeMockClient = (): OzonClient => ({
  async post<T>(endpoint: string): Promise<T> {
    if (endpoint === "/v3/finance/transaction/list") return fixture as T;
    throw new Error(`unmocked endpoint: ${endpoint}`);
  },
});

interface TestEnv {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  cookie: string;
  userId: number;
  workspaceId: number;
  shopId: number;
}

const setupDb = (): TestEnv => {
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
  const userId = createUserDirect(db, "owner@test.local", "password", "user");
  const shopId = createShopFor(db, userId);
  const workspaceId = workspaceIdOf(db, userId);
  const sessionId = "test-finance-session";
  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
    })
    .run();
  return {
    db,
    sqlite,
    cookie: `ozon_calc_session=${sessionId}`,
    userId,
    workspaceId,
    shopId,
  };
};

const FILTER = { from: "2026-04-01T00:00:00.000Z", to: "2026-04-30T23:59:59.999Z" };

describe("runFinanceImport", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupDb();
  });
  afterEach(() => env.sqlite.close());

  it("inserts transactions classified by operation_type", async () => {
    const counters = await runFinanceImport(env.db, makeMockClient(), env.shopId, env.workspaceId, env.userId, FILTER);
    expect(counters.inserted).toBe(7);
    expect(counters.skipped).toBe(0);

    const rows = env.db.select().from(financeTransactions).all();
    expect(rows).toHaveLength(7);

    const byId = new Map(rows.map((r) => [r.operationId, r]));
    expect(byId.get(1001)?.type).toBe("sale");
    expect(byId.get(1002)?.type).toBe("last_mile");
    expect(byId.get(1003)?.type).toBe("logistics");
    expect(byId.get(1004)?.type).toBe("storage");
    expect(byId.get(1005)?.type).toBe("refund");
    expect(byId.get(1006)?.type).toBe("commission");
    expect(byId.get(1007)?.type).toBe("other");

    expect(byId.get(1001)?.articleId).toBe("OFFER-1");
    expect(byId.get(1001)?.amount).toBe(337000);
    expect(byId.get(1006)?.articleId).toBeNull(); // empty items array
  });

  it("is idempotent on repeat run (INSERT OR IGNORE)", async () => {
    await runFinanceImport(env.db, makeMockClient(), env.shopId, env.workspaceId, env.userId, FILTER);
    const before = env.db.select().from(financeTransactions).all();

    const second = await runFinanceImport(env.db, makeMockClient(), env.shopId, env.workspaceId, env.userId, FILTER);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(7);

    const after = env.db.select().from(financeTransactions).all();
    expect(after).toHaveLength(before.length);
  });
});

describe("finance import route + finance API", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupDb();
  });
  afterEach(() => env.sqlite.close());

  const headers = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  it("POST /api/import/finance runs and completes", async () => {
    const app = buildApp({
      db: env.db,
      importContext: { ozonClient: makeMockClient() },
    });
    const res = await app.request("/api/import/finance", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify({ from: "2026-04-01", to: "2026-04-30" }),
    });
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: number };

    let final: { status: string; itemsProcessed: number } | null = null;
    for (let i = 0; i < 20; i++) {
      const r = await app.request(`/api/import/runs/${runId}`, { headers: headers(env.cookie) });
      const body = (await r.json()) as { status: string; itemsProcessed: number };
      if (body.status !== "running") {
        final = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(final?.status).toBe("ok");
    expect(final?.itemsProcessed).toBe(7);
  });

  it("rejects bad date format with 400", async () => {
    const app = buildApp({
      db: env.db,
      importContext: { ozonClient: makeMockClient() },
    });
    const res = await app.request("/api/import/finance", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify({ from: "yesterday", to: "today" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/finance/transactions returns rows + filters by type", async () => {
    await runFinanceImport(env.db, makeMockClient(), env.shopId, env.workspaceId, env.userId, FILTER);
    const app = buildApp({ db: env.db });

    const all = await app.request("/api/finance/transactions", { headers: headers(env.cookie) });
    expect(all.status).toBe(200);
    const allRows = (await all.json()) as Array<{ type: string }>;
    expect(allRows).toHaveLength(7);

    const sales = await app.request(
      "/api/finance/transactions?type=sale",
      { headers: headers(env.cookie) },
    );
    const saleRows = (await sales.json()) as Array<{ type: string }>;
    expect(saleRows).toHaveLength(1);
    expect(saleRows[0].type).toBe("sale");
  });

  it("GET /api/finance/summary aggregates by type", async () => {
    await runFinanceImport(env.db, makeMockClient(), env.shopId, env.workspaceId, env.userId, FILTER);
    const app = buildApp({ db: env.db });
    const res = await app.request("/api/finance/summary", { headers: headers(env.cookie) });
    const summary = (await res.json()) as Array<{
      type: string;
      count: number;
      total: number;
    }>;
    const byType = new Map(summary.map((s) => [s.type, s]));
    expect(byType.get("sale")?.count).toBe(1);
    expect(byType.get("sale")?.total).toBe(337000);
    expect(byType.get("storage")?.total).toBe(-150);
    expect(byType.get("refund")?.total).toBe(-5000);
  });
});
