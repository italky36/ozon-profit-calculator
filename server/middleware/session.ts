import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, or } from "drizzle-orm";
import type { DB } from "../db/client";
import { shopAccess, shops, userSettings } from "../db/schema";
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

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SessionUser | undefined;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};

export function getSessionUser(c: Context): SessionUser | undefined {
  return c.get("user") as SessionUser | undefined;
}

/** Returns true if the user owns the shop OR has been granted access via
 * shop_access. Used by all routes to gate per-shop reads/writes. */
export async function userCanSeeShop(
  db: DB,
  userId: number,
  shopId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .leftJoin(
      shopAccess,
      and(eq(shopAccess.shopId, shops.id), eq(shopAccess.userId, userId)),
    )
    .where(
      and(
        eq(shops.id, shopId),
        or(eq(shops.userId, userId), eq(shopAccess.userId, userId)),
      ),
    );
  return Boolean(row);
}

/** Returns true only when the user is the shop's owner (admin-fields gate). */
export async function userOwnsShop(
  db: DB,
  userId: number,
  shopId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.userId, userId)));
  return Boolean(row);
}

/**
 * Resolve shopId for a request. Priority:
 *   1. explicit `?shopId=` query parameter (validated against visibility);
 *   2. user_settings.active_shop_id (lazy fallback, validated);
 *   3. any visible shop (last-ditch — happens right after autocreate).
 *
 * Returns null if the user can see no shops at all (caller decides response).
 * Throws { status: 404 } if requested shopId is not visible.
 */
export async function resolveShopId(
  db: DB,
  user: SessionUser,
  opts: { explicit?: number | string | null } = {},
): Promise<number | null> {
  if (opts.explicit !== undefined && opts.explicit !== null && opts.explicit !== "") {
    const n = Number(opts.explicit);
    if (!Number.isFinite(n) || n <= 0) {
      throw Object.assign(new Error("invalid shopId"), { status: 400 });
    }
    const visible = await userCanSeeShop(db, user.id, n);
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
    const visible = await userCanSeeShop(db, user.id, settings.activeShopId);
    if (visible) return settings.activeShopId;
  }

  const visibleIds = await visibleShopIds(db, user.id);
  return visibleIds[0] ?? null;
}

/** List ids of all shops visible to the user — owned shops plus shops granted
 * via shop_access. Used as default scope when caller didn't specify shopId. */
export async function visibleShopIds(
  db: DB,
  userId: number,
): Promise<number[]> {
  const owned = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.userId, userId));
  const granted = await db
    .select({ id: shopAccess.shopId })
    .from(shopAccess)
    .where(eq(shopAccess.userId, userId));
  const set = new Set<number>();
  for (const r of owned) set.add(r.id);
  for (const r of granted) set.add(r.id);
  return [...set];
}

/** Backwards-compatible alias retained for routes that still call it. */
export const listUserShopIds = async (
  db: DB,
  user: SessionUser,
): Promise<number[]> => visibleShopIds(db, user.id);
