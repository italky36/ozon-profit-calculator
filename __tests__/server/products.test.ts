import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { buildApp } from "../../server/index";
import { sessions } from "../../server/db/schema";
import * as schema from "../../server/db/schema";
import type { ProductInput } from "../../src/types";
import { createShopFor, createUserDirect, SAMPLE_TAX } from "./_helpers";

const SAMPLE_INPUT: ProductInput = {
  articleId: "TEST-PRODUCT",
  productName: "Test product",
  category: "Кофеварки и кофемашины",
  productType: "Автоматическая кофемашина",
  isKgt: false,
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  volumeL: 209,
  vatRate: 0.05,
  redemptionPercent: 90,
  salesPlan: 10,
  logisticsMode: "Авто",
  localShare: 0.5,
  clustersCount: "Считать без наценки",
  dispatchCluster: "Москва, МО и Дальние регионы",
  destinationCluster: "Москва, МО и Дальние регионы",
  currentPrice: 337000,
  discountPercent: 0.345,
  marketingPercent: 0,
  realFbsDeliveryCost: 500,
  realFbsReturnCost: 250,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 87000,
  extraExpensesPerUnit: 0,
  whitePurchase: true,
  incomingVatPurchase: false,
  incomingVatRate: 0,
};

interface TestEnv {
  app: ReturnType<typeof buildApp>;
  sqlite: Database.Database;
  cookie: string;
}

const setup = (): TestEnv => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  // Apply migrations from the file system (same as server runtime would).
  const migrationsDir = path.resolve(import.meta.dirname, "../../server/db/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  const db = drizzle(sqlite, { schema });

  const adminId = createUserDirect(db, "admin@test.local", "password", "admin");
  // Multi-shop model: ensure user has at least one shop.
  createShopFor(db, adminId);
  const sessionId = "test-products-session";
  db.insert(sessions)
    .values({
      id: sessionId,
      userId: adminId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
    })
    .run();
  const cookie = `ozon_calc_session=${sessionId}`;

  const app = buildApp({ db });
  return { app, sqlite, cookie };
};

const headers = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

describe("products CRUD", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setup();
  });
  afterEach(() => {
    env.sqlite.close();
  });

  it("rejects missing auth token", async () => {
    const res = await env.app.request("/api/products");
    expect(res.status).toBe(401);
  });

  it("starts with an empty list", async () => {
    const res = await env.app.request("/api/products", { headers: headers(env.cookie) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("creates, reads, updates, deletes a product", async () => {
    // CREATE
    const createRes = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify(SAMPLE_INPUT),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; input: ProductInput };
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.input.articleId).toBe(SAMPLE_INPUT.articleId);
    expect(created.input.vatRate).toBe(0.05);
    expect(created.input.clustersCount).toBe("Считать без наценки");

    // LIST
    const listRes = await env.app.request("/api/products", { headers: headers(env.cookie) });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    // UPDATE
    const updated = { ...SAMPLE_INPUT, salesPlan: 42, currentPrice: 400000 };
    const patchRes = await env.app.request(`/api/products/${created.id}`, {
      method: "PATCH",
      headers: headers(env.cookie),
      body: JSON.stringify(updated),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { input: ProductInput };
    expect(patched.input.salesPlan).toBe(42);
    expect(patched.input.currentPrice).toBe(400000);

    // DELETE
    const delRes = await env.app.request(`/api/products/${created.id}`, {
      method: "DELETE",
      headers: headers(env.cookie),
    });
    expect(delRes.status).toBe(204);

    const afterRes = await env.app.request("/api/products", { headers: headers(env.cookie) });
    expect(await afterRes.json()).toEqual([]);
  });

  it("rejects duplicate articleId with 409", async () => {
    const a = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify(SAMPLE_INPUT),
    });
    expect(a.status).toBe(201);
    const b = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify(SAMPLE_INPUT),
    });
    expect(b.status).toBe(409);
  });

  it("rejects invalid input with 400", async () => {
    const bad = { ...SAMPLE_INPUT, vatRate: 0.5 };
    const res = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(env.cookie),
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating unknown id", async () => {
    const res = await env.app.request("/api/products/no-such-id", {
      method: "PATCH",
      headers: headers(env.cookie),
      body: JSON.stringify(SAMPLE_INPUT),
    });
    expect(res.status).toBe(404);
  });
});

describe("settings", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setup();
  });
  afterEach(() => {
    env.sqlite.close();
  });

  it("GET returns seeded tax settings", async () => {
    const res = await env.app.request("/api/settings", { headers: headers(env.cookie) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ taxSystem: SAMPLE_TAX.taxSystem });
  });

  it("PUT updates tax settings", async () => {
    const next = { ...SAMPLE_TAX, taxSystem: "НПД" as const, npdRate: 0.06 };
    const res = await env.app.request("/api/settings", {
      method: "PUT",
      headers: headers(env.cookie),
      body: JSON.stringify(next),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ taxSystem: "НПД", npdRate: 0.06 });
  });

  it("PUT rejects invalid taxSystem", async () => {
    const res = await env.app.request("/api/settings", {
      method: "PUT",
      headers: headers(env.cookie),
      body: JSON.stringify({ ...SAMPLE_TAX, taxSystem: "BOGUS" }),
    });
    expect(res.status).toBe(400);
  });
});
