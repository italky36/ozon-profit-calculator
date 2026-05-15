import { Hono } from "hono";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  logisticsClusterTariffSets,
  shopAccess,
  shops,
  userSettings,
  users,
} from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import type { TaxSettings } from "../../src/types";
import { readDefaultTaxSettings } from "../settings/defaults";
import {
  clearShopUserSettings,
  resolveShopSettings,
  upsertShopUserSettings,
} from "../settings/shopSettings";

type ShopsEnv = { Variables: { user: SessionUser } };

interface ShopOut {
  id: number;
  name: string;
  shortName: string;
  color: string | null;
  taxSettings: TaxSettings;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMin: number;
  hasOzonCreds: boolean;
  ozonUpdatedAt: number | null;
  tariffSetId: number | null;
  createdAt: number;
  updatedAt: number;
  /** True when the current user owns this shop. False for viewer (shared) shops. */
  isOwner: boolean;
  /** Email of the shop owner — shown only for shared shops to identify the source. */
  ownerEmail: string | null;
  /** True when shop_user_settings has any non-NULL field for current user. */
  hasOverrides: boolean;
}

type ShopRow = typeof shops.$inferSelect;

const buildOut = async (
  db: DB,
  row: ShopRow,
  currentUserId: number,
): Promise<ShopOut> => {
  const isOwner = row.userId === currentUserId;
  const effective = await resolveShopSettings(db, row.id, currentUserId);
  let ownerEmail: string | null = null;
  if (!isOwner) {
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.userId));
    ownerEmail = owner?.email ?? null;
  }
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    color: row.color ?? null,
    taxSettings: effective?.taxSettings ?? row.taxSettings,
    autoRefreshEnabled:
      effective?.autoRefreshEnabled ?? row.autoRefreshEnabled,
    autoRefreshIntervalMin:
      effective?.autoRefreshIntervalMin ?? row.autoRefreshIntervalMin,
    hasOzonCreds: !!(row.ozonClientId && row.ozonApiKey),
    ozonUpdatedAt: row.ozonUpdatedAt?.getTime() ?? null,
    tariffSetId: effective?.tariffSetId ?? row.tariffSetId ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    isOwner,
    ownerEmail,
    hasOverrides: effective?.hasOverrides ?? false,
  };
};

const validateShortName = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  const cp = Array.from(trimmed);
  if (cp.length !== 2) return null;
  return cp.join("");
};

const validateColor = (v: unknown): string | null | "invalid" => {
  if (v === null) return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim();
  if (s === "") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return "invalid";
  return s;
};

const autoShortName = async (db: DB, userId: number): Promise<string> => {
  const existing = new Set(
    (
      await db
        .select({ shortName: shops.shortName })
        .from(shops)
        .where(eq(shops.userId, userId))
    ).map((r) => r.shortName),
  );
  for (const prefix of ["M", "S", "A", "B"]) {
    for (let i = 1; i < 100; i++) {
      const candidate = `${prefix}${i % 10}`;
      if (i < 10 && !existing.has(candidate)) return candidate;
      const long = `${prefix}${i}`;
      if (long.length === 2 && !existing.has(long)) return long;
    }
  }
  return Date.now().toString(36).slice(-2).toUpperCase();
};

