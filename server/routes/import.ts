import { Hono } from "hono";
import { desc, eq, isNull } from "drizzle-orm";
import { financeTransactions, importRuns, products } from "../db/schema";
import type { OzonCommissions } from "../../src/types";
import type { DB } from "../db/client";
import { createOzonClient, resolveCredentials, type OzonClient } from "../ozon/client";
import {
  getCategoryLookup,
  getProductsInfo,
  getPrices,
  iterateProductList,
} from "../ozon/catalog";
import {
  iterateTransactions,
  type TransactionFilter,
} from "../ozon/finance";
import { classifyOperationType } from "../ozon/classifyOperation";
import {
  mapCatalogEntry,
  NEW_PRODUCT_DEFAULTS,
  type CatalogPatch,
} from "../ozon/mapToProduct";
import { randomUUID } from "node:crypto";

export interface ImportContext {
  /** Override Ozon client (for tests). */
  ozonClient?: OzonClient;
}

interface RunCounters {
  itemsProcessed: number;
  added: number;
  updated: number;
  unmatched: number;
}

/** Pure orchestrator — exported for tests. */
export async function runCatalogImport(
  db: DB,
  client: OzonClient,
  onProgress: (counters: RunCounters) => void = () => {},
): Promise<RunCounters> {
  const counters: RunCounters = {
    itemsProcessed: 0,
    added: 0,
    updated: 0,
    unmatched: 0,
  };

  const categories = await getCategoryLookup(client);

  for await (const page of iterateProductList(client)) {
    const [infos, priceMap] = await Promise.all([
      getProductsInfo(client, page.productIds),
      getPrices(client, page.productIds),
    ]);

    const mapped = infos.map((info) =>
      mapCatalogEntry(info, priceMap.get(info.id), categories),
    );

    db.transaction((tx) => {
      for (const entry of mapped) {
        const [existing] = tx
          .select()
          .from(products)
          .where(eq(products.articleId, entry.articleId))
          .all();

        if (existing) {
          // Update only catalog fields. Local fields remain.
          const patch: CatalogPatch & { updatedAt: Date } = {
            ...entry.patch,
            updatedAt: new Date(),
          };
          const commissionsUpdate: {
            ozonCommissions?: OzonCommissions | null;
            ozonCommissionsUpdatedAt?: Date | null;
          } = entry.ozonCommissions
            ? {
                ozonCommissions: entry.ozonCommissions,
                ozonCommissionsUpdatedAt: patch.updatedAt,
              }
            : {};
          const costPriceUpdate =
            entry.costPrice != null ? { costPrice: entry.costPrice } : {};
          const skuUpdate =
            entry.ozonSku != null ? { ozonSku: entry.ozonSku } : {};
          tx.update(products)
            .set({
              productName: patch.productName,
              category: patch.category,
              productType: patch.productType,
              volumeL: patch.volumeL,
              vatRate: String(patch.vatRate),
              isKgt: patch.isKgt,
              currentPrice: patch.currentPrice,
              regularPrice: patch.regularPrice,
              discountPercent: patch.discountPercent,
              ozonProductId: patch.ozonProductId,
              updatedAt: patch.updatedAt,
              ...costPriceUpdate,
              ...skuUpdate,
              ...commissionsUpdate,
            })
            .where(eq(products.articleId, entry.articleId))
            .run();
          if (!entry.patch.category || !entry.patch.productType) {
            counters.unmatched++;
          }
          counters.updated++;
        } else {
          if (!entry.patch.category || !entry.patch.productType) {
            // Skip insert when category resolution failed — would later fail
            // calc lookups and confuse the user. Log via counter.
            counters.unmatched++;
            continue;
          }
          const now = new Date();
          tx.insert(products)
            .values({
              ...NEW_PRODUCT_DEFAULTS,
              clustersCount: String(NEW_PRODUCT_DEFAULTS.clustersCount),
              id: randomUUID(),
              articleId: entry.articleId,
              productName: entry.patch.productName,
              category: entry.patch.category,
              productType: entry.patch.productType,
              volumeL: entry.patch.volumeL,
              vatRate: String(entry.patch.vatRate),
              isKgt: entry.patch.isKgt,
              currentPrice: entry.patch.currentPrice,
              regularPrice: entry.patch.regularPrice,
              discountPercent: entry.patch.discountPercent,
              ozonProductId: entry.patch.ozonProductId,
              ozonSku: entry.ozonSku,
              costPrice: entry.costPrice ?? NEW_PRODUCT_DEFAULTS.costPrice,
              createdAt: now,
              updatedAt: now,
              ozonCommissions: entry.ozonCommissions,
              ozonCommissionsUpdatedAt: entry.ozonCommissions ? now : null,
            })
            .run();
          counters.added++;
        }
        counters.itemsProcessed++;
      }
    });

    onProgress({ ...counters });
  }

  return counters;
}

