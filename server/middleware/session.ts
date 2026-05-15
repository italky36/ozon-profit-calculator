import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { shops, userSettings, workspaceMembers } from "../db/schema";
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

/** Returns true when the shop belongs to the current workspace. Used as the
 * single visibility check for everything per-shop (products, finance, settings,
 * credentials). */
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

/**
 * Resolve shopId for a request. Priority:
 *   1. explicit `?shopId=` query parameter (validated against the workspace);
 *   2. user_settings.active_shop_id (validated);
 *   3. any shop in the workspace (last-ditch fallback).
 *
 * Returns null when the workspace has no shops at all (caller decides
 * response). Throws { status: 404 } if requested shopId is not in workspace.
 */
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
    const visible = await shopBelongsToWorkspace(db, user.workspaceId, n);
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
    const visible = await shopBelongsToWorkspace(
      db,
      user.workspaceId,
      settings.activeShopId,
    );
    if (visible) return settings.activeShopId;
  }

  const [first] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.workspaceId, user.workspaceId))
    .limit(1);
  return first?.id ?? null;
}

/** All shops in current workspace (used as default scope when caller didn't
 * specify shopId). */
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
