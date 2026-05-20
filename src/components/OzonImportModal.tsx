import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, RefreshCw, X } from "lucide-react";
import { type Shop } from "../api";
import {
  getAutoRefreshState,
  setAutoRefreshConfig,
  onAutoRefreshChange,
} from "../lib/autoRefresh";
import {
  useMultiShopImport,
  type ShopRunState,
} from "../lib/useMultiShopImport";
import ShopBadge from "./ShopBadge";

type AutoRefreshState = ReturnType<typeof getAutoRefreshState>;

interface Props {
  shops: Shop[];
  onClose: () => void;
  onImported: () => void;
}

export default function OzonImportModal({
  shops,
  onClose,
  onImported,
}: Props) {
  const {
    credsByShop,
    credsLoading,
    credsError,
    runsByShop,
    phase,
    start,
    retry,
  } = useMultiShopImport({
    kind: "catalog",
    onShopDone: () => onImported(),
  });

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [userTouchedSelection, setUserTouchedSelection] = useState(false);
  const [expandedAuto, setExpandedAuto] = useState<Set<number>>(() => new Set());
  const toggleAuto = (shopId: number) => {
    setExpandedAuto((cur) => {
      const next = new Set(cur);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  // Default-select shops with credentials once creds resolve.
  useEffect(() => {
    if (credsLoading || userTouchedSelection) return;
    const next = new Set<number>();
    for (const s of shops) {
      const c = credsByShop.get(s.id);
      if (c?.hasCredentials) next.add(s.id);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(next);
  }, [credsLoading, credsByShop, shops, userTouchedSelection]);

  const toggle = (shopId: number) => {
    setUserTouchedSelection(true);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  const eligible = useMemo(
    () => shops.filter((s) => credsByShop.get(s.id)?.hasCredentials),
    [shops, credsByShop],
  );
  const allEligibleSelected =
    eligible.length > 0 && eligible.every((s) => selected.has(s.id));
  const toggleAll = () => {
    setUserTouchedSelection(true);
    if (allEligibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((s) => s.id)));
    }
  };

  const handleClose = () => {
    if (phase === "running") {
      const ok = window.confirm(
        "Импорт продолжится на сервере. Закрыть окно?",
      );
      if (!ok) return;
    }
    onClose();
  };

  const handleStart = () => {
    start([...selected]);
  };

  const totalSelected = selected.size;
  const runs = [...runsByShop.entries()];
  const doneCount = runs.filter(([, r]) => r.status === "ok").length;
  const errorCount = runs.filter(
    ([, r]) => r.status === "error" || r.status === "skipped",
  ).length;
  const totalRuns = runs.length;
  const totalItems = runs.reduce(
    (sum, [, r]) => sum + (r.itemsProcessed ?? 0),
    0,
  );
  const totalAdded = runs.reduce((sum, [, r]) => {
    const n = (r.params as { added?: number } | null)?.added;
    return sum + (typeof n === "number" ? n : 0);
  }, 0);
  const totalUpdated = runs.reduce((sum, [, r]) => {
    const n = (r.params as { updated?: number } | null)?.updated;
    return sum + (typeof n === "number" ? n : 0);
  }, 0);
  const sortedShops = useMemo(
    () =>
      [...shops].sort((a, b) =>
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
      ),
    [shops],
  );

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Импорт каталога из Ozon</h3>
          <button
            className="btn-icon"
            onClick={handleClose}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        {credsLoading && <p className="muted">Проверка ключей…</p>}
        {credsError && (
          <p style={{ color: "var(--err)" }}>Ошибка: {credsError}</p>
        )}

        {!credsLoading && !credsError && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <p className="muted" style={{ margin: 0 }}>
                Магазины, для которых обновить каталог:
              </p>
              {eligible.length > 1 && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={toggleAll}
                  disabled={phase === "running"}
                >
                  {allEligibleSelected ? "Снять все" : "Выбрать все"}
                </button>
              )}
            </div>

            <div className="ozon-import-shops">
              {sortedShops.map((s) => {
                const c = credsByShop.get(s.id);
                const eligibleShop = !!c?.hasCredentials;
                const run = runsByShop.get(s.id) ?? null;
                return (
                  <ShopRow
                    key={s.id}
                    shop={s}
                    sourceLabel={sourceLabel(c?.activeSource)}
                    eligible={eligibleShop}
                    selected={selected.has(s.id)}
                    disabled={phase === "running" || !eligibleShop}
                    onToggle={() => toggle(s.id)}
                    run={run}
                    onRetry={() => retry(s.id)}
                    autoExpanded={expandedAuto.has(s.id)}
                    onToggleAuto={() => toggleAuto(s.id)}
                  />
                );
              })}
            </div>

            {phase === "running" || phase === "done" ? (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--surface-muted)",
                  border: "1px solid var(--border-soft)",
                  fontSize: 13,
                }}
              >
                {phase === "running" ? (
                  <span>
                    Импорт идёт: <b>{doneCount}</b> готово,{" "}
                    <b>{errorCount}</b> с ошибкой из <b>{totalRuns}</b>{" "}
                    магазинов · обработано товаров: <b>{totalItems}</b>
                  </span>
                ) : (
                  <span>
                    Готово: <b>{doneCount}</b> из <b>{totalRuns}</b> магазинов
                    {errorCount > 0 && (
                      <>
                        {", "}
                        <span style={{ color: "var(--err)" }}>
                          ошибок: <b>{errorCount}</b>
                        </span>
                      </>
                    )}
                    {" · "}
                    товаров: <b>{totalItems}</b>
                    {(totalAdded > 0 || totalUpdated > 0) && (
                      <>
                        {" "}
                        <span className="muted">
                          (новых <b>{totalAdded}</b>, обновлено{" "}
                          <b>{totalUpdated}</b>)
                        </span>
                      </>
                    )}
                  </span>
                )}
              </div>
            ) : null}

            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              {phase === "idle" && (
                <button
                  className="btn-primary"
                  onClick={handleStart}
                  disabled={totalSelected === 0}
                >
                  {totalSelected > 1
                    ? `Запустить импорт (${totalSelected})`
                    : "Запустить импорт"}
                </button>
              )}
              {phase === "running" && (
                <span className="muted">Можно закрыть — импорт продолжится.</span>
              )}
              {phase === "done" && (
                <button className="btn-primary" onClick={onClose}>
                  Закрыть
                </button>
              )}
            </div>

          </>
        )}
      </div>
    </div>
  );
}

