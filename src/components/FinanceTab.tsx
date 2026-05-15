import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Equal, Receipt } from "lucide-react";
import {
  api,
  type FinanceSummaryRow,
  type FinanceTransactionRow,
  type FinanceType,
  type Shop,
} from "../api";
import { fmtRub } from "../format";
import { KpiCard } from "./KpiStrip";
import { useToast } from "../contexts/useToast";
import ShopBadge from "./ShopBadge";
import {
  useMultiShopImport,
  type ShopRunState,
} from "../lib/useMultiShopImport";

const TYPE_LABEL: Record<FinanceType, string> = {
  sale: "Продажа",
  refund: "Возврат",
  commission: "Комиссия",
  logistics: "Логистика",
  last_mile: "Последняя миля",
  storage: "Хранение",
  other: "Прочее",
};

const formatLocalIso = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};
const todayIso = (): string => formatLocalIso(new Date());
const monthAgoIso = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return formatLocalIso(d);
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleDateString("ru-RU");
};

function ShopRunPill({ run }: { run: ShopRunState }) {
  const common: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 6,
    whiteSpace: "nowrap",
  };
  if (run.status === "queued")
    return (
      <span
        style={{ ...common, background: "var(--surface-muted)", color: "var(--muted)" }}
      >
        в очереди
      </span>
    );
  if (run.status === "starting")
    return (
      <span style={{ ...common, background: "var(--accent-bg)", color: "var(--accent)" }}>
        запуск…
      </span>
    );
  if (run.status === "running")
    return (
      <span style={{ ...common, background: "var(--accent-bg)", color: "var(--accent)" }}>
        {run.itemsProcessed}/…
      </span>
    );
  if (run.status === "ok") {
    const params = (run.params ?? {}) as { inserted?: number; skipped?: number };
    return (
      <span
        style={{ ...common, background: "color-mix(in srgb, #16a34a 14%, transparent)", color: "#15803d" }}
        title={`Добавлено: ${params.inserted ?? 0}, пропущено: ${params.skipped ?? 0}`}
      >
        готово
      </span>
    );
  }
  if (run.status === "skipped" || run.status === "error")
    return (
      <span
        style={{ ...common, background: "color-mix(in srgb, var(--err) 14%, transparent)", color: "var(--err)" }}
        title={run.errorMessage ?? ""}
      >
        {run.status === "skipped" ? "нет ключа" : "ошибка"}
      </span>
    );
  return null;
}

interface Props {
  shops: Shop[];
  onOpenArticle?: (articleId: string) => void;
}

