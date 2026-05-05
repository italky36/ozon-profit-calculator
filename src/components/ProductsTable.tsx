import { AlertTriangle, Download, X } from "lucide-react";
import type { ProductRow, ProductInput, CalcResult } from "../types";
import type { RealizedMarginRow } from "../api";
import { fmtRub, fmtPct } from "../format";
import EditableCell from "./EditableCell";
import MarginBar from "./MarginBar";
import ChannelBadge, { type ChannelKey } from "./ChannelBadge";
import ChannelFilter, { type FilterValue } from "./ChannelFilter";

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
  /** Unit-mode: hide qty column and the entire tfoot (portfolio aggregates). */
  unitMode?: boolean;
}

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

interface Totals {
  fbo: number;
  fbs: number;
  realFbs: number;
  weightedMarginPct: { fbo: number; fbs: number; realFbs: number };
  weightedProfitabilityPct: { fbo: number; fbs: number; realFbs: number };
  hasAny: boolean;
  totalQty: number;
}

const computeTotals = (
  rows: ProductRow[],
  results: Map<string, RowResult>,
  filter: FilterValue,
): Totals => {
  let fbo = 0, fbs = 0, realFbs = 0;
  let revenue = 0;
  let costSum = 0;
  let mFbo = 0, mFbs = 0, mRealFbs = 0;
  let hasAny = false;
  let totalQty = 0;

  for (const row of rows) {
    const r = results.get(row.id);
    if (!isCalc(r)) continue;
    const winner = bestKey(r);
    if (filter !== "Все" && SCHEMA_TO_CHANNEL[winner] !== filter) continue;
    hasAny = true;
    const plan = row.input.salesPlan;
    totalQty += plan;
    fbo += r.fbo.totalProfit;
    fbs += r.fbs.totalProfit;
    realFbs += r.realFbs.totalProfit;
    const rev = r.promoPrice * plan;
    revenue += rev;
    costSum += row.input.costPrice * plan;
    mFbo += r.fbo.marginRub * plan;
    mFbs += r.fbs.marginRub * plan;
    mRealFbs += r.realFbs.marginRub * plan;
  }

  const wm = (m: number) => (revenue > 0 ? m / revenue : 0);
  const wp = (m: number) => (costSum > 0 ? m / costSum : 0);

  return {
    fbo, fbs, realFbs,
    weightedMarginPct: { fbo: wm(mFbo), fbs: wm(mFbs), realFbs: wm(mRealFbs) },
    weightedProfitabilityPct: { fbo: wp(mFbo), fbs: wp(mFbs), realFbs: wp(mRealFbs) },
    hasAny,
    totalQty,
  };
};

