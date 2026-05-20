import { useState } from "react";
import type {
  CalcResult,
  ProductInput,
  References,
  SchemaResult,
  TaxSettings,
} from "../types";
import type { RealizedMarginRow } from "../api";
import { fmtRub, fmtPct } from "../format";
import { findClusterTariff } from "../lib/calc/logistics";

interface Props {
  result: CalcResult;
  input?: ProductInput;
  taxSettings?: TaxSettings;
  refs?: References | null;
  actual?: RealizedMarginRow | null;
}

const SCHEMAS: Array<{
  key: "fbo" | "fbs" | "realFbs";
  label: string;
  cls: string;
}> = [
  { key: "fbo", label: "FBO", cls: "fbo" },
  { key: "fbs", label: "FBS", cls: "fbs" },
  { key: "realFbs", label: "realFBS", cls: "real" },
];

const bestKey = (r: CalcResult): "fbo" | "fbs" | "realFbs" => {
  const m = {
    fbo: r.fbo.marginRub,
    fbs: r.fbs.marginRub,
    realFbs: r.realFbs.marginRub,
  };
  return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0] as
    | "fbo"
    | "fbs"
    | "realFbs";
};

const detailRows: Array<[string, (s: SchemaResult) => number]> = [
  ["Комиссия Ozon", (s) => s.commissionRub],
  ["Эквайринг", (s) => s.acquiringRub],
  ["Маркетинг", (s) => s.marketingRub],
  ["Логистика", (s) => s.logisticsRub],
  ["Последняя миля", (s) => s.lastMileRub],
  ["Возврат (Ozon)", (s) => s.ozonReturnServicesRub],
  ["Хранение FBO", (s) => s.storageRub],
  ["Приёмка / first-mile", (s) => s.acceptanceRub],
  ["Порча (учитывается в realFBS)", (s) => s.damageRub],
  ["НДС к уплате", (s) => s.vatPayable],
  ["Налог", (s) => s.totalTax],
  ["Итого расходов", (s) => s.totalExpenses],
];

