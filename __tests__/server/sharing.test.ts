import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  financeTransactions,
  products,
  shopAccess,
  shops,
  shopUserSettings,
} from "../../server/db/schema";
import { resolveCredentials } from "../../server/ozon/client";
import {
  loginAs,
  SAMPLE_TAX,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import type { ProductInput, TaxSettings } from "../../src/types";

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

interface ShopOut {
  id: number;
  name: string;
  shortName: string;
  isOwner: boolean;
  ownerEmail: string | null;
  hasOverrides: boolean;
  taxSettings: TaxSettings;
  tariffSetId: number | null;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMin: number;
  hasOzonCreds: boolean;
}

describe("shared admin shops", () => {
  let env: TestEnv;
  let admin: { cookie: string; userId: number; shopId: number };
  let viewer: { cookie: string; userId: number; shopId: number };

  beforeEach(async () => {
    env = setupTestEnv();
    admin = await loginAs(env, "admin@test.local", "password", "admin");
    viewer = await loginAs(env, "viewer@test.local", "password");
  });
  afterEach(() => teardownTestEnv(env));

  const headers = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  const grant = async (shopId: number, userId: number) => {
    const res = await env.app.request(`/api/admin/shops/${shopId}/access`, {
      method: "POST",
      headers: headers(admin.cookie),
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(200);
  };

  const listShops = async (cookie: string): Promise<ShopOut[]> => {
    const res = await env.app.request("/api/shops", { headers: headers(cookie) });
    expect(res.status).toBe(200);
    return (await res.json()) as ShopOut[];
  };

  it("after grant the viewer sees the admin shop with isOwner=false", async () => {
    await grant(admin.shopId, viewer.userId);
    const seen = await listShops(viewer.cookie);
    const shared = seen.find((s) => s.id === admin.shopId);
    expect(shared).toBeDefined();
    expect(shared!.isOwner).toBe(false);
    expect(shared!.ownerEmail).toBe("admin@test.local");

    const ownView = await listShops(admin.cookie);
    const adminOwn = ownView.find((s) => s.id === admin.shopId);
    expect(adminOwn?.isOwner).toBe(true);
    expect(adminOwn?.ownerEmail).toBeNull();
  });

  it("viewer cannot list the shop until access is granted", async () => {
    const before = await listShops(viewer.cookie);
    expect(before.find((s) => s.id === admin.shopId)).toBeUndefined();
  });

  it("products in a shared shop are scoped per user", async () => {
    await grant(admin.shopId, viewer.userId);

    const adminProductRes = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(admin.cookie),
      body: JSON.stringify({ ...sampleInput("SHARED-1"), shopId: admin.shopId }),
    });
    expect(adminProductRes.status).toBe(201);

    const viewerProductRes = await env.app.request("/api/products", {
      method: "POST",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ ...sampleInput("SHARED-1"), shopId: admin.shopId }),
    });
    expect(viewerProductRes.status).toBe(201);

    const all = env.db
      .select()
      .from(products)
      .where(eq(products.shopId, admin.shopId))
      .all();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((p) => p.userId))).toEqual(
      new Set([admin.userId, viewer.userId]),
    );

    // GET /api/products returns only caller's rows.
    const viewerListRes = await env.app.request(
      `/api/products?shopId=${admin.shopId}`,
      { headers: headers(viewer.cookie) },
    );
    const viewerList = (await viewerListRes.json()) as Array<{
      input: { articleId: string };
    }>;
    expect(viewerList).toHaveLength(1);
    expect(viewerList[0].input.articleId).toBe("SHARED-1");
  });

  it("viewer's PATCH taxSettings goes to shop_user_settings, not shops", async () => {
    await grant(admin.shopId, viewer.userId);

    const next: TaxSettings = { ...SAMPLE_TAX, taxSystem: "НПД", npdRate: 0.06 };
    const res = await env.app.request(`/api/shops/${admin.shopId}`, {
      method: "PATCH",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ taxSettings: next }),
    });
    expect(res.status).toBe(200);

    const [override] = env.db
      .select()
      .from(shopUserSettings)
      .where(
        and(
          eq(shopUserSettings.shopId, admin.shopId),
          eq(shopUserSettings.userId, viewer.userId),
        ),
      )
      .all();
    expect(override?.taxSettings?.taxSystem).toBe("НПД");

    const [shopRow] = env.db
      .select()
      .from(shops)
      .where(eq(shops.id, admin.shopId))
      .all();
    // Original shop tax untouched.
    expect(shopRow.taxSettings.taxSystem).toBe(SAMPLE_TAX.taxSystem);

    // Viewer's GET /api/shops shows the override; admin's still sees defaults.
    const viewerSeen = await listShops(viewer.cookie);
    expect(
      viewerSeen.find((s) => s.id === admin.shopId)?.taxSettings.taxSystem,
    ).toBe("НПД");
    expect(
      viewerSeen.find((s) => s.id === admin.shopId)?.hasOverrides,
    ).toBe(true);
    const adminSeen = await listShops(admin.cookie);
    expect(
      adminSeen.find((s) => s.id === admin.shopId)?.taxSettings.taxSystem,
    ).toBe(SAMPLE_TAX.taxSystem);
  });

  it("viewer cannot edit owner-only fields", async () => {
    await grant(admin.shopId, viewer.userId);

    const renameRes = await env.app.request(`/api/shops/${admin.shopId}`, {
      method: "PATCH",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(renameRes.status).toBe(403);

    const credsRes = await env.app.request(
      `/api/credentials?shopId=${admin.shopId}`,
      {
        method: "PUT",
        headers: headers(viewer.cookie),
        body: JSON.stringify({ clientId: "x", apiKey: "y" }),
      },
    );
    expect(credsRes.status).toBe(403);
  });

  it("viewer cannot delete a shared shop", async () => {
    await grant(admin.shopId, viewer.userId);
    const res = await env.app.request(`/api/shops/${admin.shopId}`, {
      method: "DELETE",
      headers: headers(viewer.cookie),
    });
    // Either 404 (not in their owned shops) or 400 ("cannot delete the only shop")
    // — both indicate the action is rejected.
    expect([400, 404]).toContain(res.status);
    const [stillThere] = env.db
      .select()
      .from(shops)
      .where(eq(shops.id, admin.shopId))
      .all();
    expect(stillThere).toBeDefined();
  });

  it("revoking access wipes viewer's per-user data in that shop", async () => {
    await grant(admin.shopId, viewer.userId);

    await env.app.request("/api/products", {
      method: "POST",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ ...sampleInput("WIPED"), shopId: admin.shopId }),
    });
    env.db
      .insert(financeTransactions)
      .values({
        shopId: admin.shopId,
        userId: viewer.userId,
        operationId: 555,
        operationType: "OperationAgentDeliveredToCustomer",
        operationDate: new Date(),
        postingNumber: null,
        articleId: "WIPED",
        amount: 100,
        type: "sale",
        raw: {},
      })
      .run();
    await env.app.request(`/api/shops/${admin.shopId}`, {
      method: "PATCH",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ taxSettings: { ...SAMPLE_TAX, taxSystem: "НПД" } }),
    });

    const revokeRes = await env.app.request(
      `/api/admin/shops/${admin.shopId}/access/${viewer.userId}`,
      { method: "DELETE", headers: headers(admin.cookie) },
    );
    expect(revokeRes.status).toBe(200);

    const remainingAccess = env.db
      .select()
      .from(shopAccess)
      .where(
        and(
          eq(shopAccess.shopId, admin.shopId),
          eq(shopAccess.userId, viewer.userId),
        ),
      )
      .all();
    expect(remainingAccess).toHaveLength(0);

    const remainingProducts = env.db
      .select()
      .from(products)
      .where(
        and(
          eq(products.shopId, admin.shopId),
          eq(products.userId, viewer.userId),
        ),
      )
      .all();
    expect(remainingProducts).toHaveLength(0);

    const remainingFinance = env.db
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.shopId, admin.shopId),
          eq(financeTransactions.userId, viewer.userId),
        ),
      )
      .all();
    expect(remainingFinance).toHaveLength(0);

    const remainingOverride = env.db
      .select()
      .from(shopUserSettings)
      .where(
        and(
          eq(shopUserSettings.shopId, admin.shopId),
          eq(shopUserSettings.userId, viewer.userId),
        ),
      )
      .all();
    expect(remainingOverride).toHaveLength(0);
  });

  it("resolveCredentials in shared shop returns admin's shop key", async () => {
    // Set admin shop creds directly.
    env.db
      .update(shops)
      .set({
        ozonClientId: "admin-client",
        ozonApiKey: "admin-key",
        ozonUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, admin.shopId))
      .run();
    await grant(admin.shopId, viewer.userId);

    const creds = await resolveCredentials(env.db, admin.shopId);
    expect(creds?.clientId).toBe("admin-client");
    expect(creds?.apiKey).toBe("admin-key");
  });

  it("reset-overrides clears the viewer's row", async () => {
    await grant(admin.shopId, viewer.userId);
    await env.app.request(`/api/shops/${admin.shopId}`, {
      method: "PATCH",
      headers: headers(viewer.cookie),
      body: JSON.stringify({ taxSettings: { ...SAMPLE_TAX, taxSystem: "НПД" } }),
    });
    const seenBefore = await listShops(viewer.cookie);
    expect(
      seenBefore.find((s) => s.id === admin.shopId)?.hasOverrides,
    ).toBe(true);

    const res = await env.app.request(
      `/api/shops/${admin.shopId}/reset-overrides`,
      { method: "POST", headers: headers(viewer.cookie) },
    );
    expect(res.status).toBe(200);

    const seenAfter = await listShops(viewer.cookie);
    expect(
      seenAfter.find((s) => s.id === admin.shopId)?.taxSettings.taxSystem,
    ).toBe(SAMPLE_TAX.taxSystem);
    expect(
      seenAfter.find((s) => s.id === admin.shopId)?.hasOverrides,
    ).toBe(false);
  });

  it("non-admin cannot call admin sharing endpoints", async () => {
    const otherViewer = await loginAs(env, "stranger@test.local", "password");
    const res = await env.app.request(`/api/admin/shops`, {
      headers: headers(otherViewer.cookie),
    });
    expect(res.status).toBe(403);
  });
});
