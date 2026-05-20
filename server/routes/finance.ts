import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import * as XLSX from "xlsx";
import { financeTransactions, shops } from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { resolveShopId, visibleShopIds } from "../middleware/session";

const TYPE_LABEL: Record<string, string> = {
  sale: "Продажа",
  refund: "Возврат",
  commission: "Комиссия",
  logistics: "Логистика",
  last_mile: "Последняя миля",
  storage: "Хранение",
  other: "Прочее",
};

const EXPORT_HARD_CAP = 200_000;

interface ExportRow {
  date: string;
  shopShortName: string;
  type: string;
  operationType: string;
  postingNumber: string;
  articleId: string;
  amount: number;
  grossAmount: number | null;
  operationId: number;
}

function csvEscape(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: ExportRow[]): string {
  const header = [
    "Дата",
    "Магазин",
    "Тип",
    "Operation Type (Ozon)",
    "Номер отправления",
    "Артикул",
    "Сумма, ₽",
    "Выручка (gross), ₽",
    "Operation ID",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.date),
        csvEscape(r.shopShortName),
        csvEscape(r.type),
        csvEscape(r.operationType),
        csvEscape(r.postingNumber),
        csvEscape(r.articleId),
        csvEscape(r.amount),
        csvEscape(r.grossAmount),
        csvEscape(r.operationId),
      ].join(","),
    );
  }
  // BOM добавляется на response-level в buildResponse() через bytes,
  // потому что TextDecoder в Response.text() выбрасывает leading BOM
  // если включить его в JS-строку.
  return lines.join("\n");
}

function buildResponse(
  format: "csv" | "xlsx",
  rows: ExportRow[],
  fromRaw: string | undefined,
  toRaw: string | undefined,
): Response {
  const tag = `${fromRaw ?? "all"}_${toRaw ?? "all"}`.replace(/[^\w-]+/g, "-");
  const baseName = `finance_${tag}`;
  if (format === "csv") {
    // BOM-байты впереди: 0xEF 0xBB 0xBF — Excel под Windows распознаёт
    // CSV как UTF-8 и кириллица не превращается в кракозябры. В string
    // BOM включать нельзя — Response.text() / TextDecoder его срезает
    // (spec-поведение для UTF-8).
    const csv = toCsv(rows);
    const bodyBytes = new TextEncoder().encode(csv);
    const full = new Uint8Array(3 + bodyBytes.length);
    full.set([0xef, 0xbb, 0xbf]);
    full.set(bodyBytes, 3);
    return new Response(full, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  }
  const buf = toXlsxBuffer(rows);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      "Content-Length": String(buf.length),
    },
  });
}

function toXlsxBuffer(rows: ExportRow[]): Buffer {
  const aoa: unknown[][] = [
    [
      "Дата",
      "Магазин",
      "Тип",
      "Operation Type (Ozon)",
      "Номер отправления",
      "Артикул",
      "Сумма, ₽",
      "Выручка (gross), ₽",
      "Operation ID",
    ],
  ];
  for (const r of rows) {
    aoa.push([
      r.date,
      r.shopShortName,
      r.type,
      r.operationType,
      r.postingNumber,
      r.articleId,
      r.amount,
      r.grossAmount,
      r.operationId,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Ширины колонок для читабельности.
  ws["!cols"] = [
    { wch: 12 }, // дата
    { wch: 8 },  // магазин
    { wch: 16 }, // тип
    { wch: 36 }, // operation_type
    { wch: 20 }, // posting
    { wch: 18 }, // article
    { wch: 12 }, // amount
    { wch: 12 }, // gross
    { wch: 14 }, // op id
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Финансы");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

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
 *  - explicit `?shopId=N` → just that shop (validated against workspace);
 *  - omitted → all shops in workspace.
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
  return await visibleShopIds(db, user);
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
      eq(financeTransactions.workspaceId, user.workspaceId),
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
      eq(financeTransactions.workspaceId, user.workspaceId),
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

    // pg возвращает `count(*)` и `sum(...)` как строку (BIGINT/NUMERIC →
    // лосс точности в JS double), драйвер не парсит обратно в число.
    // Приводим вручную, чтобы API контракт остался number.
    return c.json(
      rows.map((r) => ({
        ...r,
        count: Number(r.count),
        total: Number(r.total),
      })),
    );
  });

  app.get("/transactions/export", async (c) => {
    const user = c.get("user");
    const scope = await scopeShopIds(db, user, c.req.query("shopId"));
    if (!Array.isArray(scope)) return c.json({ error: scope.error }, scope.status);

    const formatRaw = (c.req.query("format") ?? "xlsx").toLowerCase();
    if (formatRaw !== "xlsx" && formatRaw !== "csv") {
      return c.json({ error: "format must be xlsx|csv" }, 400);
    }
    const format = formatRaw;

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const type = c.req.query("type");
    const articleId = c.req.query("articleId");

    const filters: SQL[] = [
      eq(financeTransactions.workspaceId, user.workspaceId),
      eq(financeTransactions.userId, user.id),
    ];
    if (scope.length > 0) {
      filters.push(inArray(financeTransactions.shopId, scope));
    } else {
      // нет visible shops → пустой ответ
      return buildResponse(format, [], fromRaw, toRaw);
    }
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

    const dbRows = await db
      .select({
        operationId: financeTransactions.operationId,
        operationType: financeTransactions.operationType,
        operationDate: financeTransactions.operationDate,
        postingNumber: financeTransactions.postingNumber,
        articleId: financeTransactions.articleId,
        amount: financeTransactions.amount,
        type: financeTransactions.type,
        raw: financeTransactions.raw,
        shopShortName: shops.shortName,
      })
      .from(financeTransactions)
      .innerJoin(shops, eq(shops.id, financeTransactions.shopId))
      .where(and(...filters))
      .orderBy(asc(financeTransactions.operationDate))
      .limit(EXPORT_HARD_CAP);

    const rows: ExportRow[] = dbRows.map((r) => {
      const raw = (r.raw ?? {}) as { accruals_for_sale?: number };
      return {
        date: r.operationDate.toISOString().slice(0, 10),
        shopShortName: r.shopShortName,
        type: TYPE_LABEL[r.type] ?? r.type,
        operationType: r.operationType,
        postingNumber: r.postingNumber ?? "",
        articleId: r.articleId ?? "",
        amount: r.amount,
        grossAmount:
          typeof raw.accruals_for_sale === "number" ? raw.accruals_for_sale : null,
        operationId: r.operationId,
      };
    });

    return buildResponse(format, rows, fromRaw, toRaw);
  });

  // Удалить накопленные транзакции. Scope: либо ?shopId=N, либо все магазины
  // workspace'а.
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
          eq(financeTransactions.workspaceId, user.workspaceId),
          eq(financeTransactions.userId, user.id),
        ),
      );
    return c.json({ deleted: result.rowCount ?? 0 });
  });

  return app;
}