export interface FinanceCounters {
  itemsProcessed: number;
  inserted: number;
  skipped: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;

const toIsoStartOfDay = (s: string): string =>
  s.includes("T") ? s : `${s}T00:00:00.000Z`;
const toIsoEndOfDay = (s: string): string =>
  s.includes("T") ? s : `${s}T23:59:59.999Z`;

/** Build sku → articleId map from products. Used as a fallback when finance
 * operations have items[].sku but not items[].offer_id (older Ozon ops). */
const buildSkuMap = async (db: DB): Promise<Map<number, string>> => {
  const rows = await db
    .select({ sku: products.ozonSku, articleId: products.articleId })
    .from(products);
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.sku != null) map.set(r.sku, r.articleId);
  }
  return map;
};

/** Pure orchestrator for finance import — exported for tests. */
export async function runFinanceImport(
  db: DB,
  client: OzonClient,
  filter: TransactionFilter,
  onProgress: (counters: FinanceCounters) => void = () => {},
): Promise<FinanceCounters> {
  const counters: FinanceCounters = {
    itemsProcessed: 0,
    inserted: 0,
    skipped: 0,
  };

  const skuMap = await buildSkuMap(db);

  const resolveArticle = (op: {
    items?: Array<{ sku?: number; offer_id?: string }>;
  }): string | null => {
    if (!op.items?.length) return null;
    for (const it of op.items) {
      if (it.offer_id) return it.offer_id;
    }
    for (const it of op.items) {
      if (typeof it.sku === "number") {
        const a = skuMap.get(it.sku);
        if (a) return a;
      }
    }
    return null;
  };

  for await (const page of iterateTransactions(client, filter)) {
    db.transaction((tx) => {
      for (const op of page) {
        const articleId = resolveArticle(op);
        const result = tx
          .insert(financeTransactions)
          .values({
            operationId: op.operation_id,
            operationType: op.operation_type,
            operationDate: new Date(op.operation_date),
            postingNumber: op.posting?.posting_number ?? null,
            articleId,
            amount: op.amount,
            type: classifyOperationType(op.operation_type),
            raw: op,
          })
          .onConflictDoNothing()
          .run();
        if (result.changes > 0) counters.inserted++;
        else counters.skipped++;
        counters.itemsProcessed++;
      }
    });
    onProgress({ ...counters });
  }
  return counters;
}

