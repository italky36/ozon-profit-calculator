import { Hono } from "hono";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  logisticsClusterTariffSets,
  shops,
  userSettings,
} from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import type { TaxSettings } from "../../src/types";
import { readDefaultTaxSettings } from "../settings/defaults";
import { canManageWorkspace } from "../middleware/session";

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
  /** Stage-2 compatibility: every shop in workspace is shared by all members,
   * so the per-user owner concept is gone. The flag stays for the UI which
   * still renders «shared» badges; we send `true` for owner/manager (can
   * mutate) and `false` for member (read-only). */
  isOwner: boolean;
  /** Always null in the workspace model — kept for client-side type compat. */
  ownerEmail: string | null;
  /** Always false — per-user overrides table was removed in 0020. */
  hasOverrides: boolean;
}

type ShopRow = typeof shops.$inferSelect;

const buildOut = (row: ShopRow, user: SessionUser): ShopOut => ({
  id: row.id,
  name: row.name,
  shortName: row.shortName,
  color: row.color ?? null,
  taxSettings: row.taxSettings,
  autoRefreshEnabled: row.autoRefreshEnabled,
  autoRefreshIntervalMin: row.autoRefreshIntervalMin,
  hasOzonCreds: !!(row.ozonClientId && row.ozonApiKey),
  ozonUpdatedAt: row.ozonUpdatedAt?.getTime() ?? null,
  tariffSetId: row.tariffSetId ?? null,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  isOwner: canManageWorkspace(user.workspaceRole),
  ownerEmail: null,
  hasOverrides: false,
});

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

const autoShortName = async (db: DB, workspaceId: number): Promise<string> => {
  const existing = new Set(
    (
      await db
        .select({ shortName: shops.shortName })
        .from(shops)
        .where(eq(shops.workspaceId, workspaceId))
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

  // List shops in current workspace.
  app.get("/", async (c) => {
    const user = c.get("user");
    const rows = await db
      .select()
      .from(shops)
      .where(eq(shops.workspaceId, user.workspaceId))
      .orderBy(shops.createdAt);
    return c.json(rows.map((r) => buildOut(r, user)));
  });

  // Create a new shop in current workspace. Owner/manager only.
  app.post("/", async (c) => {
    const user = c.get("user");
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json({ error: "Только owner или manager создаёт магазины" }, 403);
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
    };
    if (typeof r.name !== "string" || !r.name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    const name = r.name.trim();
    let shortName: string | null;
    if (r.shortName === undefined || r.shortName === "" || r.shortName === null) {
      shortName = await autoShortName(db, user.workspaceId);
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
          workspaceId: user.workspaceId,
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
      return c.json(buildOut(inserted[0], user), 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "shortName already used" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // Select active shop — must belong to current workspace.
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

    const [row] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!row) return c.json({ error: "shop not found" }, 404);

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

  // Patch shop fields. Owner/manager mutates name/shortName/color/tax/etc.
  // Member is read-only on shop metadata (data CRUD goes through other routes).
  app.patch("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [existing] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!existing) return c.json({ error: "not found" }, 404);

    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json(
        { error: "Только owner или manager редактирует магазин" },
        403,
      );
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
                isNull(logisticsClusterTariffSets.workspaceId),
                eq(
                  logisticsClusterTariffSets.workspaceId,
                  user.workspaceId,
                ),
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

    const [row] = await db.select().from(shops).where(eq(shops.id, id));
    return c.json(buildOut(row, user));
  });

  // No-op stub kept for the UI: per-user overrides table was removed in 0020,
  // so there's nothing to clear. Returns the current shop unchanged.
  app.post("/:id/reset-overrides", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [existing] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!existing) return c.json({ error: "not found" }, 404);
    return c.json(buildOut(existing, user));
  });

  // Delete a shop — owner/manager only. Cascades to products, finance, imports
  // via FK ON DELETE CASCADE.
  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json({ error: "Только owner или manager удаляет магазин" }, 403);
    }

    const [{ n: total }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(shops)
      .where(eq(shops.workspaceId, user.workspaceId));
    if (total <= 1) {
      return c.json({ error: "cannot delete the only shop" }, 400);
    }

    const result = await db
      .delete(shops)
      .where(
        and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)),
      );
    if (result.changes === 0) return c.json({ error: "not found" }, 404);

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id));
    if (settings && settings.activeShopId === null) {
      const [fallback] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.workspaceId, user.workspaceId))
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
