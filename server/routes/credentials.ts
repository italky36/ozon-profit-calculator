import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { apiCredentials } from "../db/schema";
import type { DB } from "../db/client";
import { requireAdmin } from "../middleware/session";
import type { SessionUser } from "../auth/utils";

interface PutBody {
  clientId?: unknown;
  apiKey?: unknown;
}

type CredsEnv = { Variables: { user?: SessionUser } };

export function credentialsRoutes(db: DB): Hono<CredsEnv> {
  const app = new Hono<CredsEnv>();

  app.get("/status", async (c) => {
    const envHas =
      !!process.env.OZON_CLIENT_ID && !!process.env.OZON_API_KEY;
    const [row] = await db
      .select({ id: apiCredentials.id })
      .from(apiCredentials)
      .where(eq(apiCredentials.id, 1));
    // DB takes priority over env (consistent with import client behavior).
    if (row) return c.json({ hasCredentials: true, source: "db" });
    if (envHas) return c.json({ hasCredentials: true, source: "env" });
    return c.json({ hasCredentials: false, source: null });
  });

  app.put("/", requireAdmin, async (c) => {
    let body: PutBody;
    try {
      body = (await c.req.json()) as PutBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { clientId, apiKey } = body;
    if (
      typeof clientId !== "string" ||
      typeof apiKey !== "string" ||
      !clientId.trim() ||
      !apiKey.trim()
    ) {
      return c.json({ error: "clientId and apiKey are required" }, 400);
    }
    const now = new Date();
    const [existing] = await db
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.id, 1));
    if (existing) {
      await db
        .update(apiCredentials)
        .set({ clientId, apiKey, updatedAt: now })
        .where(eq(apiCredentials.id, 1));
    } else {
      await db.insert(apiCredentials).values({
        id: 1,
        clientId,
        apiKey,
        updatedAt: now,
      });
    }
    return c.json({ ok: true });
  });

  return app;
}
