import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { shops } from "../db/schema";
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
  return r as TaxSettings;
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

const isShopOwner = async (
  db: DB,
  shopId: number,
  userId: number,
): Promise<boolean> => {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.userId, userId)));
  return !!row;
};

export function settingsRoutes(db: DB): Hono<SettingsEnv> {
  const app = new Hono<SettingsEnv>();

  // Effective TaxSettings for caller in shop. Combines shop defaults with
  // per-user override (shop_user_settings).
  app.get("/", async (c) => {
    const user = c.get("user");
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);
    const effective = await resolveShopSettings(db, shop, user.id);
    if (!effective) return c.json({ error: "shop not found" }, 404);
    return c.json(effective.taxSettings);
  });

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
    const now = new Date();
    const owner = await isShopOwner(db, shop, user.id);
    if (owner) {
      await db
        .update(shops)
        .set({ taxSettings: next, updatedAt: now })
        .where(eq(shops.id, shop));
    } else {
      await upsertShopUserSettings(db, shop, user.id, { taxSettings: next });
    }
    return c.json(next);
  });

  app.get("/auto-refresh", async (c) => {
    const user = c.get("user");
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);
    const effective = await resolveShopSettings(db, shop, user.id);
    if (!effective) return c.json({ error: "shop not found" }, 404);
    return c.json({
      shopId: shop,
      enabled: effective.autoRefreshEnabled,
      intervalMin: effective.autoRefreshIntervalMin,
    });
  });

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
    const now = new Date();
    const owner = await isShopOwner(db, shop, user.id);
    if (owner) {
      await db
        .update(shops)
        .set({
          autoRefreshEnabled: r.enabled,
          autoRefreshIntervalMin: min,
          updatedAt: now,
        })
        .where(eq(shops.id, shop));
    } else {
      await upsertShopUserSettings(db, shop, user.id, {
        autoRefreshEnabled: r.enabled,
        autoRefreshIntervalMin: min,
      });
    }
    return c.json({ shopId: shop, enabled: r.enabled, intervalMin: min });
  });

  return app;
}
