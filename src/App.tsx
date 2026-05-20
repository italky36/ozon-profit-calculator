import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShopSettings from "./components/ShopSettings";
import ProductsTable, { type RowResult } from "./components/ProductsTable";
import AppHeader from "./components/AppHeader";
import TabBar from "./components/TabBar";
import TweaksPanel from "./components/TweaksPanel";

const ProductDrawer = lazy(() => import("./components/ProductDrawer"));
const OzonImportModal = lazy(() => import("./components/OzonImportModal"));
const CostPriceImportModal = lazy(
  () => import("./components/CostPriceImportModal"),
);
const FinanceTab = lazy(() => import("./components/FinanceTab"));
const ShopsModal = lazy(() => import("./components/ShopsModal"));
const TeamPage = lazy(() => import("./components/TeamPage"));
const ChatPage = lazy(() => import("./components/chat/ChatPage"));
import { TWEAK_DEFAULTS, useTweaks } from "./lib/useTweaks";
import { useAuth } from "./contexts/useAuth";
import {
  MessageSquare,
  Package,
  Wallet,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import type { FilterValue } from "./components/ChannelFilter";
import { calculateRow } from "./lib/calc";
import type {
  OzonCommissions,
  ProductInput,
  ProductRow,
  References,
  TaxSettings,
} from "./types";
import { api, type RealizedMarginRow, type RefsResponse, type Shop } from "./api";
import { initAutoRefresh, onAutoRefreshChange } from "./lib/autoRefresh";

const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const SHOP_FILTER_KEY = "ozon-calc.shopFilter";
const loadShopFilter = (): Set<number> => {
  try {
    const raw = localStorage.getItem(SHOP_FILTER_KEY);
    if (!raw) return new Set();
    return new Set(
      raw
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0),
    );
  } catch {
    return new Set();
  }
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

type TabId = "calc" | "finance" | "team" | "chat";

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
  {
    id: "team" as const,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Users size={16} /> Команда
      </span>
    ),
  },
  {
    id: "chat" as const,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <MessageSquare size={16} /> Чат
      </span>
    ),
  },
];

