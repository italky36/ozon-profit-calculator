import { useState } from "react";
import type { CalcResult, SchemaResult } from "../types";
import { fmtRub, fmtPct } from "../format";

interface Props {
  result: CalcResult;
}

const SCHEMAS: Array<{ key: "fbo" | "fbs" | "realFbs"; label: string }> = [
  { key: "fbo", label: "FBO" },
  { key: "fbs", label: "FBS" },
  { key: "realFbs", label: "realFBS" },
];

const bestKey = (r: CalcResult): "fbo" | "fbs" | "realFbs" => {
  const m = { fbo: r.fbo.marginRub, fbs: r.fbs.marginRub, realFbs: r.realFbs.marginRub };
  return (Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]) as "fbo" | "fbs" | "realFbs";
};

const detailRows: Array<[string, (s: SchemaResult) => number]> = [
  ["Комиссия Ozon", (s) => s.commissionRub],
  ["Эквайринг", (s) => s.acquiringRub],
  ["Маркетинг", (s) => s.marketingRub],
  ["Логистика", (s) => s.logisticsRub],
  ["Последняя миля", (s) => s.lastMileRub],
  ["Хранение FBO", (s) => s.storageRub],
  ["Приёмка", (s) => s.acceptanceRub],
  ["Порча (учитывается в realFBS)", (s) => s.damageRub],
  ["НДС к уплате", (s) => s.vatPayable],
  ["Налог", (s) => s.totalTax],
  ["Итого расходов", (s) => s.totalExpenses],
];

export default function ResultsPanel({ result }: Props) {
  const [open, setOpen] = useState(true);
  const winner = bestKey(result);

  return (
    <section className="panel">
      <h3>Сравнение схем</h3>
      <p className="muted">Цена со скидкой: <b>{fmtRub(result.promoPrice)}</b></p>

      <table className="results">
        <thead>
          <tr>
            <th>Показатель</th>
            {SCHEMAS.map((s) => (
              <th key={s.key} className={winner === s.key ? "winner" : ""}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Маржа, ₽</td>
            {SCHEMAS.map((s) => (
              <td key={s.key} className={winner === s.key ? "winner" : ""}>
                {fmtRub(result[s.key].marginRub)}
              </td>
            ))}
          </tr>
          <tr>
            <td>Маржа, %</td>
            {SCHEMAS.map((s) => (
              <td key={s.key}>{fmtPct(result[s.key].marginPercent)}</td>
            ))}
          </tr>
          <tr>
            <td>Рентабельность к с/с</td>
            {SCHEMAS.map((s) => (
              <td key={s.key}>{fmtPct(result[s.key].profitability)}</td>
            ))}
          </tr>
          <tr>
            <td>Прибыль по плану, ₽</td>
            {SCHEMAS.map((s) => (
              <td key={s.key}>{fmtRub(result[s.key].totalProfit)}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <button className="toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Детализация расходов
      </button>
      {open && (
        <table className="results details">
          <thead>
            <tr>
              <th>Статья</th>
              {SCHEMAS.map((s) => <th key={s.key}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {detailRows.map(([label, getter]) => (
              <tr key={label}>
                <td>{label}</td>
                {SCHEMAS.map((s) => (
                  <td key={s.key}>{fmtRub(getter(result[s.key]))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