function sourceLabel(
  source: "shop" | "global" | "env" | null | undefined,
): string {
  switch (source) {
    case "shop":
      return "личные ключи";
    case "global":
      return "общие админские";
    case "env":
      return "ключи из .env";
    default:
      return "нет ключей";
  }
}

function ShopRow({
  shop,
  sourceLabel,
  eligible,
  selected,
  disabled,
  onToggle,
  run,
  onRetry,
  autoExpanded,
  onToggleAuto,
}: {
  shop: Shop;
  sourceLabel: string;
  eligible: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  run: ShopRunState | null;
  onRetry: () => void;
  autoExpanded: boolean;
  onToggleAuto: () => void;
}) {
  return (
    <div
      className="ozon-import-shop"
      style={{ opacity: eligible ? 1 : 0.55 }}
    >
      <label
        className="ozon-import-shop-row"
        style={{ cursor: disabled ? "default" : "pointer" }}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
        />
        <ShopBadge code={shop.shortName} color={shop.color} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{shop.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {eligible
              ? sourceLabel
              : "Нет ключа API — настройте в карточке магазина"}
          </div>
          {run?.status === "error" && run.errorMessage && (
            <ErrorMessage text={run.errorMessage} />
          )}
        </div>
        <RunStatusBadge run={run} onRetry={onRetry} eligible={eligible} />
        {eligible && (
          <button
            type="button"
            className="ozon-import-shop-auto-toggle"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleAuto();
            }}
            aria-expanded={autoExpanded}
            title="Авто-обновление каталога"
          >
            <RefreshCw size={12} />
            <span>Авто</span>
            <ChevronDown
              size={12}
              style={{
                transform: autoExpanded ? "rotate(180deg)" : "none",
                transition: "transform .15s",
              }}
            />
          </button>
        )}
      </label>
      {eligible && autoExpanded && (
        <div className="ozon-import-shop-auto">
          <SelectedShopAutoRefresh shop={shop} />
        </div>
      )}
    </div>
  );
}

