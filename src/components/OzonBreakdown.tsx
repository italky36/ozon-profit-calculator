import { useState } from "react";
import type { CalcResult, SchemaResult } from "../types";
import { fmtRub, fmtPct } from "../format";
import { useTweaks } from "../lib/useTweaks";

interface Props {
  result: CalcResult;
}

const SCHEMAS: Array<{ key: "fbo" | "fbs" | "realFbs"; label: string }> = [
  { key: "fbo", label: "FBO" },
  { key: "fbs", label: "FBS" },
  { key: "realFbs", label: "realFBS" },
];

type BarKind = "expense" | "payout" | "neutral";

interface AmountCell {
  /** Money value to display. `null` → render dash, no bar. */
  value: number | null;
  /** Share of price (0..1). Used to size the inline bar. */
  share?: number;
  /** Optional grey "full-picture" value rendered below the primary one
   * (e.g. for "Затраты" — total seller-side outflow incl. cost/marketing/tax). */
  secondary?: { value: number; share?: number; title?: string };
}

interface Row {
  label: string;
  cells: Record<"fbo" | "fbs" | "realFbs", AmountCell>;
  kind: BarKind;
  /** Render label/values with a slight indent — used for child rows. */
  indent?: boolean;
  /** Render the row a bit heavier — totals & headers. */
  emphasis?: boolean;
}

const cellOf = (price: number, amount: number): AmountCell => ({
  value: amount,
  share: price > 0 ? amount / price : 0,
});

const dashCell: AmountCell = { value: null };

const Bar = ({ share, kind }: { share: number; kind: BarKind }) => {
  // Clamp to [0,1] for layout safety; over-100 % bars (e.g. К начислению can
  // never exceed price) are simply rendered full.
  const w = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className={`obz-bar obz-bar-${kind}`}>
      <div className="obz-bar-fill" style={{ width: `${w}%` }} />
    </div>
  );
};

const Cell = ({ cell, kind }: { cell: AmountCell; kind: BarKind }) => {
  if (cell.value === null) return <td className="obz-cell obz-empty">—</td>;
  const sign = kind === "expense" ? -1 : 1;
  const display = cell.value === 0 && kind === "expense" ? 0 : sign * cell.value;
  const secondaryDisplay =
    cell.secondary !== undefined
      ? cell.secondary.value === 0 && kind === "expense"
        ? 0
        : sign * cell.secondary.value
      : null;
  return (
    <td className="obz-cell">
      <div className="obz-cell-row">
        <div className="obz-cell-amount">
          <div className="obz-amount">{fmtRub(display)}</div>
          {cell.share !== undefined && (
            <div className="obz-share">{fmtPct(cell.share)}</div>
          )}
          {cell.secondary !== undefined && secondaryDisplay !== null && (
            <div className="obz-secondary" title={cell.secondary.title}>
              <div>{fmtRub(secondaryDisplay)}</div>
              {cell.secondary.share !== undefined && (
                <div className="obz-secondary-share">
                  {fmtPct(cell.secondary.share)}
                </div>
              )}
            </div>
          )}
        </div>
        <Bar share={cell.share ?? 0} kind={kind} />
      </div>
    </td>
  );
};

