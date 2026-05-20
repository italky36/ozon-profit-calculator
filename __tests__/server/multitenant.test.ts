import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  financeTransactions,
  users,
  workspaceMembers,
  workspaces,
} from "../../server/db/schema";
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

describe("multi-tenant workspace isolation", () => {
  let env: TestEnv;
  let alice: Awaited<ReturnType<typeof loginAs>>;
  let bob: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    alice = await loginAs(env, "alice@test.local", "password");
    bob = await loginAs(env, "bob@test.local", "password");
  });
  afterEach(async () => await teardownTestEnv(env));

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

  it("each user lands in their own workspace and cannot see the other's shops", async () => {
    expect(alice.workspaceId).not.toBe(bob.workspaceId);

    const aliceShops = (await (
      await env.app.request("/api/shops", { headers: headersFor(alice.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(aliceShops.map((s) => s.id)).toEqual([alice.shopId]);

    const bobShops = (await (
      await env.app.request("/api/shops", { headers: headersFor(bob.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(bobShops.map((s) => s.id)).toEqual([bob.shopId]);
  });

  it("?shopId=N from another workspace is rejected with 404", async () => {
    const res = await env.app.request(`/api/products?shopId=${bob.shopId}`, {
      headers: headersFor(alice.cookie),
    });
    expect(res.status).toBe(404);
  });

  it("identical articleId can exist in two workspaces independently", async () => {
    const a = await createProduct(alice.cookie, alice.shopId, "SAME-SKU");
    const b = await createProduct(bob.cookie, bob.shopId, "SAME-SKU");
    expect(a.id).not.toBe(b.id);
  });

  it("two shops in the SAME workspace can hold the same articleId", async () => {
    const shop2 = await createShopFor(env.db, alice.userId, {
      name: "Shop 2",
      shortName: "S2",
    });
    const a1 = await createProduct(alice.cookie, alice.shopId, "DUP");
    const a2 = await createProduct(alice.cookie, shop2, "DUP");
    expect(a1.id).not.toBe(a2.id);
    expect(a1.shopId).not.toBe(a2.shopId);
  });

  it("PATCH/DELETE on another workspace's product returns 404", async () => {
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

  it("finance routes scope by workspace", async () => {
    await env.db
      .insert(financeTransactions)
      .values({
        shopId: alice.shopId,
        workspaceId: alice.workspaceId,
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
      ;
    await env.db
      .insert(financeTransactions)
      .values({
        shopId: bob.shopId,
        workspaceId: bob.workspaceId,
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
      ;

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

  it("PUT /api/shops/active rejects shop of another workspace", async () => {
    const res = await env.app.request("/api/shops/active", {
      method: "PUT",
      headers: headersFor(alice.cookie),
      body: JSON.stringify({ shopId: bob.shopId }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH on another workspace's shop returns 404", async () => {
    const res = await env.app.request(`/api/shops/${bob.shopId}`, {
      method: "PATCH",
      headers: headersFor(alice.cookie),
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(res.status).toBe(404);
  });

  it("cascade delete user removes workspace_members but keeps the workspace", async () => {
    // 1 user = 1 workspace today, but workspaces are first-class — they don't
    // disappear when the last member leaves (Stage 4 multi-member workspaces
    // would orphan everyone's data otherwise). The user's membership row is
    // cascaded; sysadmin can clean up empty workspaces separately.
    await env.db.delete(users).where(eq(users.id, alice.userId));

    const memberAfter = await env.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, alice.userId));
    expect(memberAfter).toHaveLength(0);
    const [wsRow] = await env.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, alice.workspaceId));
    expect(wsRow).toBeDefined();
  });

  it("cannot delete the only shop in workspace", async () => {
    const res = await env.app.request(`/api/shops/${alice.shopId}`, {
      method: "DELETE",
      headers: headersFor(alice.cookie),
    });
    expect(res.status).toBe(400);
  });
});
