import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  financeTransactions,
  shops,
} from "../../server/db/schema";
import { resolveCredentials } from "../../server/ozon/client";
import {
  createShopFor,
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import type { ProductInput } from "../../src/types";

const sampleInput = (articleId: string): ProductInput => ({
  articleId,
  productName: `Product ${articleId}`,
  category: "Кофеварки и кофемашины",
  productType: "Автоматическая кофемашина",
  isKgt: false,
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  volumeL: 100,
  vatRate: "Не облагается",
  redemptionPercent: 90,
  salesPlan: 10,
  logisticsMode: "Авто",
  localShare: 0.5,
  clustersCount: "Считать без наценки",
  dispatchCluster: "Москва, МО и Дальние регионы",
  destinationCluster: "Москва, МО и Дальние регионы",
  currentPrice: 100000,
  discountPercent: 0,
  marketingPercent: 0,
  realFbsDeliveryCost: 0,
  realFbsReturnCost: 0,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 50000,
  extraExpensesPerUnit: 0,
  whitePurchase: null,
  incomingVatPurchase: false,
  incomingVatRate: 0,
});

interface ProductOut {
  id: string;
  shopId: number;
  input: { articleId: string };
}

describe("multi-shop isolation", () => {
  let env: TestEnv;
  let alice: { cookie: string; userId: number; shopId: number };
  let bob: { cookie: string; userId: number; shopId: number };

  beforeEach(async () => {
    env = setupTestEnv();
    alice = await loginAs(env, "alice@test.local", "password");
    bob = await loginAs(env, "bob@test.local", "password");
  });
  afterEach(() => teardownTestEnv(env));

  const headersFor = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  const createProduct = async (
    cookie: string,
    shopId: number,
    articleId: string,
  ) => {
    const res = await env.app.request("/api/products", {
      method: "POST",
      headers: headersFor(cookie),
      body: JSON.stringify({ ...sampleInput(articleId), shopId }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ProductOut;
  };

  it("two users' default shops are independent", async () => {
    const a = await createProduct(alice.cookie, alice.shopId, "SAME-SKU");
    const b = await createProduct(bob.cookie, bob.shopId, "SAME-SKU");
    expect(a.id).not.toBe(b.id);
    expect(a.shopId).toBe(alice.shopId);
    expect(b.shopId).toBe(bob.shopId);
  });

  it("two shops of the SAME user can hold the same articleId", async () => {
    const shop2 = createShopFor(env.db, alice.userId, {
      name: "Shop 2",
      shortName: "S2",
    });
    const a1 = await createProduct(alice.cookie, alice.shopId, "DUP");
    const a2 = await createProduct(alice.cookie, shop2, "DUP");
    expect(a1.shopId).not.toBe(a2.shopId);
  });

  it("GET /products without ?shopId= returns all user's shops mixed", async () => {
    const shop2 = createShopFor(env.db, alice.userId, {
      name: "Shop 2",
      shortName: "S2",
    });
    await createProduct(alice.cookie, alice.shopId, "ALICE-1");
    await createProduct(alice.cookie, shop2, "ALICE-2");
    await createProduct(bob.cookie, bob.shopId, "BOB-1");

    const all = (await (
      await env.app.request("/api/products", { headers: headersFor(alice.cookie) })
    ).json()) as ProductOut[];
    expect(all.map((p) => p.input.articleId).sort()).toEqual([
      "ALICE-1",
      "ALICE-2",
    ]);

    const onlyShop2 = (await (
      await env.app.request(`/api/products?shopId=${shop2}`, {
        headers: headersFor(alice.cookie),
      })
    ).json()) as ProductOut[];
    expect(onlyShop2.map((p) => p.input.articleId)).toEqual(["ALICE-2"]);
  });

  it("?shopId=N from another user is rejected", async () => {
    const res = await env.app.request(`/api/products?shopId=${bob.shopId}`, {
      headers: headersFor(alice.cookie),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH/DELETE on another user's product returns 404", async () => {
    const product = await createProduct(alice.cookie, alice.shopId, "ALICE-ONLY");
    const patch = await env.app.request(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: headersFor(bob.cookie),
      body: JSON.stringify(sampleInput("HIJACK")),
    });
    expect(patch.status).toBe(404);
    const del = await env.app.request(`/api/products/${product.id}`, {
      method: "DELETE",
      headers: headersFor(bob.cookie),
    });
    expect(del.status).toBe(404);
  });

  it("finance_transactions: same operation_id for two shops coexists", () => {
    env.db
      .insert(financeTransactions)
      .values({
        shopId: alice.shopId,
        userId: alice.userId,
        operationId: 12345,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-15"),
        postingNumber: "p1",
        articleId: "X",
        amount: 1000,
        type: "sale",
        raw: { owner: "alice" },
      })
      .run();
    env.db
      .insert(financeTransactions)
      .values({
        shopId: bob.shopId,
        userId: bob.userId,
        operationId: 12345,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-15"),
        postingNumber: "p1",
        articleId: "Y",
        amount: 2000,
        type: "sale",
        raw: { owner: "bob" },
      })
      .run();
    const all = env.db.select().from(financeTransactions).all();
    expect(all).toHaveLength(2);
  });

  it("finance routes scope by user: alice sees only her shops' transactions", async () => {
    env.db
      .insert(financeTransactions)
      .values({
        shopId: alice.shopId,
        userId: alice.userId,
        operationId: 1,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-15"),
        postingNumber: null,
        articleId: "X",
        amount: 100,
        type: "sale",
        raw: {},
      })
      .run();
    env.db
      .insert(financeTransactions)
      .values({
        shopId: bob.shopId,
        userId: bob.userId,
        operationId: 1,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-15"),
        postingNumber: null,
        articleId: "Y",
        amount: 200,
        type: "sale",
        raw: {},
      })
      .run();

    const aliceRows = (await (
      await env.app.request("/api/finance/transactions", {
        headers: headersFor(alice.cookie),
      })
    ).json()) as Array<{ amount: number }>;
    expect(aliceRows.map((r) => r.amount)).toEqual([100]);

    const bobRows = (await (
      await env.app.request("/api/finance/transactions", {
        headers: headersFor(bob.cookie),
      })
    ).json()) as Array<{ amount: number }>;
    expect(bobRows.map((r) => r.amount)).toEqual([200]);
  });

  it("resolveCredentials: returns shop creds or null", async () => {
    // No shop keys → null (no global/env fallback exists anymore).
    let r = await resolveCredentials(env.db, alice.shopId);
    expect(r).toBeNull();

    // Even if env vars are set, they're ignored.
    const prevEnvId = process.env.OZON_CLIENT_ID;
    const prevEnvKey = process.env.OZON_API_KEY;
    process.env.OZON_CLIENT_ID = "env-id";
    process.env.OZON_API_KEY = "env-key";
    try {
      r = await resolveCredentials(env.db, alice.shopId);
      expect(r).toBeNull();
    } finally {
      if (prevEnvId === undefined) delete process.env.OZON_CLIENT_ID;
      else process.env.OZON_CLIENT_ID = prevEnvId;
      if (prevEnvKey === undefined) delete process.env.OZON_API_KEY;
      else process.env.OZON_API_KEY = prevEnvKey;
    }

    // Set shop creds → returned.
    env.db
      .update(shops)
      .set({
        ozonClientId: "alice-id",
        ozonApiKey: "alice-key",
        ozonUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, alice.shopId))
      .run();
    r = await resolveCredentials(env.db, alice.shopId);
    expect(r).toEqual({
      clientId: "alice-id",
      apiKey: "alice-key",
      source: "shop",
    });
    // Bob's shop, no keys → still null.
    r = await resolveCredentials(env.db, bob.shopId);
    expect(r).toBeNull();
  });

  it("credentials/status reflects only shop state", async () => {
    // No creds at all → activeSource null.
    let s = (await (
      await env.app.request("/api/credentials/status", {
        headers: headersFor(alice.cookie),
      })
    ).json()) as {
      shopId: number;
      hasCredentials: boolean;
      activeSource: string | null;
      shop: { hasCredentials: boolean };
    };
    expect(s).toEqual({
      shopId: alice.shopId,
      hasCredentials: false,
      activeSource: null,
      shop: { hasCredentials: false },
    });

    // Alice sets her shop creds → activeSource shop.
    await env.app.request("/api/credentials", {
      method: "PUT",
      headers: headersFor(alice.cookie),
      body: JSON.stringify({ clientId: "ac", apiKey: "ak" }),
    });
    s = (await (
      await env.app.request("/api/credentials/status", {
        headers: headersFor(alice.cookie),
      })
    ).json()) as typeof s;
    expect(s.activeSource).toBe("shop");
    expect(s.shop.hasCredentials).toBe(true);

    // Alice clears her shop creds → back to null.
    await env.app.request("/api/credentials", {
      method: "DELETE",
      headers: headersFor(alice.cookie),
    });
    s = (await (
      await env.app.request("/api/credentials/status", {
        headers: headersFor(alice.cookie),
      })
    ).json()) as typeof s;
    expect(s.activeSource).toBeNull();
    expect(s.shop.hasCredentials).toBe(false);
  });

  it("cascade delete: removing a shop wipes its products and finance", async () => {
    const shop2 = createShopFor(env.db, alice.userId, {
      name: "Shop 2",
      shortName: "S2",
    });
    await createProduct(alice.cookie, shop2, "S2-X");
    env.db
      .insert(financeTransactions)
      .values({
        shopId: shop2,
        userId: alice.userId,
        operationId: 999,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date(),
        postingNumber: null,
        articleId: "S2-X",
        amount: 100,
        type: "sale",
        raw: {},
      })
      .run();

    const res = await env.app.request(`/api/shops/${shop2}`, {
      method: "DELETE",
      headers: headersFor(alice.cookie),
    });
    expect(res.status).toBe(204);

    const productsAfter = (await (
      await env.app.request("/api/products", { headers: headersFor(alice.cookie) })
    ).json()) as ProductOut[];
    expect(productsAfter.map((p) => p.input.articleId)).not.toContain("S2-X");

    const txAfter = env.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.shopId, shop2))
      .all();
    expect(txAfter).toHaveLength(0);
  });

  it("cannot delete the last shop", async () => {
    const res = await env.app.request(`/api/shops/${alice.shopId}`, {
      method: "DELETE",
      headers: headersFor(alice.cookie),
    });
    expect(res.status).toBe(400);
  });

  it("cascade delete user wipes their shops and dependent data", () => {
    env.sqlite.prepare("DELETE FROM users WHERE id = ?").run(alice.userId);

    // alice's shops are gone:
    const aliceShops = env.db
      .select()
      .from(shops)
      .where(eq(shops.userId, alice.userId))
      .all();
    expect(aliceShops).toHaveLength(0);
  });
});

// Local helper to silence unused-import for `and` if not referenced.
void and;
