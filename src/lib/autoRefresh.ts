import { api } from "../api";

export interface AutoRefreshConfig {
  enabled: boolean;
  intervalMin: number;
}

interface ShopState extends AutoRefreshConfig {
  timer: ReturnType<typeof setInterval> | null;
  lastRunAt: number | null;
  lastError: string | null;
}

const byShop = new Map<number, ShopState>();

const EVENT_NAME = "catalog-auto-refreshed";

const dispatchUpdate = (shopId: number) => {
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, { detail: { shopId } }),
  );
};

const ensure = (shopId: number): ShopState => {
  let s = byShop.get(shopId);
  if (!s) {
    s = {
      enabled: false,
      intervalMin: 30,
      timer: null,
      lastRunAt: null,
      lastError: null,
    };
    byShop.set(shopId, s);
  }
  return s;
};

const stop = (shopId: number) => {
  const s = byShop.get(shopId);
  if (s?.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
};

const tick = (shopId: number) => {
  const s = ensure(shopId);
  s.lastRunAt = Date.now();
  s.lastError = null;
  dispatchUpdate(shopId);
  void api.import
    .startCatalog(shopId)
    .then(({ runId }) => {
      const t = setInterval(async () => {
        try {
          const r = await api.import.getRun(runId);
          if (r.status !== "running") {
            clearInterval(t);
            if (r.status === "ok") dispatchUpdate(shopId);
            else {
              s.lastError = r.errorMessage ?? "import failed";
              dispatchUpdate(shopId);
            }
          }
        } catch (e) {
          clearInterval(t);
          s.lastError = (e as Error).message;
          dispatchUpdate(shopId);
        }
      }, 2000);
    })
    .catch((e: Error) => {
      s.lastError = e.message;
      dispatchUpdate(shopId);
    });
};

const arm = (shopId: number) => {
  stop(shopId);
  const s = ensure(shopId);
  if (!s.enabled) return;
  const ms = Math.max(1, s.intervalMin) * 60_000;
  s.timer = setInterval(() => tick(shopId), ms);
};

/** Read auto-refresh config from server for each shop and arm timers.
 * Idempotent — re-call when the user creates/deletes a shop. */
export async function initAutoRefresh(shopIds: number[]): Promise<void> {
  // Drop timers for shops that no longer exist.
  for (const id of [...byShop.keys()]) {
    if (!shopIds.includes(id)) {
      stop(id);
      byShop.delete(id);
    }
  }
  await Promise.all(
    shopIds.map(async (shopId) => {
      try {
        const cfg = await api.settings.getAutoRefresh(shopId);
        const s = ensure(shopId);
        s.enabled = cfg.enabled;
        s.intervalMin = cfg.intervalMin;
        arm(shopId);
        dispatchUpdate(shopId);
      } catch {
        // Server unreachable for this shop — leave defaults (disabled).
      }
    }),
  );
}

/** Persist new config to server for one shop, restart that shop's timer. */
export async function setAutoRefreshConfig(
  shopId: number,
  next: AutoRefreshConfig,
): Promise<void> {
  const saved = await api.settings.putAutoRefresh(next, shopId);
  const s = ensure(shopId);
  s.enabled = saved.enabled;
  s.intervalMin = saved.intervalMin;
  arm(shopId);
  dispatchUpdate(shopId);
}

export interface AutoRefreshSnapshot {
  enabled: boolean;
  intervalMin: number;
  lastRunAt: number | null;
  lastError: string | null;
}

export function getAutoRefreshState(shopId: number): AutoRefreshSnapshot {
  const s = byShop.get(shopId);
  return {
    enabled: s?.enabled ?? false,
    intervalMin: s?.intervalMin ?? 30,
    lastRunAt: s?.lastRunAt ?? null,
    lastError: s?.lastError ?? null,
  };
}

/** Subscribe to state changes. Callback receives the shopId that changed. */
export function onAutoRefreshChange(
  cb: (shopId: number) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ shopId: number }>).detail;
    if (detail) cb(detail.shopId);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