const FINANCE_PERIOD_KEY = "ozon-calc.finance-period";
const loadStoredPeriod = (): { from: string; to: string } | null => {
  try {
    const raw = localStorage.getItem(FINANCE_PERIOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { from?: string; to?: string };
    if (parsed?.from && parsed?.to) return { from: parsed.from, to: parsed.to };
  } catch {
    /* ignore */
  }
  return null;
};

export default function FinanceTab({ shops, onOpenArticle }: Props) {
  const toast = useToast();
  const stored = loadStoredPeriod();
  const [from, setFrom] = useState(stored?.from ?? monthAgoIso());
  const [to, setTo] = useState(stored?.to ?? todayIso());

  // Persist last-used period across page reloads. Hides the surprise of
  // returning to the default monthly window after a long-period import.
  useEffect(() => {
    try {
      localStorage.setItem(
        FINANCE_PERIOD_KEY,
        JSON.stringify({ from, to }),
      );
    } catch {
      /* ignore */
    }
  }, [from, to]);

  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FinanceTransactionRow[]>([]);
  const [summary, setSummary] = useState<FinanceSummaryRow[]>([]);
  const [filterType, setFilterType] = useState<FinanceType | "">("");
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [userTouchedShops, setUserTouchedShops] = useState(false);

  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const multi = useMultiShopImport({
    kind: "finance",
    financeParams: { from, to },
    onShopDone: () => {
      void refreshRef.current();
    },
  });

  // Default-select shops with credentials once creds resolve.
  useEffect(() => {
    if (multi.credsLoading || userTouchedShops) return;
    const next = new Set<number>();
    for (const s of shops) {
      if (multi.credsByShop.get(s.id)?.hasCredentials) next.add(s.id);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(next);
  }, [multi.credsLoading, multi.credsByShop, shops, userTouchedShops]);

  const toggleShop = (id: number) => {
    setUserTouchedShops(true);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Reset to first page when filters change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [from, to, filterType]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, sum] = await Promise.all([
          api.finance.listTransactions({
            from,
            to,
            type: filterType || undefined,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
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
  }, [from, to, filterType, page]);

  const refresh = async () => {
    try {
      const [list, sum] = await Promise.all([
        api.finance.listTransactions({
          from,
          to,
          type: filterType || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
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
    refreshRef.current = refresh;
  });

  const [relinking, setRelinking] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearAll = async () => {
    if (
      !window.confirm(
        "Удалить ВСЕ импортированные финансовые транзакции из локальной БД? " +
          "После этого можно импортировать с нуля. Действие необратимо.",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const { deleted } = await api.finance.clearAll();
      toast.show(`Удалено ${deleted} операций.`, { variant: "success" });
      void refresh();
    } catch (e) {
      toast.show(`Ошибка: ${(e as Error).message}`, { variant: "error" });
    } finally {
      setClearing(false);
    }
  };

  const relink = async () => {
    setRelinking(true);
    try {
      const r = await api.import.relinkFinance();
      toast.show(
        `Просканировано: ${r.scanned}, привязано к товарам: ${r.linked}.`,
        { variant: "success" },
      );
      // Re-fetch transactions so they show the now-linked articleId.
      void refresh();
    } catch (e) {
      toast.show(`Ошибка: ${(e as Error).message}`, { variant: "error" });
    } finally {
      setRelinking(false);
    }
  };

  const startImport = () => {
    setError(null);
    multi.start([...selected]);
  };

  // KPI считаем из summary (агрегат сервера по всему периоду), а не из
  // rows — последние ограничены пагинацией (100 на страницу).
  // «Поступления» = sale-операции (positive total), «Удержания» = всё
  // остальное со знаком минус (комиссии, логистика, возвраты, хранение).
  // Себестоимость в БД не лежит, поэтому это не «Доходы/Расходы» в налоговом
  // смысле — это движение по счёту от Ozon.
  const totalIncome = summary
    .filter((s) => s.total > 0)
    .reduce((acc, s) => acc + s.total, 0);
  const totalExpense = summary
    .filter((s) => s.total < 0)
    .reduce((acc, s) => acc + s.total, 0);
  const netTotal = summary.reduce((acc, s) => acc + s.total, 0);
  const totalAmount = netTotal; // alias, used by сводка-tfoot ниже

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI cards */}
      <div className="kpi-cards">
        <KpiCard
          label="Поступления"
          value={fmtRub(totalIncome)}
          sub="Выручка от продаж (до удержаний Ozon)"
          accent="var(--ok)"
          icon={<ArrowUpRight size={14} />}
        />
        <KpiCard
          label="Удержания Ozon"
          value={fmtRub(Math.abs(totalExpense))}
          sub="Комиссии, логистика, возвраты, хранение"
          accent="var(--err)"
          icon={<ArrowDownRight size={14} />}
        />
        <KpiCard
          label="К получению"
          value={fmtRub(netTotal)}
          sub={
            netTotal >= 0
              ? "Поступит на счёт (без учёта налогов и себестоимости)"
              : "Ушло со счёта"
          }
          accent={netTotal >= 0 ? "var(--accent)" : "var(--err)"}
          icon={<Equal size={14} />}
        />
        <KpiCard
          label="Операций"
          value={String(summary.reduce((a, s) => a + s.count, 0))}
          sub="Всего записей"
          accent="var(--info)"
          icon={<Receipt size={14} />}
        />
      </div>

      <section className="card">
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Финансы Ozon</h3>

        <div
          className="finance-actions"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            marginBottom: 20,
          }}
        >
          {(() => {
            const localToday = (() => {
              const d = new Date();
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              return `${yyyy}-${mm}-${dd}`;
            })();
            // Произвольный период разрешён — сервер сам разобьёт на 30-дневные
            // чанки и прогонит последовательно. Ограничиваем только «не в
            // будущее» и «to ≥ from».
            return (
              <>
                <label>
                  <span>С даты</span>
                  <input
                    type="date"
                    value={from}
                    max={localToday}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFrom(v);
                      if (to < v) setTo(v);
                    }}
                  />
                </label>
                <label>
                  <span>По дату</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    max={localToday}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </>
            );
          })()}
          {(() => {
            const days =
              Math.round(
                (new Date(to).getTime() - new Date(from).getTime()) /
                  (24 * 60 * 60 * 1000),
              ) + 1;
            const chunkCount = Math.max(1, Math.ceil(days / 30));
            const invalid = days <= 0;
            return (
              <button
                className="btn-primary"
                onClick={startImport}
                disabled={
                  multi.phase === "running" || invalid || selected.size === 0
                }
                title={
                  invalid
                    ? "«По дату» должна быть позже «С даты»"
                    : selected.size === 0
                      ? "Выберите хотя бы один магазин"
                      : chunkCount === 1
                        ? `Период ${days} дн. — один запрос к Ozon API на магазин.`
                        : `Период ${days} дн. Будет разбит на ${chunkCount} запросов по 30 дней на каждый магазин.`
                }
              >
                {selected.size > 1
                  ? `Импортировать за период (${selected.size})`
                  : "Импортировать за период"}
              </button>
            );
          })()}
          <button
            className="btn-secondary"
            onClick={relink}
            disabled={relinking}
            title="Пройтись по транзакциям с пустым articleId и связать их с товарами через ozon_sku"
          >
            {relinking ? "Связываем…" : "Привязать неопознанные"}
          </button>
          <button
            className="btn-secondary"
            onClick={clearAll}
            disabled={clearing}
            title="Удалить все импортированные транзакции из локальной БД."
            style={{ color: "var(--err)", borderColor: "var(--err)" }}
          >
            {clearing ? "Очищаем…" : "Очистить финансы"}
          </button>
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

        {shops.length > 1 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: -8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Магазины
            </span>
            <div className="shop-filter-row">
              {shops.map((s) => {
                const creds = multi.credsByShop.get(s.id);
                const eligible = !!creds?.hasCredentials;
                const isSel = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ch-pill${isSel ? " active" : ""}`}
                    disabled={!eligible || multi.phase === "running"}
                    onClick={() => toggleShop(s.id)}
                    title={
                      eligible
                        ? s.name
                        : `${s.name} — нет ключа API, настройте в карточке магазина`
                    }
                    style={
                      s.color && isSel
                        ? {
                            borderColor: s.color,
                            background: s.color,
                            color: "#fff",
                          }
                        : s.color
                          ? { borderColor: s.color, color: s.color }
                          : undefined
                    }
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        marginRight: 6,
                        letterSpacing: 0.5,
                      }}
                    >
                      {s.shortName}
                    </span>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: "var(--err)", margin: 0 }}>Ошибка: {error}</p>
        )}
        {multi.runsByShop.size > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 4,
            }}
          >
            {[...multi.runsByShop.entries()].map(([shopId, r]) => {
              const s = shops.find((x) => x.id === shopId);
              if (!s) return null;
              return (
                <div
                  key={shopId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <ShopBadge
                    code={s.shortName}
                    color={s.color}
                    title={s.name}
                    size="sm"
                  />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <ShopRunPill run={r} />
                </div>
              );
            })}
          </div>
        )}

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
          {(() => {
            const totalOps = summary.reduce((a, s) => a + s.count, 0);
            const fromIdx = totalOps === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
            const toIdx = Math.min(page * PAGE_SIZE, totalOps);
            return (
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span>Операции ({totalOps})</span>
                {totalOps > 0 && (
                  <span
                    style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}
                  >
                    {fromIdx}–{toIdx} из {totalOps}
                  </span>
                )}
              </div>
            );
          })()}
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
          {(() => {
            const totalOps = summary.reduce((a, s) => a + s.count, 0);
            const pageCount = Math.max(1, Math.ceil(totalOps / PAGE_SIZE));
            if (pageCount <= 1) return null;
            const goto = (p: number) =>
              setPage(Math.min(Math.max(1, p), pageCount));
            return (
              <div className="finance-pagination">
                <button
                  type="button"
                  onClick={() => goto(1)}
                  disabled={page === 1}
                  title="К первой странице"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => goto(page - 1)}
                  disabled={page === 1}
                >
                  ‹ Назад
                </button>
                <span className="finance-pagination-info">
                  стр. {page} из {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goto(page + 1)}
                  disabled={page === pageCount}
                >
                  Далее ›
                </button>
                <button
                  type="button"
                  onClick={() => goto(pageCount)}
                  disabled={page === pageCount}
                  title="К последней странице"
                >
                  »
                </button>
              </div>
            );
          })()}
        </div>
      </section>
    </div>
  );
}
