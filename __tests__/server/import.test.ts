import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../../server/db/schema";
import { products, userSettings } from "../../server/db/schema";
import { buildApp } from "../../server/index";
import { runCatalogImport } from "../../server/routes/import";
import { getCategoryLookup } from "../../server/ozon/catalog";
import type { OzonClient } from "../../server/ozon/client";
import type { TaxSettings } from "../../src/types";

const AUTH = "test-token";

const SAMPLE_TAX: TaxSettings = {
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

const TREE_RESPONSE = {
  result: [
    {
      description_category_id: 100,
      category_name: "Кофеварки и кофемашины",
      children: [
        {
          description_category_id: 100,
          type_id: 1,
          type_name: "Автоматическая кофемашина",
        },
        {
          description_category_id: 100,
          type_id: 2,
          type_name: "Кофеварка",
        },
      ],
    },
  ],
};

const PRODUCT_LIST_RESPONSE = {
  result: {
    items: [
      { product_id: 11, offer_id: "OFFER-1" },
      { product_id: 22, offer_id: "OFFER-2" },
    ],
    total: 2,
    last_id: "",
  },
};

const INFO_RESPONSE = {
  items: [
    {
      id: 11,
      offer_id: "OFFER-1",
      name: "Кофемашина-1",
      description_category_id: 100,
      type_id: 1,
      vat: "0.05",
      weight: 12000,
      weight_unit: "g",
      dimensions: { depth: 500, height: 400, width: 600, dimension_unit: "mm" },
      is_kgt: false,
    },
    {
      id: 22,
      offer_id: "OFFER-2",
      name: "Кофеварка-2",
      description_category_id: 100,
      type_id: 2,
      vat: "0.22",
      weight: 3000,
      weight_unit: "g",
      dimensions: { depth: 200, height: 300, width: 200, dimension_unit: "mm" },
      is_kgt: false,
    },
  ],
};

const PRICES_RESPONSE = {
  items: [
    {
      product_id: 11,
      offer_id: "OFFER-1",
      price: { price: "337000", old_price: "514000", currency_code: "RUB" },
      commissions: {
        sales_percent_fbo: 18,
        sales_percent_fbs: 20,
        fbo_direct_flow_trans_max_amount: 350,
        fbs_direct_flow_trans_max_amount: 280,
        fbo_deliv_to_customer_amount: 80,
        fbs_deliv_to_customer_amount: 60,
      },
    },
    {
      product_id: 22,
      offer_id: "OFFER-2",
      price: { price: "5000", old_price: "0", currency_code: "RUB" },
      // No commissions block — exercise the fallback path.
    },
  ],
  cursor: "",
};

const makeMockClient = (): OzonClient => ({
  async post<T>(endpoint: string): Promise<T> {
    if (endpoint === "/v1/description-category/tree")
      return TREE_RESPONSE as T;
    if (endpoint === "/v3/product/list") return PRODUCT_LIST_RESPONSE as T;
    if (endpoint === "/v3/product/info/list") return INFO_RESPONSE as T;
    if (endpoint === "/v5/product/info/prices") return PRICES_RESPONSE as T;
    throw new Error(`unmocked endpoint: ${endpoint}`);
  },
});

interface TestEnv {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
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
  db.insert(userSettings)
    .values({ id: 1, taxSettings: SAMPLE_TAX, updatedAt: new Date() })
    .run();
  return { db, sqlite };
};

describe("getCategoryLookup", () => {
  it("flattens nested category tree to (descId, typeId) → names", async () => {
    const lookup = await getCategoryLookup(makeMockClient());
    expect(lookup.resolve(100, 1)).toEqual({
      categoryName: "Кофеварки и кофемашины",
      typeName: "Автоматическая кофемашина",
    });
    expect(lookup.resolve(100, 2)).toEqual({
      categoryName: "Кофеварки и кофемашины",
      typeName: "Кофеварка",
    });
    expect(lookup.resolve(999, 1)).toBeNull();
  });
});

describe("runCatalogImport", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupDb();
  });
  afterEach(() => env.sqlite.close());

  it("inserts new products with safe defaults", async () => {
    const counters = await runCatalogImport(env.db, makeMockClient());
    expect(counters.added).toBe(2);
    expect(counters.updated).toBe(0);
    expect(counters.itemsProcessed).toBe(2);

    const rows = env.db.select().from(products).all();
    expect(rows).toHaveLength(2);

    const offer1 = rows.find((r) => r.articleId === "OFFER-1")!;
    expect(offer1.productName).toBe("Кофемашина-1");
    expect(offer1.category).toBe("Кофеварки и кофемашины");
    expect(offer1.productType).toBe("Автоматическая кофемашина");
    expect(offer1.vatRate).toBe("0.05");
    expect(offer1.currentPrice).toBe(337000);
    // 500*400*600 mm³ = 120000 cm³ = 120 L
    expect(offer1.volumeL).toBeCloseTo(120, 1);
    // discount = (514000 - 337000) / 514000
    expect(offer1.discountPercent).toBeCloseTo(0.3443, 3);
    expect(offer1.ozonProductId).toBe(11);
    // safe defaults
    expect(offer1.salesPlan).toBe(0);
    expect(offer1.costPrice).toBe(0);
    expect(offer1.acceptanceTariff).toBe("Доверительная приемка");

    // Phase 5: ozonCommissions persisted from the price item.
    expect(offer1.ozonCommissions).toEqual({
      sales_percent_fbo: 18,
      sales_percent_fbs: 20,
      fbo_direct_flow_trans_max_amount: 350,
      fbs_direct_flow_trans_max_amount: 280,
      fbo_deliv_to_customer_amount: 80,
      fbs_deliv_to_customer_amount: 60,
    });
    expect(offer1.ozonCommissionsUpdatedAt).toBeInstanceOf(Date);

    // OFFER-2 had no commissions in the price item — falls back to null.
    const offer2 = rows.find((r) => r.articleId === "OFFER-2")!;
    expect(offer2.ozonCommissions).toBeNull();
    expect(offer2.ozonCommissionsUpdatedAt).toBeNull();
  });

  it("preserves local fields on re-import", async () => {
    // Pre-seed a row matching one of the import entries.
    env.db
      .insert(products)
      .values({
        id: randomUUID(),
        articleId: "OFFER-1",
        productName: "Стартовое имя",
        category: "Кофеварки и кофемашины",
        productType: "Автоматическая кофемашина",
        isKgt: false,
        isKazakhstan: false,
        isFireHazard: false,
        plannedStorageDays: 30,
        volumeL: 50,
        vatRate: "0.05",
        redemptionPercent: 90,
        salesPlan: 42,
        logisticsMode: "Авто",
        localShare: 0.5,
        clustersCount: "Считать без наценки",
        currentPrice: 100000,
        discountPercent: 0,
        marketingPercent: 0.07,
        realFbsDeliveryCost: 0,
        realFbsReturnCost: 0,
        acceptanceTariff: "Доверительная приемка",
        costPrice: 99999,
        extraExpensesPerUnit: 0,
        whitePurchase: false,
        incomingVatPurchase: false,
        incomingVatRate: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const counters = await runCatalogImport(env.db, makeMockClient());
    expect(counters.updated).toBe(1);
    expect(counters.added).toBe(1);

    const [offer1] = env.db
      .select()
      .from(products)
      .where(eq(products.articleId, "OFFER-1"))
      .all();

    // Catalog fields refreshed.
    expect(offer1.productName).toBe("Кофемашина-1");
    expect(offer1.currentPrice).toBe(337000);
    expect(offer1.volumeL).toBeCloseTo(120, 1);
    expect(offer1.ozonProductId).toBe(11);
    // Local fields preserved.
    expect(offer1.costPrice).toBe(99999);
    expect(offer1.salesPlan).toBe(42);
    expect(offer1.marketingPercent).toBeCloseTo(0.07, 6);
  });

  it("is idempotent across repeat runs", async () => {
    await runCatalogImport(env.db, makeMockClient());
    const before = env.db.select().from(products).all();
    await runCatalogImport(env.db, makeMockClient());
    const after = env.db.select().from(products).all();
    expect(after).toHaveLength(before.length);
    // ids stable
    expect(new Set(after.map((r) => r.id))).toEqual(
      new Set(before.map((r) => r.id)),
    );
  });
});

