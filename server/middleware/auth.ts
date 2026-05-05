import type { MiddlewareHandler } from "hono";

export function authMiddleware(expectedToken: string): MiddlewareHandler {
  return async (c, next) => {
    const got = c.req.header("X-Auth-Token");
    if (!got || got !== expectedToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
