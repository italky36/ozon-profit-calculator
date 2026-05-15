import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type CredentialsStatus } from "../api";

export type MultiImportKind = "catalog" | "finance";

export type ShopRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "ok"
  | "error"
  | "skipped";

export interface ShopRunState {
  runId: number | null;
  status: ShopRunStatus;
  itemsProcessed: number;
  errorMessage: string | null;
  params: Record<string, unknown> | null;
}

export interface UseMultiShopImportOptions {
  kind: MultiImportKind;
  /** Required when kind === "finance". */
  financeParams?: { from: string; to: string };
  /** Fired after each shop's run resolves to "ok". Use for incremental refresh. */
  onShopDone?: (shopId: number) => void;
}

interface BucketState {
  queue: number[];
  active: number | null;
}

// Each shop has its own Ozon key now (no global/env fallback), so every shop
// is its own bucket — imports run in parallel. Shops without their own key
// return null and are skipped.
function bucketKeyFor(creds: CredentialsStatus | undefined): string | null {
  if (!creds || !creds.hasCredentials) return null;
  return `shop:${creds.shopId}`;
}

export function useMultiShopImport(options: UseMultiShopImportOptions) {
  const { kind, financeParams, onShopDone } = options;

  const [credsByShop, setCredsByShop] = useState<Map<number, CredentialsStatus>>(
    () => new Map(),
  );
  const [credsLoading, setCredsLoading] = useState(true);
  const [credsError, setCredsError] = useState<string | null>(null);

  // Mutate refs directly; expose a tear-free snapshot to React via
  // useSyncExternalStore. tick() recomputes the snapshot and notifies
  // subscribers — this coalesces many ref mutations per poll tick into a
  // single render without the "read refs during render" anti-pattern.
  const runsRef = useRef<Map<number, ShopRunState>>(new Map());
  const bucketsRef = useRef<Map<string, BucketState>>(new Map());
  const bucketOfRef = useRef<Map<number, string>>(new Map());
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  interface Snapshot {
    runs: Map<number, ShopRunState>;
    phase: "idle" | "running" | "done";
  }
  const listenersRef = useRef<Set<() => void>>(new Set());
  const snapshotRef = useRef<Snapshot>({ runs: new Map(), phase: "idle" });
  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const tick = useCallback(() => {
    const runs = new Map(runsRef.current);
    let phase: Snapshot["phase"] = "idle";
    if (runs.size > 0) {
      const anyActive = [...runs.values()].some(
        (r) =>
          r.status === "queued" ||
          r.status === "starting" ||
          r.status === "running",
      );
      phase = anyActive ? "running" : "done";
    }
    snapshotRef.current = { runs, phase };
    for (const cb of listenersRef.current) cb();
  }, []);

  const financeParamsRef = useRef(financeParams);
  const onShopDoneRef = useRef(onShopDone);
  const credsByShopRef = useRef(credsByShop);
  useEffect(() => {
    financeParamsRef.current = financeParams;
  });
  useEffect(() => {
    onShopDoneRef.current = onShopDone;
  });
  useEffect(() => {
    credsByShopRef.current = credsByShop;
  });

  // Indirection ref to break the advanceBucket ↔ startOne cycle.
  const startOneRef = useRef<(shopId: number) => Promise<void>>(
    () => Promise.resolve(),
  );

  useEffect(() => {
    let cancelled = false;
    api.credentials
      .statusAll()
      .then((data) => {
        if (cancelled) return;
        setCredsByShop(new Map(data.shops.map((s) => [s.shopId, s])));
        setCredsLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setCredsError(e.message);
        setCredsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
      pollerRef.current = null;
    };
  }, []);

  const advanceBucket = useCallback((bucketKey: string | undefined) => {
    if (!bucketKey) return;
    const bucket = bucketsRef.current.get(bucketKey);
    if (!bucket) return;
    bucket.active = null;
    const nextId = bucket.queue.shift();
    if (nextId == null) return;
    bucket.active = nextId;
    void startOneRef.current(nextId);
  }, []);

  const ensurePoller = useCallback(() => {
    if (pollerRef.current) return;
    pollerRef.current = setInterval(async () => {
      const runningEntries = [...runsRef.current.entries()].filter(
        ([, r]) => r.status === "running" && r.runId != null,
      );
      if (runningEntries.length === 0) {
        const stillBusy = [...bucketsRef.current.values()].some(
          (b) => b.queue.length > 0 || b.active !== null,
        );
        if (!stillBusy) {
          if (pollerRef.current) clearInterval(pollerRef.current);
          pollerRef.current = null;
        }
        return;
      }
      const results = await Promise.allSettled(
        runningEntries.map(([, r]) => api.import.getRun(r.runId as number)),
      );
      for (let i = 0; i < runningEntries.length; i++) {
        const [shopId, state] = runningEntries[i];
        const res = results[i];
        if (res.status === "rejected") {
          runsRef.current.set(shopId, {
            ...state,
            status: "error",
            errorMessage: (res.reason as Error).message,
          });
          advanceBucket(bucketOfRef.current.get(shopId));
          continue;
        }
        const d = res.value;
        if (d.status === "running") {
          runsRef.current.set(shopId, {
            ...state,
            itemsProcessed: d.itemsProcessed,
          });
        } else if (d.status === "ok") {
          runsRef.current.set(shopId, {
            ...state,
            status: "ok",
            itemsProcessed: d.itemsProcessed,
            params: d.params,
          });
          try {
            onShopDoneRef.current?.(shopId);
          } catch {
            /* ignore consumer errors */
          }
          advanceBucket(bucketOfRef.current.get(shopId));
        } else {
          runsRef.current.set(shopId, {
            ...state,
            status: "error",
            errorMessage: d.errorMessage ?? "import failed",
            params: d.params,
          });
          advanceBucket(bucketOfRef.current.get(shopId));
        }
      }
      tick();
    }, 1000);
  }, [advanceBucket, tick]);

  const startOne = useCallback(
    async (shopId: number) => {
      const cur = runsRef.current.get(shopId);
      if (!cur) return;
      runsRef.current.set(shopId, { ...cur, status: "starting" });
      tick();
      try {
        const { runId } =
          kind === "catalog"
            ? await api.import.startCatalog(shopId)
            : await api.import.startFinance({
                from: financeParamsRef.current!.from,
                to: financeParamsRef.current!.to,
                shopId,
              });
        runsRef.current.set(shopId, {
          runId,
          status: "running",
          itemsProcessed: 0,
          errorMessage: null,
          params: null,
        });
        tick();
        ensurePoller();
      } catch (e) {
        runsRef.current.set(shopId, {
          runId: null,
          status: "error",
          itemsProcessed: 0,
          errorMessage: (e as Error).message,
          params: null,
        });
        tick();
        advanceBucket(bucketOfRef.current.get(shopId));
      }
    },
    [advanceBucket, ensurePoller, kind, tick],
  );
  useEffect(() => {
    startOneRef.current = startOne;
  });

  const enqueue = useCallback((shopId: number) => {
    const creds = credsByShopRef.current.get(shopId);
    const bucket = bucketKeyFor(creds);
    if (bucket === null) {
      runsRef.current.set(shopId, {
        runId: null,
        status: "skipped",
        itemsProcessed: 0,
        errorMessage: "Нет ключей API",
        params: null,
      });
      return;
    }
    bucketOfRef.current.set(shopId, bucket);
    if (!bucketsRef.current.has(bucket)) {
      bucketsRef.current.set(bucket, { queue: [], active: null });
    }
    const b = bucketsRef.current.get(bucket) as BucketState;
    runsRef.current.set(shopId, {
      runId: null,
      status: "queued",
      itemsProcessed: 0,
      errorMessage: null,
      params: null,
    });
    if (b.active === null) {
      b.active = shopId;
      void startOneRef.current(shopId);
    } else {
      b.queue.push(shopId);
    }
  }, []);

  const start = useCallback(
    (shopIds: number[]) => {
      runsRef.current = new Map();
      bucketsRef.current = new Map();
      bucketOfRef.current = new Map();
      for (const id of shopIds) enqueue(id);
      tick();
    },
    [enqueue, tick],
  );

  const retry = useCallback(
    (shopId: number) => {
      const cur = runsRef.current.get(shopId);
      if (!cur) return;
      if (cur.status !== "error" && cur.status !== "skipped") return;
      enqueue(shopId);
      tick();
    },
    [enqueue, tick],
  );

  const reset = useCallback(() => {
    runsRef.current = new Map();
    bucketsRef.current = new Map();
    bucketOfRef.current = new Map();
    if (pollerRef.current) clearInterval(pollerRef.current);
    pollerRef.current = null;
    tick();
  }, [tick]);

  return {
    credsByShop,
    credsLoading,
    credsError,
    runsByShop: snapshot.runs,
    phase: snapshot.phase,
    start,
    retry,
    reset,
  } as const;
}
