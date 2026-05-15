import { and, eq } from "drizzle-orm";
import { shops, shopUserSettings } from "../db/schema";
import type { DB } from "../db/client";
import type { TaxSettings } from "../../src/types";

export interface EffectiveShopSettings {
  taxSettings: TaxSettings;
  tariffSetId: number | null;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMin: number;
}

/** Resolve effective per-(shop, user) settings. Each field independently:
 *   1) `shop_user_settings.<field>` if non-null (user override);
 *   2) `shops.<field>` otherwise (shop default).
 *
 * Used by `calculateRow` callers, refs endpoint (tariff selection), and the
 * auto-refresh timer registry. */
export async function resolveShopSettings(
  db: DB,
  shopId: number,
  userId: number,
): Promise<EffectiveShopSettings | null> {
  const [shop] = await db
    .select({
      taxSettings: shops.taxSettings,
      tariffSetId: shops.tariffSetId,
      autoRefreshEnabled: shops.autoRefreshEnabled,
      autoRefreshIntervalMin: shops.autoRefreshIntervalMin,
    })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop) return null;

  const [override] = await db
    .select()
    .from(shopUserSettings)
    .where(
      and(
        eq(shopUserSettings.shopId, shopId),
        eq(shopUserSettings.userId, userId),
      ),
    );

  return {
    taxSettings: override?.taxSettings ?? shop.taxSettings,
    tariffSetId:
      override?.tariffSetId ?? shop.tariffSetId,
    autoRefreshEnabled:
      override?.autoRefreshEnabled ?? shop.autoRefreshEnabled,
    autoRefreshIntervalMin:
      override?.autoRefreshIntervalMin ?? shop.autoRefreshIntervalMin,
  };
}

export interface ShopUserSettingsPatch {
  taxSettings?: TaxSettings | null;
  tariffSetId?: number | null;
  autoRefreshEnabled?: boolean | null;
  autoRefreshIntervalMin?: number | null;
}

/** Insert or update the user's override row. Pass `null` for a field to clear
 * that single override (inherit shop default again). */
export async function upsertShopUserSettings(
  db: DB,
  shopId: number,
  userId: number,
  patch: ShopUserSettingsPatch,
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select({ shopId: shopUserSettings.shopId })
    .from(shopUserSettings)
    .where(
      and(
        eq(shopUserSettings.shopId, shopId),
        eq(shopUserSettings.userId, userId),
      ),
    );
  if (existing) {
    await db
      .update(shopUserSettings)
      .set({ ...patch, updatedAt: now })
      .where(
        and(
          eq(shopUserSettings.shopId, shopId),
          eq(shopUserSettings.userId, userId),
        ),
      );
  } else {
    await db.insert(shopUserSettings).values({
      shopId,
      userId,
      taxSettings: patch.taxSettings ?? null,
      tariffSetId: patch.tariffSetId ?? null,
      autoRefreshEnabled: patch.autoRefreshEnabled ?? null,
      autoRefreshIntervalMin: patch.autoRefreshIntervalMin ?? null,
      updatedAt: now,
    });
  }
}

/** Drop the entire per-user override row for a shop. After this call,
 * `resolveShopSettings` returns shop defaults for every field. */
export async function clearShopUserSettings(
  db: DB,
  shopId: number,
  userId: number,
): Promise<void> {
  await db
    .delete(shopUserSettings)
    .where(
      and(
        eq(shopUserSettings.shopId, shopId),
        eq(shopUserSettings.userId, userId),
      ),
    );
}

/** True when the user has any non-null override for this shop. Used by
 * `ShopOut.hasOverrides` to surface the «Сбросить к дефолтам команды» button. */
export async function userHasShopOverrides(
  db: DB,
  shopId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(shopUserSettings)
    .where(
      and(
        eq(shopUserSettings.shopId, shopId),
        eq(shopUserSettings.userId, userId),
      ),
    );
  if (!row) return false;
  return (
    row.taxSettings !== null ||
    row.tariffSetId !== null ||
    row.autoRefreshEnabled !== null ||
    row.autoRefreshIntervalMin !== null
  );
}