const totalsBest = (t: Totals): SchemaKey => {
  const m: Record<SchemaKey, number> = { fbo: t.fbo, fbs: t.fbs, realFbs: t.realFbs };
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
}: Props) {
  const totals = computeTotals(rows, results, channelFilter);
  const winnerTotal = totals.hasAny ? totalsBest(totals) : null;
  const showActuals = !!actuals;

  // Per-channel totals for actuals tfoot (predicted = schema.marginRub × salesCount).
  let actualsAgg: {
    actualSum: number;
    predicted: Record<SchemaKey, number>;
    totalUnits: number;
  } | null = null;
  if (showActuals) {
    let actualSum = 0;
    let totalUnits = 0;
    const predicted: Record<SchemaKey, number> = { fbo: 0, fbs: 0, realFbs: 0 };
    for (const row of rows) {
      const a = actuals.get(row.input.articleId);
      const calc = results.get(row.id);
      if (!a) continue;
      if (isCalc(calc)) {
        const winner = bestKey(calc);
        if (channelFilter !== "Все" && SCHEMA_TO_CHANNEL[winner] !== channelFilter) continue;
      }
      actualSum += a.actualMargin;
      totalUnits += a.salesCount;
      if (isCalc(calc)) {
        predicted.fbo += calc.fbo.marginRub * a.salesCount;
        predicted.fbs += calc.fbs.marginRub * a.salesCount;
        predicted.realFbs += calc.realFbs.marginRub * a.salesCount;
      }
    }
    actualsAgg = { actualSum, predicted, totalUnits };
  }

  // Column count for colSpan math: base 13 + 1 chart.
  const colCount = 13 + (showChart ? 1 : 0);

  return (
    <section>
      <div className="products-toolbar">
        <div className="products-toolbar-left">
          <ChannelFilter active={channelFilter} onChange={onChannelFilterChange} />
          <span className="toolbar-legend">
            <OzIcon />
            — данные из Ozon, только чтение
          </span>
        </div>
        <div className="products-toolbar-actions">
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
              <th>Артикул</th>
              <th>Название</th>
              <th>Категория</th>
              <th className="num price">Цена</th>
              <th className="num">Себест.</th>
              <th className="num center">Кол-во</th>
              {SCHEMAS.map((s) => (
                <th key={s.key} className={`num ${s.cls}`}>Маржа {s.label}</th>
              ))}
              {showChart && <th className="center">График</th>}
              <th className="center">Лучшая</th>
              <th className="num">Продано</th>
              <th className="num">Факт. маржа</th>
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
            {rows.map((row) => {
              const r = results.get(row.id);
              const calc = isCalc(r) ? r : null;
              const winner = calc ? bestKey(calc) : null;
              if (calc && winner && channelFilter !== "Все" && SCHEMA_TO_CHANNEL[winner] !== channelFilter) {
                return null;
              }
              const isSelected = row.id === selectedId;
              const fromOzon = row.ozonProductId != null;
              const a = actuals?.get(row.input.articleId);

              const updateField = <K extends keyof ProductInput>(key: K, val: ProductInput[K]) =>
                onUpdate(row.id, { ...row.input, [key]: val });

              return (
                <tr
                  key={row.id}
                  className={isSelected ? "selected" : ""}
                  onClick={() => onSelect(row.id)}
                >
                  <td>
                    {fromOzon ? (
                      <span
                        className="oz-badge"
                        title="Артикул из каталога Ozon — только чтение"
                      >
                        <OzIcon />
                        {row.input.articleId || "—"}
                      </span>
                    ) : (
                      <EditableCell
                        type="text"
                        value={row.input.articleId}
                        onChange={(v) => updateField("articleId", v)}
                        align="left"
                      />
                    )}
                  </td>
                  <td className="ellipsis" title={row.input.productName}>
                    {fromOzon ? (
                      <span title="Название из каталога Ozon — только чтение" style={{ fontWeight: 600 }}>
                        {row.input.productName || "—"}
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
                  <td className="num center">
                    <EditableCell
                      type="number"
                      value={row.input.salesPlan}
                      onChange={(v) => updateField("salesPlan", v)}
                      align="center"
                      inputWidth={70}
                    />
                  </td>
                  {SCHEMAS.map((s) => (
                    <td key={s.key} className={`num ${s.cls}`}>
                      {calc ? fmtRub(calc[s.key].marginRub) : "—"}
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
                  <td className="num" style={{ color: "var(--muted-2)" }}>
                    {a ? a.salesCount : "—"}
                  </td>
                  <td className="num" style={{ color: "var(--muted-2)" }}>
                    {a ? fmtRub(a.actualMargin) : "—"}
                  </td>
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
          </tbody>
          {totals.hasAny && (
            <tfoot>
              <tr className="totals">
                <td colSpan={5}>Итого по плану</td>
                <td className="num center">{totals.totalQty}</td>
                {SCHEMAS.map((s) => (
                  <td key={s.key} className={`num ${s.cls}`} style={{ fontWeight: 800 }}>
                    {fmtRub(totals[s.key])}
                  </td>
                ))}
                {showChart && <td />}
                <td className="center">
                  {winnerTotal && <ChannelBadge channel={SCHEMA_TO_CHANNEL[winnerTotal]} />}
                </td>
                <td colSpan={3} />
              </tr>
              <tr className="totals-sub">
                <td colSpan={6}>Средневзвешенная маржа, %</td>
                {SCHEMAS.map((s) => (
                  <td key={s.key} className={`num ${s.cls}`}>
                    {fmtPct(totals.weightedMarginPct[s.key])}
                  </td>
                ))}
                {showChart && <td />}
                <td colSpan={4} />
              </tr>
              <tr className="totals-sub">
                <td colSpan={6}>Рентабельность к с/с, %</td>
                {SCHEMAS.map((s) => (
                  <td key={s.key} className={`num ${s.cls}`}>
                    {fmtPct(totals.weightedProfitabilityPct[s.key])}
                  </td>
                ))}
                {showChart && <td />}
                <td colSpan={4} />
              </tr>
              {actualsAgg && (
                <>
                  <tr className="totals-sub">
                    <td colSpan={6}>
                      Прогноз × факт.продажи ({actualsAgg.totalUnits} шт)
                    </td>
                    {SCHEMAS.map((s) => (
                      <td key={s.key} className={`num ${s.cls}`}>
                        {fmtRub(actualsAgg.predicted[s.key])}
                      </td>
                    ))}
                    {showChart && <td />}
                    <td colSpan={4} />
                  </tr>
                  <tr className="totals-sub">
                    <td colSpan={6}>Δ факт − прогноз, %</td>
                    {SCHEMAS.map((s) => {
                      const p = actualsAgg.predicted[s.key];
                      const diff =
                        p === 0 ? null : (actualsAgg.actualSum - p) / Math.abs(p);
                      return (
                        <td key={s.key} className={`num ${s.cls}`}>
                          {diff === null ? "—" : fmtPct(diff)}
                        </td>
                      );
                    })}
                    {showChart && <td />}
                    <td className="center">Факт</td>
                    <td colSpan={2} className="num">
                      {fmtRub(actualsAgg.actualSum)}
                    </td>
                    <td />
                  </tr>
                </>
              )}
            </tfoot>
          )}
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
