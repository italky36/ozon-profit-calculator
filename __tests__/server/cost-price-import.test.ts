import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import {
  parseCostPriceXlsx,
  type ParsedCostRow,
} from "../../server/lib/costPriceXlsx";
import { products, sessions } from "../../server/db/schema";
import { buildApp } from "../../server/index";
import {
  createShopFor,
  createUserDirect,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv as BaseTestEnv,
} from "./_helpers";

type Row = [string | null, string | null, number | null, number | null, number | null];

const buildXlsxBuffer = (rows: Row[]): Buffer => {
  const aoa: unknown[][] = [
    ["Артикул продавца", "Наименование товара", "SKU", "Артикул OZON", "Себестоимость"],
    ...rows.map((r) => r.map((v) => (v == null ? "" : v))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe("parseCostPriceXlsx", () => {
  it("parses valid xlsx with все 5 колонок", () => {
    const buf = buildXlsxBuffer([
      ["Jl30", "Кофемашина 1", 2384163112, 2098493735, 67990],
      ["Jl36", "Кофемашина 2", 2432628463, 2161735304, 87000],
    ]);
    const res = parseCostPriceXlsx(buf);
    expect(typeof res).not.toBe("string");
    if (typeof res === "string") return;
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject<Partial<ParsedCostRow>>({
      sourceRow: 1,
      articleId: "Jl30",
      ozonSku: 2384163112,
      ozonProductId: 2098493735,
      costPrice: 67990,
    });
    expect(res.warnings).toHaveLength(0);
  });

  it("skips rows без cost_price с warning", () => {
    const buf = buildXlsxBuffer([
      ["Jl30", "С ценой", 2384163112, null, 67990],
      ["Jl40", "Без цены", 2384163113, null, null],
    ]);
    const res = parseCostPriceXlsx(buf);
    if (typeof res === "string") throw new Error(res);
    expect(res.rows).toHaveLength(1);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings[0]).toMatch(/строка 3/);
  });

  it("принимает строку с только SKU (без article_id)", () => {
    const buf = buildXlsxBuffer([
      [null, "Только SKU", 2384163112, null, 1000],
    ]);
    const res = parseCostPriceXlsx(buf);
    if (typeof res === "string") throw new Error(res);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].articleId).toBeNull();
    expect(res.rows[0].ozonSku).toBe(2384163112);
  });

  it("возвращает строку-ошибку если нет нужных заголовков", () => {
    const aoa = [["Что-то", "Совсем", "Не", "То"], ["a", "b", "c", "d"]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const res = parseCostPriceXlsx(buf);
    expect(typeof res).toBe("string");
  });
});

type TestEnv = BaseTestEnv & {
  cookie: string;
  userId: number;
  shopId: number;
};

async function setup(email: string, session: string): Promise<TestEnv> {
  const env = await setupTestEnv();
  const userId = await createUserDirect(env.db, email, "password", "user");
  const shopId = await createShopFor(env.db, userId);
  await env.db.insert(sessions).values({
    id: session,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    createdAt: new Date(),
  });
  return { ...env, cookie: `ozon_calc_session=${session}`, userId, shopId };
}

async function insertProduct(
  env: TestEnv,
  shopId: number,
  userId: number,
  opts: {
    articleId: string;
    ozonSku?: number | null;
    ozonProductId?: number | null;
    productName?: string;
    costPrice?: number;
  },
): Promise<string> {
  const now = new Date();
  const id = crypto.randomUUID();
  const workspaceId = (
    await env.db
      .select({ id: products.workspaceId })
      .from(products)
      .where(eq(products.id, "__nonexistent__"))
  )[0]?.id;
  // Берём workspaceId напрямую из shops чтобы избежать FK ошибок
  const [shop] = await env.db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.shopId, shopId))
    .limit(1);
  const wsId = workspaceId ?? shop?.workspaceId ?? (await getWorkspaceIdByShop(env, shopId));
  await env.db.insert(products).values({
    id,
    shopId,
    workspaceId: wsId,
    userId,
    articleId: opts.articleId,
    productName: opts.productName ?? "Test product",
    category: "Кофеварки и кофемашины",
    productType: "Автоматическая кофемашина",
    isKgt: false,
    isKazakhstan: false,
    isFireHazard: false,
    plannedStorageDays: 30,
    volumeL: 100,
    widthMm: 0,
    heightMm: 0,
    weightG: 0,
    vatRate: "0.05",
    redemptionPercent: 90,
    salesPlan: 10,
    logisticsMode: "Авто",
    localShare: 0.5,
    clustersCount: "Считать без наценки",
    dispatchCluster: "Москва, МО и Дальние регионы",
    destinationCluster: "Москва, МО и Дальние регионы",
    currentPrice: 0,
    discountPercent: 0,
    marketingPercent: 0,
    realFbsDeliveryCost: 0,
    realFbsReturnCost: 0,
    acceptanceTariff: "Доверительная приемка",
    costPrice: opts.costPrice ?? 0,
    extraExpensesPerUnit: 0,
    whitePurchase: null,
    incomingVatPurchase: false,
    incomingVatRate: 0,
    ozonSku: opts.ozonSku ?? null,
    ozonProductId: opts.ozonProductId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function getWorkspaceIdByShop(env: TestEnv, shopId: number): Promise<number> {
  // Помощник на случай если products ещё пуст — берём из shops.
  const { shops } = await import("../../server/db/schema");
  const [row] = await env.db
    .select({ workspaceId: shops.workspaceId })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!row) throw new Error(`no shop ${shopId}`);
  return row.workspaceId;
}

describe("POST /api/products/import-cost-price", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setup("cost-import@test.local", "cost-session");
  });
  afterEach(async () => await teardownTestEnv(env));

  const post = async (buf: Buffer, dryRun = true) => {
    const app = buildApp({ db: env.db });
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(buf)], "cost.xlsx"));
    fd.append("dryRun", dryRun ? "true" : "false");
    return await app.request("/api/products/import-cost-price", {
      method: "POST",
      headers: { Cookie: env.cookie },
      body: fd,
    });
  };

  it("dryRun возвращает отчёт но не пишет в БД", async () => {
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "Jl30",
      ozonSku: 100,
      costPrice: 10,
    });
    const buf = buildXlsxBuffer([["Jl30", null, null, null, 999]]);
    const res = await post(buf, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: Array<{ oldCostPrice: number; newCostPrice: number; matchedBy: string }>;
      didUpdate: number;
      dryRun: boolean;
    };
    expect(body.dryRun).toBe(true);
    expect(body.didUpdate).toBe(0);
    expect(body.matched).toHaveLength(1);
    expect(body.matched[0].oldCostPrice).toBe(10);
    expect(body.matched[0].newCostPrice).toBe(999);
    expect(body.matched[0].matchedBy).toBe("articleId");

    const [row] = await env.db
      .select({ costPrice: products.costPrice })
      .from(products)
      .where(eq(products.articleId, "Jl30"));
    expect(row.costPrice).toBe(10);
  });

  it("apply пишет cost_price", async () => {
    const productId = await insertProduct(env, env.shopId, env.userId, {
      articleId: "Jl30",
      costPrice: 10,
    });
    const buf = buildXlsxBuffer([["Jl30", null, null, null, 999]]);
    const res = await post(buf, false);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { didUpdate: number; matched: unknown[] };
    expect(body.didUpdate).toBe(1);
    expect(body.matched).toHaveLength(1);

    const [row] = await env.db
      .select({ costPrice: products.costPrice })
      .from(products)
      .where(eq(products.id, productId));
    expect(row.costPrice).toBe(999);
  });

  it("каскад: article_id миссит → SKU матчит", async () => {
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "REAL-ART",
      ozonSku: 5555,
      costPrice: 10,
    });
    // В файле article_id не совпадает с тем что в БД, но SKU совпадает
    const buf = buildXlsxBuffer([["WRONG-ART", null, 5555, null, 777]]);
    const res = await post(buf, false);
    const body = (await res.json()) as {
      matched: Array<{ matchedBy: string; newCostPrice: number }>;
      didUpdate: number;
    };
    expect(body.didUpdate).toBe(1);
    expect(body.matched[0].matchedBy).toBe("ozonSku");
  });

  it("каскад: ни article_id, ни SKU — fallback на ozon_product_id", async () => {
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "REAL-ART",
      ozonSku: null,
      ozonProductId: 99999,
      costPrice: 10,
    });
    const buf = buildXlsxBuffer([[null, null, null, 99999, 333]]);
    const res = await post(buf, false);
    const body = (await res.json()) as {
      matched: Array<{ matchedBy: string }>;
      didUpdate: number;
    };
    expect(body.didUpdate).toBe(1);
    expect(body.matched[0].matchedBy).toBe("ozonProductId");
  });

  it("not_found когда нет совпадений ни по одному ключу", async () => {
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "A",
      ozonSku: 1,
      ozonProductId: 1,
      costPrice: 10,
    });
    const buf = buildXlsxBuffer([["B", null, 2, 2, 50]]);
    const res = await post(buf, false);
    const body = (await res.json()) as {
      notFound: unknown[];
      didUpdate: number;
    };
    expect(body.didUpdate).toBe(0);
    expect(body.notFound).toHaveLength(1);
  });

  it("per-user изоляция: чужой товар не обновляется", async () => {
    // Создаём второго юзера в том же env (TRUNCATE между ними сбросил бы данные).
    const otherUserId = await createUserDirect(
      env.db,
      "other@test.local",
      "password",
      "user",
    );
    const otherShopId = await createShopFor(env.db, otherUserId);
    // Чужой товар у другого юзера в его собственном shop'е
    await insertProduct(env, otherShopId, otherUserId, {
      articleId: "FOREIGN",
      costPrice: 10,
    });
    // Свой товар у current юзера
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "FOREIGN",
      costPrice: 20,
    });

    const buf = buildXlsxBuffer([["FOREIGN", null, null, null, 5555]]);
    const res = await post(buf, false);
    const body = (await res.json()) as { didUpdate: number };
    // Обновится только у current юзера
    expect(body.didUpdate).toBe(1);

    // У другого юзера cost_price остался прежним (visibleShopIds(env.user)
    // не включает otherShopId, потому что другой workspace).
    const [foreignRow] = await env.db
      .select({ costPrice: products.costPrice })
      .from(products)
      .where(eq(products.userId, otherUserId));
    expect(foreignRow.costPrice).toBe(10);
  });

  it("unchanged когда new == old — не пишет UPDATE", async () => {
    await insertProduct(env, env.shopId, env.userId, {
      articleId: "Same",
      costPrice: 555,
    });
    const buf = buildXlsxBuffer([["Same", null, null, null, 555]]);
    const res = await post(buf, false);
    const body = (await res.json()) as {
      matched: unknown[];
      unchanged: unknown[];
      didUpdate: number;
    };
    expect(body.matched).toHaveLength(0);
    expect(body.unchanged).toHaveLength(1);
    expect(body.didUpdate).toBe(0);
  });

  it("400 если файл не приложен", async () => {
    const app = buildApp({ db: env.db });
    const fd = new FormData();
    fd.append("dryRun", "true");
    const res = await app.request("/api/products/import-cost-price", {
      method: "POST",
      headers: { Cookie: env.cookie },
      body: fd,
    });
    expect(res.status).toBe(400);
  });

  it("400 если файл с кривыми заголовками", async () => {
    const aoa = [["Не", "То"], ["a", "b"]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const res = await post(buf, true);
    expect(res.status).toBe(400);
  });
});
