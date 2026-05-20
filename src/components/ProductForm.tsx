import type {
  ProductInput,
  References,
  VatRate,
  IncomingVatRate,
  AcceptanceTariff,
  LogisticsMode,
  ClustersCount,
} from "../types";
import categories from "../data/categories.json";
import lists from "../data/lists.json";
import { OZON_CLUSTERS } from "../lib/clusters";
import { findStorage, freeStorageDaysOf } from "../lib/calc/storage";
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
  /** Refs из API — нужны чтобы показать «Бесплатное хранение по таблице
   *  Ozon». Если не передано, поле не рендерится. */
  refs?: References | null;
}

const cats = categories as Record<string, string[]>;
const num = (v: string) => (v === "" ? 0 : Number(v));
const LOCK_TOOLTIP = "Данные из Ozon — только чтение";

function pluralizeDay(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "дней";
  if (b > 1 && b < 5) return "дня";
  if (b === 1) return "день";
  return "дней";
}

export default function ProductForm({ value, onChange, lockedFields = [], refs = null }: Props) {
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
        <legend>Габариты</legend>
        <div className="grid">
          <label><span>Глубина, мм</span>
            <input
              type="number"
              step="1"
              min="0"
              value={value.depthMm ?? ""}
              onChange={(e) => set("depthMm", e.target.value === "" ? null : num(e.target.value))}
            />
          </label>
          <label><span>Ширина, мм</span>
            <input
              type="number"
              step="1"
              min="0"
              value={value.widthMm ?? ""}
              onChange={(e) => set("widthMm", e.target.value === "" ? null : num(e.target.value))}
            />
          </label>
          <label><span>Высота, мм</span>
            <input
              type="number"
              step="1"
              min="0"
              value={value.heightMm ?? ""}
              onChange={(e) => set("heightMm", e.target.value === "" ? null : num(e.target.value))}
            />
          </label>
          <label><span>Вес, г</span>
            <input
              type="number"
              step="1"
              min="0"
              value={value.weightG ?? ""}
              onChange={(e) => set("weightG", e.target.value === "" ? null : num(e.target.value))}
            />
          </label>
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
          <label><span>Кластер отправки</span>
            <select value={value.dispatchCluster}
              onChange={(e) => set("dispatchCluster", e.target.value)}>
              {OZON_CLUSTERS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label><span>Кластер назначения</span>
            <select value={value.destinationCluster}
              onChange={(e) => set("destinationCluster", e.target.value)}>
              {OZON_CLUSTERS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
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
        {refs && (() => {
          const row = findStorage(refs.storage, value.category, value.productType);
          const effective = freeStorageDaysOf(
            row,
            value.isFireHazard,
            value.isKgt,
            value.isKazakhstan,
          );
          const overdue = Math.max(value.plannedStorageDays - effective, 0);
          const flag = value.isFireHazard
            ? "пожароопасный"
            : value.isKgt
              ? "КГТ"
              : value.isKazakhstan
                ? "Казахстан"
                : null;
          return (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                fontSize: 12,
                background: "var(--surface-muted, #f8fafc)",
                border: "1px solid var(--border-soft, #e2e8f0)",
                borderRadius: 6,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
              title="Берётся из ref_storage по category × productType. Если plannedStorageDays > этого числа — за каждый «лишний» день начисляется storageRub (объём × ставка ₽/л/день)."
            >
              <div>
                <b>Бесплатное хранение по таблице Ozon:</b> {effective} {pluralizeDay(effective)}
                {flag && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    (вариант «{flag}»)
                  </span>
                )}
                {!row && !value.isFireHazard && (
                  <span style={{ marginLeft: 6, color: "var(--err)" }}>
                    — не нашли в таблице для этой категории
                  </span>
                )}
              </div>
              {overdue > 0 ? (
                <div>
                  План {value.plannedStorageDays} − бесплатно {effective} ={" "}
                  <b>{overdue} {pluralizeDay(overdue)}</b> платно → влияет на «Хранение FBO»
                </div>
              ) : (
                <div>
                  План {value.plannedStorageDays} ≤ бесплатно {effective} →{" "}
                  <b>«Хранение FBO» = 0</b>
                </div>
              )}
            </div>
          );
        })()}
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
          <label>
            <span title="«По умолчанию» — берёт значение из глобальной настройки. Можно явно выставить «Белая» или «Не белая» для конкретного товара.">
              Белая закупка
            </span>
            <select
              value={
                value.whitePurchase === null || value.whitePurchase === undefined
                  ? "default"
                  : value.whitePurchase
                    ? "true"
                    : "false"
              }
              onChange={(e) => {
                const v = e.target.value;
                set(
                  "whitePurchase",
                  v === "default" ? null : v === "true",
                );
              }}
            >
              <option value="default">По умолчанию (из настроек)</option>
              <option value="true">Белая (с документами)</option>
              <option value="false">Не белая</option>
            </select>
          </label>
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
