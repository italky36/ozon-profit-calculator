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

export type TariffKind = "regular" | "kgt";

/** Returns the tariff-set to apply for a (shop, user) pair. Priority:
 *   1) shop_user_settings.tariff_set_id (or kgt_*) override (per-user);
 *   2) shops.tariff_set_id (or kgt_*) pinned by workspace owner/manager;
 *   3) latest global set by uploaded_at — только для regular; для kgt
 *      global fallback не делаем (NULL = «KGT-сетка не настроена»);
 *   4) null when no sets are available.
 *
 * If a pinned set points at another workspace's personal set (would only
 * happen via direct DB write — the upload route blocks it), fall through to
 * the next tier. Также набор проверяется на соответствие `kind` —
 * случайно или вручную привязанный set другого вида игнорируется.
 */
export async function resolveTariffSetId(
  db: DB,
  shopId: number,
  userId?: number,
  kind: TariffKind = "regular",
): Promise<number | null> {
  const [shop] = await db
    .select({
      tariffSetId: shops.tariffSetId,
      kgtTariffSetId: shops.kgtTariffSetId,
      workspaceId: shops.workspaceId,
    })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop) return null;

  const shopSetId = kind === "kgt" ? shop.kgtTariffSetId : shop.tariffSetId;

  // 1. Per-user override.
  if (userId !== undefined) {
    const [override] = await db
      .select({
        tariffSetId: shopUserSettings.tariffSetId,
        kgtTariffSetId: shopUserSettings.kgtTariffSetId,
      })
      .from(shopUserSettings)
      .where(
        and(
          eq(shopUserSettings.shopId, shopId),
          eq(shopUserSettings.userId, userId),
        ),
      );
    const overrideSetId =
      kind === "kgt" ? override?.kgtTariffSetId : override?.tariffSetId;
    if (overrideSetId != null) {
      const [chosen] = await db
        .select({ id: logisticsClusterTariffSets.id })
        .from(logisticsClusterTariffSets)
        .where(
          and(
            eq(logisticsClusterTariffSets.id, overrideSetId),
            eq(logisticsClusterTariffSets.kind, kind),
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
  if (shopSetId != null) {
    const [chosen] = await db
      .select({ id: logisticsClusterTariffSets.id })
      .from(logisticsClusterTariffSets)
      .where(
        and(
          eq(logisticsClusterTariffSets.id, shopSetId),
          eq(logisticsClusterTariffSets.kind, kind),
          or(
            isNull(logisticsClusterTariffSets.workspaceId),
            eq(logisticsClusterTariffSets.workspaceId, shop.workspaceId),
          ),
        ),
      );
    if (chosen) return chosen.id;
  }

  // 3. Для regular — latest global. Для KGT global fallback не делаем —
  //    NULL значит «нет KGT-сетки», calc-engine откатится на табличный
  //    логистический lookup.
  if (kind === "regular") {
    const [latestGlobal] = await db
      .select({ id: logisticsClusterTariffSets.id })
      .from(logisticsClusterTariffSets)
      .where(
        and(
          isNull(logisticsClusterTariffSets.workspaceId),
          eq(logisticsClusterTariffSets.kind, "regular"),
        ),
      )
      .orderBy(desc(logisticsClusterTariffSets.uploadedAt))
      .limit(1);
    return latestGlobal?.id ?? null;
  }
  return null;
}

/** Returns the rows of the resolved tariff set for a (shop, user) pair,
 * ordered by volumeFrom. Empty array if no set is available. */
export async function loadActiveTariffRows(
  db: DB,
  shopId: number,
  userId?: number,
  kind: TariffKind = "regular",
): Promise<ClusterTariffRow[]> {
  const setId = await resolveTariffSetId(db, shopId, userId, kind);
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