describe("import route", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupDb();
  });
  afterEach(() => env.sqlite.close());

  it("POST /api/import/catalog creates a run and completes", async () => {
    const app = buildApp({
      authToken: AUTH,
      db: env.db,
      importContext: { ozonClient: makeMockClient() },
    });
    const headers = { "Content-Type": "application/json", "X-Auth-Token": AUTH };

    const res = await app.request("/api/import/catalog", {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: number };
    expect(runId).toBeGreaterThan(0);

    // Wait until status leaves "running" — polling like the UI does.
    let final: { status: string; itemsProcessed: number } | null = null;
    for (let i = 0; i < 20; i++) {
      const r = await app.request(`/api/import/runs/${runId}`, { headers });
      const body = (await r.json()) as { status: string; itemsProcessed: number };
      if (body.status !== "running") {
        final = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(final?.status).toBe("ok");
    expect(final?.itemsProcessed).toBe(2);
  });

  it("GET /api/credentials/status reports false when nothing configured", async () => {
    const prevId = process.env.OZON_CLIENT_ID;
    const prevKey = process.env.OZON_API_KEY;
    delete process.env.OZON_CLIENT_ID;
    delete process.env.OZON_API_KEY;
    try {
      const app = buildApp({ authToken: AUTH, db: env.db });
      const res = await app.request("/api/credentials/status", {
        headers: { "X-Auth-Token": AUTH },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hasCredentials: false, source: null });
    } finally {
      if (prevId) process.env.OZON_CLIENT_ID = prevId;
      if (prevKey) process.env.OZON_API_KEY = prevKey;
    }
  });

  it("PUT /api/credentials saves to db and surfaces in status", async () => {
    const prevId = process.env.OZON_CLIENT_ID;
    const prevKey = process.env.OZON_API_KEY;
    delete process.env.OZON_CLIENT_ID;
    delete process.env.OZON_API_KEY;
    try {
      const app = buildApp({ authToken: AUTH, db: env.db });
      const headers = { "Content-Type": "application/json", "X-Auth-Token": AUTH };

      const put = await app.request("/api/credentials", {
        method: "PUT",
        headers,
        body: JSON.stringify({ clientId: "abc", apiKey: "xyz" }),
      });
      expect(put.status).toBe(200);

      const status = await app.request("/api/credentials/status", { headers });
      expect(await status.json()).toEqual({
        hasCredentials: true,
        source: "db",
      });
    } finally {
      if (prevId) process.env.OZON_CLIENT_ID = prevId;
      if (prevKey) process.env.OZON_API_KEY = prevKey;
    }
  });
});
