import type {
  LogisticsSettings,
  LogisticsTariffRow,
  LogisticsClusterTariffRow,
  ClustersCount,
  LogisticsMode,
} from "../../types";
import { clamp } from "./pricing";

/** Точная per-cluster-pair логистика. Берёт строку с максимальным
 * `volumeFrom ≤ volumeL` для пары (from, to). Если пара/объём не покрыты,
 * возвращает null — caller должен fallback'нуть на другую формулу. */
export const findClusterTariff = (
  rows: LogisticsClusterTariffRow[] | undefined,
  volumeL: number,
  fromCluster: string,
  toCluster: string,
  promoPrice: number,
): number | null => {
  if (!rows || rows.length === 0) return null;
  const from = (fromCluster ?? "").trim();
  const to = (toCluster ?? "").trim();
  const vol = Number(volumeL);
  if (!Number.isFinite(vol)) return null;
  let best: LogisticsClusterTariffRow | null = null;
  let bestVol = -Infinity;
  for (const r of rows) {
    if ((r.fromCluster ?? "").trim() !== from) continue;
    if ((r.toCluster ?? "").trim() !== to) continue;
    const rv = Number(r.volumeFrom);
    if (!Number.isFinite(rv) || rv > vol) continue;
    if (rv > bestVol) {
      best = r;
      bestVol = rv;
    }
  }
  if (!best) return null;
  return promoPrice < 300
    ? Number(best.tariffLte300)
    : Number(best.tariffGt300);
};

export const findTariff = (
  rows: LogisticsTariffRow[],
  volumeL: number,
): LogisticsTariffRow => {
  const found = rows.find((r) => volumeL >= r.volumeFrom && volumeL <= r.volumeTo);
  if (found) return found;
  // Fallback: largest bucket if over the table, smallest if under
  const sorted = [...rows].sort((a, b) => a.volumeFrom - b.volumeFrom);
  if (volumeL > sorted[sorted.length - 1].volumeTo) return sorted[sorted.length - 1];
  return sorted[0];
};

export const nonLocalShareOf = (
  mode: LogisticsMode,
  localShare: number,
  clustersCount: ClustersCount,
  settings: LogisticsSettings,
): number => {
  if (mode === "По доле локальных") {
    return 1 - clamp(localShare, 0, 1);
  }
  // Авто
  if (typeof clustersCount === "number") {
    return 1 - clustersCount / settings.totalDeliveryClusters;
  }
  return 1 - 1 / settings.totalDeliveryClusters;
};

export const markupShareOf = (
  mode: LogisticsMode,
  nonLocalShare: number,
  clustersCount: ClustersCount,
  settings: LogisticsSettings,
): number => {
  if (mode === "По доле локальных") {
    return nonLocalShare * settings.markupClusterShare;
  }
  if (clustersCount === "Считать без наценки" || clustersCount === 26) return 0;
  return nonLocalShare * settings.markupClusterShare;
};

export interface LogisticsResult {
  baseDelivery: number;
  baseLocal: number;
  baseNonLocal: number;
  logisticsFbo: number;
  logisticsFbs: number;
  markupFbo: number;
}

export const calcLogistics = (
  promoPrice: number,
  volumeL: number,
  mode: LogisticsMode,
  localShare: number,
  clustersCount: ClustersCount,
  tariffs: LogisticsTariffRow[],
  settings: LogisticsSettings,
): LogisticsResult => {
  const tariff = findTariff(tariffs, volumeL);
  const baseLocal = promoPrice <= 300 ? tariff.localUpTo300 : tariff.localOver300;
  const baseNonLocal = promoPrice <= 300 ? tariff.nonLocalUpTo300 : tariff.nonLocalOver300;
  const nlShare = nonLocalShareOf(mode, localShare, clustersCount, settings);
  const mkShare = markupShareOf(mode, nlShare, clustersCount, settings);
  const baseDelivery = baseNonLocal * nlShare + baseLocal * (1 - nlShare);
  const markupFbo = promoPrice * settings.typicalMarkupRate * mkShare;
  return {
    baseDelivery,
    baseLocal,
    baseNonLocal,
    logisticsFbo: baseDelivery + markupFbo,
    logisticsFbs: baseDelivery,
    markupFbo,
  };
};

export const lastMileOf = (promoPrice: number): number =>
  Math.min(promoPrice * 0.01, 25);
