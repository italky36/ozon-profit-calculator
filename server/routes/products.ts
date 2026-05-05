import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { products, type ProductRow as DbProduct } from "../db/schema";
import type { DB } from "../db/client";
import type {
  ClustersCount,
  IncomingVatRate,
  ProductInput,
  ProductRow,
  VatRate,
} from "../../src/types";
import { randomUUID } from "node:crypto";

const parseVatRate = (s: string): VatRate => {
  if (s === "Не облагается") return s;
  const n = Number(s);
  if (n === 0.05 || n === 0.07 || n === 0.1 || n === 0.22) return n as VatRate;
  throw new Error(`invalid vatRate: ${s}`);
};

const parseClustersCount = (s: string): ClustersCount => {
  if (s === "Считать без наценки") return s;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  throw new Error(`invalid clustersCount: ${s}`);
};

const parseIncomingVatRate = (n: number): IncomingVatRate => {
  if (n === 0 || n === 0.05 || n === 0.07 || n === 0.1 || n === 0.22)
    return n as IncomingVatRate;
  throw new Error(`invalid incomingVatRate: ${n}`);
};

const dbToRow = (r: DbProduct): ProductRow => ({
  id: r.id,
  ozonProductId: r.ozonProductId ?? null,
  ozonCommissions: r.ozonCommissions ?? null,
  ozonCommissionsUpdatedAt: r.ozonCommissionsUpdatedAt
    ? r.ozonCommissionsUpdatedAt.getTime()
    : null,
  regularPrice: r.regularPrice ?? null,
  ozonSku: r.ozonSku ?? null,
  input: {
    articleId: r.articleId,
    productName: r.productName,
    category: r.category,
    productType: r.productType,
    isKgt: r.isKgt,
    isKazakhstan: r.isKazakhstan,
    isFireHazard: r.isFireHazard,
    plannedStorageDays: r.plannedStorageDays,
    volumeL: r.volumeL,
    vatRate: parseVatRate(r.vatRate),
    redemptionPercent: r.redemptionPercent,
    salesPlan: r.salesPlan,
    logisticsMode: r.logisticsMode as ProductInput["logisticsMode"],
    localShare: r.localShare,
    clustersCount: parseClustersCount(r.clustersCount),
    currentPrice: r.currentPrice,
    discountPercent: r.discountPercent,
    marketingPercent: r.marketingPercent,
    realFbsDeliveryCost: r.realFbsDeliveryCost,
    realFbsReturnCost: r.realFbsReturnCost,
    acceptanceTariff: r.acceptanceTariff as ProductInput["acceptanceTariff"],
    costPrice: r.costPrice,
    extraExpensesPerUnit: r.extraExpensesPerUnit,
    whitePurchase: r.whitePurchase,
    incomingVatPurchase: r.incomingVatPurchase,
    incomingVatRate: parseIncomingVatRate(r.incomingVatRate),
  },
});

const inputToColumns = (i: ProductInput) => ({
  articleId: i.articleId,
  productName: i.productName,
  category: i.category,
  productType: i.productType,
  isKgt: i.isKgt,
  isKazakhstan: i.isKazakhstan,
  isFireHazard: i.isFireHazard,
  plannedStorageDays: i.plannedStorageDays,
  volumeL: i.volumeL,
  vatRate: String(i.vatRate),
  redemptionPercent: i.redemptionPercent,
  salesPlan: i.salesPlan,
  logisticsMode: i.logisticsMode,
  localShare: i.localShare,
  clustersCount: String(i.clustersCount),
  currentPrice: i.currentPrice,
  discountPercent: i.discountPercent,
  marketingPercent: i.marketingPercent,
  realFbsDeliveryCost: i.realFbsDeliveryCost,
  realFbsReturnCost: i.realFbsReturnCost,
  acceptanceTariff: i.acceptanceTariff,
  costPrice: i.costPrice,
  extraExpensesPerUnit: i.extraExpensesPerUnit,
  whitePurchase: i.whitePurchase,
  incomingVatPurchase: i.incomingVatPurchase,
  incomingVatRate: i.incomingVatRate,
});

const validateInput = (raw: unknown): ProductInput => {
  if (!raw || typeof raw !== "object") throw new Error("invalid input");
  const i = raw as Partial<ProductInput>;
  const required: Array<keyof ProductInput> = [
    "articleId",
    "productName",
    "category",
    "productType",
    "plannedStorageDays",
    "volumeL",
    "vatRate",
    "redemptionPercent",
    "salesPlan",
    "logisticsMode",
    "localShare",
    "clustersCount",
    "currentPrice",
    "discountPercent",
    "marketingPercent",
    "realFbsDeliveryCost",
    "realFbsReturnCost",
    "acceptanceTariff",
    "costPrice",
    "extraExpensesPerUnit",
    "incomingVatRate",
  ];
  for (const k of required) {
    if (i[k] === undefined || i[k] === null)
      throw new Error(`missing field: ${k}`);
  }
  // Round-trip through stringification to validate enum-ish values.
  parseVatRate(String(i.vatRate));
  parseClustersCount(String(i.clustersCount));
  parseIncomingVatRate(Number(i.incomingVatRate));
  return i as ProductInput;
};

export function productsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db.select().from(products).orderBy(products.createdAt);
    return c.json(rows.map(dbToRow));
  });

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    let input: ProductInput;
    try {
      input = validateInput(body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const id = randomUUID();
    const now = new Date();
    try {
      await db.insert(products).values({
        id,
        ...inputToColumns(input),
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "articleId already exists" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return c.json(dbToRow(row), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    let input: ProductInput;
    try {
      input = validateInput(body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const existing = await db.select().from(products).where(eq(products.id, id));
    if (existing.length === 0) return c.json({ error: "not found" }, 404);

    try {
      await db
        .update(products)
        .set({ ...inputToColumns(input), updatedAt: new Date() })
        .where(eq(products.id, id));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "articleId already exists" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return c.json(dbToRow(row));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const result = await db.delete(products).where(eq(products.id, id));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });

  return app;
}