export function shopsRoutes(db: DB): Hono<ShopsEnv> {
  const app = new Hono<ShopsEnv>();

  // List shops visible to current user: owned + granted via shop_access.
  app.get("/", async (c) => {
    const user = c.get("user");
    const owned = await db
      .select()
      .from(shops)
      .where(eq(shops.userId, user.id));
    const granted = await db
      .select({ shop: shops })
      .from(shopAccess)
      .innerJoin(shops, eq(shopAccess.shopId, shops.id))
      .where(eq(shopAccess.userId, user.id));

    const seen = new Set<number>();
    const all: ShopRow[] = [];
    for (const r of owned) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        all.push(r);
      }
    }
    for (const r of granted) {
      if (!seen.has(r.shop.id)) {
        seen.add(r.shop.id);
        all.push(r.shop);
      }
    }
    all.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const out: ShopOut[] = [];
    for (const r of all) out.push(await buildOut(db, r, user.id));
    return c.json(out);
  });

  // Create a new shop — always owned by the caller.
  app.post("/", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as {
      name?: unknown;
      shortName?: unknown;
      color?: unknown;
      taxSettings?: unknown;
    };
    if (typeof r.name !== "string" || !r.name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    const name = r.name.trim();
    let shortName: string | null;
    if (r.shortName === undefined || r.shortName === "" || r.shortName === null) {
      shortName = await autoShortName(db, user.id);
    } else {
      shortName = validateShortName(r.shortName);
      if (!shortName)
        return c.json({ error: "shortName must be 2 characters" }, 400);
    }
    let color: string | null = null;
    if (r.color !== undefined) {
      const parsed = validateColor(r.color);
      if (parsed === "invalid") {
        return c.json({ error: "color must be #RRGGBB or null" }, 400);
      }
      color = parsed;
    }
    const taxSettings = (r.taxSettings ?? readDefaultTaxSettings(db)) as TaxSettings;
    if (!taxSettings || typeof taxSettings !== "object") {
      return c.json({ error: "taxSettings missing or invalid" }, 400);
    }

    const now = new Date();
    try {
      const inserted = await db
        .insert(shops)
        .values({
          userId: user.id,
          name,
          shortName,
          color,
          taxSettings,
          autoRefreshEnabled: false,
          autoRefreshIntervalMin: 30,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const out = await buildOut(db, inserted[0], user.id);
      return c.json(out, 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "shortName already used" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // Select active shop — must be visible to user (owned or granted).
  app.put("/active", async (c) => {
    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { shopId } = (body ?? {}) as { shopId?: unknown };
    const id = Number(shopId);
    if (!Number.isFinite(id) || id <= 0)
      return c.json({ error: "shopId required" }, 400);

    const [owned] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.userId, user.id)));
    let visible = !!owned;
    if (!visible) {
      const [granted] = await db
        .select({ shopId: shopAccess.shopId })
        .from(shopAccess)
        .where(
          and(eq(shopAccess.shopId, id), eq(shopAccess.userId, user.id)),
        );
      visible = !!granted;
    }
    if (!visible) return c.json({ error: "shop not found" }, 404);

    const now = new Date();
    const [existing] = await db
      .select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id));
    if (existing) {
      await db
        .update(userSettings)
        .set({ activeShopId: id, updatedAt: now })
        .where(eq(userSettings.userId, user.id));
    } else {
      await db
        .insert(userSettings)
        .values({ userId: user.id, activeShopId: id, updatedAt: now });
    }
    return c.json({ activeShopId: id });
  });

  // Patch shop fields. Owner edits the shop row directly. Viewer can only
  // touch override-fields (taxSettings/autoRefresh*/tariffSetId) — those go
  // into shop_user_settings.
  app.patch("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [existing] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, id));
    if (!existing) return c.json({ error: "not found" }, 404);

    const isOwner = existing.userId === user.id;
    if (!isOwner) {
      const [access] = await db
        .select({ shopId: shopAccess.shopId })
        .from(shopAccess)
        .where(
          and(eq(shopAccess.shopId, id), eq(shopAccess.userId, user.id)),
        );
      if (!access) return c.json({ error: "not found" }, 404);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as {
      name?: unknown;
      shortName?: unknown;
      color?: unknown;
      taxSettings?: unknown;
      autoRefreshEnabled?: unknown;
      autoRefreshIntervalMin?: unknown;
      tariffSetId?: unknown;
    };

    const OWNER_FIELDS = ["name", "shortName", "color"] as const;
    if (!isOwner) {
      for (const f of OWNER_FIELDS) {
        if ((r as Record<string, unknown>)[f] !== undefined) {
          return c.json(
            { error: `field "${f}" can only be edited by shop owner` },
            403,
          );
        }
      }
    }

    if (isOwner) {
      const patch: Partial<typeof shops.$inferInsert> = {};
      if (r.name !== undefined) {
        if (typeof r.name !== "string" || !r.name.trim())
          return c.json({ error: "name must be non-empty" }, 400);
        patch.name = r.name.trim();
      }
      if (r.shortName !== undefined) {
        const sn = validateShortName(r.shortName);
        if (!sn) return c.json({ error: "shortName must be 2 characters" }, 400);
        patch.shortName = sn;
      }
      if (r.color !== undefined) {
        const c2 = validateColor(r.color);
        if (c2 === "invalid")
          return c.json({ error: "color must be #RRGGBB or null" }, 400);
        patch.color = c2;
      }
      if (r.taxSettings !== undefined) {
        if (!r.taxSettings || typeof r.taxSettings !== "object")
          return c.json({ error: "taxSettings must be object" }, 400);
        patch.taxSettings = r.taxSettings as TaxSettings;
      }
      if (r.autoRefreshEnabled !== undefined) {
        patch.autoRefreshEnabled = !!r.autoRefreshEnabled;
      }
      if (r.autoRefreshIntervalMin !== undefined) {
        const n = Number(r.autoRefreshIntervalMin);
        if (!Number.isFinite(n) || n < 1 || n > 1440)
          return c.json({ error: "intervalMin must be 1..1440" }, 400);
        patch.autoRefreshIntervalMin = Math.floor(n);
      }
      if (r.tariffSetId !== undefined) {
        if (r.tariffSetId === null) {
          patch.tariffSetId = null;
        } else {
          const n = Number(r.tariffSetId);
          if (!Number.isFinite(n) || n <= 0)
            return c.json({ error: "tariffSetId must be number or null" }, 400);
          const [set] = await db
            .select()
            .from(logisticsClusterTariffSets)
            .where(
              and(
                eq(logisticsClusterTariffSets.id, n),
                or(
                  isNull(logisticsClusterTariffSets.shopId),
                  eq(logisticsClusterTariffSets.shopId, existing.id),
                ),
              ),
            );
          if (!set)
            return c.json(
              { error: "tariffSetId not found or not accessible" },
              404,
            );
          patch.tariffSetId = n;
        }
      }
      if (Object.keys(patch).length === 0) {
        return c.json({ error: "nothing to update" }, 400);
      }
      patch.updatedAt = new Date();
      try {
        await db.update(shops).set(patch).where(eq(shops.id, id));
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("UNIQUE")) {
          return c.json({ error: "shortName already used" }, 409);
        }
        return c.json({ error: msg }, 500);
      }
    } else {
      // Viewer: persist override fields into shop_user_settings.
      const overridePatch: {
        taxSettings?: TaxSettings | null;
        tariffSetId?: number | null;
        autoRefreshEnabled?: boolean | null;
        autoRefreshIntervalMin?: number | null;
      } = {};

      if (r.taxSettings !== undefined) {
        if (r.taxSettings === null) {
          overridePatch.taxSettings = null;
        } else if (typeof r.taxSettings !== "object") {
          return c.json({ error: "taxSettings must be object" }, 400);
        } else {
          overridePatch.taxSettings = r.taxSettings as TaxSettings;
        }
      }
      if (r.autoRefreshEnabled !== undefined) {
        overridePatch.autoRefreshEnabled =
          r.autoRefreshEnabled === null ? null : !!r.autoRefreshEnabled;
      }
      if (r.autoRefreshIntervalMin !== undefined) {
        if (r.autoRefreshIntervalMin === null) {
          overridePatch.autoRefreshIntervalMin = null;
        } else {
          const n = Number(r.autoRefreshIntervalMin);
          if (!Number.isFinite(n) || n < 1 || n > 1440)
            return c.json({ error: "intervalMin must be 1..1440" }, 400);
          overridePatch.autoRefreshIntervalMin = Math.floor(n);
        }
      }
      if (r.tariffSetId !== undefined) {
        if (r.tariffSetId === null) {
          overridePatch.tariffSetId = null;
        } else {
          const n = Number(r.tariffSetId);
          if (!Number.isFinite(n) || n <= 0)
            return c.json({ error: "tariffSetId must be number or null" }, 400);
          const [set] = await db
            .select()
            .from(logisticsClusterTariffSets)
            .where(
              and(
                eq(logisticsClusterTariffSets.id, n),
                or(
                  isNull(logisticsClusterTariffSets.shopId),
                  eq(logisticsClusterTariffSets.shopId, existing.id),
                ),
              ),
            );
          if (!set)
            return c.json(
              { error: "tariffSetId not found or not accessible" },
              404,
            );
          overridePatch.tariffSetId = n;
        }
      }
      if (Object.keys(overridePatch).length === 0) {
        return c.json({ error: "nothing to update" }, 400);
      }
      await upsertShopUserSettings(db, id, user.id, overridePatch);
    }

    const [row] = await db.select().from(shops).where(eq(shops.id, id));
    const out = await buildOut(db, row, user.id);
    return c.json(out);
  });

  // Reset per-user overrides on a shared shop — viewer reverts to shop defaults.
  // Owners can also call this (no-op on shops, just clears their override row).
  app.post("/:id/reset-overrides", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [existing] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, id));
    if (!existing) return c.json({ error: "not found" }, 404);

    const isOwner = existing.userId === user.id;
    if (!isOwner) {
      const [access] = await db
        .select({ shopId: shopAccess.shopId })
        .from(shopAccess)
        .where(
          and(eq(shopAccess.shopId, id), eq(shopAccess.userId, user.id)),
        );
      if (!access) return c.json({ error: "not found" }, 404);
    }

    await clearShopUserSettings(db, id, user.id);
    const out = await buildOut(db, existing, user.id);
    return c.json(out);
  });

  // Delete a shop — owner only. Cascades to products, finance, imports,
  // shop_access, shop_user_settings via FK ON DELETE CASCADE.
  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [{ n: total }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(shops)
      .where(eq(shops.userId, user.id));
    if (total <= 1) {
      return c.json({ error: "cannot delete the only shop" }, 400);
    }

    const result = await db
      .delete(shops)
      .where(and(eq(shops.id, id), eq(shops.userId, user.id)));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id));
    if (settings && settings.activeShopId === null) {
      const [fallback] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.userId, user.id))
        .limit(1);
      if (fallback) {
        await db
          .update(userSettings)
          .set({ activeShopId: fallback.id, updatedAt: new Date() })
          .where(eq(userSettings.userId, user.id));
      }
    }
    return c.body(null, 204);
  });

  return app;
}
