import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Search,
  X,
} from "lucide-react";
import type {
  ProductRow,
  ProductInput,
  CalcResult,
  TaxSettings,
} from "../types";
import { exportShortExcel, exportFullExcel } from "../lib/exportExcel";
import type { RealizedMarginRow } from "../api";
import { fmtRub, fmtPct } from "../format";
import EditableCell from "./EditableCell";
import MarginBar from "./MarginBar";
import ChannelBadge, { type ChannelKey } from "./ChannelBadge";
import ChannelFilter, { type FilterValue } from "./ChannelFilter";
import InactivityBadge from "./InactivityBadge";
import { inactivityOf, isActiveOzon } from "../lib/ozonStatus";

export type RowResult = CalcResult | { error: string };

interface Props {
  rows: ProductRow[];
  results: Map<string, RowResult>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, next: ProductInput) => void;
  onRemove: (id: string) => void;
  onImport: () => void;
  channelFilter: FilterValue;
  onChannelFilterChange: (v: FilterValue) => void;
  showChart: boolean;
  /** When provided, renders Продано / Факт. маржа with actual numbers + tfoot Δ. */
  actuals?: Map<string, RealizedMarginRow>;
  /** Hide products that Ozon marks as archived/inactive. */
  activeOnly?: boolean;
  onActiveOnlyChange?: (v: boolean) => void;
  /** Which numbers the schema columns show:
   *  - "margin"  → marginRub only (header "Маржа FBO");
   *  - "payout"  → ozonNetPayout only (header "К начислению FBO");
   *  - "both"    → ozonNetPayout primary + marginRub secondary in gray. */
  breakdownMode?: "both" | "margin" | "payout";
  /** Live search query — filtering happens upstream in App.tsx; the value is
   * passed back here only so the input can render its own controlled state. */
  searchQuery?: string;
  onSearchChange?: (v: string) => void;
  /** Total rows in the underlying dataset (before search). Used to render
   * the "Найдено X из Y" counter. */
  totalRowsCount?: number;
  /** Tax settings — required for the full Excel export (header line shows
   * the active tax system). When omitted, only short export is offered. */
  taxSettings?: TaxSettings;
}

type SortKey =
  | "articleId"
  | "sku"
  | "productName"
  | "category"
  | "currentPrice"
  | "costPrice"
  | "salesPlan"
  | "fbo"
  | "fbs"
  | "realFbs"
  | "salesCount"
  | "avgRevenue"
  | "totalAmount";
type SortDir = "asc" | "desc";

/** Wraps the substring of `text` matching `query` in <mark>. Case-insensitive,
 * highlights only the first occurrence (the cells are short). */
const Highlight = ({ text, query }: { text: string; query: string | undefined }) => {
  const q = (query ?? "").trim();
  if (!q || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
};

type SchemaKey = "fbo" | "fbs" | "realFbs";

const SCHEMA_TO_CHANNEL: Record<SchemaKey, ChannelKey> = {
  fbo: "FBO",
  fbs: "FBS",
  realFbs: "realFBS",
};

const SCHEMAS: Array<{ key: SchemaKey; label: string; cls: string }> = [
  { key: "fbo", label: "FBO", cls: "fbo" },
  { key: "fbs", label: "FBS", cls: "fbs" },
  { key: "realFbs", label: "realFBS", cls: "real" },
];

const isCalc = (r: RowResult | undefined): r is CalcResult => !!r && !("error" in r);

const bestKey = (r: CalcResult): SchemaKey => {
  const m: Record<SchemaKey, number> = {
    fbo: r.fbo.marginRub,
    fbs: r.fbs.marginRub,
    realFbs: r.realFbs.marginRub,
  };
  return (Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]) as SchemaKey;
};

