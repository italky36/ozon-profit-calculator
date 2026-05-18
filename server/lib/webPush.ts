import webPush from "web-push";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { pushSubscriptions, vapidSettings } from "../db/schema";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushPayload {
  /** Notification title shown by the OS. Kept short — Android truncates
   * around 50 chars. */
  title: string;
  /** Body text below title. */
  body: string;
  /** Notification icon path. Defaults to /favicon-192.png served by Vite. */
  icon?: string;
  /** Deep-link target. The service worker reads this on click and focuses
   * (or opens) the SPA at this URL. */
  url?: string;
  /** Notification tag — same tag replaces an earlier notification rather
   * than stacking. Use channelId/threadId so multiple events from the
   * same thread collapse. */
  tag?: string;
  /** App-specific bag. Forwarded to the SW for routing logic. */
  data?: Record<string, unknown>;
}

let cached: VapidConfig | null | undefined; // undefined = not yet checked
let cachedDb: DB | null = null;

function readVapidFromDb(db: DB): VapidConfig | null {
  try {
    const row = db
      .select()
      .from(vapidSettings)
      .where(eq(vapidSettings.id, 1))
      .get();
    if (!row) return null;
    if (!row.publicKey || !row.privateKey || !row.subject) return null;
    return {
      publicKey: row.publicKey,
      privateKey: row.privateKey,
      subject: row.subject,
    };
  } catch {
    return null;
  }
}

function readVapidFromEnv(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Thread DB into the lazy resolver — called once from buildApp. */
export function setWebPushDb(db: DB): void {
  cachedDb = db;
  cached = undefined;
}

/** Returns the active VAPID config (DB row → env → null). Cached;
 * `invalidateVapid()` clears the cache after a sysadmin edit. */
export function getVapidConfig(): VapidConfig | null {
  if (cached !== undefined) return cached;
  cached = (cachedDb ? readVapidFromDb(cachedDb) : null) ?? readVapidFromEnv();
  return cached;
}

export function invalidateVapid(): void {
  cached = undefined;
}

/** Just the public key — UI requests this to register a PushSubscription. */
export function getVapidPublicKey(): string | null {
  return getVapidConfig()?.publicKey ?? null;
}

/** True when push delivery is configured (VAPID present + at least one
 * subscription possible). Used by health checks and UI gating. */
export function isPushConfigured(): boolean {
  return getVapidConfig() != null;
}

export interface SendPushOptions {
  /** When true, an HTTP 410/404 from the push service triggers automatic
   * delete of the subscription row by endpoint. Default true. */
  cleanupOnExpired?: boolean;
}

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

/** Send a push payload to one subscription. Handles 410/404 by removing
 * the dead row. Returns true on a successful 2xx. */
export async function sendPush(
  db: DB,
  sub: SubscriptionRow,
  payload: PushPayload,
  opts: SendPushOptions = {},
): Promise<boolean> {
  const cfg = getVapidConfig();
  if (!cfg) return false;
  const cleanup = opts.cleanupOnExpired ?? true;
  webPush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  try {
    await webPush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
      },
      JSON.stringify(payload),
    );
    // Bump last_used_at — useful for "stale subscription" cleanup later.
    try {
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch {
      /* non-fatal */
    }
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (cleanup && (status === 404 || status === 410)) {
      // Subscription expired / unsubscribed — drop the row.
      try {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id));
      } catch {
        /* non-fatal */
      }
    }
    return false;
  }
}

/** Fan-out — load all subscriptions for the given user ids and send the
 * same payload to each. Used by the chat notifications orchestrator. */
export async function sendPushToUsers(
  db: DB,
  userIds: ReadonlyArray<number>,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (userIds.length === 0 || !isPushConfigured()) {
    return { sent: 0, failed: 0 };
  }
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dhKey: pushSubscriptions.p256dhKey,
      authKey: pushSubscriptions.authKey,
    })
    .from(pushSubscriptions);
  const targeted = rows.filter((r) => userIds.includes(r.userId));
  let sent = 0;
  let failed = 0;
  // Sequential — parallel sends to the same push service can rate-limit.
  // For ≤ dozens of subscriptions this is acceptable.
  for (const sub of targeted) {
    const ok = await sendPush(db, sub, payload);
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** Generate a fresh VAPID keypair — used by sysadmin UI / CLI script. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webPush.generateVAPIDKeys();
}
