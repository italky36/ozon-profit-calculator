import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { financeTransactions } from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { resolveShopId, visibleShopIds } from "../middleware/session";

const TYPES = new Set([
  "sale",
  "refund",
  "commission",
  "logistics",
  "last_mile",
  "storage",
  "other",
]);

type FinanceEnv = { Variables: { user: SessionUser } };

/** Resolve which shopIds the request scopes to.
 *  - explicit `?shopId=N` → just that shop (validated for visibility);
 *  - omitted → all shops visible to the user (owned + granted).
 */
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
  return await visibleShopIds(db, user.id);
};

export function financeRoutes(db: DB): Hono<FinanceEnv> {
  const app = new Hono<FinanceEnv>();

  app.get("/transactions", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);
    if (scope.length === 0) return c.json([]);

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const type = c.req.query("type");
    const articleId = c.req.query("articleId");
    const limit = Math.min(Number(c.req.query("limit") ?? 500), 5000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const filters: SQL[] = [
      inArray(financeTransactions.shopId, scope),
      eq(financeTransactions.userId, user.id),
    ];
    if (fromRaw) {
      const from = new Date(fromRaw);
      if (Number.isNaN(from.getTime()))
        return c.json({ error: "invalid 'from'" }, 400);
      filters.push(gte(financeTransactions.operationDate, from));
    }
    if (toRaw) {
      const to = new Date(toRaw);
      if (Number.isNaN(to.getTime()))
        return c.json({ error: "invalid 'to'" }, 400);
      filters.push(lte(financeTransactions.operationDate, to));
    }
    if (type) {
      if (!TYPES.has(type)) return c.json({ error: "invalid type" }, 400);
      filters.push(eq(financeTransactions.type, type));
    }
    if (articleId) {
      filters.push(eq(financeTransactions.articleId, articleId));
    }

    const where = and(...filters);

    const rows = await db
      .select({
        shopId: financeTransactions.shopId,
        operationId: financeTransactions.operationId,
        operationType: financeTransactions.operationType,
        operationDate: financeTransactions.operationDate,
        postingNumber: financeTransactions.postingNumber,
        articleId: financeTransactions.articleId,
        amount: financeTransactions.amount,
        type: financeTransactions.type,
        raw: financeTransactions.raw,
      })
      .from(financeTransactions)
      .where(where)
      .orderBy(desc(financeTransactions.operationDate))
      .limit(limit)
      .offset(offset);

    const out = rows.map((r) => {
      const raw = (r.raw ?? {}) as { accruals_for_sale?: number };
      return {
        shopId: r.shopId,
        operationId: r.operationId,
        operationType: r.operationType,
        operationDate: r.operationDate,
        postingNumber: r.postingNumber,
        articleId: r.articleId,
        amount: r.amount,
        type: r.type,
        grossAmount:
          typeof raw.accruals_for_sale === "number"
            ? raw.accruals_for_sale
            : null,
      };
    });

    return c.json(out);
  });

  app.get("/summary", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);
    if (scope.length === 0) return c.json([]);

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const filters: SQL[] = [
      inArray(financeTransactions.shopId, scope),
      eq(financeTransactions.userId, user.id),
    ];
    if (fromRaw) {
      const from = new Date(fromRaw);
      if (Number.isNaN(from.getTime()))
        return c.json({ error: "invalid 'from'" }, 400);
      filters.push(gte(financeTransactions.operationDate, from));
    }
    if (toRaw) {
      const to = new Date(toRaw);
      if (Number.isNaN(to.getTime()))
        return c.json({ error: "invalid 'to'" }, 400);
      filters.push(lte(financeTransactions.operationDate, to));
    }
    const where = and(...filters);

    const rows = await db
      .select({
        type: financeTransactions.type,
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${financeTransactions.amount}), 0)`,
      })
      .from(financeTransactions)
      .where(where)
      .groupBy(financeTransactions.type)
      .orderBy(asc(financeTransactions.type));

    return c.json(rows);
  });

  // Удалить накопленные транзакции. Scope: либо ?shopId=N, либо все магазины
  // юзера.
  app.delete("/transactions/all", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);
    if (scope.length === 0) return c.json({ deleted: 0 });
    const result = await db
      .delete(financeTransactions)
      .where(
        and(
          inArray(financeTransactions.shopId, scope),
          eq(financeTransactions.userId, user.id),
        ),
      );
    return c.json({ deleted: result.changes });
  });

  return app;
}
