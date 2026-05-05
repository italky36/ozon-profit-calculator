import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Equal, Receipt } from "lucide-react";
import {
  api,
  type FinanceSummaryRow,
  type FinanceTransactionRow,
  type FinanceType,
  type ImportRun,
} from "../api";
import { fmtRub } from "../format";
import { KpiCard } from "./KpiStrip";

const TYPE_LABEL: Record<FinanceType, string> = {
  sale: "Продажа",
  refund: "Возврат",
  commission: "Комиссия",
  logistics: "Логистика",
  last_mile: "Последняя миля",
  storage: "Хранение",
  other: "Прочее",
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const monthAgoIso = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleDateString("ru-RU");
};

interface RunInfoProps {
  importing: boolean;
  run: ImportRun | null;
  error: string | null;
}

function RunInfo({ importing, run, error }: RunInfoProps) {
  if (error) return <p style={{ color: "var(--err)", margin: 0 }}>Ошибка: {error}</p>;
  if (!importing && !run) return null;
  if (importing) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Импорт идёт… Обработано: <b>{run?.itemsProcessed ?? 0}</b>
      </p>
    );
  }
  if (run?.status === "ok") {
    const params = (run.params ?? {}) as { inserted?: number; skipped?: number };
    return (
      <p className="muted" style={{ margin: 0 }}>
        Готово. Добавлено: <b>{params.inserted ?? 0}</b>, пропущено
        (дубликаты): <b>{params.skipped ?? 0}</b>.
      </p>
    );
  }
  return null;
}

interface Props {
  onOpenArticle?: (articleId: string) => void;
}