function RunStatusBadge({
  run,
  onRetry,
  eligible,
}: {
  run: ShopRunState | null;
  onRetry: () => void;
  eligible: boolean;
}) {
  if (!run) return null;
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
        style={{
          ...common,
          background: "var(--surface-muted)",
          color: "var(--muted)",
        }}
      >
        в очереди
      </span>
    );
  if (run.status === "starting")
    return (
      <span
        style={{
          ...common,
          background: "var(--accent-bg)",
          color: "var(--accent)",
        }}
      >
        запуск…
      </span>
    );
  if (run.status === "running")
    return (
      <span
        style={{
          ...common,
          background: "var(--accent-bg)",
          color: "var(--accent)",
        }}
      >
        {run.itemsProcessed}/…
      </span>
    );
  if (run.status === "ok")
    return (
      <span
        style={{
          ...common,
          background: "color-mix(in srgb, #16a34a 14%, transparent)",
          color: "#15803d",
        }}
        title={`Обработано: ${run.itemsProcessed}`}
      >
        готово
      </span>
    );
  if (run.status === "skipped" || run.status === "error")
    return (
      <span
        style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
      >
        <span
          style={{
            ...common,
            background: "color-mix(in srgb, var(--err) 14%, transparent)",
            color: "var(--err)",
          }}
          title={run.errorMessage ?? ""}
        >
          {run.status === "skipped" ? "нет ключа" : "ошибка"}
        </span>
        {eligible && run.status === "error" && (
          <button
            type="button"
            className="btn-link"
            onClick={onRetry}
            style={{ fontSize: 12 }}
          >
            Повторить
          </button>
        )}
      </span>
    );
  return null;
}

function ErrorMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API без HTTPS / в WebView отключён — fallback на selection.
      const sel = window.getSelection();
      const node = textRef.current;
      if (sel && node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };
  return (
    <div
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      <div
        ref={textRef}
        style={{
          flex: 1,
          fontSize: 11.5,
          color: "var(--err)",
          wordBreak: "break-word",
          lineHeight: 1.4,
          userSelect: "text",
          cursor: "text",
        }}
      >
        {text}
      </div>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Скопировано" : "Скопировать"}
        aria-label="Скопировать текст ошибки"
        style={{
          flex: "0 0 auto",
          width: 22,
          height: 22,
          padding: 0,
          borderRadius: 5,
          border: "1px solid var(--border)",
          background: copied ? "color-mix(in srgb, #16a34a 14%, transparent)" : "#fff",
          color: copied ? "#15803d" : "var(--muted)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all .12s",
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function SelectedShopAutoRefresh({ shop }: { shop: Shop }) {
  const [state, setState] = useState<AutoRefreshState>(() =>
    getAutoRefreshState(shop.id),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const off = onAutoRefreshChange((changedShop) => {
      if (changedShop === shop.id) setState(getAutoRefreshState(shop.id));
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(getAutoRefreshState(shop.id));
    return off;
  }, [shop.id]);

  const apply = async (enabled: boolean, minutes: number) => {
    setSaving(true);
    setSaveError(null);
    try {
      await setAutoRefreshConfig(shop.id, { enabled, intervalMin: minutes });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AutoRefreshCard
      state={state}
      saving={saving}
      saveError={saveError}
      onChange={apply}
    />
  );
}

const PRESETS = [15, 30, 60, 120];

function AutoRefreshCard({
  state,
  saving,
  saveError,
  onChange,
}: {
  state: AutoRefreshState;
  saving: boolean;
  saveError: string | null;
  onChange: (enabled: boolean, minutes: number) => void | Promise<void>;
}) {
  const sub = state.enabled
    ? `Каждые ${state.intervalMin} мин`
    : "Выключено";
  return (
    <div className="auto-refresh-card">
      <div className="auto-refresh-head">
        <span className="auto-refresh-icon">
          <RefreshCw size={14} />
        </span>
        <div className="auto-refresh-text">
          <div className="auto-refresh-title">Авто-обновление</div>
          <div className="auto-refresh-sub">{sub}</div>
        </div>
        <button
          type="button"
          className={`gs-toggle${state.enabled ? " on" : ""}`}
          disabled={saving}
          onClick={() => void onChange(!state.enabled, state.intervalMin)}
          aria-label="Включить авто-обновление"
        />
      </div>
      {state.enabled && (
        <>
          <div className="auto-refresh-presets">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className={`gs-seg-btn${state.intervalMin === m ? " on" : ""}`}
                disabled={saving}
                onClick={() => void onChange(true, m)}
              >
                {m} мин
              </button>
            ))}
            <div className="auto-refresh-custom">
              <input
                type="number"
                min={1}
                max={1440}
                step={5}
                value={state.intervalMin}
                disabled={saving}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value) || 1);
                  void onChange(true, v);
                }}
              />
              <span>мин</span>
            </div>
          </div>
          {(state.lastRunAt || state.lastError) && (
            <div className="auto-refresh-status">
              {state.lastRunAt && (
                <span>
                  Последний запуск:{" "}
                  <strong>
                    {new Date(state.lastRunAt).toLocaleTimeString("ru-RU")}
                  </strong>
                </span>
              )}
              {state.lastError && (
                <span className="auto-refresh-error">
                  Ошибка: {state.lastError}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {saveError && (
        <div className="auto-refresh-error">Не удалось сохранить: {saveError}</div>
      )}
    </div>
  );
}
