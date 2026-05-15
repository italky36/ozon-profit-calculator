import { Hono } from "hono";
import { and, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { financeTransactions } from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { resolveShopId, visibleShopIds } from "../middleware/session";

const sumWhereType = (typeLiteral: string) =>
  sql<number>`coalesce(sum(case when ${financeTransactions.type} = ${typeLiteral} then ${financeTransactions.amount} else 0 end), 0)`;

const countWhereType = (typeLiteral: string) =>
  sql<number>`coalesce(sum(case when ${financeTransactions.type} = ${typeLiteral} then 1 else 0 end), 0)`;

type AnalyticsEnv = { Variables: { user: SessionUser } };

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

export function analyticsRoutes(db: DB): Hono<AnalyticsEnv> {
  const app = new Hono<AnalyticsEnv>();

  app.get("/realized-margin", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");

    const filters: SQL[] = [
      isNotNull(financeTransactions.articleId),
    ];
    if (scope.length === 0) {
      return c.json({ period: { from: null, to: null }, rows: [] });
    }
    filters.push(inArray(financeTransactions.shopId, scope));
    filters.push(eq(financeTransactions.userId, user.id));

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
        shopId: financeTransactions.shopId,
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
      .groupBy(financeTransactions.shopId, financeTransactions.articleId);

    return c.json({
      period: { from: fromIso, to: toIso },
      rows,
    });
  });

  return app;
}
