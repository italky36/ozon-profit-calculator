import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { apiCredentials } from "../db/schema";
import type { DB } from "../db/client";

interface PutBody {
  clientId?: unknown;
  apiKey?: unknown;
}

export function credentialsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    const envHas =
      !!process.env.OZON_CLIENT_ID && !!process.env.OZON_API_KEY;
    if (envHas) return c.json({ hasCredentials: true, source: "env" });

    const [row] = await db
      .select({ id: apiCredentials.id })
      .from(apiCredentials)
      .where(eq(apiCredentials.id, 1));
    return c.json({
      hasCredentials: !!row,
      source: row ? "db" : null,
    });
  });

  app.put("/", async (c) => {
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
