import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../server/db/schema";
import { financeTransactions, sessions } from "../../server/db/schema";
import { buildApp } from "../../server/index";
import { createShopFor, createUserDirect, workspaceIdOf } from "./_helpers";


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

  const adminId = createUserDirect(db, "admin@test.local", "password", "admin");
  const shopId = createShopFor(db, adminId);
  const workspaceId = workspaceIdOf(db, adminId);
  const sessionId = "test-analytics-session";
  db.insert(sessions)
    .values({
      id: sessionId,
      userId: adminId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
    })
    .run();
  return {
    db,
    sqlite,
    cookie: `ozon_calc_session=${sessionId}`,
    userId: adminId,
    workspaceId,
    shopId,
  };
};

interface Tx {
  operation_id: number;
  operation_type: string;
  operation_date: string;
  posting_number: string | null;
  article_id: string | null;
  amount: number;
  type: string;
}

const seedTx = (env: TestEnv, list: Tx[]) => {
  for (const t of list) {
    env.db
      .insert(financeTransactions)
      .values({
        shopId: env.shopId,
        workspaceId: env.workspaceId,
        operationId: t.operation_id,
        operationType: t.operation_type,
        operationDate: new Date(t.operation_date),
        postingNumber: t.posting_number,
        articleId: t.article_id,
        amount: t.amount,
        type: t.type,
        raw: { _seeded: true },
      })
      .run();
  }
};

describe("/api/analytics/realized-margin", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupDb();
  });
  afterEach(() => env.sqlite.close());

  it("aggregates by articleId with correct breakdown and net margin", async () => {
    seedTx(env, [
      // OFFER-1: 2 sales (337k each), one last_mile fee, one logistics, one storage
      { operation_id: 1, operation_type: "OperationAgentDeliveredToCustomer", operation_date: "2026-04-10T00:00:00.000Z", posting_number: "p1", article_id: "OFFER-1", amount: 337000, type: "sale" },
      { operation_id: 2, operation_type: "OperationAgentDeliveredToCustomer", operation_date: "2026-04-12T00:00:00.000Z", posting_number: "p2", article_id: "OFFER-1", amount: 337000, type: "sale" },
      { operation_id: 3, operation_type: "MarketplaceServiceItemDelivToCustomer", operation_date: "2026-04-12T00:01:00.000Z", posting_number: "p2", article_id: "OFFER-1", amount: -3400, type: "last_mile" },
      { operation_id: 4, operation_type: "MarketplaceServiceItemDirectFlowTrans", operation_date: "2026-04-13T00:00:00.000Z", posting_number: null, article_id: "OFFER-1", amount: -1200, type: "logistics" },
      { operation_id: 5, operation_type: "OperationMarketplaceServiceStorage", operation_date: "2026-04-15T00:00:00.000Z", posting_number: null, article_id: "OFFER-1", amount: -150, type: "storage" },
      // OFFER-2: 1 sale, 1 refund
      { operation_id: 6, operation_type: "OperationAgentDeliveredToCustomer", operation_date: "2026-04-11T00:00:00.000Z", posting_number: "p3", article_id: "OFFER-2", amount: 5000, type: "sale" },
      { operation_id: 7, operation_type: "ClientReturnAgentOperation", operation_date: "2026-04-20T00:00:00.000Z", posting_number: "p3", article_id: "OFFER-2", amount: -5000, type: "refund" },
      // Operation outside the period
      { operation_id: 8, operation_type: "OperationAgentDeliveredToCustomer", operation_date: "2026-03-01T00:00:00.000Z", posting_number: "p9", article_id: "OFFER-1", amount: 9999, type: "sale" },
      // Operation without articleId — should be excluded
      { operation_id: 9, operation_type: "MarketplaceRedistributionOfAcquiringOperation", operation_date: "2026-04-22T00:00:00.000Z", posting_number: null, article_id: null, amount: -100, type: "commission" },
    ]);

    const app = buildApp({ db: env.db });
    const res = await app.request(
      "/api/analytics/realized-margin?from=2026-04-01&to=2026-04-30T23:59:59.999Z",
      { headers: { Cookie: env.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      period: { from: string; to: string };
      rows: Array<{
        articleId: string;
        actualRevenue: number;
        actualRefund: number;
        actualLastMile: number;
        actualLogistics: number;
        actualStorage: number;
        actualMargin: number;
        salesCount: number;
        txCount: number;
      }>;
    };
    expect(body.period.from).toMatch(/^2026-04-01/);
    const byArticle = new Map(body.rows.map((r) => [r.articleId, r]));
    expect(byArticle.size).toBe(2);

    const o1 = byArticle.get("OFFER-1")!;
    expect(o1.actualRevenue).toBe(674000); // 2 × 337000
    expect(o1.actualLastMile).toBe(-3400);
    expect(o1.actualLogistics).toBe(-1200);
    expect(o1.actualStorage).toBe(-150);
    expect(o1.salesCount).toBe(2);
    expect(o1.txCount).toBe(5);
    // net = 674000 - 3400 - 1200 - 150 = 669250
    expect(o1.actualMargin).toBe(669250);

    const o2 = byArticle.get("OFFER-2")!;
    expect(o2.actualRevenue).toBe(5000);
    expect(o2.actualRefund).toBe(-5000);
    expect(o2.actualMargin).toBe(0);
    expect(o2.salesCount).toBe(1);
  });

  it("returns empty rows when no data in range", async () => {
    const app = buildApp({ db: env.db });
    const res = await app.request(
      "/api/analytics/realized-margin?from=2030-01-01&to=2030-01-31",
      { headers: { Cookie: env.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });

  it("rejects bad date with 400", async () => {
    const app = buildApp({ db: env.db });
    const res = await app.request(
      "/api/analytics/realized-margin?from=garbage",
      { headers: { Cookie: env.cookie } },
    );
    expect(res.status).toBe(400);
  });
});
