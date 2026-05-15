import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  shopMember,
  shops,
  userSettings,
  workspaceMembers,
} from "../db/schema";
import { validateSession, type SessionUser } from "../auth/utils";

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ?? "ozon_calc_session";

export interface SessionVars {
  user: SessionUser;
}

/** Reads session cookie, validates it, attaches `user` to context. Does not
 * itself reject — pair with `requireAuth` for protected routes. */
export function sessionMiddleware(db: DB): MiddlewareHandler {
  return async (c, next) => {
    const sid = getCookie(c, SESSION_COOKIE_NAME);
    if (sid) {
      const user = validateSession(db, sid);
      if (user) c.set("user", user);
    }
    await next();
  };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SessionUser | undefined;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  await next();
};

/** Platform-level gate: only sysadmins (the SaaS-owner side, not workspace
 * roles) reach SMTP / users / global tariff sets. */
export const requireSysadmin: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SessionUser | undefined;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!user.isSysadmin) return c.json({ error: "forbidden" }, 403);
  await next();
};

export function getSessionUser(c: Context): SessionUser | undefined {
  return c.get("user") as SessionUser | undefined;
}

/** Returns true when the shop belongs to the current workspace. Low-level
 * check used by the assignment-aware helpers below; **most callers should
 * use `userCanAccessShop`**, which also enforces `shop_member` for non-owners. */
export async function shopBelongsToWorkspace(
  db: DB,
  workspaceId: number,
  shopId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.workspaceId, workspaceId)));
  return Boolean(row);
}

/** Workspace-level role gate. owner/manager can mutate shop admin-fields and
 * credentials; member can read+edit data but not change shop metadata. */
export function canManageWorkspace(role: SessionUser["workspaceRole"]): boolean {
  return role === "owner" || role === "manager";
}

/** Visibility check: can `user` see/work with `shopId`?
 *   - Owner of workspace: always (no shop_member check needed).
 *   - Manager / member: must have a `shop_member(shop_id, user_id)` row.
 *
 * Used as the single gate for products/finance/imports/settings/credentials
 * before reading or mutating per-shop data. */
export async function userCanAccessShop(
  db: DB,
  user: SessionUser,
  shopId: number,
): Promise<boolean> {
  // First confirm the shop is in the user's workspace.
  if (!(await shopBelongsToWorkspace(db, user.workspaceId, shopId)))
    return false;
  // Owner sees every workspace shop unconditionally.
  if (user.workspaceRole === "owner") return true;
  // Everyone else needs a shop_member row.
  const [row] = await db
    .select({ shopId: shopMember.shopId })
    .from(shopMember)
    .where(
      and(eq(shopMember.shopId, shopId), eq(shopMember.userId, user.id)),
    );
  return Boolean(row);
}

/** All shops in the user's workspace they are entitled to see.
 *   - Owner: every shop in the workspace.
 *   - Manager / member: only shops with a `shop_member` row.
 *
 * Used as the default scope when caller didn't specify `?shopId=…`. */
export async function visibleShopIds(
  db: DB,
  user: SessionUser,
): Promise<number[]> {
  if (user.workspaceRole === "owner") {
    return workspaceShopIds(db, user.workspaceId);
  }
  const rows = await db
    .select({ id: shops.id })
    .from(shops)
    .innerJoin(shopMember, eq(shopMember.shopId, shops.id))
    .where(
      and(
        eq(shops.workspaceId, user.workspaceId),
        eq(shopMember.userId, user.id),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Resolve shopId for a request. Priority:
 *   1. explicit `?shopId=` query parameter (validated against assignment);
 *   2. user_settings.active_shop_id (validated);
 *   3. any shop the user can see (last-ditch fallback).
 *
 * Returns null when the user has zero accessible shops. Throws { status: 404 }
 * if requested shopId is not visible (not in workspace or not assigned). */
export async function resolveShopId(
  db: DB,
  user: SessionUser,
  opts: { explicit?: number | string | null } = {},
): Promise<number | null> {
  if (
    opts.explicit !== undefined &&
    opts.explicit !== null &&
    opts.explicit !== ""
  ) {
    const n = Number(opts.explicit);
    if (!Number.isFinite(n) || n <= 0) {
      throw Object.assign(new Error("invalid shopId"), { status: 400 });
    }
    const visible = await userCanAccessShop(db, user, n);
    if (!visible) {
      throw Object.assign(new Error("shop not found"), { status: 404 });
    }
    return n;
  }

  const [settings] = await db
    .select({ activeShopId: userSettings.activeShopId })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id));
  if (settings?.activeShopId) {
    const visible = await userCanAccessShop(db, user, settings.activeShopId);
    if (visible) return settings.activeShopId;
  }

  const accessible = await visibleShopIds(db, user);
  return accessible[0] ?? null;
}

/** All shops in a workspace, no assignment filter. Low-level — most callers
 * want `visibleShopIds(db, user)` instead, which respects assignment. */
export async function workspaceShopIds(
  db: DB,
  workspaceId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.workspaceId, workspaceId));
  return rows.map((r) => r.id);
}

/** Looks up the user's single workspace membership (Stage 2 invariant: 1 user
 * = 1 workspace). Returns null if the user has no membership yet — callers
 * should treat this as «нужно создать workspace» (Stage 3 wires registration). */
export async function findUserWorkspace(
  db: DB,
  userId: number,
): Promise<{
  workspaceId: number;
  workspaceRole: "owner" | "manager" | "member";
} | null> {
  const [row] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  if (!row) return null;
  return { workspaceId: row.workspaceId, workspaceRole: row.role };
}
