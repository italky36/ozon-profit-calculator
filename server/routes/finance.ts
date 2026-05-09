import { Hono } from "hono";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { financeTransactions } from "../db/schema";
import type { DB } from "../db/client";

const TYPES = new Set([
  "sale",
  "refund",
  "commission",
  "logistics",
  "last_mile",
  "storage",
  "other",
]);

export function financeRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/transactions", async (c) => {
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const type = c.req.query("type");
    const articleId = c.req.query("articleId");
    const limit = Math.min(Number(c.req.query("limit") ?? 500), 5000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const filters: SQL[] = [];
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

    const where = filters.length ? and(...filters) : undefined;

    const rows = await db
      .select({
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
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const filters: SQL[] = [];
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
    const where = filters.length ? and(...filters) : undefined;

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

  // Удалить ВСЕ накопленные транзакции. Используется кнопкой «Очистить
  // импортированные финансы» в UI. После этого можно импортировать с нуля.
  app.delete("/transactions/all", async (c) => {
    const result = await db.delete(financeTransactions);
    return c.json({ deleted: result.changes });
  });

  return app;
}
