import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  financeTransactions,
  shopMember,
  shops,
  shopUserSettings,
  users,
  workspaceMembers,
} from "../../server/db/schema";
import {
  loginAndGetCookie,
  setupTestEnv,
  teardownTestEnv,
  SAMPLE_TAX,
  type TestEnv,
} from "./_helpers";
import type { ProductInput, TaxSettings } from "../../src/types";

const sampleInput = (articleId: string): ProductInput => ({
  articleId,
  productName: `P-${articleId}`,
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

/** Create a verified user and add them to an existing workspace as a
 * non-owner. Returns userId + login cookie. */
async function addMemberToWorkspace(
  env: TestEnv,
  workspaceId: number,
  email: string,
  password: string,
  role: "manager" | "member",
): Promise<{ userId: number; cookie: string }> {
  const now = new Date();
  const hash = bcrypt.hashSync(password, 4);
  const [u] = await env.db
    .insert(users)
    .values({
      email,
      passwordHash: hash,
      isSysadmin: false,
      isVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    ;
  await env.db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId: u.id,
      role,
      status: "active",
      createdAt: now,
    })
    ;
  const cookie = await loginAndGetCookie(env.app, email, password);
  return { userId: u.id, cookie };
}

const headersFor = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

describe("shop assignment + per-user overrides", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  /** Create owner with two shops and a single member (Petya) assigned to shop1
   * only. Returns ids needed by individual tests. */
  async function setupTeam() {
    const { loginAs } = await import("./_helpers");
    const owner = await loginAs(env, "owner@team.local", "password");

    // Owner creates a second shop in the workspace.
    const res = await env.app.request("/api/shops", {
      method: "POST",
      headers: headersFor(owner.cookie),
      body: JSON.stringify({
        name: "Shop 2",
        shortName: "S2",
      }),
    });
    expect(res.status).toBe(201);
    const shop2 = (await res.json()) as { id: number };

    const petya = await addMemberToWorkspace(
      env,
      owner.workspaceId,
      "petya@team.local",
      "password",
      "member",
    );

    // Owner assigns Petya to shop1 (alice's default shop). shop2 stays
    // out-of-reach for Petya.
    const assignRes = await env.app.request(
      `/api/shops/${owner.shopId}/members`,
      {
        method: "POST",
        headers: headersFor(owner.cookie),
        body: JSON.stringify({ userId: petya.userId }),
      },
    );
    expect(assignRes.status).toBe(200);

    return { owner, petya, shop1Id: owner.shopId, shop2Id: shop2.id };
  }

  it("owner sees both shops; assigned member sees only their assigned shop", async () => {
    const { owner, petya, shop1Id, shop2Id } = await setupTeam();

    const ownerShops = (await (
      await env.app.request("/api/shops", { headers: headersFor(owner.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(ownerShops.map((s) => s.id).sort()).toEqual(
      [shop1Id, shop2Id].sort(),
    );

    const petyaShops = (await (
      await env.app.request("/api/shops", { headers: headersFor(petya.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(petyaShops.map((s) => s.id)).toEqual([shop1Id]);
  });

  it("unassigned shop is not visible to member: products query returns 404 with explicit shopId", async () => {
    const { petya, shop2Id } = await setupTeam();
    const res = await env.app.request(`/api/products?shopId=${shop2Id}`, {
      headers: headersFor(petya.cookie),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/settings writes a per-user override that owner does not see", async () => {
    const { owner, petya, shop1Id } = await setupTeam();
    const customTax: TaxSettings = {
      ...SAMPLE_TAX,
      taxSystem: "УСН Доходы",
      usnIncomeRate: 0.06,
    };
    const putRes = await env.app.request("/api/settings", {
      method: "PUT",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...customTax, shopId: shop1Id }),
    });
    expect(putRes.status).toBe(200);

    // Override must land in shop_user_settings.
    const [overrideRow] = await env.db
      .select()
      .from(shopUserSettings)
      .where(eq(shopUserSettings.userId, petya.userId))
      ;
    expect(overrideRow).toBeDefined();
    expect(overrideRow!.taxSettings?.taxSystem).toBe("УСН Доходы");

    // Owner reading the same shop must see the original shop default.
    const ownerView = (await (
      await env.app.request(`/api/settings?shopId=${shop1Id}`, {
        headers: headersFor(owner.cookie),
      })
    ).json()) as TaxSettings;
    expect(ownerView.taxSystem).toBe(SAMPLE_TAX.taxSystem);

    // Petya reading sees their own override.
    const petyaView = (await (
      await env.app.request(`/api/settings?shopId=${shop1Id}`, {
        headers: headersFor(petya.cookie),
      })
    ).json()) as TaxSettings;
    expect(petyaView.taxSystem).toBe("УСН Доходы");
  });

  it("PUT /api/settings clears the override when user submits the shop default", async () => {
    const { petya, shop1Id } = await setupTeam();
    // 1. set an override.
    const customTax: TaxSettings = {
      ...SAMPLE_TAX,
      usnIncomeRate: 0.99,
    };
    await env.app.request("/api/settings", {
      method: "PUT",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...customTax, shopId: shop1Id }),
    });
    expect(
      (await env.db
        .select()
        .from(shopUserSettings)
        .where(eq(shopUserSettings.userId, petya.userId)))[0]?.taxSettings,
    ).not.toBeNull();

    // 2. submit shop default exactly → override row's tax_settings is cleared.
    await env.app.request("/api/settings", {
      method: "PUT",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...SAMPLE_TAX, shopId: shop1Id }),
    });
    const [row] = await env.db
      .select()
      .from(shopUserSettings)
      .where(eq(shopUserSettings.userId, petya.userId))
      ;
    expect(row?.taxSettings).toBeNull();
  });

  it("POST /api/shops/:id/reset-overrides drops the user's override row", async () => {
    const { petya, shop1Id } = await setupTeam();
    await env.app.request("/api/settings", {
      method: "PUT",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...SAMPLE_TAX, usnIncomeRate: 0.5, shopId: shop1Id }),
    });
    const before = await env.db
      .select()
      .from(shopUserSettings)
      .where(eq(shopUserSettings.userId, petya.userId))
      ;
    expect(before).toHaveLength(1);

    const res = await env.app.request(
      `/api/shops/${shop1Id}/reset-overrides`,
      { method: "POST", headers: headersFor(petya.cookie) },
    );
    expect(res.status).toBe(200);
    const after = await env.db
      .select()
      .from(shopUserSettings)
      .where(eq(shopUserSettings.userId, petya.userId))
      ;
    expect(after).toHaveLength(0);
  });

  it("products are per-user inside a shared shop", async () => {
    const { owner, petya, shop1Id } = await setupTeam();

    // Owner creates a product.
    const ownerRes = await env.app.request("/api/products", {
      method: "POST",
      headers: headersFor(owner.cookie),
      body: JSON.stringify({ ...sampleInput("OWNER-SKU"), shopId: shop1Id }),
    });
    expect(ownerRes.status).toBe(201);
    // Petya creates one with same articleId in same shop — must work because
    // UNIQUE is (shop_id, user_id, article_id).
    const petyaRes = await env.app.request("/api/products", {
      method: "POST",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...sampleInput("OWNER-SKU"), shopId: shop1Id }),
    });
    expect(petyaRes.status).toBe(201);

    const ownerList = (await (
      await env.app.request(`/api/products?shopId=${shop1Id}`, {
        headers: headersFor(owner.cookie),
      })
    ).json()) as unknown[];
    const petyaList = (await (
      await env.app.request(`/api/products?shopId=${shop1Id}`, {
        headers: headersFor(petya.cookie),
      })
    ).json()) as unknown[];

    expect(ownerList).toHaveLength(1);
    expect(petyaList).toHaveLength(1);
    expect((ownerList[0] as { id: string }).id).not.toBe(
      (petyaList[0] as { id: string }).id,
    );
  });

  it("finance reads/writes are per-user in a shared shop", async () => {
    const { owner, petya, shop1Id } = await setupTeam();
    await env.db
      .insert(financeTransactions)
      .values({
        shopId: shop1Id,
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        operationId: 7,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-10"),
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
        shopId: shop1Id,
        workspaceId: owner.workspaceId,
        userId: petya.userId,
        operationId: 7,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-10"),
        postingNumber: null,
        articleId: "X",
        amount: 200,
        type: "sale",
        raw: {},
      })
      ;

    const ownerRows = (await (
      await env.app.request("/api/finance/transactions", {
        headers: headersFor(owner.cookie),
      })
    ).json()) as Array<{ amount: number }>;
    const petyaRows = (await (
      await env.app.request("/api/finance/transactions", {
        headers: headersFor(petya.cookie),
      })
    ).json()) as Array<{ amount: number }>;
    expect(ownerRows.map((r) => r.amount)).toEqual([100]);
    expect(petyaRows.map((r) => r.amount)).toEqual([200]);
  });

  it("non-manager cannot manage shop members", async () => {
    const { petya, shop1Id } = await setupTeam();
    const res = await env.app.request(`/api/shops/${shop1Id}/members`, {
      method: "POST",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ userId: petya.userId }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id/members/:userId cascades user's products + finance + overrides", async () => {
    const { owner, petya, shop1Id } = await setupTeam();

    // Petya populates the shared shop with their own data.
    await env.app.request("/api/products", {
      method: "POST",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...sampleInput("PETYA-SKU"), shopId: shop1Id }),
    });
    await env.db
      .insert(financeTransactions)
      .values({
        shopId: shop1Id,
        workspaceId: owner.workspaceId,
        userId: petya.userId,
        operationId: 42,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date("2026-04-10"),
        postingNumber: null,
        articleId: "PETYA-SKU",
        amount: 500,
        type: "sale",
        raw: {},
      })
      ;
    await env.app.request("/api/settings", {
      method: "PUT",
      headers: headersFor(petya.cookie),
      body: JSON.stringify({ ...SAMPLE_TAX, usnIncomeRate: 0.5, shopId: shop1Id }),
    });

    // Owner unassigns Petya.
    const res = await env.app.request(
      `/api/shops/${shop1Id}/members/${petya.userId}`,
      { method: "DELETE", headers: headersFor(owner.cookie) },
    );
    expect(res.status).toBe(204);

    expect(
      await env.db
        .select()
        .from(shopMember)
        .where(eq(shopMember.userId, petya.userId)),
    ).toHaveLength(0);

    // Petya's data must be gone.
    const wsId = owner.workspaceId;
    const { products } = await import("../../server/db/schema");
    expect(
      await env.db
        .select()
        .from(products)
        .where(eq(products.userId, petya.userId)),
    ).toHaveLength(0);
    expect(
      await env.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, petya.userId)),
    ).toHaveLength(0);
    expect(
      await env.db
        .select()
        .from(shopUserSettings)
        .where(eq(shopUserSettings.userId, petya.userId)),
    ).toHaveLength(0);

    // Petya can no longer see this shop.
    const petyaShopsAfter = (await (
      await env.app.request("/api/shops", { headers: headersFor(petya.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(petyaShopsAfter.map((s) => s.id)).toEqual([]);
    expect(wsId).toBe(owner.workspaceId);
  });

  it("GET /:id/members surfaces owner as assigned and non-assigned member as candidate", async () => {
    const { owner, petya, shop1Id, shop2Id } = await setupTeam();

    const r1 = (await (
      await env.app.request(`/api/shops/${shop1Id}/members`, {
        headers: headersFor(owner.cookie),
      })
    ).json()) as {
      assigned: Array<{ userId: number; role: string }>;
      candidates: Array<{ userId: number }>;
    };
    expect(r1.assigned.find((m) => m.userId === owner.userId)?.role).toBe(
      "owner",
    );
    expect(r1.assigned.map((m) => m.userId)).toContain(petya.userId);

    const r2 = (await (
      await env.app.request(`/api/shops/${shop2Id}/members`, {
        headers: headersFor(owner.cookie),
      })
    ).json()) as {
      candidates: Array<{ userId: number }>;
      assigned: Array<{ userId: number }>;
    };
    expect(r2.candidates.map((m) => m.userId)).toContain(petya.userId);
    expect(r2.assigned.find((m) => m.userId === owner.userId)).toBeDefined();
  });

  it("manager creating a shop is auto-assigned to it via shop_member", async () => {
    const ownerLogin = await (await import("./_helpers")).loginAs(
      env,
      "owner2@team.local",
      "password",
    );
    const manager = await addMemberToWorkspace(
      env,
      ownerLogin.workspaceId,
      "manager@team.local",
      "password",
      "manager",
    );
    const res = await env.app.request("/api/shops", {
      method: "POST",
      headers: headersFor(manager.cookie),
      body: JSON.stringify({ name: "Manager Shop", shortName: "MM" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number };

    const list = (await (
      await env.app.request("/api/shops", { headers: headersFor(manager.cookie) })
    ).json()) as Array<{ id: number }>;
    expect(list.map((s) => s.id)).toContain(created.id);

    // shop_member row exists.
    const [row] = await env.db
      .select()
      .from(shopMember)
      .where(eq(shopMember.userId, manager.userId))
      ;
    expect(row?.shopId).toBe(created.id);
    // Sanity: shops table sees it.
    expect(
      (await env.db.select().from(shops).where(eq(shops.id, created.id)))[0],
    ).toBeDefined();
  });
});
