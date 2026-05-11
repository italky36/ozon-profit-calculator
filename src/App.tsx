import { useEffect, useMemo, useRef, useState } from "react";
import GlobalSettings from "./components/GlobalSettings";
import ProductsTable, { type RowResult } from "./components/ProductsTable";
import ProductDrawer from "./components/ProductDrawer";
import OzonImportModal from "./components/OzonImportModal";
import FinanceTab from "./components/FinanceTab";
import AdminPage from "./components/admin/AdminPage";
import AppHeader from "./components/AppHeader";
import TabBar from "./components/TabBar";
import TweaksPanel from "./components/TweaksPanel";
import { TWEAK_DEFAULTS, useTweaks } from "./lib/useTweaks";
import { useAuth } from "./contexts/AuthContext";
import { Package, ShieldCheck, Wallet, Settings as SettingsIcon } from "lucide-react";
import type { FilterValue } from "./components/ChannelFilter";
import { calculateRow } from "./lib/calc";
import type {
  ProductInput,
  ProductRow,
  References,
  TaxSettings,
} from "./types";
import { api, type RealizedMarginRow, type RefsResponse } from "./api";
import { initAutoRefresh, onAutoRefreshChange } from "./lib/autoRefresh";

const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const COFFEE_DEFAULT: ProductInput = {
  articleId: "TEST-001",
  productName: "Кофемашина (пример)",
  category: "Кофеварки и кофемашины",
  productType: "Автоматическая кофемашина",
  isKgt: false,
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  volumeL: 209,
  depthMm: null,
  widthMm: null,
  heightMm: null,
  weightG: null,
  vatRate: 0.05,
  redemptionPercent: 90,
  salesPlan: 10,
  logisticsMode: "Авто",
  localShare: 0.5,
  clustersCount: "Считать без наценки",
  dispatchCluster: "Москва, МО и Дальние регионы",
  destinationCluster: "Москва, МО и Дальние регионы",
  currentPrice: 337000,
  discountPercent: 0.345,
  marketingPercent: 0,
  realFbsDeliveryCost: 500,
  realFbsReturnCost: 250,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 87000,
  extraExpensesPerUnit: 0,
  whitePurchase: true,
  incomingVatPurchase: false,
  incomingVatRate: 0,
};

const fitsCategories = (
  input: ProductInput,
  categories: Record<string, string[]>,
): ProductInput => {
  if (categories[input.category]?.includes(input.productType)) return input;
  const firstCategory = Object.keys(categories).sort()[0];
  if (!firstCategory) return input;
  const firstType = categories[firstCategory]?.[0] ?? input.productType;
  return { ...input, category: firstCategory, productType: firstType };
};

const uniqueArticleId = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
};

type TabId = "calc" | "finance" | "admin";

const BASE_TABS = [
  {
    id: "calc" as const,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Package size={16} /> Калькулятор
      </span>
    ),
  },
  {
    id: "finance" as const,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Wallet size={16} /> Финансы
      </span>
    ),
  },
];

const ADMIN_TAB = {
  id: "admin" as const,
  label: (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <ShieldCheck size={16} /> Админка
    </span>
  ),
};

