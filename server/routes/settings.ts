import { Hono } from "hono";
import { and, eq, isNull, or } from "drizzle-orm";
import { logisticsClusterTariffSets, shops } from "../db/schema";
import type { DB } from "../db/client";
import type { TaxSettings } from "../../src/types";
import type { SessionUser } from "../auth/utils";
import { resolveShopId } from "../middleware/session";
import {
  resolveShopSettings,
  upsertShopUserSettings,
} from "../settings/shopSettings";

type SettingsEnv = { Variables: { user: SessionUser } };

const TAX_SYSTEMS = new Set([
  "УСН Доходы",
  "УСН Доходы минус расходы",
  "АУСН Доходы",
  "АУСН Доходы минус расходы",
  "ОСНО ООО",
  "ОСНО ИП",
  "НПД",
]);

const NUMERIC_FIELDS: Array<keyof TaxSettings> = [
  "damageRate",
  "usnIncomeRate",
  "usnIncomeMinusRate",
  "ausnIncomeRate",
  "ausnIncomeMinusRate",
  "osnoOooRate",
  "osnoIpAnnualIncome",
  "npdRate",
  "partyExtraExpenses",
];

const validate = (raw: unknown): TaxSettings => {
  if (!raw || typeof raw !== "object") throw new Error("invalid input");
  const r = raw as Partial<TaxSettings>;
  if (!r.taxSystem || !TAX_SYSTEMS.has(r.taxSystem))
    throw new Error("invalid taxSystem");
  for (const f of NUMERIC_FIELDS) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`invalid ${f}`);
  }
  if (r.calcMode !== undefined && r.calcMode !== "ozon" && r.calcMode !== "tz")
    throw new Error("invalid calcMode");
  if (r.usnVatRate !== undefined) {
    const v = r.usnVatRate;
    const ok =
      v === "Не облагается" ||
      v === 0.05 ||
      v === 0.07 ||
      v === 0.1 ||
      v === 0.22;
    if (!ok) throw new Error("invalid usnVatRate");
  }
  if (
    r.defaultWhitePurchase !== undefined &&
    typeof r.defaultWhitePurchase !== "boolean"
  )
    throw new Error("invalid defaultWhitePurchase");
  if (
    r.useClusterLogistics !== undefined &&
    typeof r.useClusterLogistics !== "boolean"
  )
    throw new Error("invalid useClusterLogistics");
  // Build a clean object: stripping `shopId` and any other request-only keys
  // is required so the override-vs-default comparison below isn't fooled by
  // the wrapper field the client adds.
  const clean: TaxSettings = {
    taxSystem: r.taxSystem,
    damageRate: r.damageRate as number,
    usnIncomeRate: r.usnIncomeRate as number,
    usnIncomeMinusRate: r.usnIncomeMinusRate as number,
    ausnIncomeRate: r.ausnIncomeRate as number,
    ausnIncomeMinusRate: r.ausnIncomeMinusRate as number,
    osnoOooRate: r.osnoOooRate as number,
    osnoIpAnnualIncome: r.osnoIpAnnualIncome as number,
    npdRate: r.npdRate as number,
    partyExtraExpenses: r.partyExtraExpenses as number,
    ...(r.calcMode !== undefined ? { calcMode: r.calcMode } : {}),
    ...(r.usnVatRate !== undefined ? { usnVatRate: r.usnVatRate } : {}),
    ...(r.defaultWhitePurchase !== undefined
      ? { defaultWhitePurchase: r.defaultWhitePurchase }
      : {}),
    ...(r.useClusterLogistics !== undefined
      ? { useClusterLogistics: r.useClusterLogistics }
      : {}),
  };
  return clean;
};

const resolveShop = async (
  db: DB,
  user: SessionUser,
  explicit: string | undefined | null,
): Promise<number | { status: 400 | 404; error: string }> => {
  try {
    const id = await resolveShopId(db, user, { explicit });
    if (!id) return { status: 400, error: "no shop available" };
    return id;
  } catch (e) {
    const err = e as Error & { status?: number };
    return { status: (err.status as 400 | 404) ?? 400, error: err.message };
  }
};

const taxSettingsEqual = (a: TaxSettings, b: TaxSettings): boolean => {
  const norm = (x: TaxSettings) => {
    const obj = x as unknown as Record<string, unknown>;
    return JSON.stringify(
      Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {}),
    );
  };
  return norm(a) === norm(b);
};

