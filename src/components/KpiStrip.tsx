import { useMemo, useState, type ReactNode } from "react";
import { Package, Truck, Factory, Trophy, TrendingUp } from "lucide-react";
import type { ProductRow, CalcResult } from "../types";
import type { RowResult } from "./ProductsTable";
import type { ChannelKey } from "./ChannelBadge";
import ChannelBadge from "./ChannelBadge";
import type { FilterValue } from "./ChannelFilter";
import { fmtRub } from "../format";

interface Props {
  rows: ProductRow[];
  results: Map<string, RowResult>;
  channelFilter: FilterValue;
  unitMode?: boolean;
}

const isCalc = (r: RowResult | undefined): r is CalcResult => !!r && !("error" in r);

const bestKey = (r: CalcResult): ChannelKey => {
  const m: Record<ChannelKey, number> = {
    FBO: r.fbo.marginRub,
    FBS: r.fbs.marginRub,
    realFBS: r.realFbs.marginRub,
  };
  return (Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]) as ChannelKey;
};

export default function KpiStrip({ rows, results, channelFilter, unitMode }: Props) {
  const [open, setOpen] = useState(true);

  const totals = useMemo(() => {
    let totFbo = 0,
      totFbs = 0,
      totReal = 0,
      totQty = 0,
      revenue = 0,
      costSum = 0;
    let visible = 0;
    for (const row of rows) {
      const r = results.get(row.id);
      if (!isCalc(r)) continue;
      const winner = bestKey(r);
      if (channelFilter !== "Все" && winner !== channelFilter) continue;
      visible++;
      const qty = row.input.salesPlan;
      totQty += qty;
      totFbo += r.fbo.marginRub * qty;
      totFbs += r.fbs.marginRub * qty;
      totReal += r.realFbs.marginRub * qty;
      revenue += r.promoPrice * qty;
      costSum += row.input.costPrice * qty;
    }
    const marginPctFbo = revenue > 0 ? totFbo / revenue : 0;
    const roiFbo = costSum > 0 ? totFbo / costSum : 0;
    const channels: Record<ChannelKey, number> = { FBO: totFbo, FBS: totFbs, realFBS: totReal };
    const bestCh = (Object.entries(channels).sort((a, b) => b[1] - a[1])[0]?.[0] as ChannelKey) ?? "FBO";
    return { totFbo, totFbs, totReal, totQty, marginPctFbo, roiFbo, bestCh, visible };
  }, [rows, results, channelFilter]);

  if (unitMode) return null;

  return (
    <section className="kpi-strip">
      <div className="kpi-strip-header">
        <span className="section-title">Сводка по плану</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "1.5px solid var(--border)",
            borderRadius: 20,
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            color: open ? "var(--accent)" : "var(--muted)",
          }}
        >
          {open ? "Скрыть сводку" : "Показать сводку"}
        </button>
      </div>
      {open && (
        <div className="kpi-cards">
          <KpiCard
            label="Маржа FBO (сумма)"
            value={fmtRub(totals.totFbo)}
            sub={`${(totals.marginPctFbo * 100).toFixed(1)}% от выручки · ${totals.totQty} шт`}
            accent="var(--ch-fbo-text)"
            icon={<Package size={14} />}
          />
          <KpiCard
            label="Маржа FBS (сумма)"
            value={fmtRub(totals.totFbs)}
            sub={`${totals.visible} товаров`}
            accent="var(--ch-fbs-text)"
            icon={<Truck size={14} />}
          />
          <KpiCard
            label="Маржа realFBS (сумма)"
            value={fmtRub(totals.totReal)}
            sub="Со своего склада"
            accent="var(--ch-real-text)"
            icon={<Factory size={14} />}
          />
          <KpiCard
            label="Лучший канал"
            value={<ChannelBadge channel={totals.totQty > 0 ? totals.bestCh : null} />}
            sub="По суммарной марже"
            accent="var(--info)"
            icon={<Trophy size={14} />}
          />
          <KpiCard
            label="Рентабельность FBO"
            value={`${(totals.roiFbo * 100).toFixed(1)}%`}
            sub="к себестоимости"
            accent="var(--warn)"
            icon={<TrendingUp size={14} />}
          />
        </div>
      )}
    </section>
  );
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent: string;
  icon?: ReactNode;
}

export function KpiCard({ label, value, sub, accent, icon }: KpiCardProps) {
  return (
    <div className="kpi-card" style={{ borderTopColor: accent }}>
      <div className="kpi-label">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
