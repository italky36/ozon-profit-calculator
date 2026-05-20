/** Парсит xlsx-файл с себестоимостью товаров для bulk-импорта.
 *  Ожидаемый формат (case-insensitive по regex заголовков):
 *    «Артикул продавца» | «Наименование» | «SKU» | «Артикул OZON» | «Себестоимость»
 *  Все колонки кроме «Себестоимости» опциональны — каскадный матчинг
 *  в роуте использует то что есть. Пустая или нечисловая себестоимость
 *  пропускается (warning'ом). */
import * as XLSX from "xlsx";

export interface ParsedCostRow {
  /** 1-based source row в xlsx (без шапки). Первая data-строка = 1. */
  sourceRow: number;
  articleId: string | null;
  ozonSku: number | null;
  ozonProductId: number | null;
  productName: string | null;
  costPrice: number;
}

export interface ParseResult {
  rows: ParsedCostRow[];
  warnings: string[];
}

const HEADER_PATTERNS = {
  articleId: /артикул\s+продавца/i,
  productName: /наимен/i,
  ozonSku: /^sku$/i,
  ozonProductId: /артикул\s+ozon/i,
  costPrice: /себестои/i,
} as const;

function readCell(
  row: unknown[],
  idx: number,
): unknown {
  return idx >= 0 ? row[idx] : null;
}

function toNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toNullableNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function parseCostPriceXlsx(buf: Buffer): ParseResult | string {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    return `xlsx parse: ${(e as Error).message}`;
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
    });
    if (aoa.length < 2) continue;

    const header = (aoa[0] as unknown[]).map((v) => String(v ?? "").trim());
    const idxArticleId = header.findIndex((h) =>
      HEADER_PATTERNS.articleId.test(h),
    );
    const idxProductName = header.findIndex((h) =>
      HEADER_PATTERNS.productName.test(h),
    );
    const idxOzonSku = header.findIndex((h) => HEADER_PATTERNS.ozonSku.test(h));
    const idxOzonProductId = header.findIndex((h) =>
      HEADER_PATTERNS.ozonProductId.test(h),
    );
    const idxCostPrice = header.findIndex((h) =>
      HEADER_PATTERNS.costPrice.test(h),
    );

    // Cost price обязателен — без него файл бессмысленный. Из ключевых
    // колонок (article_id, sku, ozon_product_id) хотя бы одна должна быть,
    // иначе матчить не по чем.
    if (idxCostPrice < 0) continue;
    if (idxArticleId < 0 && idxOzonSku < 0 && idxOzonProductId < 0) continue;

    const out: ParsedCostRow[] = [];
    const warnings: string[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] as unknown[];
      const cost = toNullableNumber(readCell(r, idxCostPrice));
      if (cost == null || cost <= 0) {
        // тихо пропускаем целиком пустые строки; warning'им только если
        // строка имеет хоть какой-то контент
        const hasAny =
          toNullableString(readCell(r, idxArticleId)) ??
          toNullableNumber(readCell(r, idxOzonSku)) ??
          toNullableNumber(readCell(r, idxOzonProductId)) ??
          toNullableString(readCell(r, idxProductName));
        if (hasAny != null) {
          warnings.push(
            `строка ${i + 1}: нет валидной себестоимости — пропущено`,
          );
        }
        continue;
      }
      const articleId = toNullableString(readCell(r, idxArticleId));
      const ozonSku = toNullableNumber(readCell(r, idxOzonSku));
      const ozonProductId = toNullableNumber(readCell(r, idxOzonProductId));
      if (articleId == null && ozonSku == null && ozonProductId == null) {
        warnings.push(
          `строка ${i + 1}: нет ни одного ключа (article_id/sku/ozon_id) — пропущено`,
        );
        continue;
      }
      out.push({
        sourceRow: i,
        articleId,
        ozonSku,
        ozonProductId,
        productName: toNullableString(readCell(r, idxProductName)),
        costPrice: cost,
      });
    }
    if (out.length > 0 || warnings.length > 0) {
      return { rows: out, warnings };
    }
  }

  return (
    'Не нашёл лист с нужной структурой. Должны быть колонки ' +
    '«Артикул продавца» / «SKU» / «Артикул OZON» (хотя бы одна) ' +
    'и «Себестоимость».'
  );
}
