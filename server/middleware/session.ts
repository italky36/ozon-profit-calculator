import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { DB } from "../db/client";
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
