import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { shops } from "../db/schema";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import {
  canManageWorkspace,
  resolveShopId,
  workspaceShopIds,
} from "../middleware/session";

interface PutBody {
  clientId?: unknown;
  apiKey?: unknown;
  shopId?: unknown;
}

type CredsEnv = { Variables: { user: SessionUser } };

const parsePutBody = (
  body: PutBody,
): { clientId: string; apiKey: string } | string => {
  const { clientId, apiKey } = body;
  if (
    typeof clientId !== "string" ||
    typeof apiKey !== "string" ||
    !clientId.trim() ||
    !apiKey.trim()
  ) {
    return "clientId and apiKey are required";
  }
  return { clientId: clientId.trim(), apiKey: apiKey.trim() };
};

/** Resolve shopId from query (?shopId=) OR fall back to active. */
const resolveShop = async (
  db: DB,
  user: SessionUser,
  explicit: string | undefined | null,
): Promise<number | { status: 400 | 404; error: string }> => {
  try {
    const id = await resolveShopId(db, user, { explicit });
    if (!id) return { status: 400, error: "no shop available" };
    return id;
  } catch (e) {
    const err = e as Error & { status?: number };
    return { status: (err.status as 400 | 404) ?? 400, error: err.message };
  }
};

export function credentialsRoutes(db: DB): Hono<CredsEnv> {
  const app = new Hono<CredsEnv>();

  // Status for a shop. Only shop keys are accepted — no fallback.
  app.get("/status", async (c) => {
    const user = c.get("user");
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    const [shopRow] = await db
      .select({
        ozonClientId: shops.ozonClientId,
        ozonApiKey: shops.ozonApiKey,
      })
      .from(shops)
      .where(eq(shops.id, shop));

    const hasShopCreds = !!(shopRow?.ozonClientId && shopRow?.ozonApiKey);
    return c.json({
      shopId: shop,
      hasCredentials: hasShopCreds,
      activeSource: hasShopCreds ? ("shop" as const) : null,
      shop: { hasCredentials: hasShopCreds },
    });
  });

  // Status for ALL shops in workspace.
  app.get("/status/all", async (c) => {
    const user = c.get("user");

    const visibleIds = await workspaceShopIds(db, user.workspaceId);
    const rows = visibleIds.length
      ? await db
          .select({
            id: shops.id,
            ozonClientId: shops.ozonClientId,
            ozonApiKey: shops.ozonApiKey,
          })
          .from(shops)
          .where(inArray(shops.id, visibleIds))
      : [];

    const shopsStatus = rows.map((r) => {
      const hasShopCreds = !!(r.ozonClientId && r.ozonApiKey);
      return {
        shopId: r.id,
        hasCredentials: hasShopCreds,
        activeSource: hasShopCreds ? ("shop" as const) : null,
        shop: { hasCredentials: hasShopCreds },
      };
    });
    return c.json({ shops: shopsStatus });
  });

  // Upsert credentials for a shop — owner/manager only.
  app.put("/", async (c) => {
    const user = c.get("user");
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json(
        { error: "Только owner или manager редактирует ключи Ozon" },
        403,
      );
    }
    let body: PutBody;
    try {
      body = (await c.req.json()) as PutBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const explicit =
      typeof body.shopId === "number" || typeof body.shopId === "string"
        ? String(body.shopId)
        : c.req.query("shopId");
    const shop = await resolveShop(db, user, explicit);
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    const parsed = parsePutBody(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const now = new Date();
    await db
      .update(shops)
      .set({
        ozonClientId: parsed.clientId,
        ozonApiKey: parsed.apiKey,
        ozonUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(shops.id, shop));
    return c.json({ ok: true, shopId: shop });
  });

  // Remove shop credentials — owner/manager only.
  app.delete("/", async (c) => {
    const user = c.get("user");
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json(
        { error: "Только owner или manager редактирует ключи Ozon" },
        403,
      );
    }
    const shop = await resolveShop(db, user, c.req.query("shopId"));
    if (typeof shop !== "number") return c.json({ error: shop.error }, shop.status);

    const now = new Date();
    const result = await db
      .update(shops)
      .set({
        ozonClientId: null,
        ozonApiKey: null,
        ozonUpdatedAt: null,
        updatedAt: now,
      })
      .where(eq(shops.id, shop));
    return c.json({ ok: true, cleared: result.changes });
  });

  return app;
}