export function importRoutes(db: DB, ctx: ImportContext = {}): Hono {
  const app = new Hono();

  app.post("/catalog", async (c) => {
    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db);
      if (!creds) {
        return c.json(
          { error: "ozon credentials not configured" },
          400,
        );
      }
      client = createOzonClient({ creds });
    }

    const startedAt = new Date();
    const [run] = await db
      .insert(importRuns)
      .values({
        kind: "catalog",
        startedAt,
        status: "running",
        itemsProcessed: 0,
        params: { source: "ozon" },
      })
      .returning();

    // Fire-and-forget. Single-tenant, no queue needed.
    void (async () => {
      try {
        const counters = await runCatalogImport(db, client, (c2) => {
          db.update(importRuns)
            .set({ itemsProcessed: c2.itemsProcessed })
            .where(eq(importRuns.id, run.id))
            .run();
        });
        await db
          .update(importRuns)
          .set({
            status: "ok",
            finishedAt: new Date(),
            itemsProcessed: counters.itemsProcessed,
            params: { ...counters },
          })
          .where(eq(importRuns.id, run.id));
      } catch (e) {
        await db
          .update(importRuns)
          .set({
            status: "error",
            finishedAt: new Date(),
            errorMessage: (e as Error).message,
          })
          .where(eq(importRuns.id, run.id));
      }
    })();

    return c.json({ runId: run.id });
  });

  app.post("/finance", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { from, to, transactionType } = (body ?? {}) as {
      from?: unknown;
      to?: unknown;
      transactionType?: unknown;
    };
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !ISO_DATE_RE.test(from) ||
      !ISO_DATE_RE.test(to)
    ) {
      return c.json({ error: "from/to must be ISO date strings" }, 400);
    }
    const filter: TransactionFilter = {
      from: toIsoStartOfDay(from),
      to: toIsoEndOfDay(to),
      transactionType:
        typeof transactionType === "string" ? transactionType : undefined,
    };

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    const startedAt = new Date();
    const [run] = await db
      .insert(importRuns)
      .values({
        kind: "finance",
        startedAt,
        status: "running",
        itemsProcessed: 0,
        params: { from: filter.from, to: filter.to },
      })
      .returning();

    void (async () => {
      try {
        const counters = await runFinanceImport(db, client, filter, (c2) => {
          db.update(importRuns)
            .set({ itemsProcessed: c2.itemsProcessed })
            .where(eq(importRuns.id, run.id))
            .run();
        });
        await db
          .update(importRuns)
          .set({
            status: "ok",
            finishedAt: new Date(),
            itemsProcessed: counters.itemsProcessed,
            params: { from: filter.from, to: filter.to, ...counters },
          })
          .where(eq(importRuns.id, run.id));
      } catch (e) {
        await db
          .update(importRuns)
          .set({
            status: "error",
            finishedAt: new Date(),
            errorMessage: (e as Error).message,
          })
          .where(eq(importRuns.id, run.id));
      }
    })();

    return c.json({ runId: run.id });
  });

  app.get("/runs/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const [row] = await db
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, id));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  });

  app.get("/runs", async (c) => {
    const rows = await db
      .select()
      .from(importRuns)
      .orderBy(desc(importRuns.startedAt))
      .limit(50);
    return c.json(rows);
  });

  // Refresh catalog data for a single SKU on demand. Useful when the user
  // wants to pull the latest price/promo without re-running the full import.
  // Updates only the catalog fields; local fields stay intact. Returns 404 if
  // the article isn't in the local DB or wasn't found in Ozon.
  app.post("/catalog/refresh/:articleId", async (c) => {
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    const [existing] = await db
      .select()
      .from(products)
      .where(eq(products.articleId, articleId));
    if (!existing) return c.json({ error: "product not found" }, 404);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    try {
      const categories = await getCategoryLookup(client);
      const productIdHint = existing.ozonProductId
        ? [existing.ozonProductId]
        : [];
      const [infos, priceMap] = await Promise.all([
        productIdHint.length
          ? getProductsInfo(client, productIdHint)
          : (async () => {
              const out: Awaited<ReturnType<typeof getProductsInfo>> = [];
              for await (const page of iterateProductList(client)) {
                const idx = page.offerIds.indexOf(articleId);
                if (idx >= 0) {
                  const infos2 = await getProductsInfo(client, [
                    page.productIds[idx],
                  ]);
                  out.push(...infos2);
                  break;
                }
              }
              return out;
            })(),
        productIdHint.length
          ? getPrices(client, productIdHint)
          : Promise.resolve(new Map()),
      ]);
      const info = infos.find((i) => i.offer_id === articleId) ?? infos[0];
      if (!info) return c.json({ error: "not found in Ozon catalog" }, 404);

      const priceItem =
        priceMap.get(info.id) ??
        (await (async () => {
          // If we resolved info via product_list scan, also fetch its price.
          const m = await getPrices(client, [info.id]);
          return m.get(info.id);
        })());

      const entry = mapCatalogEntry(info, priceItem, categories);

      const now = new Date();
      const commissionsUpdate: {
        ozonCommissions?: OzonCommissions | null;
        ozonCommissionsUpdatedAt?: Date | null;
      } = entry.ozonCommissions
        ? {
            ozonCommissions: entry.ozonCommissions,
            ozonCommissionsUpdatedAt: now,
          }
        : {};
      const costPriceUpdate =
        entry.costPrice != null ? { costPrice: entry.costPrice } : {};
      const skuUpdate =
        entry.ozonSku != null ? { ozonSku: entry.ozonSku } : {};
      db.update(products)
        .set({
          productName: entry.patch.productName,
          category: entry.patch.category || existing.category,
          productType: entry.patch.productType || existing.productType,
          volumeL: entry.patch.volumeL,
          vatRate: String(entry.patch.vatRate),
          isKgt: entry.patch.isKgt,
          currentPrice: entry.patch.currentPrice,
          regularPrice: entry.patch.regularPrice,
          discountPercent: entry.patch.discountPercent,
          ozonProductId: entry.patch.ozonProductId,
          updatedAt: now,
          ...costPriceUpdate,
          ...skuUpdate,
          ...commissionsUpdate,
        })
        .where(eq(products.articleId, articleId))
        .run();

      return c.json({
        ok: true,
        articleId,
        currentPrice: entry.patch.currentPrice,
        regularPrice: entry.patch.regularPrice,
        discountPercent: entry.patch.discountPercent,
        costPrice: entry.costPrice,
        ozonSku: entry.ozonSku,
        ozonCommissions: entry.ozonCommissions,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Backfill articleId for finance_transactions rows that came in with
  // items[].sku but no items[].offer_id (Ozon's API quirk on older ops).
  // Walks rows where article_id IS NULL, checks raw.items[].sku against
  // products.ozon_sku, updates row when match is found.
  app.post("/finance/relink", async (c) => {
    const skuMap = await buildSkuMap(db);
    if (skuMap.size === 0) {
      return c.json({ ok: true, scanned: 0, linked: 0, note: "no SKU data" });
    }
    const orphans = await db
      .select()
      .from(financeTransactions)
      .where(isNull(financeTransactions.articleId));

    let linked = 0;
    db.transaction((tx) => {
      for (const r of orphans) {
        const raw = (r.raw ?? {}) as {
          items?: Array<{ sku?: number; offer_id?: string }>;
        };
        const items = raw.items ?? [];
        let articleId: string | null = null;
        for (const it of items) {
          if (it.offer_id) {
            articleId = it.offer_id;
            break;
          }
        }
        if (!articleId) {
          for (const it of items) {
            if (typeof it.sku === "number") {
              const a = skuMap.get(it.sku);
              if (a) {
                articleId = a;
                break;
              }
            }
          }
        }
        if (articleId) {
          tx.update(financeTransactions)
            .set({ articleId })
            .where(eq(financeTransactions.operationId, r.operationId))
            .run();
          linked++;
        }
      }
    });
    return c.json({ ok: true, scanned: orphans.length, linked });
  });

  // Aggregate already-imported finance_transactions for a single article.
  // Useful when /v5/product/info/prices says one thing but the storefront /
  // actual buyer payment differs — this lets us verify what Ozon really
  // credited per sale. Includes grand-total since first import (Ozon's own
  // /finance API caps at ~30 days; we keep history forever locally).
  app.get("/debug/finance/:articleId", async (c) => {
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    const rows = await db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.articleId, articleId));

    interface AggBucket {
      count: number;
      itemsCount: number;
      grossSum: number;
      netSum: number;
    }
    const sale: AggBucket = { count: 0, itemsCount: 0, grossSum: 0, netSum: 0 };
    const refund: AggBucket = { count: 0, itemsCount: 0, grossSum: 0, netSum: 0 };
    let minDate: number | null = null;
    let maxDate: number | null = null;

    for (const r of rows) {
      const ts = r.operationDate.getTime();
      minDate = minDate == null || ts < minDate ? ts : minDate;
      maxDate = maxDate == null || ts > maxDate ? ts : maxDate;
      const raw = (r.raw ?? {}) as {
        accruals_for_sale?: number;
        items?: Array<{ offer_id?: string }>;
      };
      const itemsForArticle =
        raw.items?.filter((i) => i.offer_id === articleId).length ?? 0;
      const gross =
        typeof raw.accruals_for_sale === "number" ? raw.accruals_for_sale : 0;
      const bucket =
        r.type === "sale" ? sale : r.type === "refund" ? refund : null;
      if (bucket) {
        bucket.count++;
        bucket.itemsCount += itemsForArticle;
        bucket.grossSum += gross;
        bucket.netSum += r.amount;
      }
    }

    const recent = rows
      .slice()
      .sort((a, b) => b.operationDate.getTime() - a.operationDate.getTime())
      .slice(0, 10)
      .map((r) => {
        const raw = (r.raw ?? {}) as { accruals_for_sale?: number };
        return {
          operationId: r.operationId,
          operationType: r.operationType,
          operationDate: r.operationDate.getTime(),
          type: r.type,
          amount: r.amount,
          accrualsForSale:
            typeof raw.accruals_for_sale === "number"
              ? raw.accruals_for_sale
              : null,
          postingNumber: r.postingNumber,
        };
      });

    const avgPerItem = (b: AggBucket) =>
      b.itemsCount > 0 ? b.grossSum / b.itemsCount : null;

    return c.json({
      articleId,
      period: { from: minDate, to: maxDate },
      sale: {
        operations: sale.count,
        units: sale.itemsCount,
        grossSum: sale.grossSum,
        netSum: sale.netSum,
        avgPerUnitGross: avgPerItem(sale),
        avgPerUnitNet: sale.itemsCount > 0 ? sale.netSum / sale.itemsCount : null,
      },
      refund: {
        operations: refund.count,
        units: refund.itemsCount,
        grossSum: refund.grossSum,
        netSum: refund.netSum,
      },
      recent,
    });
  });

  // Diagnostic: dump raw /v5/product/info/prices response for a single article.
  // Useful to inspect what Ozon currently returns for a SKU without re-running
  // the full catalog import.
  app.get("/debug/prices/:articleId", async (c) => {
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    const requestBody = {
      cursor: "",
      limit: 1,
      filter: { offer_id: [articleId], visibility: "ALL" },
    };
    try {
      const response = await client.post<unknown>(
        "/v5/product/info/prices",
        requestBody,
      );
      return c.json({
        endpoint: "/v5/product/info/prices",
        request: requestBody,
        response,
      });
    } catch (e) {
      return c.json(
        {
          endpoint: "/v5/product/info/prices",
          request: requestBody,
          error: (e as Error).message,
        },
        502,
      );
    }
  });

  return app;
}
