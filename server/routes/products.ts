import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { products, type ProductRow as DbProduct } from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { resolveShopId, visibleShopIds } from "../middleware/session";
import { isUniqueViolation } from "../lib/pgErrors";
import { parseCostPriceXlsx } from "../lib/costPriceXlsx";
import { shops } from "../db/schema";
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
  shopId: r.shopId,
  ozonProductId: r.ozonProductId ?? null,
  ozonCommissions: r.ozonCommissions ?? null,
  ozonCommissionsUpdatedAt: r.ozonCommissionsUpdatedAt
    ? r.ozonCommissionsUpdatedAt.getTime()
    : null,
  regularPrice: r.regularPrice ?? null,
  ozonSku: r.ozonSku ?? null,
  ozonArchived: r.ozonArchived ?? null,
  ozonVisible: r.ozonVisible ?? null,
  ozonStatusName: r.ozonStatusName ?? null,
  ozonStatusDescription: r.ozonStatusDescription ?? null,
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
    depthMm: r.depthMm ?? null,
    widthMm: r.widthMm ?? null,
    heightMm: r.heightMm ?? null,
    weightG: r.weightG ?? null,
    vatRate: parseVatRate(r.vatRate),
    redemptionPercent: r.redemptionPercent,
    salesPlan: r.salesPlan,
    logisticsMode: r.logisticsMode as ProductInput["logisticsMode"],
    localShare: r.localShare,
    clustersCount: parseClustersCount(r.clustersCount),
    dispatchCluster: r.dispatchCluster,
    destinationCluster: r.destinationCluster,
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
  depthMm: i.depthMm,
  widthMm: i.widthMm,
  heightMm: i.heightMm,
  weightG: i.weightG,
  vatRate: String(i.vatRate),
  redemptionPercent: i.redemptionPercent,
  salesPlan: i.salesPlan,
  logisticsMode: i.logisticsMode,
  localShare: i.localShare,
  clustersCount: String(i.clustersCount),
  dispatchCluster: i.dispatchCluster,
  destinationCluster: i.destinationCluster,
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
    "dispatchCluster",
    "destinationCluster",
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

type ProductsEnv = { Variables: { user: SessionUser } };

/** Returns the shopId scope for the current request:
 *   - explicit `?shopId=N` → that single shop (validated against workspace);
 *   - missing → every shop in the workspace. */
const scopeShopIds = async (
  db: DB,
  user: SessionUser,
  explicit: string | undefined,
): Promise<number[] | { error: string; status: 400 | 404 }> => {
  if (explicit !== undefined && explicit !== "") {
    try {
      const id = await resolveShopId(db, user, { explicit });
      if (!id) return { error: "no shop available", status: 400 };
      return [id];
    } catch (e) {
      const err = e as Error & { status?: number };
      return {
        error: err.message,
        status: (err.status as 400 | 404) ?? 400,
      };
    }
  }
  return await visibleShopIds(db, user);
};