const fmtNum = (n: number, digits = 2): string =>
  Number.isFinite(n)
    ? n.toLocaleString("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

export default function ResultsPanel({ result, input, taxSettings, refs, actual }: Props) {
  const [openDetails, setOpenDetails] = useState(true);
  const [openTaxDebug, setOpenTaxDebug] = useState(false);
  const winner = bestKey(result);
  const price = result.promoPrice;

  const headerRow = (
    <thead>
      <tr>
        <th />
        {SCHEMAS.map((s) => (
          <th key={s.key} className={`rp-th ${s.cls}`}>
            {s.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <section className="card rp">
      <div className="rp-head">
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Сравнение схем
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          Лучшая по марже:{" "}
          <b style={{ color: "var(--accent)" }}>
            {SCHEMAS.find((s) => s.key === winner)?.label}
          </b>
        </span>
      </div>

      <div className="rp-table-wrap">
        <table className="rp-table">
          {headerRow}
          <tbody>
            <tr className="rp-row-strong">
              <td className="rp-label">К начислению (Ozon), ₽</td>
              {SCHEMAS.map((s) => (
                <td key={s.key} className="rp-cell">
                  {fmtRub(result[s.key].ozonNetPayout)}
                </td>
              ))}
            </tr>
            <tr className="rp-row-strong">
              <td className="rp-label">Маржа, ₽</td>
              {SCHEMAS.map((s) => (
                <td
                  key={s.key}
                  className={`rp-cell ${winner === s.key ? "rp-winner" : ""}`}
                >
                  {fmtRub(result[s.key].marginRub)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="rp-label">Маржа, %</td>
              {SCHEMAS.map((s) => (
                <td key={s.key} className="rp-cell">
                  {fmtPct(result[s.key].marginPercent)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="rp-label">Рентабельность к с/с</td>
              {SCHEMAS.map((s) => (
                <td key={s.key} className="rp-cell">
                  {fmtPct(result[s.key].profitability)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <button
        className="rp-toggle"
        onClick={() => setOpenDetails((o) => !o)}
        type="button"
      >
        {openDetails ? "▾" : "▸"} Детализация расходов
      </button>
      {openDetails && (
        <div className="rp-table-wrap">
          <table className="rp-table">
            {headerRow}
            <tbody>
              {detailRows.map(([label, getter]) => (
                <tr key={label}>
                  <td className="rp-label">{label}</td>
                  {SCHEMAS.map((s) => {
                    const v = getter(result[s.key]);
                    const share = price > 0 ? v / price : 0;
                    return (
                      <td key={s.key} className="rp-cell">
                        <div className="rp-cell-num">{fmtRub(v)}</div>
                        {v !== 0 && (
                          <div className="rp-cell-share">{fmtPct(share)}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {input && taxSettings && (
        <>
          <button
            className="rp-toggle rp-toggle-debug"
            onClick={() => setOpenTaxDebug((o) => !o)}
            type="button"
            title="Покажет пошаговый расчёт налога. В проде уберём."
          >
            {openTaxDebug ? "▾" : "▸"} Пошаговый расчёт налога (debug)
          </button>
          {openTaxDebug && (
            <TaxDebug
              result={result}
              input={input}
              taxSettings={taxSettings}
              refs={refs ?? null}
              actual={actual ?? null}
            />
          )}
        </>
      )}
    </section>
  );
}

// ── Tax debug component ───────────────────────────────────────────────────

function TaxDebug({
  result,
  input,
  taxSettings,
  refs,
  actual,
}: {
  result: CalcResult;
  input: ProductInput;
  taxSettings: TaxSettings;
  refs: References | null;
  actual: RealizedMarginRow | null;
}) {
  const [techMode, setTechMode] = useState(false);
  const clusterTariff = findClusterTariff(
    refs?.logisticsClusterTariffs,
    input.volumeL,
    input.dispatchCluster,
    input.destinationCluster,
    result.promoPrice,
  );

  const isUsn =
    taxSettings.taxSystem === "УСН Доходы" ||
    taxSettings.taxSystem === "УСН Доходы минус расходы";
  const effectiveVatRate = isUsn
    ? (taxSettings.usnVatRate ?? "Не облагается")
    : input.vatRate;

  const price = result.promoPrice;
  const costShare = price > 0 ? input.costPrice / price : 0;
  const extraShare =
    price > 0 ? input.extraExpensesPerUnit / price : 0;

  // Тот же расчёт, что в calc/index.ts: явное значение в товаре → берём его;
  // null → берём глобальный дефолт; иначе false.
  const effectiveWhitePurchase =
    input.whitePurchase ?? taxSettings.defaultWhitePurchase ?? false;
  const wpSource: "explicit" | "default" =
    input.whitePurchase === null || input.whitePurchase === undefined
      ? "default"
      : "explicit";

  const renderSchema = (
    schemaKey: "fbo" | "fbs" | "realFbs",
    schemaLabel: string,
  ) => {
    const s = result[schemaKey];
    const ozonShare =
      price > 0
        ? (s.commissionRub +
            s.acquiringRub +
            s.marketingRub +
            s.logisticsRub +
            s.lastMileRub +
            s.storageRub +
            s.acceptanceRub +
            s.ozonReturnServicesRub) /
          price
        : 0;

    const inclCost = effectiveWhitePurchase ? costShare : 0;
    const baseUsn = price - price * (ozonShare + inclCost + extraShare);
    const usnRate = taxSettings.usnIncomeMinusRate;
    const usnTax = Math.max(0, baseUsn * usnRate);

    // НДС
    const vr = effectiveVatRate;
    const vatRateNum = vr === "Не облагается" ? 0 : vr;
    const vatOut = vatRateNum > 0 ? (price * vatRateNum) / (1 + vatRateNum) : 0;

    return (
      <div key={schemaKey} className="rp-debug-block">
        <div className="rp-debug-title">{schemaLabel}</div>
        <div className="rp-debug-grid">
          <Step
            human="Цена со скидкой"
            tech="promoPrice"
            mode={techMode}
            formula={fmtRub(price)}
          />
          <Step
            human="Доля себестоимости от цены"
            tech="costShare = costPrice / promoPrice"
            mode={techMode}
            formula={`${fmtRub(input.costPrice)} / ${fmtRub(price)} = ${fmtNum(costShare * 100, 2)}%`}
          />
          <Step
            human="Доля доп. расходов от цены"
            tech="extraShare = extraExpensesPerUnit / promoPrice"
            mode={techMode}
            formula={`${fmtRub(input.extraExpensesPerUnit)} / ${fmtRub(price)} = ${fmtNum(extraShare * 100, 2)}%`}
          />
          <Step
            human="Доля Ozon-удержаний от цены"
            tech="ozonShare = Σ(комиссия + эквайринг + маркетинг + логистика + last-mile + хранение + приёмка + возврат) / promoPrice"
            mode={techMode}
            formula={`(${fmtRub(s.commissionRub)} + ${fmtRub(s.acquiringRub)} + ${fmtRub(s.marketingRub)} + ${fmtRub(s.logisticsRub)} + ${fmtRub(s.lastMileRub)} + ${fmtRub(s.storageRub)} + ${fmtRub(s.acceptanceRub)} + ${fmtRub(s.ozonReturnServicesRub)}) / ${fmtRub(price)} = ${fmtNum(ozonShare * 100, 2)}%`}
          />
          <Step
            human={`Учёт себестоимости в УСН-расходах (${effectiveWhitePurchase ? "✓ Белая закупка" : "✗ Без белой закупки"}${wpSource === "default" ? " — из глобальных настроек" : ""})`}
            tech={`inclCost = effectiveWhitePurchase ? costShare : 0`}
            mode={techMode}
            formula={
              effectiveWhitePurchase
                ? `costShare = ${fmtNum(costShare * 100, 2)}% — себестоимость вычитается из УСН-базы`
                : `0% (без галки «Белая закупка» себестоимость в УСН-расходы не попадает)`
            }
          />
          {taxSettings.taxSystem === "УСН Доходы минус расходы" && (
            <>
              <Step
                human="Налогооблагаемая база УСН"
                tech="base = promoPrice − promoPrice × (ozonShare + inclCost + extraShare)"
                mode={techMode}
                formula={`${fmtRub(price)} − ${fmtRub(price)} × ${fmtNum((ozonShare + inclCost + extraShare) * 100, 2)}% = ${fmtRub(baseUsn)}`}
              />
              <Step
                human={`УСН-налог (без НДС, ставка ${fmtPct(usnRate)})`}
                tech={`базовыйУСН = max(0, base × ${fmtPct(usnRate)})`}
                mode={techMode}
                formula={`max(0, ${fmtRub(baseUsn)} × ${fmtPct(usnRate)}) = ${fmtRub(usnTax)}`}
              />
            </>
          )}
          {taxSettings.taxSystem === "УСН Доходы" && (
            <Step
              human={`УСН Доходы (ставка ${fmtPct(taxSettings.usnIncomeRate)})`}
              tech={`УСН Доходы = promoPrice × ${fmtPct(taxSettings.usnIncomeRate)}`}
              mode={techMode}
              formula={`${fmtRub(price)} × ${fmtPct(taxSettings.usnIncomeRate)} = ${fmtRub(price * taxSettings.usnIncomeRate)}`}
            />
          )}
          <Step
            human={`Применяемая ставка НДС ${isUsn ? "(глобальная для УСН)" : "(per-product, ОСНО)"}`}
            tech={`effectiveVatRate (${isUsn ? "УСН — taxSettings.usnVatRate" : "ОСНО — input.vatRate"})`}
            mode={techMode}
            formula={vr === "Не облагается" ? "Не облагается (0%)" : fmtPct(vr)}
          />
          <Step
            human="НДС к начислению (исходящий)"
            tech="НДСисх = promoPrice × ставка / (1 + ставка)"
            mode={techMode}
            formula={
              vatRateNum === 0
                ? "0 ₽ (не облагается)"
                : `${fmtRub(price)} × ${fmtPct(vatRateNum)} / (1 + ${fmtPct(vatRateNum)}) = ${fmtRub(vatOut)}`
            }
          />
          <Step
            human="НДС к уплате (после вычета входящего, если применим)"
            tech="vatPayable = НДСисх − НДСвх (зачёт только при ставках 10%/22%)"
            mode={techMode}
            formula={fmtRub(s.vatPayable)}
          />
          <Step
            human="Итоговый налог"
            tech="totalTax = базовыйУСН + vatPayable"
            mode={techMode}
            formula={`${isUsn && taxSettings.taxSystem === "УСН Доходы минус расходы" ? `${fmtRub(usnTax)} + ${fmtRub(s.vatPayable)} = ` : ""}${fmtRub(s.totalTax)}`}
            emphasis
          />
          <Step
            human="Маржа (твоя прибыль с одной штуки)"
            tech="marginRub = promoPrice − totalExpenses"
            mode={techMode}
            formula={`${fmtRub(price)} − ${fmtRub(s.totalExpenses)} = ${fmtRub(s.marginRub)}`}
            emphasis
          />
        </div>
      </div>
    );
  };

  return (
    <div className="rp-debug">
      <div className="rp-debug-meta">
        <span>
          Налоговая система: <b>{taxSettings.taxSystem}</b>
        </span>
        <span>
          Ставка УСН Д−Р: <b>{fmtPct(taxSettings.usnIncomeMinusRate)}</b>
        </span>
        <span>
          НДС на УСН:{" "}
          <b>
            {effectiveVatRate === "Не облагается"
              ? "Не облагается"
              : fmtPct(effectiveVatRate as number)}
          </b>
        </span>
        <span>
          Белая закупка:{" "}
          <b>{effectiveWhitePurchase ? "✓" : "✗"}</b>
          {wpSource === "default" && (
            <span style={{ fontWeight: 400, marginLeft: 4 }}>
              (по умолчанию)
            </span>
          )}
        </span>
        <span>
          Логистика по кластерам:{" "}
          {taxSettings.useClusterLogistics ? (
            <>
              <b>{clusterTariff != null ? fmtRub(clusterTariff) : "не нашлась"}</b>
              <span style={{ fontWeight: 400, marginLeft: 4 }}>
                ({input.dispatchCluster} → {input.destinationCluster}, объём{" "}
                {input.volumeL} л,{" "}
                {refs?.logisticsClusterTariffs?.length ?? 0} строк в матрице)
              </span>
            </>
          ) : (
            <b>выкл</b>
          )}
        </span>
        <label className="rp-debug-toggle" title="Показать имена переменных и формулы из кода (для разработчика)">
          <input
            type="checkbox"
            checked={techMode}
            onChange={(e) => setTechMode(e.target.checked)}
          />
          <span>Технические имена</span>
        </label>
      </div>
      {SCHEMAS.map((s) => renderSchema(s.key, s.label))}
      {actual && actual.salesCount > 0 && (() => {
        const winner = bestKey(result);
        const salesCount = actual.salesCount;
        const factOzonNet = actual.actualRevenue / salesCount;
        const taxPerSale = result[winner].totalTax;
        const factMargin = factOzonNet - input.costPrice - taxPerSale;
        const profitability =
          input.costPrice > 0 ? factMargin / input.costPrice : null;
        return (
          <div className="rp-debug-block">
            <div className="rp-debug-title">
              Расчёт по факту (по {winner}-налогу)
            </div>
            <div className="rp-debug-grid">
              <Step
                human="Поступление от Ozon (всего за период)"
                tech="actual.actualRevenue"
                mode={techMode}
                formula={fmtRub(actual.actualRevenue)}
              />
              <Step
                human="Продаж за период"
                tech="actual.salesCount"
                mode={techMode}
                formula={String(salesCount)}
              />
              <Step
                human="Поступление за единицу"
                tech="factOzonNet = actualRevenue / salesCount"
                mode={techMode}
                formula={`${fmtRub(actual.actualRevenue)} / ${salesCount} = ${fmtRub(factOzonNet)}`}
              />
              <Step
                human="− Себестоимость"
                tech="− costPrice"
                mode={techMode}
                formula={fmtRub(input.costPrice)}
              />
              <Step
                human={`− Налог (из ${winner}-расчёта)`}
                tech={`− result.${winner}.totalTax`}
                mode={techMode}
                formula={fmtRub(taxPerSale)}
              />
              <Step
                human="Маржа за единицу"
                tech="factMargin = factOzonNet − costPrice − totalTax"
                mode={techMode}
                formula={`${fmtRub(factOzonNet)} − ${fmtRub(input.costPrice)} − ${fmtRub(taxPerSale)} = ${fmtRub(factMargin)}`}
                emphasis
              />
              {profitability != null && (
                <Step
                  human="Рентабельность к себестоимости"
                  tech="profitability = factMargin / costPrice"
                  mode={techMode}
                  formula={`${fmtRub(factMargin)} / ${fmtRub(input.costPrice)} = ${fmtPct(profitability)}`}
                  emphasis
                />
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Step({
  human,
  tech,
  mode,
  formula,
  emphasis,
}: {
  human: string;
  tech: string;
  mode: boolean;
  formula: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rp-debug-step ${emphasis ? "rp-debug-step-strong" : ""}`}>
      <div className="rp-debug-step-label">{mode ? tech : human}</div>
      <div className="rp-debug-step-formula">{formula}</div>
    </div>
  );
}
