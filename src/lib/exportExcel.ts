import ExcelJS from "exceljs";
import type { CalcResult, ProductRow, SchemaResult, TaxSettings } from "../types";

/** YYYY-MM-DD_HH-mm — filesystem-safe, sortable, includes time so multiple
 * exports the same day don't collide. Local timezone (matches the user's
 * "now" — no UTC surprises). */
const nowFileStamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
};

/** "07.05.2026 в 14:32" — for the worksheet subtitle. */
const nowHuman = (): string => {
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return `${date} в ${time}`;
};

const ACCENT = "FF005BFF";
const ACCENT_BG = "FFEBF2FF";
const HEADER_BG = "FF1A2E4D";
const HEADER_TEXT = "FFFFFFFF";
const ALT_ROW = "FFF8FAFF";
const BORDER = "FFE2E8F0";
const MUTED = "FF8B95A8";

const moneyFmt = "#,##0 ₽;-#,##0 ₽;—";
const percentFmt = "0.0%";
const intFmt = "0";

interface Column {
  header: string;
  key: string;
  width: number;
  /** "money" / "percent" / "int" / "text" — picks numFmt and alignment. */
  type?: "money" | "percent" | "int" | "text";
  /** Group label for the second header row (e.g. "FBO", "Ozon API"). */
  group?: string;
}

