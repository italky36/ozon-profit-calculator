import { Suspense, lazy, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ProductInput, References, TaxSettings } from "../types";
import type { RowResult } from "./ProductsTable";
import ProductForm, { type LockedField } from "./ProductForm";
import OzonBreakdown from "./OzonBreakdown";
import ResultsPanel from "./ResultsPanel";
import { api, type RealizedMarginRow } from "../api";

const OzonPricesDebugModal = lazy(() => import("./OzonPricesDebugModal"));
const OzonInfoDebugModal = lazy(() => import("./OzonInfoDebugModal"));
const OzonFinanceDebugModal = lazy(() => import("./OzonFinanceDebugModal"));

interface Props {
  input: ProductInput;
  result: RowResult;
  onChange: (next: ProductInput) => void;
  onClose: () => void;
  fromOzon: boolean;
  ozonProductId?: number | null;
  ozonSku?: number | null;
  onRefreshed?: () => void;
  taxSettings?: TaxSettings;
  refs?: References | null;
  /** Факт.данные за выбранный период (когда юзер включил «Сравнить с
   *  фактом»). Прокидывается в TaxDebug для блока «Расчёт по факту». */
  actual?: RealizedMarginRow | null;
}

export default function ProductDrawer({ input, result, onChange, onClose, fromOzon, ozonProductId, ozonSku, onRefreshed, taxSettings, refs, actual }: Props) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [infoDebugOpen, setInfoDebugOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const refresh = async () => {
    if (!input.articleId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api.import.refreshArticle(input.articleId);
      setRefreshedAt(Date.now());
      onRefreshed?.();
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (debugOpen) setDebugOpen(false);
        else if (infoDebugOpen) setInfoDebugOpen(false);
        else if (financeOpen) setFinanceOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, debugOpen, infoDebugOpen, financeOpen]);

  const lockedFields: LockedField[] = fromOzon
    ? ["articleId", "productName", "category"]
    : [];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Параметры товара">
        <div className="drawer-header">
          <h3>{input.articleId || "Без артикула"} — {input.productName || "Без названия"}</h3>
          <button className="btn-icon" onClick={onClose} title="Закрыть (Esc)" aria-label="Закрыть" style={{ flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">
          {input.articleId && (
            <section className="card diagnostics-card">
              <div className="diagnostics-head">
                <strong>Диагностика Ozon</strong>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Сырой ответ <code>/v5/product/info/prices</code> и ссылки на товар
                </div>
              </div>
              <div className="diagnostics-actions">
                {fromOzon && (
                  <button
                    className="btn-primary"
                    onClick={refresh}
                    disabled={refreshing}
                    title="Подтянуть из Ozon свежие цену, акцию, комиссии и габариты"
                  >
                    {refreshing ? "Обновляем…" : "Обновить из Ozon"}
                  </button>
                )}
                {ozonSku != null ? (
                  <a
                    className="btn-secondary"
                    href={`https://www.ozon.ru/product/${ozonSku}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Открыть карточку товара на витрине Ozon"
                  >
                    На Ozon ↗
                  </a>
                ) : (
                  <a
                    className="btn-secondary"
                    href={`https://www.ozon.ru/search/?text=${encodeURIComponent(input.articleId)}&from_global=true`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="SKU не загружен — поиск по артикулу. Запусти 'Обновить из Ozon', чтобы получить прямой линк."
                  >
                    Найти на Ozon ↗
                  </a>
                )}
                {ozonProductId != null && (
                  <a
                    className="btn-secondary"
                    href={`https://seller.ozon.ru/app/products/${ozonProductId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Открыть карточку в личном кабинете продавца"
                  >
                    В ЛК продавца ↗
                  </a>
                )}
                <button className="btn-secondary" onClick={() => setDebugOpen(true)}>
                  Ozon /v5 raw
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setInfoDebugOpen(true)}
                  title="Сырой ответ /v3/product/info/list — поля статуса (archived, visibility_details, status)"
                >
                  Ozon /v3 info raw
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setFinanceOpen(true)}
                  title="Среднее accruals_for_sale из локальной БД — фактическая цена продажи"
                >
                  Финансы
                </button>
              </div>
              {refreshError && (
                <div style={{ color: "var(--err)", fontSize: 12, marginTop: 8 }}>
                  Ошибка обновления: {refreshError}
                </div>
              )}
              {refreshedAt && !refreshError && (
                <div style={{ color: "var(--ok, #0a0)", fontSize: 12, marginTop: 8 }}>
                  Обновлено · {new Date(refreshedAt).toLocaleTimeString("ru-RU")}
                </div>
              )}
            </section>
          )}
          <ProductForm value={input} onChange={onChange} lockedFields={lockedFields} refs={refs ?? null} />
          {"error" in result ? (
            <section className="card" style={{ borderColor: "#FFB3B3", background: "#FEEFEF" }}>
              <h3 style={{ margin: "0 0 8px", color: "var(--err)" }}>Ошибка расчёта</h3>
              <p>{result.error}</p>
              <p className="muted">Проверьте, что выбрана корректная пара «Категория / Тип товара».</p>
            </section>
          ) : (
            <>
              <OzonBreakdown result={result} />
              <ResultsPanel
                result={result}
                input={input}
                taxSettings={taxSettings}
                refs={refs}
                actual={actual ?? null}
              />
            </>
          )}
        </div>
      </aside>
      {debugOpen && input.articleId && (
        <Suspense fallback={null}>
          <OzonPricesDebugModal
            articleId={input.articleId}
            onClose={() => setDebugOpen(false)}
          />
        </Suspense>
      )}
      {infoDebugOpen && input.articleId && (
        <Suspense fallback={null}>
          <OzonInfoDebugModal
            articleId={input.articleId}
            onClose={() => setInfoDebugOpen(false)}
          />
        </Suspense>
      )}
      {financeOpen && input.articleId && (
        <Suspense fallback={null}>
          <OzonFinanceDebugModal
            articleId={input.articleId}
            onClose={() => setFinanceOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