export default function App() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const TABS = isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [refs, setRefs] = useState<References | null>(null);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const TAB_KEY = "ozon-calc.active-tab";
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      if (v === "calc" || v === "finance" || v === "admin") return v;
    } catch {
      /* ignore */
    }
    return "calc";
  });
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);
  // Если не-админ ранее был на "admin" и роль изменилась — откатить.
  useEffect(() => {
    if (activeTab === "admin" && !isAdmin) setActiveTab("calc");
  }, [activeTab, isAdmin]);
  const [channelFilter, setChannelFilter] = useState<FilterValue>("Все");
  const ACTIVE_ONLY_KEY = "ozon-calc.active-only";
  const [activeOnly, setActiveOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ACTIVE_ONLY_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_ONLY_KEY, activeOnly ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [activeOnly]);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Actuals comparison (Phase 4) — UI-state, persisted in localStorage so the
  // toggle and chosen period survive a page reload.
  const ACTUALS_KEY = "ozon-calc.actuals";
  const monthAgo = (): string => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  };
  const today = (): string => new Date().toISOString().slice(0, 10);
  const loadActuals = (): { showActuals: boolean; from: string; to: string } => {
    try {
      const raw = localStorage.getItem(ACTUALS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<{
          showActuals: boolean;
          from: string;
          to: string;
        }>;
        return {
          showActuals: !!p.showActuals,
          from: typeof p.from === "string" ? p.from : monthAgo(),
          to: typeof p.to === "string" ? p.to : today(),
        };
      }
    } catch {
      // ignore — fall through to defaults
    }
    return { showActuals: false, from: monthAgo(), to: today() };
  };
  const [showActuals, setShowActuals] = useState(() => loadActuals().showActuals);
  const [actualsFrom, setActualsFrom] = useState(() => loadActuals().from);
  const [actualsTo, setActualsTo] = useState(() => loadActuals().to);
  const [actualsByArticle, setActualsByArticle] = useState<
    Map<string, RealizedMarginRow>
  >(new Map());
  const [actualsLoading, setActualsLoading] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        ACTUALS_KEY,
        JSON.stringify({
          showActuals,
          from: actualsFrom,
          to: actualsTo,
        }),
      );
    } catch {
      // ignore — Safari private mode etc.
    }
  }, [showActuals, actualsFrom, actualsTo]);

  // Apply tweaks to root element via CSS variables / classes.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", tweaks.accentColor);
  }, [tweaks.accentColor]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark-header", tweaks.darkHeader);
  }, [tweaks.darkHeader]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "density-compact",
      tweaks.density === "compact",
    );
  }, [tweaks.density]);

  useEffect(() => {
    if (!showActuals) return;
    let cancelled = false;
    void (async () => {
      setActualsLoading(true);
      try {
        const resp = await api.analytics.realizedMargin({
          from: actualsFrom,
          to: actualsTo,
        });
        if (cancelled) return;
        const m = new Map<string, RealizedMarginRow>();
        for (const r of resp.rows) m.set(r.articleId, r);
        setActualsByArticle(m);
      } catch (e) {
        if (!cancelled) setActionError(`actuals: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setActualsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showActuals, actualsFrom, actualsTo]);

  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSettings = useRef<TaxSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [refsData, productList, settings] = await Promise.all([
          api.refs.get(),
          api.products.list(),
          api.settings.get(),
        ]);
        if (cancelled) return;
        const r: References = {
          commissions: refsData.commissions,
          storage: refsData.storage,
          logisticsTariffs: refsData.logisticsTariffs,
          logisticsSettings: (refsData as RefsResponse).logisticsSettings,
          logisticsClusterTariffs: refsData.logisticsClusterTariffs,
        };
        setRefs(r);
        setCategories(refsData.categories);
        setRows(productList);
        setTaxSettings(settings);
        lastSavedSettings.current = settings;
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Boot the auto-refresh timer once we know creds + settings exist on server.
  // The timer lives at module scope, so reload-survival is purely about reading
  // persisted config and arming it on each app load.
  useEffect(() => {
    void initAutoRefresh();
    const off = onAutoRefreshChange(() => {
      // Each tick / completion event triggers a product list refresh so the
      // table reflects whatever the auto-import just pulled.
      void refreshProducts();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!taxSettings) return;
    if (lastSavedSettings.current === taxSettings) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      const snapshot = taxSettings;
      api.settings
        .put(snapshot)
        .then(() => {
          lastSavedSettings.current = snapshot;
        })
        .catch((e: Error) => setActionError(`settings: ${e.message}`));
    }, 300);
    return () => {
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
    };
  }, [taxSettings]);

  const results = useMemo(() => {
    const map = new Map<string, RowResult>();
    if (!refs || !taxSettings) return map;
    for (const row of rows) {
      try {
        map.set(
          row.id,
          calculateRow(row.input, taxSettings, refs, {
            ozonCommissions: row.ozonCommissions ?? null,
          }),
        );
      } catch (e) {
        map.set(row.id, { error: (e as Error).message });
      }
    }
    return map;
  }, [rows, taxSettings, refs]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (row.input.articleId.toLowerCase().includes(q)) return true;
      if (row.input.productName.toLowerCase().includes(q)) return true;
      if (row.ozonSku != null && String(row.ozonSku).includes(q)) return true;
      return false;
    });
  }, [rows, searchQuery]);

  const addRow = async () => {
    const taken = new Set(rows.map((r) => r.input.articleId));
    const template = rows[rows.length - 1]?.input ?? COFFEE_DEFAULT;
    const fitted = fitsCategories(template, categories);
    const baseArticle = fitted.articleId || "NEW-001";
    const input: ProductInput = {
      ...fitted,
      articleId: uniqueArticleId(baseArticle, taken),
    };
    const tempId = `temp-${newId()}`;
    setRows((prev) => [...prev, { id: tempId, input }]);
    setSelectedId(tempId);
    try {
      const created = await api.products.create(input);
      setRows((prev) => prev.map((r) => (r.id === tempId ? created : r)));
      setSelectedId(created.id);
    } catch (e) {
      setRows((prev) => prev.filter((r) => r.id !== tempId));
      setSelectedId(null);
      setActionError(`add: ${(e as Error).message}`);
    }
  };

  const removeRow = async (id: string) => {
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (id.startsWith("temp-")) return;
    try {
      await api.products.remove(id);
    } catch (e) {
      setRows(snapshot);
      setActionError(`remove: ${(e as Error).message}`);
    }
  };

  const updateRow = async (id: string, next: ProductInput) => {
    const snapshot = rows;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, input: next } : r)));
    if (id.startsWith("temp-")) return;
    try {
      const updated = await api.products.update(id, next);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      setRows(snapshot);
      setActionError(`update: ${(e as Error).message}`);
    }
  };

  const refreshProducts = async () => {
    try {
      const list = await api.products.list();
      setRows(list);
    } catch (e) {
      setActionError(`refresh: ${(e as Error).message}`);
    }
  };

  const refreshRefs = async () => {
    try {
      const refsData = await api.refs.get();
      setRefs({
        commissions: refsData.commissions,
        storage: refsData.storage,
        logisticsTariffs: refsData.logisticsTariffs,
        logisticsSettings: refsData.logisticsSettings,
        logisticsClusterTariffs: refsData.logisticsClusterTariffs,
      });
      setCategories(refsData.categories);
    } catch (e) {
      setActionError(`refs: ${(e as Error).message}`);
    }
  };

  const selectedRow = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const selectedResult = selectedRow ? results.get(selectedRow.id) : undefined;

  if (isLoading) {
    return (
      <div className="app">
        <AppHeader accent={tweaks.accentColor} />
        <main className="main-content">
          <p className="muted">Загрузка…</p>
        </main>
      </div>
    );
  }

  if (loadError || !refs || !taxSettings) {
    return (
      <div className="app">
        <AppHeader accent={tweaks.accentColor} />
        <main className="main-content">
          <div className="card" style={{ borderColor: "#FFB3B3", background: "#FEEFEF" }}>
            <p>Не удалось загрузить данные с сервера: {loadError ?? "unknown"}</p>
            <p className="muted">
              Проверьте, что backend запущен и сессия не истекла.
              Попробуйте перелогиниться.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader accent={tweaks.accentColor} />
      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={setActiveTab}
        rightSlot={
          <button
            className="icon-button"
            onClick={() => setTweaksOpen((o) => !o)}
            title="Настройки оформления"
            aria-label="Tweaks"
          >
            <SettingsIcon size={18} />
          </button>
        }
      />

      <main className="main-content">
        {actionError && (
          <div className="error-panel">
            <span>Ошибка: {actionError}</span>
            <button className="btn-icon" onClick={() => setActionError(null)}>
              Закрыть
            </button>
          </div>
        )}

        {activeTab === "calc" && (
          <>

            <GlobalSettings
              value={taxSettings}
              onChange={setTaxSettings}
              onProductsRefresh={refreshProducts}
              onRefsRefresh={refreshRefs}
            />

            <section className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showActuals}
                  onChange={(e) => setShowActuals(e.target.checked)}
                />
                Сравнить с фактом за период
              </label>
              {showActuals && (
                <>
                  <label>
                    <span>С даты</span>
                    <input
                      type="date"
                      value={actualsFrom}
                      onChange={(e) => setActualsFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>По дату</span>
                    <input
                      type="date"
                      value={actualsTo}
                      onChange={(e) => setActualsTo(e.target.value)}
                    />
                  </label>
                  {actualsLoading ? (
                    <span className="muted">загружаем…</span>
                  ) : (
                    <span className="muted">
                      Артикулов с фактом:{" "}
                      <strong style={{ color: "var(--accent)" }}>{actualsByArticle.size}</strong>
                    </span>
                  )}
                </>
              )}
            </section>

            <div className="card">
              <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>
                Товары{" "}
                <span className="collapsible-badge" style={{ marginLeft: 4 }}>
                  {rows.length}
                </span>
              </h3>
              <ProductsTable
                rows={visibleRows}
                results={results}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAdd={addRow}
                onUpdate={updateRow}
                onRemove={removeRow}
                onImport={() => setImportOpen(true)}
                channelFilter={channelFilter}
                onChannelFilterChange={setChannelFilter}
                showChart={tweaks.showChart}
                actuals={showActuals ? actualsByArticle : undefined}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                totalRowsCount={rows.length}
                taxSettings={taxSettings}
                activeOnly={activeOnly}
                onActiveOnlyChange={setActiveOnly}
                breakdownMode={tweaks.breakdownMode}
              />
            </div>

            {selectedRow && selectedResult && (
              <ProductDrawer
                input={selectedRow.input}
                result={selectedResult}
                onChange={(next) => updateRow(selectedRow.id, next)}
                onClose={() => setSelectedId(null)}
                fromOzon={selectedRow.ozonProductId != null}
                ozonProductId={selectedRow.ozonProductId ?? null}
                ozonSku={selectedRow.ozonSku ?? null}
                onRefreshed={refreshProducts}
                taxSettings={taxSettings}
                refs={refs}
              />
            )}
          </>
        )}

        {activeTab === "finance" && (
          <FinanceTab
            onOpenArticle={(articleId) => {
              const row = rows.find((r) => r.input.articleId === articleId);
              if (row) {
                setSelectedId(row.id);
                setActiveTab("calc");
              } else {
                setActionError(
                  `Товар с артикулом «${articleId}» не найден в локальном каталоге. Запусти импорт каталога или добавь товар вручную.`,
                );
              }
            }}
          />
        )}

        {activeTab === "admin" && isAdmin && <AdminPage />}
      </main>

      {importOpen && (
        <OzonImportModal
          onClose={() => setImportOpen(false)}
          onImported={refreshProducts}
        />
      )}

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        tweaks={tweaks}
        setTweak={setTweak}
      />
    </div>
  );
}
