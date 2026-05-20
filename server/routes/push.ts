import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { pushSubscriptions } from "../db/schema";
import {
  getVapidPublicKey,
  isPushConfigured,
  sendPush,
} from "../lib/webPush";

type Env = { Variables: { user: SessionUser } };

/** Web Push opt-in endpoints. All require an authenticated user — anon
 * push isn't supported. Subscriptions are device-scoped (one per browser
 * profile that opted in); `endpoint` from PushSubscription.endpoint is
 * the dedup key. */
export function pushRoutes(db: DB): Hono<Env> {
  const app = new Hono<Env>();

  // Public-ish: returns the VAPID public key so the browser can call
  // pushManager.subscribe({ applicationServerKey }). Returns null when
  // push isn't configured — UI uses that to hide the toggle.
  app.get("/public-key", async (c) => {
    return c.json({
      publicKey: await getVapidPublicKey(),
      configured: await isPushConfigured(),
    });
  });

  // Upsert a subscription. Idempotent on `endpoint` — re-subscribing with
  // the same endpoint updates the keys (browser may rotate them) and the
  // owning user (if the user signed out and a different account signed in
  // on the same device, the new account claims the subscription).
  app.post("/subscriptions", async (c) => {
    const user = c.get("user");
    let body: {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
      userAgent?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const endpoint = String(body.endpoint ?? "").trim();
    const p256dh = String(body.keys?.p256dh ?? "").trim();
    const auth = String(body.keys?.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) {
      return c.json({ error: "endpoint + keys required" }, 400);
    }
    if (endpoint.length > 1024) {
      return c.json({ error: "endpoint too long" }, 400);
    }
    const userAgent =
      typeof body.userAgent === "string"
        ? body.userAgent.slice(0, 255)
        : null;

    const now = new Date();
    const [existing] = await db
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    if (existing) {
      await db
        .update(pushSubscriptions)
        .set({
          userId: user.id,
          p256dhKey: p256dh,
          authKey: auth,
          userAgent,
          lastUsedAt: now,
        })
        .where(eq(pushSubscriptions.id, existing.id));
      return c.json({ ok: true, updated: true });
    }
    await db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint,
      p256dhKey: p256dh,
      authKey: auth,
      userAgent,
      createdAt: now,
    });
    return c.json({ ok: true, created: true }, 201);
  });

  // Unsubscribe. Called from the SW when pushsubscriptionchange fires
  // (browser-side revocation) and from the user-toggle when they opt
  // out. Body carries the endpoint to delete.
  app.delete("/subscriptions", async (c) => {
    const user = c.get("user");
    let body: { endpoint?: unknown };
    try {
      body = (await c.req.json()) as { endpoint?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const endpoint = String(body.endpoint ?? "").trim();
    if (!endpoint) return c.json({ error: "endpoint required" }, 400);
    // Only delete subscriptions belonging to the current user — prevents
    // a stranger from spamming DELETE with someone else's endpoint.
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, user.id),
        ),
      );
    return c.json({ ok: true });
  });

  // Self-test: fire a push to all of the current user's subscriptions.
  // Useful for the UI «попробовать» button after opt-in.
  app.post("/test", async (c) => {
    const user = c.get("user");
    if (!(await isPushConfigured())) {
      return c.json({ error: "push не настроен (нет VAPID-ключей)" }, 400);
    }
    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dhKey: pushSubscriptions.p256dhKey,
        authKey: pushSubscriptions.authKey,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    if (subs.length === 0) {
      return c.json({ error: "у вас нет push-подписок" }, 400);
    }
    let sent = 0;
    let failed = 0;
    for (const s of subs) {
      const ok = await sendPush(db, s, {
        title: "Тест push-уведомлений",
        body: "Если вы видите это сообщение — всё работает 🎉",
        tag: "self-test",
      });
      if (ok) sent += 1;
      else failed += 1;
    }
    return c.json({ ok: true, sent, failed });
  });

  return app;
}
