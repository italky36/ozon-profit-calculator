import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { fmtRub } from "../format";

interface Props {
  articleId: string;
  onClose: () => void;
}

type Data = Awaited<ReturnType<typeof api.import.debugFinance>>;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

const fmtPeriod = (period: Data["period"]) => {
  if (period.from == null || period.to == null) return "—";
  return `${fmtDate(period.from)} … ${fmtDate(period.to)}`;
};

export default function OzonFinanceDebugModal({ articleId, onClose }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setData(null);
    api.import
      .debugFinance(articleId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-label="Финансы по артикулу"
        style={{ width: "min(900px, 95vw)" }}
      >
        <div className="drawer-header">
          <h3>
            Финансы · <code>{articleId}</code>
          </h3>
          <button
            className="btn-icon"
            onClick={onClose}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
            style={{ flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">
          {loading && <p className="muted">Считаем агрегаты…</p>}
          {error && (
            <section
              className="card"
              style={{ borderColor: "#FFB3B3", background: "#FEEFEF" }}
            >
              <h3 style={{ margin: "0 0 8px", color: "var(--err)" }}>
                Ошибка
              </h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{error}</p>
            </section>
          )}
          {data && (
            <>
              <section className="card">
                <h3 style={{ margin: "0 0 8px" }}>Продажи</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    <Row label="Период наблюдения" value={fmtPeriod(data.period)} />
                    <Row label="Операций продажи" value={String(data.sale.operations)} />
                    <Row label="Продано штук" value={String(data.sale.units)} />
                    <Row
                      label="Сумма gross (accruals_for_sale)"
                      value={fmtRub(data.sale.grossSum)}
                      hint="Начислено Ozon до вычета комиссии — основная цифра выручки продавца"
                    />
                    <Row
                      label="Сумма net (amount)"
                      value={fmtRub(data.sale.netSum)}
                      hint="Чистый кэш-флоу sale-операций (gross − комиссия Ozon в этой строке)"
                    />
                    <Row
                      label="Средняя gross-цена за штуку"
                      value={
                        data.sale.avgPerUnitGross == null
                          ? "—"
                          : fmtRub(data.sale.avgPerUnitGross)
                      }
                      bold
                      hint="Это и есть «реальная цена продажи продавцу». Сравни с currentPrice — если расходится, прайс-импорт врёт."
                    />
                    <Row
                      label="Средняя net за штуку"
                      value={
                        data.sale.avgPerUnitNet == null
                          ? "—"
                          : fmtRub(data.sale.avgPerUnitNet)
                      }
                    />
                  </tbody>
                </table>
              </section>

              {data.refund.operations > 0 && (
                <section className="card">
                  <h3 style={{ margin: "0 0 8px" }}>Возвраты</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <Row label="Операций возврата" value={String(data.refund.operations)} />
                      <Row label="Возвращено штук" value={String(data.refund.units)} />
                      <Row
                        label="Сумма к возврату (gross)"
                        value={fmtRub(data.refund.grossSum)}
                      />
                      <Row label="Сумма net" value={fmtRub(data.refund.netSum)} />
                    </tbody>
                  </table>
                </section>
              )}

              <section className="card">
                <h3 style={{ margin: "0 0 8px" }}>Последние операции</h3>
                {data.recent.length === 0 ? (
                  <p className="muted">Финансовых операций по этому артикулу нет.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>Дата</th>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>Тип</th>
                        <th style={{ textAlign: "right", padding: "4px 6px" }}>Gross</th>
                        <th style={{ textAlign: "right", padding: "4px 6px" }}>Net</th>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>Posting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((r) => (
                        <tr key={r.operationId} style={{ borderTop: "1px solid var(--border-soft)" }}>
                          <td style={{ padding: "4px 6px" }}>{fmtDate(r.operationDate)}</td>
                          <td style={{ padding: "4px 6px" }} title={r.operationType}>
                            {r.type}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>
                            {r.accrualsForSale == null ? "—" : fmtRub(r.accrualsForSale)}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>
                            {fmtRub(r.amount)}
                          </td>
                          <td style={{ padding: "4px 6px" }}>{r.postingNumber ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <p className="muted" style={{ fontSize: 12 }}>
                Источник: локальная таблица <code>finance_transactions</code> (Ozon отдаёт
                максимум ~30 дней через API, но мы храним всё, что когда-либо импортировали).
                Чтобы получить новые операции — запусти импорт финансов на вкладке «Финансы».
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Row({
  label,
  value,
  hint,
  bold,
}: {
  label: string;
  value: string;
  hint?: string;
  bold?: boolean;
}) {
  return (
    <tr style={{ borderTop: "1px solid var(--border-soft)" }}>
      <td style={{ padding: "6px 0", color: "var(--muted-2)" }} title={hint}>
        {label}
      </td>
      <td
        style={{
          padding: "6px 0",
          textAlign: "right",
          fontWeight: bold ? 700 : 500,
          fontSize: bold ? 15 : 13,
        }}
      >
        {value}
      </td>
    </tr>
  );
}
