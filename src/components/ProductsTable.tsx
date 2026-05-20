import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Filter,
  Plus,
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
import BulkActionsBar from "./BulkActionsBar";
import ShopBadge from "./ShopBadge";
import type { Shop } from "../api";
import { inactivityOf, isActiveOzon } from "../lib/ozonStatus";
import ShopMultiSelect from "./ShopMultiSelect";
import ProductFiltersSheet from "./ProductFiltersSheet";

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
  onImportCostPrice: () => void;
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
  /** Refetch products from server after bulk update/delete (App.tsx provides
   * `refreshProducts`). When omitted, bulk actions still run but the UI won't
   * sync to the new server state. */
  onProductsRefresh?: () => void | Promise<void>;
  /** Map shopId → Shop. Used to render per-row ShopBadge in the "Маг." column. */
  shopsById?: Map<number, Shop>;
  /** All shops the user can filter by (owned + shared). When ≥2, renders the
   * inline shop-filter chips in the toolbar. Omit or pass <2 to hide. */
  shopsForFilter?: Shop[];
  /** Selected shopIds for the filter. Empty set = all shops shown. */
  shopFilter?: Set<number>;
  onShopFilterChange?: (next: Set<number>) => void;
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

function useIsMobile(bp = 768): boolean {
  const [m, setM] = useState(
    () => typeof window !== "undefined" && window.innerWidth < bp,
  );
  useEffect(() => {
    const onResize = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return m;
}

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
  onImportCostPrice,
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
  onProductsRefresh,
  shopsById,
  shopsForFilter,
  shopFilter,
  onShopFilterChange,
}: Props) {
  // Bulk-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback(
    (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const clearSelection = () => setSelectedIds(new Set());

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

  const isMobile = useIsMobile(768);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (channelFilter !== "Все" ? 1 : 0) +
    (activeOnly ? 1 : 0) +
    (shopFilter && shopFilter.size > 0 && shopsForFilter
      ? shopFilter.size < shopsForFilter.length
        ? 1
        : 0
      : 0);

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

  // Virtualization: render only ~20-30 visible rows in DOM at a time. With
  // 1000+ products this trims initial render from seconds to <100ms.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Column count for colSpan math:
  //  - 12 always-rendered: checkbox, Маг., Артикул, SKU, Название, Категория,
  //    Цена, Себест., FBO, FBS, realFBS, Лучшая, delete.
  //  - + График when showChart
  //  - + 3 actuals (Продано / Ср. за продажу / Поступления) when actuals
  const colCount = 13 + (showChart ? 1 : 0) + (showActuals ? 3 : 0);

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

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  // Stable callbacks so memoized rows don't re-render on parent updates.
  const handleSelect = useCallback((id: string) => onSelect(id), [onSelect]);
  const handleUpdate = useCallback(
    (id: string, next: ProductInput) => onUpdate(id, next),
    [onUpdate],
  );
  const handleRemove = useCallback((id: string) => onRemove(id), [onRemove]);

  return (
    <section>
      <div className="products-toolbar">
        <div className="products-toolbar-left">
          {isMobile ? (
            <>
              {onSearchChange && (
                <label className="products-search products-search-full">
                  <Search size={14} className="products-search-icon" />
                  <input
                    type="text"
                    value={localQuery}
                    onChange={(e) => setLocalQuery(e.target.value)}
                    placeholder="Артикул, SKU или название"
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
                    >
                      <X size={12} />
                    </button>
                  )}
                </label>
              )}
              <button
                type="button"
                className="filters-trigger"
                onClick={() => setFiltersOpen(true)}
                title="Открыть фильтры"
              >
                <Filter size={14} />
                Фильтры
                {activeFilterCount > 0 && (
                  <span className="filters-trigger-badge">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {searchQuery && totalRowsCount !== undefined && (
                <span className="search-count" aria-live="polite">
                  Найдено {sortedRows.length}{" "}
                  <span className="search-count-of">из</span> {totalRowsCount}
                </span>
              )}
            </>
          ) : (
            <>
              {shopsForFilter &&
                shopsForFilter.length > 1 &&
                onShopFilterChange && (
                  <>
                    <span className="toolbar-group-label">Магазины</span>
                    <ShopMultiSelect
                      shops={shopsForFilter}
                      value={shopFilter ?? new Set()}
                      onChange={onShopFilterChange}
                    />
                  </>
                )}
              <ChannelFilter
                active={channelFilter}
                onChange={onChannelFilterChange}
              />
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
              <span
                className="toolbar-legend"
                title="Бейдж Oz на строке означает: данные пришли из Ozon, локально не редактируются"
              >
                <OzIcon />
              </span>
            </>
          )}
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
              <FileSpreadsheet size={14} />
              <span className="excel-label">Excel</span>
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
            className="btn-secondary toolbar-btn"
            onClick={onImport}
            title="Импорт из Ozon"
          >
            <Download size={14} />
            <span className="toolbar-btn-label toolbar-btn-label-full">Импорт из Ozon</span>
            <span className="toolbar-btn-label toolbar-btn-label-short">Импорт</span>
          </button>
          <button
            className="btn-secondary toolbar-btn"
            onClick={onImportCostPrice}
            title="Импорт себестоимости из xlsx"
          >
            <FileSpreadsheet size={14} />
            <span className="toolbar-btn-label toolbar-btn-label-full">Себестоимость xlsx</span>
            <span className="toolbar-btn-label toolbar-btn-label-short">xlsx</span>
          </button>
          <button
            className="btn-primary toolbar-btn"
            onClick={onAdd}
            title="Добавить товар"
          >
            <Plus size={14} />
            <span className="toolbar-btn-label">Добавить товар</span>
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionsBar
          selectedIds={selectedIds}
          rows={rows}
          results={results}
          taxSettings={taxSettings}
          onClear={clearSelection}
          onAfterChange={async () => {
            if (onProductsRefresh) await onProductsRefresh();
          }}
        />
      )}

      <div className="products-scroll" ref={scrollRef}>
        <table className="products-table">
          <thead>
            <tr>
              <th className="bulk-checkbox-col" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="bulk-checkbox"
                  aria-label="Выбрать все"
                  checked={
                    sortedRows.length > 0 &&
                    sortedRows.every((r) => selectedIds.has(r.id))
                  }
                  ref={(el) => {
                    if (!el) return;
                    const some = sortedRows.some((r) => selectedIds.has(r.id));
                    const all =
                      sortedRows.length > 0 &&
                      sortedRows.every((r) => selectedIds.has(r.id));
                    el.indeterminate = some && !all;
                  }}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(sortedRows.map((r) => r.id)));
                    } else {
                      clearSelection();
                    }
                  }}
                />
              </th>
              <th className="shop-col" title="Магазин">
                <span>Маг.</span>
              </th>
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="empty">
                  Нет товаров. Нажмите «Добавить товар».
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="empty">
                  Ничего не нашлось — попробуйте другой запрос или сбросьте
                  фильтры
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden style={{ height: paddingTop }} />
                )}
                {virtualItems.map((vi) => {
                  const row = sortedRows[vi.index];
                  return (
                    <ProductRow
                      key={row.id}
                      row={row}
                      result={results.get(row.id)}
                      selected={row.id === selectedId}
                      checked={selectedIds.has(row.id)}
                      shop={shopsById?.get(row.shopId)}
                      actual={actuals?.get(row.input.articleId)}
                      searchQuery={searchQuery}
                      showChart={showChart}
                      showActuals={showActuals}
                      breakdownMode={breakdownMode}
                      onSelect={handleSelect}
                      onToggleCheck={toggleSelect}
                      onUpdate={handleUpdate}
                      onRemove={handleRemove}
                      measureRef={virtualizer.measureElement}
                      virtualIndex={vi.index}
                    />
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden style={{ height: paddingBottom }} />
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      {isMobile && shopsForFilter && onShopFilterChange && onActiveOnlyChange && (
        <ProductFiltersSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          shops={shopsForFilter}
          shopFilter={shopFilter ?? new Set()}
          onShopFilterChange={onShopFilterChange}
          channelFilter={channelFilter}
          onChannelFilterChange={onChannelFilterChange}
          activeOnly={!!activeOnly}
          onActiveOnlyChange={onActiveOnlyChange}
          resultCount={sortedRows.length}
        />
      )}
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

interface ProductRowProps {
  row: ProductRow;
  result: RowResult | undefined;
  selected: boolean;
  checked: boolean;
  shop: Shop | undefined;
  actual: RealizedMarginRow | undefined;
  searchQuery: string | undefined;
  showChart: boolean;
  showActuals: boolean;
  breakdownMode: "both" | "margin" | "payout";
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onUpdate: (id: string, next: ProductInput) => void;
  onRemove: (id: string) => void;
  measureRef: (el: HTMLElement | null) => void;
  virtualIndex: number;
}

const ProductRow = memo(function ProductRow({
  row,
  result,
  selected,
  checked,
  shop,
  actual,
  searchQuery,
  showChart,
  showActuals,
  breakdownMode,
  onSelect,
  onToggleCheck,
  onUpdate,
  onRemove,
  measureRef,
  virtualIndex,
}: ProductRowProps) {
  const calc = isCalc(result) ? result : null;
  const winner = calc ? bestKey(calc) : null;
  const fromOzon = row.ozonProductId != null;
  const inactivity = inactivityOf(row);
  const updateField = <K extends keyof ProductInput>(
    key: K,
    val: ProductInput[K],
  ) => onUpdate(row.id, { ...row.input, [key]: val });

  const rowClasses = [
    selected ? "selected" : "",
    checked ? "row-checked" : "",
    inactivity.kind ? "row-inactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr
      ref={measureRef}
      data-index={virtualIndex}
      className={rowClasses}
      onClick={() => onSelect(row.id)}
      title={inactivity.kind ? inactivity.reason : undefined}
    >
      <td className="bulk-checkbox-col" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="bulk-checkbox"
          aria-label={`Выбрать ${row.input.articleId}`}
          checked={checked}
          onChange={() => onToggleCheck(row.id)}
        />
      </td>
      <td className="shop-col">
        {shop && (
          <ShopBadge code={shop.shortName} color={shop.color} title={shop.name} />
        )}
      </td>
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
          <span
            title="Название из каталога Ozon — только чтение"
            style={{ fontWeight: 600 }}
          >
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
          <span
            title="Категория из каталога Ozon — только чтение"
            style={{ color: "var(--muted-2)" }}
          >
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
            <title>{result && "error" in result ? result.error : ""}</title>
          </AlertTriangle>
        )}
      </td>
      {showActuals && (
        <>
          <td className="num" style={{ color: "var(--muted-2)" }}>
            {actual ? actual.salesCount : "—"}
          </td>
          <td className="num" style={{ color: "var(--muted-2)" }}>
            {actual && actual.salesCount > 0 ? (
              (() => {
                const factOzonNetPerSale =
                  actual.actualRevenue / actual.salesCount;
                // Та же формула что в SchemaResult.marginRub в калькуляторе
                // (см. src/lib/calc/index.ts:408): margin = promoPrice -
                // totalExpenses, где totalExpenses включает costPrice +
                // totalTax + всё прочее. Здесь Ozon-расходы уже вычтены
                // из factOzonNetPerSale, поэтому вычитаем только
                // costPrice + totalTax. costPrice вычитается всегда —
                // это реально потраченные деньги, независимо от
                // whitePurchase. Whitepurchase влияет только на totalTax
                // (он уже учтён в calc[winner].totalTax из калькулятора).
                const costPrice = row.input.costPrice;
                const taxPerSale =
                  calc && winner ? calc[winner].totalTax : null;
                const factMargin =
                  taxPerSale != null
                    ? factOzonNetPerSale - costPrice - taxPerSale
                    : null;
                const factProfitability =
                  factMargin != null && costPrice > 0
                    ? factMargin / costPrice
                    : null;
                return (
                  <>
                    <div>{fmtRub(factOzonNetPerSale)}</div>
                    {factProfitability != null && (
                      <div
                        className="margin-roi"
                        title={`Рентабельность по факту: (поступление от Ozon − себестоимость − налог) / себестоимость. Налог — из ${winner}-расчёта.`}
                      >
                        {fmtPct(factProfitability)}
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              "—"
            )}
          </td>
          <td className="num" style={{ color: "var(--muted-2)" }}>
            {actual ? fmtRub(actual.actualMargin) : "—"}
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
});