export function productsRoutes(db: DB): Hono<ProductsEnv> {
  const app = new Hono<ProductsEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);
    if (scope.length === 0) return c.json([]);
    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          inArray(products.shopId, scope),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      )
      .orderBy(products.createdAt);
    return c.json(rows.map(dbToRow));
  });

  app.post("/", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const bodyShopId = (body as { shopId?: unknown } | null)?.shopId;
    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: bodyShopId as never });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);

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
        shopId,
        workspaceId: user.workspaceId,
        userId: user.id,
        ...inputToColumns(input),
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "articleId already exists" }, 409);
      }
      return c.json({ error: (e as Error).message }, 500);
    }
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return c.json(dbToRow(row), 201);
  });

  /** Verifies that product `id` exists for the current user. Returns shopId
   * on success. The `(workspace_id, user_id)` filter is essential — without
   * user_id another assignee's row with the same UUID would be hit. */
  const requireOwnership = async (
    user: SessionUser,
    id: string,
  ): Promise<number | null> => {
    const [row] = await db
      .select({ shopId: products.shopId })
      .from(products)
      .where(
        and(
          eq(products.id, id),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );
    return row?.shopId ?? null;
  };

  app.patch("/:id", async (c) => {
    const user = c.get("user");
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
    const ownerShopId = await requireOwnership(user, id);
    if (!ownerShopId) return c.json({ error: "not found" }, 404);

    try {
      await db
        .update(products)
        .set({ ...inputToColumns(input), updatedAt: new Date() })
        .where(eq(products.id, id));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "articleId already exists" }, 409);
      }
      return c.json({ error: (e as Error).message }, 500);
    }
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return c.json(dbToRow(row));
  });

  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const ownerShopId = await requireOwnership(user, id);
    if (!ownerShopId) return c.json({ error: "not found" }, 404);
    await db.delete(products).where(eq(products.id, id));
    return c.body(null, 204);
  });

  // Bulk reset whitePurchase to NULL ("По умолчанию"). Scope: либо
  // ?shopId=N, либо все магазины workspace'а.
  app.post("/bulk/white-purchase-reset", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);
    if (scope.length === 0) return c.json({ updated: 0 });
    const result = await db
      .update(products)
      .set({ whitePurchase: null })
      .where(
        and(
          inArray(products.shopId, scope),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );
    return c.json({ updated: result.rowCount ?? 0 });
  });

  // Bulk-update arbitrary subset of products. Supported fields:
  //   - whitePurchase: boolean | null
  //   - vatRate: VatRate
  app.post("/bulk/update", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => null)) as
      | {
          ids?: unknown;
          patch?: {
            whitePurchase?: unknown;
            vatRate?: unknown;
          };
        }
      | null;
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "ids[] required" }, 400);
    }
    const ids = body.ids.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return c.json({ error: "ids[] empty" }, 400);

    const patch: Record<string, unknown> = {};
    const p = body.patch ?? {};
    if ("whitePurchase" in p) {
      const v = p.whitePurchase;
      if (v === null || typeof v === "boolean") {
        patch.whitePurchase = v;
      } else {
        return c.json({ error: "whitePurchase must be boolean | null" }, 400);
      }
    }
    if ("vatRate" in p) {
      try {
        const parsed = parseVatRate(String(p.vatRate));
        patch.vatRate = String(parsed);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "patch is empty" }, 400);
    }

    const scope = await scopeShopIds(db, user, undefined);
    if (!Array.isArray(scope) || scope.length === 0)
      return c.json({ updated: 0 });
    const result = await db
      .update(products)
      .set(patch)
      .where(
        and(
          inArray(products.id, ids),
          inArray(products.shopId, scope),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );
    return c.json({ updated: result.rowCount ?? 0 });
  });

  app.post("/import-cost-price", async (c) => {
    const user = c.get("user");
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "expected multipart form" }, 400);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file required" }, 400);
    }
    const dryRun = form.get("dryRun") !== "false"; // default true
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseCostPriceXlsx(buf);
    if (typeof parsed === "string") {
      return c.json({ error: parsed }, 400);
    }

    const scope = await visibleShopIds(db, user);
    if (scope.length === 0) {
      return c.json({
        totalRows: parsed.rows.length,
        parsed: parsed.rows.length,
        matched: [],
        unchanged: [],
        notFound: parsed.rows.map((r) => ({
          sourceRow: r.sourceRow,
          articleId: r.articleId,
          ozonSku: r.ozonSku,
          ozonProductId: r.ozonProductId,
          productName: r.productName,
          newCostPrice: r.costPrice,
        })),
        duplicates: [],
        warnings: parsed.warnings,
        dryRun,
        didUpdate: 0,
      });
    }

    // Все per-user товары в видимых shops — для cascade matching в памяти.
    const userProducts = await db
      .select({
        id: products.id,
        shopId: products.shopId,
        shopShortName: shops.shortName,
        articleId: products.articleId,
        ozonSku: products.ozonSku,
        ozonProductId: products.ozonProductId,
        productName: products.productName,
        costPrice: products.costPrice,
      })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .where(
        and(
          inArray(products.shopId, scope),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );

    // Multimaps — один ключ может соответствовать нескольким товарам, если
    // юзер держит одинаковый article_id в двух разных shops.
    const byArticleId = new Map<string, typeof userProducts>();
    const byOzonSku = new Map<number, typeof userProducts>();
    const byOzonProductId = new Map<number, typeof userProducts>();
    for (const p of userProducts) {
      const ap = byArticleId.get(p.articleId) ?? [];
      ap.push(p);
      byArticleId.set(p.articleId, ap);
      if (p.ozonSku != null) {
        const sp = byOzonSku.get(p.ozonSku) ?? [];
        sp.push(p);
        byOzonSku.set(p.ozonSku, sp);
      }
      if (p.ozonProductId != null) {
        const pp = byOzonProductId.get(p.ozonProductId) ?? [];
        pp.push(p);
        byOzonProductId.set(p.ozonProductId, pp);
      }
    }

    type FoundRow = (typeof userProducts)[number];
    const matched: Array<{
      sourceRow: number;
      productId: string;
      articleId: string;
      productName: string;
      shopShortName: string;
      oldCostPrice: number;
      newCostPrice: number;
      matchedBy: "articleId" | "ozonSku" | "ozonProductId";
    }> = [];
    const unchanged: typeof matched = [];
    const notFound: Array<{
      sourceRow: number;
      articleId: string | null;
      ozonSku: number | null;
      ozonProductId: number | null;
      productName: string | null;
      newCostPrice: number;
    }> = [];
    const duplicateKeys = new Set<string>();

    const pushHit = (
      row: (typeof parsed.rows)[number],
      hits: FoundRow[],
      by: "articleId" | "ozonSku" | "ozonProductId",
    ) => {
      if (hits.length > 1) {
        duplicateKeys.add(`${by}:${row.sourceRow}`);
      }
      for (const p of hits) {
        const target = (p.costPrice === row.costPrice ? unchanged : matched);
        target.push({
          sourceRow: row.sourceRow,
          productId: p.id,
          articleId: p.articleId,
          productName: p.productName,
          shopShortName: p.shopShortName,
          oldCostPrice: p.costPrice,
          newCostPrice: row.costPrice,
          matchedBy: by,
        });
      }
    };

    for (const row of parsed.rows) {
      const byA = row.articleId ? byArticleId.get(row.articleId) : undefined;
      if (byA && byA.length > 0) {
        pushHit(row, byA, "articleId");
        continue;
      }
      const byS = row.ozonSku != null ? byOzonSku.get(row.ozonSku) : undefined;
      if (byS && byS.length > 0) {
        pushHit(row, byS, "ozonSku");
        continue;
      }
      const byP =
        row.ozonProductId != null
          ? byOzonProductId.get(row.ozonProductId)
          : undefined;
      if (byP && byP.length > 0) {
        pushHit(row, byP, "ozonProductId");
        continue;
      }
      notFound.push({
        sourceRow: row.sourceRow,
        articleId: row.articleId,
        ozonSku: row.ozonSku,
        ozonProductId: row.ozonProductId,
        productName: row.productName,
        newCostPrice: row.costPrice,
      });
    }

    let didUpdate = 0;
    if (!dryRun && matched.length > 0) {
      // Group по newCostPrice — один UPDATE на каждое уникальное значение.
      const byNewPrice = new Map<number, string[]>();
      for (const m of matched) {
        const arr = byNewPrice.get(m.newCostPrice) ?? [];
        arr.push(m.productId);
        byNewPrice.set(m.newCostPrice, arr);
      }
      for (const [price, ids] of byNewPrice) {
        const res = await db
          .update(products)
          .set({ costPrice: price, updatedAt: new Date() })
          .where(
            and(
              inArray(products.id, ids),
              inArray(products.shopId, scope),
              eq(products.workspaceId, user.workspaceId),
              eq(products.userId, user.id),
            ),
          );
        didUpdate += res.rowCount ?? 0;
      }
    }

    return c.json({
      totalRows: parsed.rows.length,
      parsed: parsed.rows.length,
      matched,
      unchanged,
      notFound,
      duplicates: Array.from(duplicateKeys),
      warnings: parsed.warnings,
      dryRun,
      didUpdate,
    });
  });

  app.post("/bulk/delete", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => null)) as
      | { ids?: unknown }
      | null;
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "ids[] required" }, 400);
    }
    const ids = body.ids.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return c.json({ error: "ids[] empty" }, 400);
    const scope = await scopeShopIds(db, user, undefined);
    if (!Array.isArray(scope) || scope.length === 0)
      return c.json({ deleted: 0 });
    const result = await db
      .delete(products)
      .where(
        and(
          inArray(products.id, ids),
          inArray(products.shopId, scope),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );
    return c.json({ deleted: result.rowCount ?? 0 });
  });

  return app;
}
