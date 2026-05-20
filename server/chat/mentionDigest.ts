import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  chatChannels,
  chatMessages,
  users,
} from "../db/schema";
import { getEmailClient } from "../email/client";
import { generateMentionDigest } from "../email/templates";
import { isUserOnline } from "./presence";

/** Mention digest queue (in-memory, single-process).
 *
 * Goal: when a user is @mentioned while offline, batch the notifications and
 * send a single email after a quiet period instead of spamming one-email-per-
 * mention. If the user comes back online before the quiet period elapses, the
 * pending digest is cancelled (they'll see the mentions in-app).
 *
 * Per-user state:
 *   - `messageIds`: deduplicated set of mention message ids
 *   - `firstAt`:    when the first mention in the current batch arrived
 *   - `timer`:      handle of the scheduled flush
 *
 * On any new mention for the same user, we **bump the deadline** to `now +
 * QUIET_MS`, not the original `firstAt + QUIET_MS`. This matches Slack: each
 * new mention extends the quiet period so the user gets one fat email instead
 * of two-thin-emails-near-the-boundary. */

const QUIET_MS = 5 * 60 * 1000;

interface Pending {
  messageIds: Set<number>;
  appUrl: string;
  workspaceId: number;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const queue = new Map<number, Pending>();

interface QueueMentionInput {
  db: DB;
  workspaceId: number;
  userId: number;
  messageId: number;
  /** Public base URL used to build deep links into mentioned messages. */
  appUrl: string;
}

/** Schedule a mention for digest delivery. If the user comes online via WS
 * before the timer fires, the digest is cancelled (`cancelForUser`). */
export function queueMention(input: QueueMentionInput): void {
  // Skip silently if user is currently online — they see the mention in-app.
  if (isUserOnline(input.workspaceId, input.userId)) return;

  const existing = queue.get(input.userId);
  if (existing) {
    existing.messageIds.add(input.messageId);
    // Bump deadline: clear and reschedule.
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => {
      void flushUser(input.db, input.userId);
    }, QUIET_MS);
    return;
  }
  const pending: Pending = {
    messageIds: new Set([input.messageId]),
    appUrl: input.appUrl,
    workspaceId: input.workspaceId,
    firstAt: Date.now(),
    timer: setTimeout(() => {
      void flushUser(input.db, input.userId);
    }, QUIET_MS),
  };
  queue.set(input.userId, pending);
}

/** Drop the user's pending digest. Called when presence flips offline→online
 * (they'll see the mentions in the live UI). */
export function cancelForUser(userId: number): void {
  const pending = queue.get(userId);
  if (!pending) return;
  clearTimeout(pending.timer);
  queue.delete(userId);
}

/** Internal: load message context + send the digest email. Robust to messages
 * being deleted between queueing and flushing — those rows are simply skipped. */
async function flushUser(db: DB, userId: number): Promise<void> {
  const pending = queue.get(userId);
  if (!pending) return;
  queue.delete(userId);

  const ids = [...pending.messageIds];
  if (ids.length === 0) return;

  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return;

  const rows = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      authorUserId: chatMessages.authorUserId,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      deletedAt: chatMessages.deletedAt,
      channelName: chatChannels.name,
      authorEmail: users.email,
      authorFullName: users.fullName,
    })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .leftJoin(users, eq(users.id, chatMessages.authorUserId))
    .where(
      and(
        inArray(chatMessages.id, ids),
        eq(chatChannels.workspaceId, pending.workspaceId),
      ),
    );

  const items = rows
    .filter((r) => r.deletedAt == null)
    .map((r) => ({
      messageId: r.id,
      channelId: r.channelId,
      channelName: r.channelName,
      authorName:
        r.authorFullName ||
        (r.authorEmail ? r.authorEmail.split("@")[0]! : "—"),
      body: r.body,
      createdAt: r.createdAt.getTime(),
      link: `${pending.appUrl}/?chat=1&channel=${r.channelId}&message=${r.id}`,
    }));
  if (items.length === 0) return;

  const msg = generateMentionDigest({
    to: user.email,
    recipientName: user.fullName || user.email.split("@")[0] || "коллега",
    items,
  });
  try {
    const client = await getEmailClient();
    await client.send(msg);
  } catch {
    // Best-effort: digest send failures are not fatal. Next mention will
    // start a fresh batch.
  }
}

/** Test helper: drop all pending digests. */
export function _resetMentionDigest(): void {
  for (const p of queue.values()) clearTimeout(p.timer);
  queue.clear();
}

/** Test helper: synchronously flush a user's pending digest (used to avoid
 * sleeping for QUIET_MS in tests). */
export async function _flushUserNow(db: DB, userId: number): Promise<void> {
  const pending = queue.get(userId);
  if (!pending) return;
  clearTimeout(pending.timer);
  await flushUser(db, userId);
}

/** Test helper: peek at queued user ids. */
export function _pendingUserIds(): number[] {
  return [...queue.keys()];
}