export default function OzonBreakdown({ result }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [tweaks] = useTweaks();
  const showSecondary = tweaks.breakdownMode === "both";
  const price = result.promoPrice;

  const cellsForAll = (
    pickAmount: (s: SchemaResult) => number,
  ): Row["cells"] => ({
    fbo: cellOf(price,pickAmount(result.fbo)),
    fbs: cellOf(price,pickAmount(result.fbs)),
    realFbs: cellOf(price,pickAmount(result.realFbs)),
  });

  const priceRow: Row = {
    label: "Цена товара",
    cells: {
      fbo: { value: price, share: 1 },
      fbs: { value: price, share: 1 },
      realFbs: { value: price, share: 1 },
    },
    kind: "neutral",
    emphasis: true,
  };

  const commissionRow: Row = {
    label: "Вознаграждение Ozon",
    cells: cellsForAll((s) => s.commissionRub),
    kind: "expense",
  };

  const acquiringRow: Row = {
    label: "Эквайринг",
    cells: cellsForAll((s) => s.acquiringRub),
    kind: "expense",
  };

  // "Обработка и доставка" group — first-mile + logistics + last-mile + returns.
  const processSum = (s: SchemaResult) =>
    s.acceptanceRub + s.logisticsRub + s.lastMileRub + s.ozonReturnServicesRub;

  const processGroup: Row = {
    label: "Обработка и доставка",
    cells: cellsForAll(processSum),
    kind: "expense",
    emphasis: true,
  };

  // Children (only shown when expanded). Row hides empty values for schemas
  // that don't have that line (FBO has no first-mile; realFBS has no
  // separate Ozon line).
  const childMaybeZero = (
    pickAmount: (s: SchemaResult) => number,
  ): Row["cells"] => ({
    fbo: result.fbo === undefined
      ? dashCell
      : pickAmount(result.fbo) === 0
        ? dashCell
        : cellOf(price,pickAmount(result.fbo)),
    fbs: pickAmount(result.fbs) === 0
      ? dashCell
      : cellOf(price,pickAmount(result.fbs)),
    realFbs: pickAmount(result.realFbs) === 0
      ? dashCell
      : cellOf(price,pickAmount(result.realFbs)),
  });

  const childRows: Row[] = [
    {
      label: "Обработка отправления",
      cells: childMaybeZero((s) => s.acceptanceRub),
      kind: "expense",
      indent: true,
    },
    {
      label: "Логистика",
      cells: childMaybeZero((s) => s.logisticsRub),
      kind: "expense",
      indent: true,
    },
    {
      label: "Доставка до места выдачи",
      cells: childMaybeZero((s) => s.lastMileRub),
      kind: "expense",
      indent: true,
    },
    {
      label: "Возврат",
      cells: childMaybeZero((s) => s.ozonReturnServicesRub),
      kind: "expense",
      indent: true,
    },
  ];

  // Storage shown as a separate top-level row when present (FBO only).
  const storageRow: Row | null =
    result.fbo.storageRub > 0
      ? {
          label: "Хранение",
          cells: {
            fbo: cellOf(price,result.fbo.storageRub),
            fbs: dashCell,
            realFbs: dashCell,
          },
          kind: "expense",
        }
      : null;

  const totalCostsOf = (s: SchemaResult) => price - s.ozonNetPayout;

  const FULL_TITLE = "С учётом себестоимости, маркетинга, доп. расходов и налога";

  const withSecondary = (
    base: Row["cells"],
    pickSecondary: (s: SchemaResult) => number,
  ): Row["cells"] => ({
    fbo: {
      ...base.fbo,
      secondary: {
        value: pickSecondary(result.fbo),
        share: price > 0 ? pickSecondary(result.fbo) / price : 0,
        title: FULL_TITLE,
      },
    },
    fbs: {
      ...base.fbs,
      secondary: {
        value: pickSecondary(result.fbs),
        share: price > 0 ? pickSecondary(result.fbs) / price : 0,
        title: FULL_TITLE,
      },
    },
    realFbs: {
      ...base.realFbs,
      secondary: {
        value: pickSecondary(result.realFbs),
        share: price > 0 ? pickSecondary(result.realFbs) / price : 0,
        title: FULL_TITLE,
      },
    },
  });

  const totalRow: Row = {
    label: "Затраты на Ozon за шт",
    cells: showSecondary
      ? withSecondary(cellsForAll(totalCostsOf), (s) => s.totalExpenses)
      : cellsForAll(totalCostsOf),
    kind: "expense",
    emphasis: true,
  };

  const payoutRow: Row = {
    label: "К начислению за товар",
    cells: showSecondary
      ? withSecondary(
          cellsForAll((s) => s.ozonNetPayout),
          (s) => s.marginRub,
        )
      : cellsForAll((s) => s.ozonNetPayout),
    kind: "payout",
    emphasis: true,
  };

  const renderRow = (row: Row, idx: number) => (
    <tr
      key={`${row.label}-${idx}`}
      className={[
        "obz-row",
        row.indent ? "obz-row-indent" : "",
        row.emphasis ? "obz-row-strong" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <td className="obz-label">
        {row.label === "Обработка и доставка" && (
          <button
            type="button"
            className="obz-toggle"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Свернуть" : "Развернуть"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        {row.label}
      </td>
      {SCHEMAS.map((s) => (
        <Cell key={s.key} cell={row.cells[s.key]} kind={row.kind} />
      ))}
    </tr>
  );

  return (
    <section className="card obz">
      <div className="obz-head">
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Расчёт прибыли и затрат
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          Как в Ozon-калькуляторе
        </span>
      </div>
      <div className="obz-table-wrap">
        <table className="obz-table">
          <thead>
            <tr>
              <th />
              {SCHEMAS.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[priceRow, commissionRow, acquiringRow, processGroup].map(
              renderRow,
            )}
            {expanded && childRows.map(renderRow)}
            {storageRow && renderRow(storageRow, -1)}
            {[totalRow, payoutRow].map(renderRow)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