export default function FinanceTab({ onOpenArticle }: Props = {}) {
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [importing, setImporting] = useState(false);
  const [run, setRun] = useState<ImportRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FinanceTransactionRow[]>([]);
  const [summary, setSummary] = useState<FinanceSummaryRow[]>([]);
  const [filterType, setFilterType] = useState<FinanceType | "">("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, sum] = await Promise.all([
          api.finance.listTransactions({
            from,
            to,
            type: filterType || undefined,
            limit: 500,
          }),
          api.finance.summary({ from, to }),
        ]);
        if (cancelled) return;
        setRows(list);
        setSummary(sum);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, filterType]);

  const refresh = async () => {
    try {
      const [list, sum] = await Promise.all([
        api.finance.listTransactions({
          from,
          to,
          type: filterType || undefined,
          limit: 500,
        }),
        api.finance.summary({ from, to }),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const [relinking, setRelinking] = useState(false);
  const [relinkResult, setRelinkResult] = useState<string | null>(null);

  const relink = async () => {
    setRelinking(true);
    setRelinkResult(null);
    try {
      const r = await api.import.relinkFinance();
      setRelinkResult(
        `Просканировано: ${r.scanned}, привязано к товарам: ${r.linked}.`,
      );
      // Re-fetch transactions so they show the now-linked articleId.
      void refresh();
    } catch (e) {
      setRelinkResult(`Ошибка: ${(e as Error).message}`);
    } finally {
      setRelinking(false);
    }
  };

  const startImport = async () => {
    setError(null);
    setRun(null);
    setImporting(true);
    try {
      const { runId } = await api.import.startFinance({ from, to });
      const initial = await api.import.getRun(runId);
      setRun(initial);
      pollTimer.current = setInterval(async () => {
        try {
          const next = await api.import.getRun(runId);
          setRun(next);
          if (next.status !== "running") {
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = null;
            setImporting(false);
            if (next.status === "error") {
              setError(next.errorMessage ?? "import failed");
            } else {
              await refresh();
            }
          }
        } catch (e) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          setImporting(false);
          setError((e as Error).message);
        }
      }, 1000);
    } catch (e) {
      setImporting(false);
      setError((e as Error).message);
    }
  };

  // Aggregate KPI values over rows (current filter respected via summary).
  const totalIncome = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalExpense = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const netTotal = rows.reduce((s, r) => s + r.amount, 0);
  const totalAmount = summary.reduce((acc, s) => acc + s.total, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI cards */}
      <div className="kpi-cards">
        <KpiCard
          label="Доходы"
          value={fmtRub(totalIncome)}
          sub="За выбранный период"
          accent="var(--ok)"
          icon={<ArrowUpRight size={14} />}
        />
        <KpiCard
          label="Расходы"
          value={fmtRub(Math.abs(totalExpense))}
          sub="Комиссии + логистика"
          accent="var(--err)"
          icon={<ArrowDownRight size={14} />}
        />
        <KpiCard
          label="Чистый доход"
          value={fmtRub(netTotal)}
          sub={netTotal >= 0 ? "Прибыль" : "Убыток"}
          accent={netTotal >= 0 ? "var(--accent)" : "var(--err)"}
          icon={<Equal size={14} />}
        />
        <KpiCard
          label="Операций"
          value={String(rows.length)}
          sub="Всего записей"
          accent="var(--info)"
          icon={<Receipt size={14} />}
        />
      </div>

      <section className="card">
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Финансы Ozon</h3>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            marginBottom: 20,
          }}
        >
          <label>
            <span>С даты</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>По дату</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={startImport} disabled={importing}>
            Импортировать за период
          </button>
          <button
            className="btn-secondary"
            onClick={relink}
            disabled={relinking}
            title="Пройтись по транзакциям с пустым articleId и связать их с товарами через ozon_sku"
          >
            {relinking ? "Связываем…" : "Привязать неопознанные"}
          </button>
          {relinkResult && (
            <span className="muted" style={{ fontSize: 12 }}>
              {relinkResult}
            </span>
          )}
          <label>
            <span>Тип</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as FinanceType | "")}
            >
              <option value="">все</option>
              {(Object.keys(TYPE_LABEL) as FinanceType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <RunInfo importing={importing} run={run} error={error} />

        {summary.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Сводка</div>
            <div className="products-scroll">
              <table className="products-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th className="num">Кол-во</th>
                    <th className="num">Сумма, ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.type}>
                      <td>
                        <span className={`fin-tag ${s.type}`}>{TYPE_LABEL[s.type]}</span>
                      </td>
                      <td className="num">{s.count}</td>
                      <td className={`num ${s.total >= 0 ? "amount-pos" : "amount-neg"}`}>
                        {fmtRub(s.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totals">
                    <td>Итого</td>
                    <td className="num">
                      {summary.reduce((a, s) => a + s.count, 0)}
                    </td>
                    <td className={`num ${totalAmount >= 0 ? "amount-pos" : "amount-neg"}`}>
                      {fmtRub(totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            Операции ({rows.length}
            {rows.length === 500 ? "+" : ""})
          </div>
          <div className="products-scroll">
            <table className="products-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Operation</th>
                  <th>Артикул</th>
                  <th>Posting</th>
                  <th className="num">Сумма, ₽</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Нет операций за выбранный период.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.operationId}>
                    <td>{fmtDate(r.operationDate)}</td>
                    <td>
                      <span className={`fin-tag ${r.type}`}>{TYPE_LABEL[r.type]}</span>
                    </td>
                    <td className="ellipsis" title={r.operationType} style={{ color: "var(--muted-2)", fontSize: 12 }}>
                      {r.operationType}
                    </td>
                    <td className="price">
                      {r.articleId ? (
                        <button
                          type="button"
                          onClick={() => onOpenArticle?.(r.articleId!)}
                          title="Открыть карточку товара"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "var(--accent)",
                            cursor: "pointer",
                            font: "inherit",
                            textDecoration: "underline",
                            textUnderlineOffset: 2,
                          }}
                        >
                          {r.articleId}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ color: "var(--muted-2)", fontSize: 12 }}>{r.postingNumber ?? "—"}</td>
                    <td className={`num ${r.amount >= 0 ? "amount-pos" : "amount-neg"}`}>
                      {r.amount >= 0 ? "+" : ""}
                      {fmtRub(r.amount)}
                      {r.type === "sale" &&
                        r.grossAmount != null &&
                        r.grossAmount > 0 &&
                        r.grossAmount !== r.amount && (
                          <div
                            className="muted"
                            style={{ fontSize: 11, marginTop: 2, lineHeight: 1.2 }}
                            title="accruals_for_sale — gross-выручка по этой продаже до удержаний (комиссия Ozon, эквайринг, последняя миля)"
                          >
                            gross {fmtRub(r.grossAmount)}
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="totals">
                    <td colSpan={5}>Итого</td>
                    <td className={`num ${netTotal >= 0 ? "amount-pos" : "amount-neg"}`} style={{ fontWeight: 800 }}>
                      {netTotal >= 0 ? "+" : ""}
                      {fmtRub(netTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
