import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  logisticsClusterTariffSets,
  logisticsClusterTariffs,
  shops,
  shopUserSettings,
} from "../db/schema";
import type { DB } from "../db/client";

export interface ClusterTariffRow {
  volumeFrom: number;
  fromCluster: string;
  toCluster: string;
  tariffLte300: number;
  tariffGt300: number;
}

/** Returns the tariff-set to apply for a (shop, user) pair. Priority:
 *   1) shop_user_settings.tariff_set_id override (per-user, if present);
 *   2) shops.tariff_set_id pinned by workspace owner/manager;
 *   3) latest global set by uploaded_at;
 *   4) null when there are no sets at all.
 *
 * If a pinned set points at another workspace's personal set (would only
 * happen via direct DB write — the upload route blocks it), fall through to
 * the next tier.
 */
export async function resolveTariffSetId(
  db: DB,
  shopId: number,
  userId?: number,
): Promise<number | null> {
  const [shop] = await db
    .select({ tariffSetId: shops.tariffSetId, workspaceId: shops.workspaceId })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop) return null;

  // 1. Per-user override.
  if (userId !== undefined) {
    const [override] = await db
      .select({ tariffSetId: shopUserSettings.tariffSetId })
      .from(shopUserSettings)
      .where(
        and(
          eq(shopUserSettings.shopId, shopId),
          eq(shopUserSettings.userId, userId),
        ),
      );
    if (override?.tariffSetId != null) {
      const [chosen] = await db
        .select({ id: logisticsClusterTariffSets.id })
        .from(logisticsClusterTariffSets)
        .where(
          and(
            eq(logisticsClusterTariffSets.id, override.tariffSetId),
            or(
              isNull(logisticsClusterTariffSets.workspaceId),
              eq(logisticsClusterTariffSets.workspaceId, shop.workspaceId),
            ),
          ),
        );
      if (chosen) return chosen.id;
    }
  }

  // 2. Shop default.
  if (shop.tariffSetId !== null) {
    const [chosen] = await db
      .select({ id: logisticsClusterTariffSets.id })
      .from(logisticsClusterTariffSets)
      .where(
        and(
          eq(logisticsClusterTariffSets.id, shop.tariffSetId),
          or(
            isNull(logisticsClusterTariffSets.workspaceId),
            eq(logisticsClusterTariffSets.workspaceId, shop.workspaceId),
          ),
        ),
      );
    if (chosen) return chosen.id;
  }

  // 3. Latest global.
  const [latestGlobal] = await db
    .select({ id: logisticsClusterTariffSets.id })
    .from(logisticsClusterTariffSets)
    .where(isNull(logisticsClusterTariffSets.workspaceId))
    .orderBy(desc(logisticsClusterTariffSets.uploadedAt))
    .limit(1);
  return latestGlobal?.id ?? null;
}

/** Returns the rows of the resolved tariff set for a (shop, user) pair,
 * ordered by volumeFrom. Empty array if no set is available. */
export async function loadActiveTariffRows(
  db: DB,
  shopId: number,
  userId?: number,
): Promise<ClusterTariffRow[]> {
  const setId = await resolveTariffSetId(db, shopId, userId);
  if (!setId) return [];
  const rows = await db
    .select()
    .from(logisticsClusterTariffs)
    .where(eq(logisticsClusterTariffs.setId, setId));
  return rows
    .map((r) => ({
      volumeFrom: r.volumeFrom,
      fromCluster: r.fromCluster,
      toCluster: r.toCluster,
      tariffLte300: r.tariffLte300,
      tariffGt300: r.tariffGt300,
    }))
    .sort((a, b) => a.volumeFrom - b.volumeFrom);
}