export default function ProductsTable({
  rows,
  results,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onImport,
  channelFilter,
  onChannelFilterChange,
  showChart,
  actuals,
  activeOnly,
  onActiveOnlyChange,
  breakdownMode = "both",
  searchQuery,
  onSearchChange,
  totalRowsCount,
  taxSettings,
}: Props) {
  // Excel-export dropdown state
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportOpen]);
  // Debounced search: keep input value local for instant typing, propagate
  // upstream after a small delay so heavy re-renders (filter + KPI recompute)
  // don't run on every keystroke when there are many products.
  const [localQuery, setLocalQuery] = useState(searchQuery ?? "");
  useEffect(() => {
    if ((searchQuery ?? "") === localQuery) return;
    const t = setTimeout(() => onSearchChange?.(localQuery), 150);
    return () => clearTimeout(t);
  }, [localQuery, onSearchChange, searchQuery]);

  // ── Sort by column ──────────────────────────────────────────────────────
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const handleSortClick = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  };
  const sortIcon = (key: SortKey) => {
    if (sort?.key !== key) return null;
    return sort.dir === "desc" ? (
      <ChevronDown size={12} />
    ) : (
      <ChevronUp size={12} />
    );
  };
  const sortableThClass = (key: SortKey, base: string = "") => {
    const isActive = sort?.key === key;
    return [base, "sortable", isActive ? "sort-active" : ""]
      .filter(Boolean)
      .join(" ");
  };
  const showActuals = !!actuals;

  // Column count for colSpan math:
  //  - 11 always-rendered: Артикул, SKU, Название, Категория, Цена, Себест.,
  //    FBO, FBS, realFBS, Лучшая, delete.
  //  - + График when showChart
  //  - + 3 actuals (Продано / Ср. за продажу / Поступления) when actuals
  const colCount = 11 + (showChart ? 1 : 0) + (showActuals ? 3 : 0);

  // Precompute visible rows after channel + active filters so we can both
  // render the counter accurately and skip an extra IIFE in tbody.
  // (Search filter is applied upstream in App.tsx before rows reach us.)
  const visibleAfterFilters = rows.filter((row) => {
    const r = results.get(row.id);
    const calc = isCalc(r) ? r : null;
    const winner = calc ? bestKey(calc) : null;
    if (
      calc &&
      winner &&
      channelFilter !== "Все" &&
      SCHEMA_TO_CHANNEL[winner] !== channelFilter
    ) {
      return false;
    }
    if (activeOnly && !isActiveOzon(row)) return false;
    return true;
  });

  const sortedRows = useMemo(() => {
    if (!sort) return visibleAfterFilters;
    const getValue = (row: ProductRow): string | number | null => {
      const r = results.get(row.id);
      const calc = isCalc(r) ? r : null;
      const a = actuals?.get(row.input.articleId);
      switch (sort.key) {
        case "articleId":
          return row.input.articleId;
        case "sku":
          return row.ozonSku ?? null;
        case "productName":
          return row.input.productName;
        case "category":
          return row.input.category;
        case "currentPrice":
          return row.input.currentPrice;
        case "costPrice":
          return row.input.costPrice;
        case "salesPlan":
          return row.input.salesPlan;
        case "fbo":
          return calc?.fbo.marginRub ?? null;
        case "fbs":
          return calc?.fbs.marginRub ?? null;
        case "realFbs":
          return calc?.realFbs.marginRub ?? null;
        case "salesCount":
          return a?.salesCount ?? null;
        case "avgRevenue":
          return a && a.salesCount > 0
            ? a.actualRevenue / a.salesCount
            : null;
        case "totalAmount":
          return a?.actualMargin ?? null;
      }
    };
    const out = [...visibleAfterFilters].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      // Nulls always last regardless of direction.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? va.localeCompare(vb, "ru")
          : (va as number) - (vb as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [visibleAfterFilters, sort, results, actuals]);

  return (
    <section>
      <div className="products-toolbar">
        <div className="products-toolbar-left">
          <ChannelFilter active={channelFilter} onChange={onChannelFilterChange} />
          {onActiveOnlyChange && (
            <label
              className="active-only-toggle"
              title="Скрыть товары в архиве и снятые с витрины Ozon"
            >
              <input
                type="checkbox"
                checked={!!activeOnly}
                onChange={(e) => onActiveOnlyChange(e.target.checked)}
              />
              <span>Только активные</span>
            </label>
          )}
          {onSearchChange && (
            <label className="products-search">
              <Search size={14} className="products-search-icon" />
              <input
                type="text"
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                placeholder="Артикул, SKU или название"
                title="Поиск по артикулу, SKU или названию"
                aria-label="Поиск по таблице"
              />
              {localQuery && (
                <button
                  type="button"
                  className="products-search-clear"
                  onClick={() => {
                    setLocalQuery("");
                    onSearchChange("");
                  }}
                  aria-label="Очистить поиск"
                  title="Очистить"
                >
                  <X size={12} />
                </button>
              )}
            </label>
          )}
          {searchQuery && totalRowsCount !== undefined && (
            <span className="search-count" aria-live="polite">
              Найдено {sortedRows.length}{" "}
              <span className="search-count-of">из</span> {totalRowsCount}
            </span>
          )}
          <span className="toolbar-legend">
            <OzIcon />
            — данные из Ozon, только чтение
          </span>
        </div>
        <div className="products-toolbar-actions">
          <div className="excel-export" ref={exportRef}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setExportOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Экспорт в Excel"
            >
              <FileSpreadsheet size={14} /> Excel{" "}
              <ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div className="excel-export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="excel-export-item"
                  onClick={() => {
                    setExportOpen(false);
                    void exportShortExcel(sortedRows, results);
                  }}
                >
                  <strong>Краткий</strong>
                  <span className="muted">Как в таблице</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="excel-export-item"
                  disabled={!taxSettings}
                  onClick={() => {
                    if (!taxSettings) return;
                    setExportOpen(false);
                    void exportFullExcel(sortedRows, results, taxSettings);
                  }}
                  title={
                    !taxSettings
                      ? "Загружаем настройки налогов…"
                      : "Все статьи расходов и налоги по схемам"
                  }
                >
                  <strong>Полный</strong>
                  <span className="muted">
                    Комиссии, налоги, маржа по схемам
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            className="btn-secondary"
            onClick={onImport}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={14} /> Импорт из Ozon
          </button>
          <button className="btn-primary" onClick={onAdd}>
            + Добавить товар
          </button>
        </div>
      </div>

      <div className="products-scroll">
        <table className="products-table">
          <thead>
            <tr>
              <th
                className={sortableThClass("articleId")}
                onClick={() => handleSortClick("articleId")}
              >
                <span className="sort-th-inner">
                  Артикул {sortIcon("articleId")}
                </span>
              </th>
              <th
                className={sortableThClass("sku", "sku")}
                onClick={() => handleSortClick("sku")}
                title="Публичный SKU Ozon (ozon.ru/product/{sku})"
              >
                <span className="sort-th-inner">SKU {sortIcon("sku")}</span>
              </th>
              <th
                className={sortableThClass("productName")}
                onClick={() => handleSortClick("productName")}
              >
                <span className="sort-th-inner">
                  Название {sortIcon("productName")}
                </span>
              </th>
              <th
                className={sortableThClass("category")}
                onClick={() => handleSortClick("category")}
              >
                <span className="sort-th-inner">
                  Категория {sortIcon("category")}
                </span>
              </th>
              <th
                className={sortableThClass("currentPrice", "num price")}
                onClick={() => handleSortClick("currentPrice")}
              >
                <span className="sort-th-inner">
                  Цена {sortIcon("currentPrice")}
                </span>
              </th>
              <th
                className={sortableThClass("costPrice", "num")}
                onClick={() => handleSortClick("costPrice")}
              >
                <span className="sort-th-inner">
                  Себест. {sortIcon("costPrice")}
                </span>
              </th>
              {SCHEMAS.map((s) => {
                const headerLabel =
                  breakdownMode === "both"
                    ? s.label
                    : breakdownMode === "payout"
                      ? `Начисл. ${s.label}`
                      : `Маржа ${s.label}`;
                const headerTitle =
                  breakdownMode === "both"
                    ? "Сверху — К начислению от Ozon (как в Ozon-калькуляторе). Снизу серым — маржа после налогов и себестоимости."
                    : breakdownMode === "payout"
                      ? "Сумма, которую Ozon переведёт продавцу за товар (без вычета налогов и себестоимости)."
                      : "Реальная прибыль продавца после Ozon-удержаний, налогов и себестоимости.";
                return (
                  <th
                    key={s.key}
                    className={sortableThClass(s.key, `num ${s.cls}`)}
                    title={headerTitle}
                    onClick={() => handleSortClick(s.key)}
                  >
                    <span className="sort-th-inner">
                      {headerLabel} {sortIcon(s.key)}
                    </span>
                  </th>
                );
              })}
              {showChart && <th className="center">График</th>}
              <th className="center">Лучшая</th>
              {showActuals && (
                <>
                  <th
                    className={sortableThClass("salesCount", "num")}
                    onClick={() => handleSortClick("salesCount")}
                    title="Сколько раз товар продавался за период (sale-операций по выписке)"
                  >
                    <span className="sort-th-inner">
                      Продано {sortIcon("salesCount")}
                    </span>
                  </th>
                  <th
                    className={sortableThClass("avgRevenue", "num")}
                    onClick={() => handleSortClick("avgRevenue")}
                    title="Среднее поступление за одну sale-операцию: actualRevenue / salesCount. Это та сумма (net, после удержаний Ozon), что вы реально получаете на счёт за единицу товара в среднем."
                  >
                    <span className="sort-th-inner">
                      Ср. за продажу {sortIcon("avgRevenue")}
                    </span>
                  </th>
                  <th
                    className={sortableThClass("totalAmount", "num")}
                    onClick={() => handleSortClick("totalAmount")}
                    title="Сумма всех amount-ов за период (sales + refunds + commissions + …) — итоговое движение по счёту по этому артикулу."
                  >
                    <span className="sort-th-inner">
                      Поступления {sortIcon("totalAmount")}
                    </span>
                  </th>
                </>
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  Нет товаров. Нажмите «Добавить товар».
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const r = results.get(row.id);
              const calc = isCalc(r) ? r : null;
              const winner = calc ? bestKey(calc) : null;
              const isSelected = row.id === selectedId;
              const fromOzon = row.ozonProductId != null;
              const a = actuals?.get(row.input.articleId);
              const inactivity = inactivityOf(row);

              const updateField = <K extends keyof ProductInput>(key: K, val: ProductInput[K]) =>
                onUpdate(row.id, { ...row.input, [key]: val });

              const rowClasses = [
                isSelected ? "selected" : "",
                inactivity.kind ? "row-inactive" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  key={row.id}
                  className={rowClasses}
                  onClick={() => onSelect(row.id)}
                  title={inactivity.kind ? inactivity.reason : undefined}
                >
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <InactivityBadge inactivity={inactivity} />
                      {fromOzon ? (
                        <span
                          className="oz-badge"
                          title="Артикул из каталога Ozon — только чтение"
                        >
                          <OzIcon />
                          {row.input.articleId ? (
                            <Highlight text={row.input.articleId} query={searchQuery} />
                          ) : (
                            "—"
                          )}
                        </span>
                      ) : (
                        <EditableCell
                          type="text"
                          value={row.input.articleId}
                          onChange={(v) => updateField("articleId", v)}
                          align="left"
                        />
                      )}
                    </span>
                  </td>
                  <td className="num sku">
                    {row.ozonSku != null ? (
                      <a
                        href={`https://www.ozon.ru/product/${row.ozonSku}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Открыть товар на ozon.ru"
                      >
                        <Highlight text={String(row.ozonSku)} query={searchQuery} />
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="ellipsis" title={row.input.productName}>
                    {fromOzon ? (
                      <span title="Название из каталога Ozon — только чтение" style={{ fontWeight: 600 }}>
                        {row.input.productName ? (
                          <Highlight text={row.input.productName} query={searchQuery} />
                        ) : (
                          "—"
                        )}
                      </span>
                    ) : (
                      <EditableCell
                        type="text"
                        value={row.input.productName}
                        onChange={(v) => updateField("productName", v)}
                        align="left"
                      />
                    )}
                  </td>
                  <td className="ellipsis" title={row.input.category}>
                    {fromOzon ? (
                      <span title="Категория из каталога Ozon — только чтение" style={{ color: "var(--muted-2)" }}>
                        {row.input.category}
                      </span>
                    ) : (
                      <EditableCell
                        type="text"
                        value={row.input.category}
                        onChange={(v) => updateField("category", v)}
                        align="left"
                      />
                    )}
                  </td>
                  <td className="num price">
                    <EditableCell
                      type="number"
                      value={row.input.currentPrice}
                      onChange={(v) => updateField("currentPrice", v)}
                      suffix=" ₽"
                    />
                    {row.regularPrice != null &&
                      row.regularPrice > row.input.currentPrice && (
                        <div
                          className="muted"
                          style={{
                            fontSize: 11,
                            marginTop: 2,
                            lineHeight: 1.2,
                            textDecoration: "line-through",
                          }}
                          title="Обычная цена Ozon до маркетинговой акции"
                        >
                          {fmtRub(row.regularPrice)}
                        </div>
                      )}
                  </td>
                  <td className="num">
                    <EditableCell
                      type="number"
                      value={row.input.costPrice}
                      onChange={(v) => updateField("costPrice", v)}
                      suffix=" ₽"
                    />
                  </td>
                  {SCHEMAS.map((s) => (
                    <td key={s.key} className={`num ${s.cls}`}>
                      {calc ? (
                        breakdownMode === "both" ? (
                          <>
                            <div>{fmtRub(calc[s.key].ozonNetPayout)}</div>
                            <div
                              className="margin-secondary"
                              title="Маржа — реальная прибыль после налогов и себестоимости"
                            >
                              {fmtRub(calc[s.key].marginRub)}
                            </div>
                            <div
                              className="margin-roi"
                              title="Рентабельность к себестоимости: маржа / costPrice"
                            >
                              {fmtPct(calc[s.key].profitability)}
                            </div>
                          </>
                        ) : breakdownMode === "payout" ? (
                          fmtRub(calc[s.key].ozonNetPayout)
                        ) : (
                          <>
                            <div>{fmtRub(calc[s.key].marginRub)}</div>
                            <div
                              className="margin-roi"
                              title="Рентабельность к себестоимости: маржа / costPrice"
                            >
                              {fmtPct(calc[s.key].profitability)}
                            </div>
                          </>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                  {showChart && (
                    <td className="center">
                      {calc ? (
                        <MarginBar
                          fbo={calc.fbo.marginRub}
                          fbs={calc.fbs.marginRub}
                          real={calc.realFbs.marginRub}
                          best={winner ? SCHEMA_TO_CHANNEL[winner] : null}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td className="center">
                    {calc ? (
                      <ChannelBadge channel={winner ? SCHEMA_TO_CHANNEL[winner] : null} />
                    ) : (
                      <AlertTriangle
                        size={16}
                        className="warn"
                        aria-label="Ошибка расчёта"
                        style={{ color: "var(--err)" }}
                      >
                        <title>{r && "error" in r ? r.error : ""}</title>
                      </AlertTriangle>
                    )}
                  </td>
                  {showActuals && (
                    <>
                      <td className="num" style={{ color: "var(--muted-2)" }}>
                        {a ? a.salesCount : "—"}
                      </td>
                      <td className="num" style={{ color: "var(--muted-2)" }}>
                        {a && a.salesCount > 0
                          ? fmtRub(a.actualRevenue / a.salesCount)
                          : "—"}
                      </td>
                      <td className="num" style={{ color: "var(--muted-2)" }}>
                        {a ? fmtRub(a.actualMargin) : "—"}
                      </td>
                    </>
                  )}
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="del-btn"
                      title="Удалить"
                      onClick={() => onRemove(row.id)}
                      style={{ display: "inline-flex", alignItems: "center" }}
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length > 0 && sortedRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  Ничего не нашлось — попробуйте другой запрос или сбросьте
                  фильтры
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OzIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="oz-icon" aria-hidden>
      <rect width="12" height="12" rx="3" fill="#005BFF" opacity="0.15" />
      <text x="6" y="9" textAnchor="middle" fill="#005BFF" fontFamily="sans-serif" fontWeight="800" fontSize="7">Oz</text>
    </svg>
  );
}
