import { api } from "../api";

export interface AutoRefreshConfig {
  enabled: boolean;
  intervalMin: number;
}

interface State extends AutoRefreshConfig {
  timer: ReturnType<typeof setInterval> | null;
  lastRunAt: number | null;
  lastError: string | null;
}

const state: State = {
  enabled: false,
  intervalMin: 30,
  timer: null,
  lastRunAt: null,
  lastError: null,
};

const EVENT_NAME = "catalog-auto-refreshed";

const dispatchUpdate = () => {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
};

const stop = () => {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
};

const tick = () => {
  state.lastRunAt = Date.now();
  state.lastError = null;
  dispatchUpdate();
  void api.import
    .startCatalog()
    .then(({ runId }) => {
      const t = setInterval(async () => {
        try {
          const r = await api.import.getRun(runId);
          if (r.status !== "running") {
            clearInterval(t);
            if (r.status === "ok") dispatchUpdate();
            else {
              state.lastError = r.errorMessage ?? "import failed";
              dispatchUpdate();
            }
          }
        } catch (e) {
          clearInterval(t);
          state.lastError = (e as Error).message;
          dispatchUpdate();
        }
      }, 2000);
    })
    .catch((e: Error) => {
      state.lastError = e.message;
      dispatchUpdate();
    });
};

const arm = () => {
  stop();
  if (!state.enabled) return;
  const ms = Math.max(1, state.intervalMin) * 60_000;
  state.timer = setInterval(tick, ms);
};

/** Idempotent: read settings from server and set up timer. Call once on app boot. */
export async function initAutoRefresh(): Promise<void> {
  try {
    const cfg = await api.settings.getAutoRefresh();
    state.enabled = cfg.enabled;
    state.intervalMin = cfg.intervalMin;
    arm();
    dispatchUpdate();
  } catch {
    // Server unreachable — leave defaults (disabled).
  }
}

/** Persist new config to server, restart timer. */
export async function setAutoRefreshConfig(
  next: AutoRefreshConfig,
): Promise<void> {
  const saved = await api.settings.putAutoRefresh(next);
  state.enabled = saved.enabled;
  state.intervalMin = saved.intervalMin;
  arm();
  dispatchUpdate();
}

export function getAutoRefreshState(): {
  enabled: boolean;
  intervalMin: number;
  lastRunAt: number | null;
  lastError: string | null;
} {
  return {
    enabled: state.enabled,
    intervalMin: state.intervalMin,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
  };
}

/** Subscribe to state changes (settings updated, tick fired, run finished). */
export function onAutoRefreshChange(cb: () => void): () => void {
  window.addEventListener(EVENT_NAME, cb);
  return () => window.removeEventListener(EVENT_NAME, cb);
}
