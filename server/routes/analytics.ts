import { Hono } from "hono";
import { and, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { financeTransactions } from "../db/schema";
import type { DB } from "../db/client";

const sumWhereType = (typeLiteral: string) =>
  sql<number>`coalesce(sum(case when ${financeTransactions.type} = ${typeLiteral} then ${financeTransactions.amount} else 0 end), 0)`;

const countWhereType = (typeLiteral: string) =>
  sql<number>`coalesce(sum(case when ${financeTransactions.type} = ${typeLiteral} then 1 else 0 end), 0)`;

export function analyticsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/realized-margin", async (c) => {
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");

    const filters: SQL[] = [isNotNull(financeTransactions.articleId)];
    let fromIso: string | null = null;
    let toIso: string | null = null;

    if (fromRaw) {
      const from = new Date(fromRaw);
      if (Number.isNaN(from.getTime()))
        return c.json({ error: "invalid 'from'" }, 400);
      filters.push(gte(financeTransactions.operationDate, from));
      fromIso = from.toISOString();
    }
    if (toRaw) {
      const to = new Date(toRaw);
      if (Number.isNaN(to.getTime()))
        return c.json({ error: "invalid 'to'" }, 400);
      filters.push(lte(financeTransactions.operationDate, to));
      toIso = to.toISOString();
    }

    const rows = await db
      .select({
        articleId: financeTransactions.articleId,
        actualRevenue: sumWhereType("sale"),
        actualRefund: sumWhereType("refund"),
        actualCommission: sumWhereType("commission"),
        actualLogistics: sumWhereType("logistics"),
        actualLastMile: sumWhereType("last_mile"),
        actualStorage: sumWhereType("storage"),
        actualOther: sumWhereType("other"),
        actualMargin: sql<number>`coalesce(sum(${financeTransactions.amount}), 0)`,
        salesCount: countWhereType("sale"),
        txCount: sql<number>`count(*)`,
      })
      .from(financeTransactions)
      .where(and(...filters))
      .groupBy(financeTransactions.articleId);

    return c.json({
      period: { from: fromIso, to: toIso },
      rows,
    });
  });

  return app;
}
