import { Hono } from "hono";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  financeTransactions,
  importRuns,
  logisticsClusterTariffSets,
  products,
  shopMember,
  shopUserSettings,
  shops,
  userSettings,
  users,
  workspaceMembers,
} from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import type { TaxSettings } from "../../src/types";
import { readDefaultTaxSettings } from "../settings/defaults";
import {
  canManageShop,
  canManageWorkspace,
  userCanAccessShop,
} from "../middleware/session";
import {
  clearShopUserSettings,
  resolveShopSettings,
  userHasShopOverrides,
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
  /** True when the current user can edit shop metadata + assignment. After
   * Stage 7'' this is per-shop: workspace owner everywhere; manager only on
   * shops they created (`createdBy === user.id`). Member always false. */
  isOwner: boolean;
  /** Creator of the shop. NULL → orphaned (creator removed from workspace);
   * only workspace owner can manage such a shop. */
  createdById: number | null;
  /** True when the user has at least one non-null override in
   * `shop_user_settings` for this shop. Surfaces the «Сбросить к дефолтам
   * команды» button in the UI. */
  hasOverrides: boolean;
}

type ShopRow = typeof shops.$inferSelect;

const buildOut = async (
  db: DB,
  row: ShopRow,
  user: SessionUser,
): Promise<ShopOut> => {
  const eff = await resolveShopSettings(db, row.id, user.id);
  const hasOverrides = await userHasShopOverrides(db, row.id, user.id);
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    color: row.color ?? null,
    taxSettings: eff?.taxSettings ?? row.taxSettings,
    autoRefreshEnabled: eff?.autoRefreshEnabled ?? row.autoRefreshEnabled,
    autoRefreshIntervalMin:
      eff?.autoRefreshIntervalMin ?? row.autoRefreshIntervalMin,
    hasOzonCreds: !!(row.ozonClientId && row.ozonApiKey),
    ozonUpdatedAt: row.ozonUpdatedAt?.getTime() ?? null,
    tariffSetId: eff?.tariffSetId ?? row.tariffSetId ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    isOwner:
      user.workspaceRole === "owner" ||
      (user.workspaceRole === "manager" && row.createdBy === user.id),
    createdById: row.createdBy ?? null,
    hasOverrides,
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

/** Visible shops: owner sees all, member only via shop_member. Returned
 * rows preserve `shops` ordering by createdAt. */
const listVisibleShopRows = async (
  db: DB,
  user: SessionUser,
): Promise<ShopRow[]> => {
  if (user.workspaceRole === "owner") {
    return await db
      .select()
      .from(shops)
      .where(eq(shops.workspaceId, user.workspaceId))
      .orderBy(shops.createdAt);
  }
  const rows = await db
    .select({ row: shops })
    .from(shops)
    .innerJoin(shopMember, eq(shopMember.shopId, shops.id))
    .where(
      and(
        eq(shops.workspaceId, user.workspaceId),
        eq(shopMember.userId, user.id),
      ),
    )
    .orderBy(shops.createdAt);
  return rows.map((r) => r.row);
};

/** Cascade-delete all per-user data for `(shopId, userId)`. Called when a
 * member is unassigned from a shop — owner/manager can re-assign them later
 * but their old products/finance/runs/overrides are gone (matches Stage-2-era
 * behaviour from the pre-rewrite admin.ts). */
const cascadeUnassign = async (
  db: DB,
  shopId: number,
  userId: number,
): Promise<void> => {
  await db
    .delete(products)
    .where(and(eq(products.shopId, shopId), eq(products.userId, userId)));
  await db
    .delete(financeTransactions)
    .where(
      and(
        eq(financeTransactions.shopId, shopId),
        eq(financeTransactions.userId, userId),
      ),
    );
  await db
    .delete(importRuns)
    .where(
      and(eq(importRuns.shopId, shopId), eq(importRuns.userId, userId)),
    );
  await db
    .delete(shopUserSettings)
    .where(
      and(
        eq(shopUserSettings.shopId, shopId),
        eq(shopUserSettings.userId, userId),
      ),
    );
};

export function shopsRoutes(db: DB): Hono<ShopsEnv> {
  const app = new Hono<ShopsEnv>();

  // List shops the current user can access. Owner: every workspace shop.
  // Manager / member: only shop_member-assigned.
  app.get("/", async (c) => {
    const user = c.get("user");
    const rows = await listVisibleShopRows(db, user);
    const out: ShopOut[] = [];
    for (const r of rows) out.push(await buildOut(db, r, user));
    return c.json(out);
  });

  // Create a new shop. Owner/manager only. Creator is auto-assigned so it
  // shows up in `GET /shops` immediately even before they grant access to
  // others.
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
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      // Manager (not owner) needs an explicit shop_member row to keep seeing
      // the shop they just created — owner sees every shop unconditionally.
      if (user.workspaceRole !== "owner") {
        await db.insert(shopMember).values({
          shopId: inserted[0].id,
          userId: user.id,
          createdAt: now,
          createdBy: user.id,
        });
      }
      return c.json(await buildOut(db, inserted[0], user), 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "shortName already used" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // Select active shop — must be visible to the user.
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

    if (!(await userCanAccessShop(db, user, id))) {
      return c.json({ error: "shop not found" }, 404);
    }

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

  // Patch shop default fields. Owner/manager only. Member uses
  // `PUT /api/settings` for per-user overrides instead.
  app.patch("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [existing] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!existing) return c.json({ error: "not found" }, 404);

    if (!(await canManageShop(db, user, id))) {
      return c.json(
        {
          error:
            "Редактировать магазин может только его создатель или владелец команды",
        },
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
    return c.json(await buildOut(db, row, user));
  });

  // Drop the current user's per-shop overrides. Anyone with shop access can
  // call it — it only touches their own override row.
  app.post("/:id/reset-overrides", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    if (!(await userCanAccessShop(db, user, id))) {
      return c.json({ error: "not found" }, 404);
    }
    await clearShopUserSettings(db, id, user.id);
    const [row] = await db.select().from(shops).where(eq(shops.id, id));
    return c.json(await buildOut(db, row, user));
  });

  // Assignment endpoints — owner of workspace OR creator-of-this-shop only.
  app.get("/:id/members", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const [shop] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!shop) return c.json({ error: "not found" }, 404);
    if (!(await canManageShop(db, user, id))) {
      return c.json(
        {
          error:
            "Доступом управляет создатель магазина или владелец команды",
        },
        403,
      );
    }

    const wsMembers = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: users.email,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, user.workspaceId));

    const assignedIds = new Set(
      (
        await db
          .select({ userId: shopMember.userId })
          .from(shopMember)
          .where(eq(shopMember.shopId, id))
      ).map((r) => r.userId),
    );

    const assigned: Array<{
      userId: number;
      email: string;
      role: "owner" | "manager" | "member";
    }> = [];
    const candidates: Array<{
      userId: number;
      email: string;
      role: "owner" | "manager" | "member";
    }> = [];
    for (const m of wsMembers) {
      const item = { userId: m.userId, email: m.email, role: m.role };
      // Workspace owner always sees every shop without a shop_member row, so
      // surface them as "assigned" in the UI to avoid a misleading "Add" CTA.
      if (m.role === "owner" || assignedIds.has(m.userId)) assigned.push(item);
      else candidates.push(item);
    }
    return c.json({ assigned, candidates });
  });

  app.post("/:id/members", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const [shop] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!shop) return c.json({ error: "not found" }, 404);
    if (!(await canManageShop(db, user, id))) {
      return c.json(
        {
          error:
            "Доступом управляет создатель магазина или владелец команды",
        },
        403,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const targetId = Number((body as { userId?: unknown } | null)?.userId);
    if (!Number.isFinite(targetId) || targetId <= 0)
      return c.json({ error: "userId required" }, 400);
    const [mem] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      );
    if (!mem) return c.json({ error: "user not in workspace" }, 404);
    if (mem.role === "owner") {
      // Owner already sees everything; no shop_member row needed.
      return c.json({ ok: true, alreadyVisible: true });
    }
    const [existing] = await db
      .select({ shopId: shopMember.shopId })
      .from(shopMember)
      .where(and(eq(shopMember.shopId, id), eq(shopMember.userId, targetId)));
    if (existing) return c.json({ ok: true, alreadyVisible: true });
    await db.insert(shopMember).values({
      shopId: id,
      userId: targetId,
      createdAt: new Date(),
      createdBy: user.id,
    });
    return c.json({ ok: true });
  });

  app.delete("/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const targetId = Number(c.req.param("userId"));
    if (!Number.isFinite(id) || !Number.isFinite(targetId))
      return c.json({ error: "invalid id" }, 400);
    const [shop] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!shop) return c.json({ error: "not found" }, 404);
    if (!(await canManageShop(db, user, id))) {
      return c.json(
        {
          error:
            "Доступом управляет создатель магазина или владелец команды",
        },
        403,
      );
    }

    const [mem] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      );
    if (!mem) return c.json({ error: "user not in workspace" }, 404);
    if (mem.role === "owner") {
      return c.json({ error: "нельзя снять доступ у owner'а" }, 400);
    }
    await db
      .delete(shopMember)
      .where(and(eq(shopMember.shopId, id), eq(shopMember.userId, targetId)));
    await cascadeUnassign(db, id, targetId);
    return c.body(null, 204);
  });

  // Transfer shop management to another member. Workspace owner only — even
  // the current creator can't hand it off (prevents managers from "losing"
  // their shop accidentally; only the team owner can reassign).
  app.put("/:id/transfer", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    if (user.workspaceRole !== "owner") {
      return c.json(
        { error: "Передать управление может только владелец команды" },
        403,
      );
    }
    const [shop] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.workspaceId, user.workspaceId)));
    if (!shop) return c.json({ error: "not found" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const targetId = Number((body as { userId?: unknown } | null)?.userId);
    if (!Number.isFinite(targetId) || targetId <= 0)
      return c.json({ error: "userId required" }, 400);

    const [mem] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      );
    if (!mem) return c.json({ error: "user not in workspace" }, 404);
    if (mem.role === "member")
      return c.json(
        {
          error:
            "Управление магазином можно передать только владельцу или менеджеру команды",
        },
        400,
      );

    const now = new Date();
    await db
      .update(shops)
      .set({ createdBy: targetId, updatedAt: now })
      .where(eq(shops.id, id));

    // Manager needs an explicit shop_member row to see the shop. Owner sees
    // everything by default, so we skip the row in that case.
    if (mem.role === "manager") {
      const [existing] = await db
        .select({ shopId: shopMember.shopId })
        .from(shopMember)
        .where(and(eq(shopMember.shopId, id), eq(shopMember.userId, targetId)));
      if (!existing) {
        await db.insert(shopMember).values({
          shopId: id,
          userId: targetId,
          createdAt: now,
          createdBy: user.id,
        });
      }
    }

    const [row] = await db.select().from(shops).where(eq(shops.id, id));
    return c.json(await buildOut(db, row, user));
  });

  // Delete a shop — creator-of-shop or workspace owner only. Cascades to
  // products, finance, imports via FK ON DELETE CASCADE.
  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    if (!(await canManageShop(db, user, id))) {
      return c.json(
        {
          error:
            "Удалить магазин может только его создатель или владелец команды",
        },
        403,
      );
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