export function settingsRoutes(db: DB): Hono<SettingsEnv> {
  const app = new Hono<SettingsEnv>();

  // Effective taxSettings (user override → shop default).
  app.get("/", async (c) => {
    const user = c.get("user");
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);
    const eff = await resolveShopSettings(db, shop, user.id);
    if (!eff) return c.json({ error: "shop not found" }, 404);
    return c.json(eff.taxSettings);
  });

  // PUT writes the user's per-shop override. If the incoming settings match
  // the shop default exactly, the override is cleared (null) instead of
  // duplicating the defaults.
  app.put("/", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const explicit =
      (body as { shopId?: unknown } | null)?.shopId !== undefined
        ? String((body as { shopId?: unknown }).shopId)
        : c.req.query("shopId");
    const shop = await resolveShop(db, user, explicit);
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    let next: TaxSettings;
    try {
      next = validate(body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const [shopRow] = await db
      .select({ taxSettings: shops.taxSettings })
      .from(shops)
      .where(eq(shops.id, shop));
    if (!shopRow) return c.json({ error: "shop not found" }, 404);

    const matchesDefault = taxSettingsEqual(next, shopRow.taxSettings);
    await upsertShopUserSettings(db, shop, user.id, {
      taxSettings: matchesDefault ? null : next,
    });
    return c.json(next);
  });

  // Effective auto-refresh (override → default).
  app.get("/auto-refresh", async (c) => {
    const user = c.get("user");
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);
    const eff = await resolveShopSettings(db, shop, user.id);
    if (!eff) return c.json({ error: "shop not found" }, 404);
    return c.json({
      shopId: shop,
      enabled: eff.autoRefreshEnabled,
      intervalMin: eff.autoRefreshIntervalMin,
    });
  });

  // Writes per-user override for auto-refresh; clears overrides when they
  // match shop defaults (same pattern as taxSettings above).
  app.put("/auto-refresh", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as {
      enabled?: unknown;
      intervalMin?: unknown;
      shopId?: unknown;
    };
    const explicit =
      r.shopId !== undefined ? String(r.shopId) : c.req.query("shopId");
    const shop = await resolveShop(db, user, explicit);
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    if (typeof r.enabled !== "boolean")
      return c.json({ error: "enabled must be boolean" }, 400);
    const min =
      typeof r.intervalMin === "number" && Number.isFinite(r.intervalMin)
        ? Math.max(1, Math.min(1440, Math.round(r.intervalMin)))
        : 30;
    const [shopRow] = await db
      .select({
        autoRefreshEnabled: shops.autoRefreshEnabled,
        autoRefreshIntervalMin: shops.autoRefreshIntervalMin,
      })
      .from(shops)
      .where(eq(shops.id, shop));
    if (!shopRow) return c.json({ error: "shop not found" }, 404);

    const matchesDefault =
      r.enabled === shopRow.autoRefreshEnabled &&
      min === shopRow.autoRefreshIntervalMin;
    await upsertShopUserSettings(db, shop, user.id, {
      autoRefreshEnabled: matchesDefault ? null : r.enabled,
      autoRefreshIntervalMin: matchesDefault ? null : min,
    });
    return c.json({ shopId: shop, enabled: r.enabled, intervalMin: min });
  });

  // Per-user override for tariff set selection. Member uses this instead of
  // PATCH /api/shops/:id (owner/manager-only). When the chosen set equals the
  // shop default, the override is cleared.
  app.put("/tariff-set", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { tariffSetId?: unknown; shopId?: unknown };
    const explicit =
      r.shopId !== undefined ? String(r.shopId) : c.req.query("shopId");
    const shop = await resolveShop(db, user, explicit);
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    let tariffSetId: number | null;
    if (r.tariffSetId === null || r.tariffSetId === undefined) {
      tariffSetId = null;
    } else {
      const n = Number(r.tariffSetId);
      if (!Number.isFinite(n) || n <= 0)
        return c.json({ error: "tariffSetId must be number or null" }, 400);
      const [set] = await db
        .select({ id: logisticsClusterTariffSets.id })
        .from(logisticsClusterTariffSets)
        .where(
          and(
            eq(logisticsClusterTariffSets.id, n),
            or(
              isNull(logisticsClusterTariffSets.workspaceId),
              eq(logisticsClusterTariffSets.workspaceId, user.workspaceId),
            ),
          ),
        );
      if (!set) return c.json({ error: "tariff set not found" }, 404);
      tariffSetId = n;
    }

    const [shopRow] = await db
      .select({ tariffSetId: shops.tariffSetId })
      .from(shops)
      .where(eq(shops.id, shop));
    if (!shopRow) return c.json({ error: "shop not found" }, 404);

    const matchesDefault = (shopRow.tariffSetId ?? null) === tariffSetId;
    await upsertShopUserSettings(db, shop, user.id, {
      tariffSetId: matchesDefault ? null : tariffSetId,
    });
    return c.json({ shopId: shop, tariffSetId });
  });

  return app;
}