export default function App() {
  const { user } = useAuth();
  const TABS = BASE_TABS;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [refs, setRefs] = useState<References | null>(null);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState<number | null>(null);
  /** Пустой Set означает «Все магазины». */
  const [shopFilter, setShopFilter] = useState<Set<number>>(
    () => loadShopFilter(),
  );

  // Persist filter as comma-separated ids; clear key when empty.
  useEffect(() => {
    try {
      if (shopFilter.size === 0) {
        localStorage.removeItem(SHOP_FILTER_KEY);
      } else {
        localStorage.setItem(SHOP_FILTER_KEY, [...shopFilter].join(","));
      }
    } catch {
      /* ignore */
    }
  }, [shopFilter]);

  // When shops list changes (delete/rename), drop any stale ids from the filter.
  // Sync-to-external-state pattern: shops are owned by another source of truth
  // (server), and the filter set must reflect what currently exists.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShopFilter((cur) => {
      if (cur.size === 0) return cur;
      const validIds = new Set(shops.map((s) => s.id));
      const next = new Set([...cur].filter((id) => validIds.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [shops]);
  const [rows, setRows] = useState<ProductRow[]>([]);

  const activeShop = useMemo(
    () => shops.find((s) => s.id === activeShopId) ?? null,
    [shops, activeShopId],
  );

  useEffect(() => {
    if (activeShopId == null) return;
    localStorage.setItem("ozon-calc.activeShopId", String(activeShopId));
    void api.shops.setActive(activeShopId).catch(() => {
      // Best-effort sync — UI продолжит работать с local state.
    });
    // Refresh refs — cluster tariffs depend on the active shop's set.
    void api.refs.get(activeShopId).then((r) => {
      setRefs({
        commissions: r.commissions,
        storage: r.storage,
        logisticsTariffs: r.logisticsTariffs,
        logisticsSettings: (r as RefsResponse).logisticsSettings,
        logisticsClusterTariffs: r.logisticsClusterTariffs,
      });
    }).catch(() => {
      /* best-effort */
    });
  }, [activeShopId]);
  const taxByShop = useMemo(
    () => new Map(shops.map((s) => [s.id, s.taxSettings])),
    [shops],
  );
  const taxSettings: TaxSettings | null = activeShop?.taxSettings ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [costImportOpen, setCostImportOpen] = useState(false);
  const [shopsModalOpen, setShopsModalOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const TAB_KEY = "ozon-calc.active-tab";
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      if (v === "calc" || v === "finance" || v === "team" || v === "chat")
        return v;
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
  // One-shot signal: «when ChatPage mounts/refreshes, open a DM with this
  // user». Set from TeamPage's «Написать» button; ChatPage consumes and
  // clears via onConsumed below. Lives in App so it survives the tab
  // switch without unmounting ChatPage's existing state.
  const [pendingDmUserId, setPendingDmUserId] = useState<number | null>(null);
  const openDmWithUser = (userId: number) => {
    setPendingDmUserId(userId);
    setActiveTab("chat");
  };
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
        const [refsData, shopList] = await Promise.all([
          api.refs.get(),
          api.shops.list(),
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
        setShops(shopList);
        // Active shop: persisted localStorage (последний выбранный) или
        // первый в списке. Сервер не возвращает активный отдельно — у нас
        // user_settings.active_shop_id, но для UX достаточно localStorage,
        // и активный shopId дублируется на сервер при смене.
        const persisted = Number(localStorage.getItem("ozon-calc.activeShopId") ?? "");
        const initialActive =
          shopList.find((s) => s.id === persisted)?.id ??
          shopList[0]?.id ??
          null;
        setActiveShopId(initialActive);
        // Загружаем товары всех магазинов (для фильтра «Все»).
        const productList = await api.products.list();
        if (cancelled) return;
        setRows(productList);
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

  const refreshProducts = useCallback(async () => {
    try {
      const list = await api.products.list();
      setRows(list);
    } catch (e) {
      setActionError(`refresh: ${(e as Error).message}`);
    }
  }, []);

  // Boot auto-refresh timers per shop. Re-init whenever the shop list changes.
  useEffect(() => {
    if (shops.length === 0) return;
    void initAutoRefresh(shops.map((s) => s.id));
    const off = onAutoRefreshChange(() => {
      // Each tick / completion event triggers a product list refresh so the
      // table reflects whatever the auto-import just pulled.
      void refreshProducts();
    });
    return off;
  }, [shops, refreshProducts]);

  // Debounced PUT taxSettings of the active shop on change.
  useEffect(() => {
    if (!activeShop) return;
    if (lastSavedSettings.current === activeShop.taxSettings) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    const shopId = activeShop.id;
    const snapshot = activeShop.taxSettings;
    settingsTimer.current = setTimeout(() => {
      api.settings
        .put(snapshot, shopId)
        .then(() => {
          lastSavedSettings.current = snapshot;
        })
        .catch((e: Error) => setActionError(`settings: ${e.message}`));
    }, 300);
    return () => {
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
    };
  }, [activeShop]);

  // Per-row memoization: edit one row → only that row recomputes. Cache key
  // is reference identity of (input, tax, ozonCommissions, refs). When the row
  // object survives an Array.map, its `.input` reference is preserved and we
  // reuse the prior result; on edit, App.tsx replaces just that one row.
  // useState (vs useRef) so React Compiler treats this as plain state.
  const [cache] = useState(
    () =>
      new Map<
        string,
        {
          input: ProductInput;
          tax: TaxSettings;
          oz: OzonCommissions | null;
          refs: References;
          result: RowResult;
        }
      >(),
  );
  const results = useMemo(() => {
    const map = new Map<string, RowResult>();
    if (!refs) return map;
    const alive = new Set<string>();
    for (const row of rows) {
      alive.add(row.id);
      const tax = taxByShop.get(row.shopId);
      if (!tax) {
        map.set(row.id, { error: "магазин не найден" });
        continue;
      }
      const oz = row.ozonCommissions ?? null;
      const cached = cache.get(row.id);
      if (
        cached &&
        cached.input === row.input &&
        cached.tax === tax &&
        cached.oz === oz &&
        cached.refs === refs
      ) {
        map.set(row.id, cached.result);
        continue;
      }
      let result: RowResult;
      try {
        result = calculateRow(row.input, tax, refs, { ozonCommissions: oz });
      } catch (e) {
        result = { error: (e as Error).message };
      }
      cache.set(row.id, { input: row.input, tax, oz, refs, result });
      map.set(row.id, result);
    }
    // Evict entries for deleted rows so the cache doesn't grow unbounded.
    for (const id of cache.keys()) {
      if (!alive.has(id)) cache.delete(id);
    }
    return map;
  }, [rows, taxByShop, refs, cache]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let out = rows;
    if (shopFilter.size > 0) {
      out = out.filter((row) => shopFilter.has(row.shopId));
    }
    if (q) {
      out = out.filter((row) => {
        if (row.input.articleId.toLowerCase().includes(q)) return true;
        if (row.input.productName.toLowerCase().includes(q)) return true;
        if (row.ozonSku != null && String(row.ozonSku).includes(q)) return true;
        return false;
      });
    }
    return out;
  }, [rows, searchQuery, shopFilter]);

  const addRow = async () => {
    if (!activeShopId) {
      setActionError("add: no active shop");
      return;
    }
    const shopRows = rows.filter((r) => r.shopId === activeShopId);
    const taken = new Set(shopRows.map((r) => r.input.articleId));
    const template = shopRows[shopRows.length - 1]?.input ?? COFFEE_DEFAULT;
    const fitted = fitsCategories(template, categories);
    const baseArticle = fitted.articleId || "NEW-001";
    const input: ProductInput = {
      ...fitted,
      articleId: uniqueArticleId(baseArticle, taken),
    };
    const tempId = `temp-${newId()}`;
    setRows((prev) => [...prev, { id: tempId, shopId: activeShopId, input }]);
    setSelectedId(tempId);
    try {
      const created = await api.products.create(activeShopId, input);
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

  // Note: taxSettings is intentionally NOT required here. When the user has 0
  // assigned shops (typical right after joining a team via invite), activeShop
  // is undefined → taxSettings is null. That's not a load failure — the inner
  // tab UI handles it with a friendly «нет доступа к магазинам» card.
  if (loadError || !refs) {
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

        <div style={{ display: activeTab === "calc" ? undefined : "none" }}>

            {shops.length === 0 || !taxSettings ? (
              <div className="card" style={{ textAlign: "center", padding: 32 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
                  {user?.workspaceRole === "member"
                    ? "Owner ещё не дал вам доступ к магазинам"
                    : "У вас пока нет ни одного магазина"}
                </h3>
                <p className="muted" style={{ margin: "0 0 16px" }}>
                  {user?.workspaceRole === "member"
                    ? "Попросите owner или manager команды назначить вам магазин — после этого здесь появятся товары и расчёт прибыли. Откройте вкладку «Команда», чтобы увидеть, кто owner."
                    : user?.workspaceRole === "manager"
                      ? "Создайте свой магазин, чтобы начать импорт каталога и расчёт. Если у команды уже есть магазины — попросите владельца дать вам доступ."
                      : "Создайте первый магазин, чтобы начать импорт каталога и расчёт."}
                </p>
                {user?.workspaceRole !== "member" && (
                  <button
                    className="btn-primary"
                    onClick={() => setShopsModalOpen(true)}
                    style={{ padding: "8px 16px" }}
                  >
                    Создать магазин
                  </button>
                )}
              </div>
            ) : (
              <>
            <ShopSettings
              value={taxSettings}
              onChange={(next) => {
                if (!activeShopId) return;
                setShops((prev) =>
                  prev.map((s) =>
                    s.id === activeShopId ? { ...s, taxSettings: next } : s,
                  ),
                );
              }}
              onProductsRefresh={refreshProducts}
              onRefsRefresh={refreshRefs}
              shopId={activeShopId}
              shopName={activeShop?.name ?? null}
              shopColor={activeShop?.color ?? null}
              currentTariffSetId={activeShop?.tariffSetId ?? null}
              userIsAdmin={false}
              shopIsOwner={activeShop?.isOwner ?? true}
              shopHasOverrides={activeShop?.hasOverrides ?? false}
              allShops={shops}
              onActiveShopChange={setActiveShopId}
              onManageShops={() => setShopsModalOpen(true)}
              onResetOverrides={async () => {
                const freshShops = await api.shops.list();
                setShops(freshShops);
              }}
              onTariffChanged={async () => {
                // Reload shops (to pick up new tariffSetId) and refs (active
                // tariff rows attached to /api/refs response).
                const [freshShops] = await Promise.all([
                  api.shops.list(),
                  refreshRefs(),
                ]);
                setShops(freshShops);
              }}
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
                onImportCostPrice={() => setCostImportOpen(true)}
                onProductsRefresh={refreshProducts}
                channelFilter={channelFilter}
                onChannelFilterChange={setChannelFilter}
                showChart={tweaks.showChart}
                actuals={showActuals ? actualsByArticle : undefined}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                totalRowsCount={rows.length}
                taxSettings={taxSettings ?? undefined}
                activeOnly={activeOnly}
                onActiveOnlyChange={setActiveOnly}
                breakdownMode={tweaks.breakdownMode}
                shopsById={new Map(shops.map((s) => [s.id, s]))}
                shopsForFilter={shops}
                shopFilter={shopFilter}
                onShopFilterChange={setShopFilter}
              />
            </div>

            {selectedRow && selectedResult && activeTab === "calc" && (
              <Suspense fallback={null}>
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
              </Suspense>
            )}
              </>
            )}
        </div>


        {activeTab === "finance" && (
          <Suspense fallback={<p className="muted">Загрузка…</p>}>
            <FinanceTab
              shops={shops}
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
          </Suspense>
        )}

        {activeTab === "team" && (
          <Suspense fallback={<p className="muted">Загрузка…</p>}>
            <TeamPage onOpenDm={openDmWithUser} />
          </Suspense>
        )}

        {activeTab === "chat" && (
          <Suspense fallback={<p className="muted">Загрузка…</p>}>
            <ChatPage
              pendingDmUserId={pendingDmUserId}
              onDmConsumed={() => setPendingDmUserId(null)}
            />
          </Suspense>
        )}
      </main>

      {shopsModalOpen && (
        <Suspense fallback={null}>
          <ShopsModal
            shops={shops}
            activeShopId={activeShopId}
            onClose={() => setShopsModalOpen(false)}
            onChanged={(next) => {
              setShops(next);
              // If active shop got removed, fall back to first.
              if (
                activeShopId !== null &&
                !next.find((s) => s.id === activeShopId)
              ) {
                setActiveShopId(next[0]?.id ?? null);
              }
            }}
          />
        </Suspense>
      )}

      {importOpen && shops.length > 0 && (
        <Suspense fallback={null}>
          <OzonImportModal
            shops={shops}
            onClose={() => setImportOpen(false)}
            onImported={refreshProducts}
          />
        </Suspense>
      )}

      {costImportOpen && (
        <Suspense fallback={null}>
          <CostPriceImportModal
            onClose={() => setCostImportOpen(false)}
            onImported={refreshProducts}
          />
        </Suspense>
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
