import type {
  ProductInput,
  VatRate,
  IncomingVatRate,
  AcceptanceTariff,
  LogisticsMode,
  ClustersCount,
} from "../types";
import categories from "../data/categories.json";
import lists from "../data/lists.json";
import PercentInput from "./PercentInput";

export type LockedField = "articleId" | "productName" | "category";

const formatVatLabel = (v: string | number): string => {
  if (v === "Не облагается") return "Не облагается";
  const n = typeof v === "number" ? v : Number(v);
  return `${(n * 100).toFixed(0)}%`;
};

interface Props {
  value: ProductInput;
  onChange: (next: ProductInput) => void;
  lockedFields?: LockedField[];
}

const cats = categories as Record<string, string[]>;
const num = (v: string) => (v === "" ? 0 : Number(v));
const LOCK_TOOLTIP = "Данные из Ozon — только чтение";

export default function ProductForm({ value, onChange, lockedFields = [] }: Props) {
  const locked = (k: LockedField): boolean => lockedFields.includes(k);
  const set = <K extends keyof ProductInput>(key: K, v: ProductInput[K]) =>
    onChange({ ...value, [key]: v });

  const productTypes = cats[value.category] ?? [];

  return (
    <section className="card">
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Параметры товара</h3>

      <fieldset>
        <legend>Товар</legend>
        <div className="grid">
          <label><span>Артикул</span>
            <input
              value={value.articleId}
              readOnly={locked("articleId")}
              title={locked("articleId") ? LOCK_TOOLTIP : undefined}
              onChange={(e) => set("articleId", e.target.value)}
            />
          </label>
          <label className="span2"><span>Название</span>
            <input
              value={value.productName}
              readOnly={locked("productName")}
              title={locked("productName") ? LOCK_TOOLTIP : undefined}
              onChange={(e) => set("productName", e.target.value)}
            />
          </label>
          <label><span>Категория</span>
            <select
              value={value.category}
              disabled={locked("category")}
              title={locked("category") ? LOCK_TOOLTIP : undefined}
              onChange={(e) => {
                const cat = e.target.value;
                const next = cats[cat] ?? [];
                onChange({ ...value, category: cat, productType: next[0] ?? "" });
              }}>
              {Object.keys(cats).sort().map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label><span>Тип товара</span>
            <select
              value={value.productType}
              disabled={locked("category")}
              title={locked("category") ? LOCK_TOOLTIP : undefined}
              onChange={(e) => set("productType", e.target.value)}>
              {productTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label><span>Объём, л</span>
            <input type="number" step="0.1" value={value.volumeL}
              onChange={(e) => set("volumeL", num(e.target.value))} />
          </label>
          <label className="checkbox"><input type="checkbox" checked={value.isKgt}
            onChange={(e) => set("isKgt", e.target.checked)} /> КГТ</label>
          <label className="checkbox"><input type="checkbox" checked={value.isKazakhstan}
            onChange={(e) => set("isKazakhstan", e.target.checked)} /> Казахстан</label>
          <label className="checkbox"><input type="checkbox" checked={value.isFireHazard}
            onChange={(e) => set("isFireHazard", e.target.checked)} /> Пожароопасный</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Цена и продажи</legend>
        <div className="grid">
          <label><span>Текущая цена, ₽</span>
            <input type="number" step="1" value={value.currentPrice}
              onChange={(e) => set("currentPrice", num(e.target.value))} />
          </label>
          <label><span>Скидка, %</span>
            <PercentInput value={value.discountPercent} onChange={(v) => set("discountPercent", v)} min={0} max={100} step={0.5} />
          </label>
          <label><span>Выкуп, %</span>
            <input type="number" step="1" min="0" max="100" value={value.redemptionPercent}
              onChange={(e) => set("redemptionPercent", num(e.target.value))} />
          </label>
          <label><span>План продаж, шт</span>
            <input type="number" step="1" min="1" value={value.salesPlan}
              onChange={(e) => set("salesPlan", num(e.target.value))} />
          </label>
          <label><span>Ставка НДС</span>
            <select value={String(value.vatRate)} onChange={(e) => {
              const v = e.target.value;
              set("vatRate", v === "Не облагается" ? "Не облагается" : Number(v) as VatRate);
            }}>
              {(lists.vatRates as (string | number)[]).map((v) => (
                <option key={String(v)} value={String(v)}>{formatVatLabel(v)}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Логистика</legend>
        <div className="grid">
          <label><span>Режим</span>
            <select value={value.logisticsMode}
              onChange={(e) => set("logisticsMode", e.target.value as LogisticsMode)}>
              {(lists.logisticsModes as string[]).map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          {value.logisticsMode === "По доле локальных" ? (
            <label><span>Локальные, %</span>
              <PercentInput value={value.localShare} onChange={(v) => set("localShare", v)} min={0} max={100} step={5} />
            </label>
          ) : (
            <label><span>Кластеры (1–26 или «Считать без наценки»)</span>
              <select
                value={typeof value.clustersCount === "number" ? String(value.clustersCount) : value.clustersCount}
                onChange={(e) => {
                  const v = e.target.value;
                  const next: ClustersCount = v === "Считать без наценки" ? "Считать без наценки" : Number(v);
                  set("clustersCount", next);
                }}>
                <option value="Считать без наценки">Считать без наценки</option>
                {Array.from({ length: 26 }, (_, i) => i + 1).map((n) =>
                  <option key={n} value={String(n)}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Хранение</legend>
        <div className="grid">
          <label><span>План хранения, дней</span>
            <input type="number" step="1" min="0" value={value.plannedStorageDays}
              onChange={(e) => set("plannedStorageDays", num(e.target.value))} />
          </label>
          <label><span>Тариф приёмки</span>
            <select value={value.acceptanceTariff}
              onChange={(e) => set("acceptanceTariff", e.target.value as AcceptanceTariff)}>
              {(lists.acceptanceTariffs as string[]).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>realFBS</legend>
        <div className="grid">
          <label><span>Прямая доставка, ₽</span>
            <input type="number" step="1" min="0" value={value.realFbsDeliveryCost}
              onChange={(e) => set("realFbsDeliveryCost", num(e.target.value))} />
          </label>
          <label><span>Обратная доставка, ₽</span>
            <input type="number" step="1" min="0" value={value.realFbsReturnCost}
              onChange={(e) => set("realFbsReturnCost", num(e.target.value))} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Закупка</legend>
        <div className="grid">
          <label><span>Себестоимость, ₽</span>
            <input type="number" step="1" min="0" value={value.costPrice}
              onChange={(e) => set("costPrice", num(e.target.value))} />
          </label>
          <label><span>Доп. расходы / шт, ₽</span>
            <input type="number" step="1" min="0" value={value.extraExpensesPerUnit}
              onChange={(e) => set("extraExpensesPerUnit", num(e.target.value))} />
          </label>
          <label className="checkbox"><input type="checkbox" checked={value.whitePurchase}
            onChange={(e) => set("whitePurchase", e.target.checked)} /> Белая закупка</label>
          <label className="checkbox"><input type="checkbox" checked={value.incomingVatPurchase}
            onChange={(e) => set("incomingVatPurchase", e.target.checked)} /> Закупка с НДС</label>
          <label><span>Ставка вход. НДС</span>
            <select value={String(value.incomingVatRate)}
              onChange={(e) => set("incomingVatRate", Number(e.target.value) as IncomingVatRate)}>
              {(lists.incomingVatRates as number[]).map((v) =>
                <option key={v} value={String(v)}>{`${(v * 100).toFixed(0)}%`}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Маркетинг</legend>
        <div className="grid">
          <label><span>Маркетинг, %</span>
            <PercentInput value={value.marketingPercent} onChange={(v) => set("marketingPercent", v)} min={0} max={100} step={0.5} />
          </label>
        </div>
      </fieldset>
    </section>
  );
}
