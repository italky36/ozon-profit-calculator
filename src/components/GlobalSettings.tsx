import type { TaxSettings, TaxSystem } from "../types";
import lists from "../data/lists.json";
import Collapsible from "./Collapsible";
import PercentInput from "./PercentInput";

interface Props {
  value: TaxSettings;
  onChange: (next: TaxSettings) => void;
}

const num = (v: string) => (v === "" ? 0 : Number(v));

export default function GlobalSettings({ value, onChange }: Props) {
  const set = <K extends keyof TaxSettings>(key: K, v: TaxSettings[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <Collapsible title="Глобальные настройки" defaultOpen={false} badge={value.taxSystem}>
      <div className="grid">
        <label className="span2">
          <span>Налоговая система</span>
          <select
            value={value.taxSystem}
            onChange={(e) => set("taxSystem", e.target.value as TaxSystem)}
          >
            {(lists.taxSystems as string[]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>

        <label><span>УСН Доходы, ставка</span>
          <PercentInput value={value.usnIncomeRate} onChange={(v) => set("usnIncomeRate", v)} step={0.1} />
        </label>
        <label><span>УСН Д−Р, ставка</span>
          <PercentInput value={value.usnIncomeMinusRate} onChange={(v) => set("usnIncomeMinusRate", v)} step={0.1} />
        </label>
        <label><span>АУСН Доходы, ставка</span>
          <PercentInput value={value.ausnIncomeRate} onChange={(v) => set("ausnIncomeRate", v)} step={0.1} />
        </label>
        <label><span>АУСН Д−Р, ставка</span>
          <PercentInput value={value.ausnIncomeMinusRate} onChange={(v) => set("ausnIncomeMinusRate", v)} step={0.1} />
        </label>
        <label><span>ОСНО ООО, ставка</span>
          <PercentInput value={value.osnoOooRate} onChange={(v) => set("osnoOooRate", v)} step={0.1} />
        </label>
        <label><span>ОСНО ИП — годовой доход, ₽</span>
          <input type="number" step="100000" value={value.osnoIpAnnualIncome}
            onChange={(e) => set("osnoIpAnnualIncome", num(e.target.value))} />
        </label>
        <label><span>НПД, ставка</span>
          <PercentInput value={value.npdRate} onChange={(v) => set("npdRate", v)} step={0.1} />
        </label>
        <label><span>Доп. расходы партии, ₽</span>
          <input type="number" step="10" value={value.partyExtraExpenses}
            onChange={(e) => set("partyExtraExpenses", num(e.target.value))} />
        </label>
        <label><span>Порча, %</span>
          <PercentInput value={value.damageRate} onChange={(v) => set("damageRate", v)} step={0.1} />
        </label>
      </div>
    </Collapsible>
  );
}
