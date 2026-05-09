import { useEffect, useState } from "react";
import type { CalcMode, TaxSettings, TaxSystem, VatRate } from "../types";
import lists from "../data/lists.json";
import Collapsible from "./Collapsible";
import PercentInput from "./PercentInput";
import { api } from "../api";

interface Props {
  value: TaxSettings;
  onChange: (next: TaxSettings) => void;
  /** Optional callback to refetch products after a bulk-update action so the
   * UI reflects the new whitePurchase=null state. */
  onProductsRefresh?: () => void | Promise<void>;
  /** Refetch refs (logisticsClusterTariffs etc.) — вызывается после успешной
   * загрузки cluster-tariffs xlsx. */
  onRefsRefresh?: () => void | Promise<void>;
}

const num = (v: string) => (v === "" ? 0 : Number(v));

export default function GlobalSettings({ value, onChange, onProductsRefresh, onRefsRefresh }: Props) {
  const set = <K extends keyof TaxSettings>(key: K, v: TaxSettings[K]) =>
    onChange({ ...value, [key]: v });

  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [clusterStats, setClusterStats] = useState<{
    count: number;
    fromCount: number;
    toCount: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.refs.clusterLogisticsStats();
        setClusterStats({
          count: s.count,
          fromCount: s.fromClusters.length,
          toCount: s.toClusters.length,
        });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const onUploadCluster = async (file: File) => {
    setUploading(true);
    setUploadMsg(null);
    try {
      const r = await api.refs.uploadClusterLogistics(file);
      setUploadMsg(
        `Загружено ${r.inserted} тарифов · ${r.fromClusters.length} кластеров отправки.`,
      );
      setClusterStats({
        count: r.inserted,
        fromCount: r.fromClusters.length,
        toCount: r.toClusters.length,
      });
      // Refresh refs so the calc picks up the new matrix without page reload.
      await onRefsRefresh?.();
    } catch (e) {
      setUploadMsg(`Ошибка: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };
  const onResetWhitePurchase = async () => {
    if (
      !window.confirm(
        "Сбросить «Белая закупка» во ВСЕХ товарах к «По умолчанию»? " +
          "Это уберёт явные значения в каждой карточке — товары начнут наследовать значение из глобальной галки выше.",
      )
    ) {
      return;
    }
    setResetting(true);
    setResetMsg(null);
    try {
      const { updated } = await api.products.bulkResetWhitePurchase();
      setResetMsg(`Обновлено ${updated} товаров.`);
      await onProductsRefresh?.();
    } catch (e) {
      setResetMsg(`Ошибка: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  };

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
        <label><span>Порча, %</span>
          <PercentInput value={value.damageRate} onChange={(v) => set("damageRate", v)} step={0.1} />
        </label>
        <label className="span2">
          <span>Закупка по умолчанию</span>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 32,
              flexWrap: "wrap",
            }}
          >
            <input
              type="checkbox"
              checked={value.defaultWhitePurchase ?? false}
              onChange={(e) =>
                set("defaultWhitePurchase", e.target.checked)
              }
              style={{
                accentColor: "var(--accent)",
                width: 16,
                height: 16,
                margin: 0,
              }}
            />
            <span
              style={{
                fontSize: 13,
                color: "var(--text)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Белая закупка
            </span>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={(e) => {
                e.preventDefault();
                void onResetWhitePurchase();
              }}
              disabled={resetting}
              title="Уберёт явное значение «Белая/Не белая» во всех товарах — они будут наследовать значение из этой галки."
            >
              {resetting ? "Сбрасываем…" : "Сбросить во всех товарах"}
            </button>
            {resetMsg && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                {resetMsg}
              </span>
            )}
          </div>
        </label>
        <label className="span2">
          <span title="Зависит от дохода предыдущего года: <60 млн → не платим, 60–250 → 5%, 250–450 → 7%, >450 → 22%. На ОСНО ставка задаётся в карточке товара (per-product).">
            Ставка НДС на УСН
          </span>
          <select
            value={String(value.usnVatRate ?? "Не облагается")}
            onChange={(e) => {
              const v = e.target.value;
              const next: VatRate =
                v === "Не облагается" ? "Не облагается" : (Number(v) as VatRate);
              set("usnVatRate", next);
            }}
          >
            <option value="Не облагается">Не облагается (0%) — доход &lt; 60 млн</option>
            <option value="0.05">5% — доход 60–250 млн</option>
            <option value="0.07">7% — доход 250–450 млн</option>
            <option value="0.22">22% — доход &gt; 450 млн</option>
          </select>
        </label>
        <label className="span2">
          <span>Логистика по кластерам Ozon</span>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 32,
              flexWrap: "wrap",
            }}
          >
            <input
              type="checkbox"
              checked={value.useClusterLogistics ?? false}
              disabled={!clusterStats || clusterStats.count === 0}
              onChange={(e) =>
                set("useClusterLogistics", e.target.checked)
              }
              style={{
                accentColor: "var(--accent)",
                width: 16,
                height: 16,
                margin: 0,
              }}
            />
            <span
              style={{
                fontSize: 13,
                color: "var(--text)",
                fontWeight: 500,
              }}
            >
              Использовать точную матрицу
            </span>
            <label
              className="btn-secondary"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                cursor: uploading ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexDirection: "row",
              }}
            >
              <input
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadCluster(f);
                  e.target.value = "";
                }}
              />
              {uploading ? "Загружаем…" : "Загрузить таблицу Ozon (.xlsx)"}
            </label>
            {clusterStats && clusterStats.count > 0 && (
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                В базе: {clusterStats.count} тарифов · {clusterStats.fromCount}{" "}
                кластеров отправки.
              </span>
            )}
            {clusterStats && clusterStats.count === 0 && !uploadMsg && (
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                Матрица пока не загружена — чекбокс недоступен.
              </span>
            )}
            {uploadMsg && (
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {uploadMsg}
              </span>
            )}
          </div>
        </label>
        <label className="span2">
          <span title="Влияет только на товары с импортированными данными Ozon (бейдж API). На табличный путь не влияет.">
            Расчёт возвратов и first-mile
          </span>
          <select
            value={value.calcMode ?? "tz"}
            onChange={(e) => set("calcMode", e.target.value as CalcMode)}
          >
            <option value="tz">Формулы из ТЗ (текущие)</option>
            <option value="ozon">Формулы Ozon (по API)</option>
          </select>
        </label>
      </div>
    </Collapsible>
  );
}