const writeWorkbookTitle = (
  ws: ExcelJS.Worksheet,
  title: string,
  totalCols: number,
) => {
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: ACCENT } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, totalCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = `Сформировано ${nowHuman()}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(2).height = 16;
};

const stylizeColumns = (ws: ExcelJS.Worksheet, columns: Column[]) => {
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
};

const writeHeaderRow = (
  ws: ExcelJS.Worksheet,
  headerRowIdx: number,
  columns: Column[],
  withGroups: boolean,
) => {
  if (withGroups) {
    // Build group row: contiguous columns with the same `group` get a
    // merged cell with that label.
    const groupRowIdx = headerRowIdx;
    headerRowIdx += 1;

    let i = 0;
    while (i < columns.length) {
      const g = columns[i].group ?? "";
      let j = i;
      while (j < columns.length && (columns[j].group ?? "") === g) j++;
      // i..j-1 are in the same group
      if (g) {
        ws.mergeCells(groupRowIdx, i + 1, groupRowIdx, j);
        const cell = ws.getCell(groupRowIdx, i + 1);
        cell.value = g;
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: ACCENT } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ACCENT_BG },
        };
      }
      i = j;
    }
    ws.getRow(groupRowIdx).height = 18;
  }

  const row = ws.getRow(headerRowIdx);
  columns.forEach((col, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_TEXT } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.type === "text" ? "left" : "right",
      wrapText: true,
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BG },
    };
    cell.border = {
      top: { style: "thin", color: { argb: HEADER_BG } },
      bottom: { style: "thin", color: { argb: HEADER_BG } },
      left: { style: "thin", color: { argb: HEADER_BG } },
      right: { style: "thin", color: { argb: HEADER_BG } },
    };
  });
  row.height = 38;
  // Freeze rows above and through the header.
  ws.views = [{ state: "frozen", ySplit: headerRowIdx }];
};

const writeDataRow = (
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  columns: Column[],
  values: Record<string, string | number | null | undefined>,
  zebra: boolean,
) => {
  const row = ws.getRow(rowIdx);
  columns.forEach((col, idx) => {
    const cell = row.getCell(idx + 1);
    const v = values[col.key];
    if (v == null || v === "") {
      cell.value = null;
    } else {
      cell.value = typeof v === "number" && !Number.isFinite(v) ? null : v;
    }
    cell.font = { name: "Calibri", size: 11 };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.type === "text" ? "left" : "right",
    };
    if (col.type === "money") cell.numFmt = moneyFmt;
    else if (col.type === "percent") cell.numFmt = percentFmt;
    else if (col.type === "int") cell.numFmt = intFmt;
    if (zebra) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ALT_ROW },
      };
    }
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER } },
    };
  });
};

const triggerDownload = async (wb: ExcelJS.Workbook, filename: string) => {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ── SHORT EXPORT — visible columns from ProductsTable ─────────────────────

const SHORT_COLUMNS: Column[] = [
  { header: "Артикул", key: "articleId", width: 18, type: "text" },
  { header: "SKU", key: "ozonSku", width: 14, type: "int" },
  { header: "Название", key: "productName", width: 36, type: "text" },
  { header: "Категория", key: "category", width: 22, type: "text" },
  { header: "Цена, ₽", key: "currentPrice", width: 12, type: "money" },
  { header: "Себест., ₽", key: "costPrice", width: 12, type: "money" },
  { header: "План, шт", key: "salesPlan", width: 10, type: "int" },
  { header: "Маржа FBO, ₽", key: "marginFbo", width: 14, type: "money" },
  { header: "Маржа FBS, ₽", key: "marginFbs", width: 14, type: "money" },
  { header: "Маржа realFBS, ₽", key: "marginRealFbs", width: 16, type: "money" },
  { header: "К начисл. FBO, ₽", key: "payoutFbo", width: 16, type: "money" },
  { header: "К начисл. FBS, ₽", key: "payoutFbs", width: 16, type: "money" },
  { header: "К начисл. realFBS, ₽", key: "payoutRealFbs", width: 18, type: "money" },
  { header: "Маржа FBO, %", key: "pctFbo", width: 12, type: "percent" },
  { header: "Маржа FBS, %", key: "pctFbs", width: 12, type: "percent" },
  { header: "Маржа realFBS, %", key: "pctRealFbs", width: 14, type: "percent" },
];

export async function exportShortExcel(
  rows: ProductRow[],
  results: Map<string, CalcResult | { error: string }>,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ozon Calc";
  wb.created = new Date();
  const ws = wb.addWorksheet("Товары", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  stylizeColumns(ws, SHORT_COLUMNS);
  writeWorkbookTitle(ws, `Товары — расчёт прибыли`, SHORT_COLUMNS.length);
  writeHeaderRow(ws, 4, SHORT_COLUMNS, false);

  rows.forEach((row, i) => {
    const r = results.get(row.id);
    const calc = r && !("error" in r) ? r : null;
    const values = {
      articleId: row.input.articleId,
      ozonSku: row.ozonSku ?? null,
      productName: row.input.productName,
      category: row.input.category,
      currentPrice: row.input.currentPrice,
      costPrice: row.input.costPrice,
      salesPlan: row.input.salesPlan,
      marginFbo: calc?.fbo.marginRub ?? null,
      marginFbs: calc?.fbs.marginRub ?? null,
      marginRealFbs: calc?.realFbs.marginRub ?? null,
      payoutFbo: calc?.fbo.ozonNetPayout ?? null,
      payoutFbs: calc?.fbs.ozonNetPayout ?? null,
      payoutRealFbs: calc?.realFbs.ozonNetPayout ?? null,
      pctFbo: calc?.fbo.marginPercent ?? null,
      pctFbs: calc?.fbs.marginPercent ?? null,
      pctRealFbs: calc?.realFbs.marginPercent ?? null,
    };
    writeDataRow(ws, 5 + i, SHORT_COLUMNS, values, i % 2 === 1);
  });

  await triggerDownload(wb, `ozon-расчёт-${nowFileStamp()}.xlsx`);
}

// ── FULL EXPORT — all per-row breakdown details ───────────────────────────

const buildFullColumns = (): Column[] => {
  const cols: Column[] = [
    { header: "Артикул", key: "articleId", width: 18, type: "text", group: "Товар" },
    { header: "SKU", key: "ozonSku", width: 14, type: "int", group: "Товар" },
    { header: "Название", key: "productName", width: 36, type: "text", group: "Товар" },
    { header: "Категория", key: "category", width: 22, type: "text", group: "Товар" },
    { header: "Тип товара", key: "productType", width: 20, type: "text", group: "Товар" },
    { header: "КГТ", key: "isKgt", width: 8, type: "text", group: "Товар" },
    { header: "Объём, л", key: "volumeL", width: 10, type: "int", group: "Товар" },
    { header: "Ставка НДС", key: "vatRate", width: 11, type: "text", group: "Товар" },

    { header: "Цена, ₽", key: "currentPrice", width: 12, type: "money", group: "Цена" },
    { header: "Скидка, %", key: "discountPercent", width: 10, type: "percent", group: "Цена" },
    { header: "Цена со скидкой, ₽", key: "promoPrice", width: 14, type: "money", group: "Цена" },
    { header: "Себест., ₽", key: "costPrice", width: 12, type: "money", group: "Цена" },
    { header: "План, шт", key: "salesPlan", width: 10, type: "int", group: "Цена" },
    { header: "Выкуп, %", key: "redemptionPercent", width: 10, type: "int", group: "Цена" },
    { header: "Маркетинг, %", key: "marketingPercent", width: 12, type: "percent", group: "Цена" },
  ];

  const schemaCols = (
    schemaPrefix: "fbo" | "fbs" | "realFbs",
    label: "FBO" | "FBS" | "realFBS",
  ): Column[] => [
    { header: "Комиссия, ₽", key: `${schemaPrefix}_commission`, width: 13, type: "money", group: label },
    { header: "Эквайринг, ₽", key: `${schemaPrefix}_acquiring`, width: 12, type: "money", group: label },
    { header: "Маркетинг, ₽", key: `${schemaPrefix}_marketing`, width: 12, type: "money", group: label },
    { header: "Логистика, ₽", key: `${schemaPrefix}_logistics`, width: 12, type: "money", group: label },
    { header: "Last-mile, ₽", key: `${schemaPrefix}_lastMile`, width: 11, type: "money", group: label },
    { header: "Хранение, ₽", key: `${schemaPrefix}_storage`, width: 11, type: "money", group: label },
    { header: "Приёмка/first-mile, ₽", key: `${schemaPrefix}_acceptance`, width: 16, type: "money", group: label },
    { header: "Возврат Ozon, ₽", key: `${schemaPrefix}_returnSvc`, width: 14, type: "money", group: label },
    { header: "НДС к уплате, ₽", key: `${schemaPrefix}_vatPayable`, width: 14, type: "money", group: label },
    { header: "Налог, ₽", key: `${schemaPrefix}_tax`, width: 12, type: "money", group: label },
    { header: "Расходы итого, ₽", key: `${schemaPrefix}_totalExpenses`, width: 14, type: "money", group: label },
    { header: "К начислению, ₽", key: `${schemaPrefix}_payout`, width: 14, type: "money", group: label },
    { header: "Маржа, ₽", key: `${schemaPrefix}_margin`, width: 12, type: "money", group: label },
    { header: "Маржа, %", key: `${schemaPrefix}_marginPct`, width: 10, type: "percent", group: label },
    { header: "Рентаб. с/с, %", key: `${schemaPrefix}_profitability`, width: 12, type: "percent", group: label },
  ];

  cols.push(...schemaCols("fbo", "FBO"));
  cols.push(...schemaCols("fbs", "FBS"));
  cols.push(...schemaCols("realFbs", "realFBS"));
  return cols;
};

const buildSchemaRow = (
  prefix: "fbo" | "fbs" | "realFbs",
  s: SchemaResult,
): Record<string, number> => ({
  [`${prefix}_commission`]: s.commissionRub,
  [`${prefix}_acquiring`]: s.acquiringRub,
  [`${prefix}_marketing`]: s.marketingRub,
  [`${prefix}_logistics`]: s.logisticsRub,
  [`${prefix}_lastMile`]: s.lastMileRub,
  [`${prefix}_storage`]: s.storageRub,
  [`${prefix}_acceptance`]: s.acceptanceRub,
  [`${prefix}_returnSvc`]: s.ozonReturnServicesRub,
  [`${prefix}_vatPayable`]: s.vatPayable,
  [`${prefix}_tax`]: s.totalTax,
  [`${prefix}_totalExpenses`]: s.totalExpenses,
  [`${prefix}_payout`]: s.ozonNetPayout,
  [`${prefix}_margin`]: s.marginRub,
  [`${prefix}_marginPct`]: s.marginPercent,
  [`${prefix}_profitability`]: s.profitability,
});

export async function exportFullExcel(
  rows: ProductRow[],
  results: Map<string, CalcResult | { error: string }>,
  taxSettings: TaxSettings,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ozon Calc";
  wb.created = new Date();
  const ws = wb.addWorksheet("Полный расчёт", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 4 }],
  });

  const COLUMNS = buildFullColumns();
  stylizeColumns(ws, COLUMNS);
  writeWorkbookTitle(
    ws,
    `Полный расчёт — налоги, комиссии, маржа · ${taxSettings.taxSystem}`,
    COLUMNS.length,
  );
  // Rows 1-2 = title; row 3 = group labels; row 4 = column headers.
  writeHeaderRow(ws, 3, COLUMNS, true);

  rows.forEach((row, i) => {
    const r = results.get(row.id);
    const calc = r && !("error" in r) ? r : null;
    const values: Record<string, string | number | null | undefined> = {
      articleId: row.input.articleId,
      ozonSku: row.ozonSku ?? null,
      productName: row.input.productName,
      category: row.input.category,
      productType: row.input.productType,
      isKgt: row.input.isKgt ? "Да" : "Нет",
      volumeL: row.input.volumeL,
      vatRate:
        row.input.vatRate === "Не облагается"
          ? "Не облагается"
          : `${(row.input.vatRate * 100).toFixed(0)}%`,
      currentPrice: row.input.currentPrice,
      discountPercent: row.input.discountPercent,
      promoPrice: calc?.promoPrice ?? null,
      costPrice: row.input.costPrice,
      salesPlan: row.input.salesPlan,
      redemptionPercent: row.input.redemptionPercent,
      marketingPercent: row.input.marketingPercent,
      ...(calc ? buildSchemaRow("fbo", calc.fbo) : {}),
      ...(calc ? buildSchemaRow("fbs", calc.fbs) : {}),
      ...(calc ? buildSchemaRow("realFbs", calc.realFbs) : {}),
    };
    writeDataRow(ws, 6 + i, COLUMNS, values, i % 2 === 1);
  });

  await triggerDownload(wb, `ozon-полный-${nowFileStamp()}.xlsx`);
}
