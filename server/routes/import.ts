import { Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  financeTransactions,
  importRuns,
  products,
  shopMember,
} from "../db/schema";
import type { OzonCommissions } from "../../src/types";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import {
  resolveShopId,
  visibleShopIds,
} from "../middleware/session";
import { extractPgErrorMessage } from "../lib/pgErrors";
import { createOzonClient, resolveCredentials, type OzonClient } from "../ozon/client";
import {
  getCategoryLookup,
  getProductsInfo,
  getProductsAttributes,
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

/** Pure orchestrator — exported for tests.
 *
 * Catalog fields (productName/category/price/Ozon-metadata) are fanned out to
 * EVERY user with shop_member access to the shop, so all assignees see the
 * same catalog without each having to import themselves. The importing user
 * additionally gets `cost_price` updated from Ozon's `net_price`; for other
 * assignees, cost_price is left untouched on existing rows and defaulted to 0
 * on new rows. Manual fields (sales_plan, marketing_percent, redemption,
 * white_purchase, …) are never modified by catalog sync. */
export async function runCatalogImport(
  db: DB,
  client: OzonClient,
  shopId: number,
  workspaceId: number,
  userId: number,
  onProgress: (counters: RunCounters) => void = () => {},
): Promise<RunCounters> {
  const counters: RunCounters = {
    itemsProcessed: 0,
    added: 0,
    updated: 0,
    unmatched: 0,
  };

  // Snapshot assignees once at the start of the run. Ensures consistent
  // fan-out even if owner grants/revokes mid-import.
  const assigneeRows = await db
    .select({ userId: shopMember.userId })
    .from(shopMember)
    .where(eq(shopMember.shopId, shopId));
  const assignees = new Set(assigneeRows.map((r) => r.userId));
  // Defensive: the importer themselves must always end up with a row, even
  // if shop_member is stale (would only happen via direct DB write).
  assignees.add(userId);

  const categories = await getCategoryLookup(client);

  for await (const page of iterateProductList(client)) {
    const [infos, priceMap, attrsMap] = await Promise.all([
      getProductsInfo(client, page.productIds),
      getPrices(client, page.productIds),
      getProductsAttributes(client, page.productIds),
    ]);

    const mapped = infos.map((info) =>
      mapCatalogEntry(info, priceMap.get(info.id), attrsMap.get(info.id), categories),
    );

    await db.transaction(async (tx) => {
      for (const entry of mapped) {
        const catalogIncomplete =
          !entry.patch.category || !entry.patch.productType;
        if (catalogIncomplete) counters.unmatched++;

        // Track importer's view for counters (added/updated semantics).
        let importerHadRow = false;

        for (const assigneeId of assignees) {
          const [existing] = await tx
            .select()
            .from(products)
            .where(
              and(
                eq(products.articleId, entry.articleId),
                eq(products.shopId, shopId),
                eq(products.userId, assigneeId),
              ),
            );

          if (existing) {
            if (assigneeId === userId) importerHadRow = true;
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
            // cost_price syncs only to the importer's row, and only when
            // Ozon returned a non-null net_price (mapToProduct already drops
            // zero/missing values to null upstream).
            const costPriceUpdate =
              assigneeId === userId && entry.costPrice != null
                ? { costPrice: entry.costPrice }
                : {};
            const skuUpdate =
              entry.ozonSku != null ? { ozonSku: entry.ozonSku } : {};
            const statusUpdate = {
              ozonArchived: entry.status.archived,
              ozonVisible: entry.status.visible,
              ozonStatusName: entry.status.statusName,
              ozonStatusDescription: entry.status.statusDescription,
            };
            await tx.update(products)
              .set({
                productName: patch.productName,
                category: patch.category,
                productType: patch.productType,
                volumeL: patch.volumeL,
                depthMm: patch.depthMm,
                widthMm: patch.widthMm,
                heightMm: patch.heightMm,
                weightG: patch.weightG,
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
                ...statusUpdate,
              })
              .where(
                and(
                  eq(products.articleId, entry.articleId),
                  eq(products.shopId, shopId),
                  eq(products.userId, assigneeId),
                ),
              )
              ;
          } else {
            if (catalogIncomplete) continue;
            const now = new Date();
            // New row gets defaults for manual fields. cost_price = Ozon's
            // net_price only for the importer; other assignees start at 0
            // (they're free to enter their own assumption later).
            const initialCostPrice =
              assigneeId === userId && entry.costPrice != null
                ? entry.costPrice
                : NEW_PRODUCT_DEFAULTS.costPrice;
            await tx.insert(products)
              .values({
                ...NEW_PRODUCT_DEFAULTS,
                clustersCount: String(NEW_PRODUCT_DEFAULTS.clustersCount),
                id: randomUUID(),
                shopId,
                workspaceId,
                userId: assigneeId,
                articleId: entry.articleId,
                productName: entry.patch.productName,
                category: entry.patch.category,
                productType: entry.patch.productType,
                volumeL: entry.patch.volumeL,
                depthMm: entry.patch.depthMm,
                widthMm: entry.patch.widthMm,
                heightMm: entry.patch.heightMm,
                weightG: entry.patch.weightG,
                vatRate: String(entry.patch.vatRate),
                isKgt: entry.patch.isKgt,
                currentPrice: entry.patch.currentPrice,
                regularPrice: entry.patch.regularPrice,
                discountPercent: entry.patch.discountPercent,
                ozonProductId: entry.patch.ozonProductId,
                ozonSku: entry.ozonSku,
                costPrice: initialCostPrice,
                createdAt: now,
                updatedAt: now,
                ozonCommissions: entry.ozonCommissions,
                ozonCommissionsUpdatedAt: entry.ozonCommissions ? now : null,
                ozonArchived: entry.status.archived,
                ozonVisible: entry.status.visible,
                ozonStatusName: entry.status.statusName,
                ozonStatusDescription: entry.status.statusDescription,
              })
              ;
          }
        }

        // Counters reflect the importer's perspective only.
        if (!catalogIncomplete) {
          if (importerHadRow) counters.updated++;
          else counters.added++;
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

/** Разбить ISO-период на чанки ≤ 27 дней inclusive. Ozon /v3/finance/transaction/list
 *  возвращает 400 «too long period, only one month allowed» когда период
 *  длиннее календарного месяца — а 30-дневное окно через границу короткого
 *  месяца (февраль 28, 1 фев + 29 = 2 мар) считается «больше месяца». 27 дней
 *  гарантированно короче любого месяца. */
function splitFinanceRange(
  fromIso: string,
  toIso: string,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const final = new Date(toIso);
  let chunkStart = new Date(fromIso);
  while (chunkStart <= final) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 26);
    chunkEnd.setUTCHours(23, 59, 59, 999);
    const actualEnd = chunkEnd > final ? final : chunkEnd;
    out.push({ from: chunkStart.toISOString(), to: actualEnd.toISOString() });
    if (actualEnd >= final) break;
    chunkStart = new Date(chunkEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
    chunkStart.setUTCHours(0, 0, 0, 0);
  }
  return out;
}

/** Build sku → articleId map for a workspace (used to backfill articleId on
 * finance transactions when only items[].sku is present). */
const buildSkuMap = async (
  db: DB,
  workspaceId: number,
  userId: number,
): Promise<Map<number, string>> => {
  const rows = await db
    .select({ sku: products.ozonSku, articleId: products.articleId })
    .from(products)
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        eq(products.userId, userId),
      ),
    );
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
  shopId: number,
  workspaceId: number,
  userId: number,
  filter: TransactionFilter,
  onProgress: (counters: FinanceCounters) => void = () => {},
): Promise<FinanceCounters> {
  const counters: FinanceCounters = {
    itemsProcessed: 0,
    inserted: 0,
    skipped: 0,
  };

  const skuMap = await buildSkuMap(db, workspaceId, userId);

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
    await db.transaction(async (tx) => {
      for (const op of page) {
        const articleId = resolveArticle(op);
        const inserted = await tx
          .insert(financeTransactions)
          .values({
            shopId,
            workspaceId,
            userId,
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
          .returning({ operationId: financeTransactions.operationId });
        if (inserted.length > 0) counters.inserted++;
        else counters.skipped++;
        counters.itemsProcessed++;
      }
    });
    onProgress({ ...counters });
  }
  return counters;
}

type ImportEnv = { Variables: { user: SessionUser } };

export function importRoutes(
  db: DB,
  ctx: ImportContext = {},
): Hono<ImportEnv> {
  const app = new Hono<ImportEnv>();

  app.post("/catalog", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { shopId?: unknown };
    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: body.shopId as never });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db, shopId);
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
        shopId,
        workspaceId: user.workspaceId,
        userId: user.id,
        kind: "catalog",
        startedAt,
        status: "running",
        itemsProcessed: 0,
        params: { source: "ozon" },
      })
      .returning();

    const importShopId = shopId;
    const importWorkspaceId = user.workspaceId;
    const importUserId = user.id;
    void (async () => {
      try {
        const counters = await runCatalogImport(
          db,
          client,
          importShopId,
          importWorkspaceId,
          importUserId,
          async (c2) => {
            await db.update(importRuns)
              .set({ itemsProcessed: c2.itemsProcessed })
              .where(eq(importRuns.id, run.id))
              ;
          },
        );
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
            errorMessage: extractPgErrorMessage(e),
          })
          .where(eq(importRuns.id, run.id));
      }
    })();

    return c.json({ runId: run.id });
  });

  app.post("/finance", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { from, to, transactionType, shopId: bodyShopId } = (body ?? {}) as {
      from?: unknown;
      to?: unknown;
      transactionType?: unknown;
      shopId?: unknown;
    };
    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: bodyShopId as never });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !ISO_DATE_RE.test(from) ||
      !ISO_DATE_RE.test(to)
    ) {
      return c.json({ error: "from/to must be ISO date strings" }, 400);
    }
    const fromIso = toIsoStartOfDay(from);
    const toIso = toIsoEndOfDay(to);
    if (new Date(toIso).getTime() <= new Date(fromIso).getTime()) {
      return c.json({ error: "to должно быть позже from" }, 400);
    }
    const transactionTypeStr =
      typeof transactionType === "string" ? transactionType : undefined;
    const chunks = splitFinanceRange(fromIso, toIso);
    const filter: TransactionFilter = {
      from: fromIso,
      to: toIso,
      transactionType: transactionTypeStr,
    };

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db, shopId);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    const startedAt = new Date();
    const [run] = await db
      .insert(importRuns)
      .values({
        shopId,
        workspaceId: user.workspaceId,
        userId: user.id,
        kind: "finance",
        startedAt,
        status: "running",
        itemsProcessed: 0,
        params: { from: filter.from, to: filter.to },
      })
      .returning();

    const importShopId = shopId;
    const importWorkspaceId = user.workspaceId;
    const importUserId = user.id;
    void (async () => {
      try {
        const total = {
          itemsProcessed: 0,
          inserted: 0,
          skipped: 0,
        };
        for (let i = 0; i < chunks.length; i++) {
          const ch = chunks[i];
          const chunkFilter: TransactionFilter = {
            from: ch.from,
            to: ch.to,
            transactionType: transactionTypeStr,
          };
          const counters = await runFinanceImport(
            db,
            client,
            importShopId,
            importWorkspaceId,
            importUserId,
            chunkFilter,
            async (c2) => {
              await db.update(importRuns)
                .set({
                  itemsProcessed: total.itemsProcessed + c2.itemsProcessed,
                  params: {
                    from: filter.from,
                    to: filter.to,
                    chunks: { total: chunks.length, current: i + 1 },
                    inserted: total.inserted + c2.inserted,
                    skipped: total.skipped + c2.skipped,
                    itemsProcessed: total.itemsProcessed + c2.itemsProcessed,
                  },
                })
                .where(eq(importRuns.id, run.id))
                ;
            },
          );
          total.itemsProcessed += counters.itemsProcessed;
          total.inserted += counters.inserted;
          total.skipped += counters.skipped;
        }
        await db
          .update(importRuns)
          .set({
            status: "ok",
            finishedAt: new Date(),
            itemsProcessed: total.itemsProcessed,
            params: {
              from: filter.from,
              to: filter.to,
              chunks: { total: chunks.length, current: chunks.length },
              ...total,
            },
          })
          .where(eq(importRuns.id, run.id));
      } catch (e) {
        await db
          .update(importRuns)
          .set({
            status: "error",
            finishedAt: new Date(),
            errorMessage: extractPgErrorMessage(e),
          })
          .where(eq(importRuns.id, run.id));
      }
    })();

    return c.json({ runId: run.id });
  });

  app.get("/runs/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const [row] = await db
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.id, id),
          eq(importRuns.workspaceId, user.workspaceId),
          eq(importRuns.userId, user.id),
        ),
      );
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  });

  app.get("/runs", async (c) => {
    const user = c.get("user");
    const shopIdQ = c.req.query("shopId");
    let scope: number[];
    if (shopIdQ) {
      try {
        const id = await resolveShopId(db, user, { explicit: shopIdQ });
        if (!id) return c.json([]);
        scope = [id];
      } catch (e) {
        const err = e as Error & { status?: number };
        return c.json(
          { error: err.message },
          (err.status as 400 | 404) ?? 400,
        );
      }
    } else {
      scope = await visibleShopIds(db, user);
    }
    if (scope.length === 0) return c.json([]);
    const rows = await db
      .select()
      .from(importRuns)
      .where(
        and(
          inArray(importRuns.shopId, scope),
          eq(importRuns.workspaceId, user.workspaceId),
          eq(importRuns.userId, user.id),
        ),
      )
      .orderBy(desc(importRuns.startedAt))
      .limit(50);
    return c.json(rows);
  });

  // Refresh catalog data for a single SKU on demand.
  app.post("/catalog/refresh/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: c.req.query("shopId") });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);

    const [productRow] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.articleId, articleId),
          eq(products.shopId, shopId),
          eq(products.workspaceId, user.workspaceId),
          eq(products.userId, user.id),
        ),
      );
    if (!productRow) return c.json({ error: "product not found" }, 404);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db, shopId);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    try {
      const categories = await getCategoryLookup(client);
      const productIdHint = productRow.ozonProductId
        ? [productRow.ozonProductId]
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
          const m = await getPrices(client, [info.id]);
          return m.get(info.id);
        })());

      const attrsMap = await getProductsAttributes(client, [info.id]);
      const attrsItem = attrsMap.get(info.id);

      const entry = mapCatalogEntry(info, priceItem, attrsItem, categories);

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
      const skuUpdate =
        entry.ozonSku != null ? { ozonSku: entry.ozonSku } : {};
      const statusUpdate = {
        ozonArchived: entry.status.archived,
        ozonVisible: entry.status.visible,
        ozonStatusName: entry.status.statusName,
        ozonStatusDescription: entry.status.statusDescription,
      };
      // Catalog fields fan out to every assignee's row for this shop+article;
      // cost_price syncs only to the importing user.
      await db.update(products)
        .set({
          productName: entry.patch.productName,
          category: entry.patch.category || productRow.category,
          productType: entry.patch.productType || productRow.productType,
          volumeL: entry.patch.volumeL,
          depthMm: entry.patch.depthMm,
          widthMm: entry.patch.widthMm,
          heightMm: entry.patch.heightMm,
          weightG: entry.patch.weightG,
          vatRate: String(entry.patch.vatRate),
          isKgt: entry.patch.isKgt,
          currentPrice: entry.patch.currentPrice,
          regularPrice: entry.patch.regularPrice,
          discountPercent: entry.patch.discountPercent,
          ozonProductId: entry.patch.ozonProductId,
          updatedAt: now,
          ...skuUpdate,
          ...commissionsUpdate,
          ...statusUpdate,
        })
        .where(
          and(
            eq(products.shopId, shopId),
            eq(products.articleId, articleId),
            eq(products.workspaceId, user.workspaceId),
          ),
        )
        ;
      if (entry.costPrice != null) {
        await db.update(products)
          .set({ costPrice: entry.costPrice })
          .where(eq(products.id, productRow.id))
          ;
      }

      return c.json({
        ok: true,
        articleId,
        currentPrice: entry.patch.currentPrice,
        regularPrice: entry.patch.regularPrice,
        discountPercent: entry.patch.discountPercent,
        costPrice: entry.costPrice,
        ozonSku: entry.ozonSku,
        ozonCommissions: entry.ozonCommissions,
        status: entry.status,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Backfill articleId for finance_transactions rows that came in with
  // items[].sku but no items[].offer_id (Ozon's API quirk on older ops).
  app.post("/finance/relink", async (c) => {
    const user = c.get("user");
    const shopIds = await visibleShopIds(db, user);
    if (shopIds.length === 0)
      return c.json({ ok: true, scanned: 0, linked: 0 });

    const skuMap = await buildSkuMap(db, user.workspaceId, user.id);
    if (skuMap.size === 0) {
      return c.json({ ok: true, scanned: 0, linked: 0, note: "no SKU data" });
    }

    const orphans = await db
      .select()
      .from(financeTransactions)
      .where(
        and(
          isNull(financeTransactions.articleId),
          eq(financeTransactions.workspaceId, user.workspaceId),
          eq(financeTransactions.userId, user.id),
        ),
      );

    let linked = 0;
    await db.transaction(async (tx) => {
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
          await tx.update(financeTransactions)
            .set({ articleId })
            .where(
              and(
                eq(financeTransactions.operationId, r.operationId),
                eq(financeTransactions.workspaceId, r.workspaceId),
              ),
            )
            ;
          linked++;
        }
      }
    });
    return c.json({ ok: true, scanned: orphans.length, linked });
  });

  // Aggregate already-imported finance_transactions for a single article.
  app.get("/debug/finance/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    let scope: number[];
    const explicit = c.req.query("shopId");
    if (explicit) {
      try {
        const id = await resolveShopId(db, user, { explicit });
        if (!id) {
          scope = [];
        } else {
          scope = [id];
        }
      } catch (e) {
        const err = e as Error & { status?: number };
        return c.json(
          { error: err.message },
          (err.status as 400 | 404) ?? 400,
        );
      }
    } else {
      scope = await visibleShopIds(db, user);
    }
    if (scope.length === 0)
      return c.json({
        articleId,
        period: { from: null, to: null },
        sale: { operations: 0, units: 0, grossSum: 0, netSum: 0, avgPerUnitGross: null, avgPerUnitNet: null },
        refund: { operations: 0, units: 0, grossSum: 0, netSum: 0 },
        recent: [],
      });

    const rows = await db
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.articleId, articleId),
          inArray(financeTransactions.shopId, scope),
          eq(financeTransactions.workspaceId, user.workspaceId),
          eq(financeTransactions.userId, user.id),
        ),
      );

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

  // Diagnostic: dump raw /v3/product/info/list for a single article.
  app.get("/debug/info/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: c.req.query("shopId") });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db, shopId);
      if (!creds) {
        return c.json({ error: "ozon credentials not configured" }, 400);
      }
      client = createOzonClient({ creds });
    }

    const requestBody = { offer_id: [articleId] };
    try {
      const response = await client.post<unknown>(
        "/v3/product/info/list",
        requestBody,
      );
      return c.json({
        endpoint: "/v3/product/info/list",
        request: requestBody,
        response,
      });
    } catch (e) {
      return c.json(
        {
          endpoint: "/v3/product/info/list",
          request: requestBody,
          error: (e as Error).message,
        },
        502,
      );
    }
  });

  // Diagnostic: dump raw /v5/product/info/prices response for a single article.
  app.get("/debug/prices/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = c.req.param("articleId");
    if (!articleId) return c.json({ error: "articleId required" }, 400);

    let shopId: number | null;
    try {
      shopId = await resolveShopId(db, user, { explicit: c.req.query("shopId") });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status as 400 | 404) ?? 400);
    }
    if (!shopId) return c.json({ error: "no shop available" }, 400);

    let client = ctx.ozonClient;
    if (!client) {
      const creds = await resolveCredentials(db, shopId);
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
