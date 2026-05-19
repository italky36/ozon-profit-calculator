import { and, eq, ne } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  chatChannelMembers,
  chatChannels,
  chatMessages,
} from "../db/schema";
import { isUserOnline } from "./presence";
import { sendPushToUsers, type PushPayload } from "../lib/webPush";

const BODY_PREVIEW_MAX = 140;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

interface DispatchInput {
  db: DB;
  workspaceId: number;
  channelId: number;
  messageId: number;
  authorUserId: number;
  authorName: string;
  body: string;
  /** Channel display name — used as the notification title for regular
   *  channels («#general») and replaced for DMs (author name). */
  channelName: string;
  channelType: "channel" | "dm";
  /** parentMessageId of the new message, if any. Drives audience expansion
   *  (thread participants) and notification framing («ответ в треде»). */
  parentMessageId: number | null;
  /** Mentioned userIds already resolved by syncMentions(). */
  mentionedUserIds: ReadonlyArray<number>;
  /** App base URL for the click-deep-link in the payload. */
  appUrl: string;
}

/** Choose who should receive a web-push for this message and dispatch it.
 *
 * Audience:
 *   - DM channel: the other participant (always, regardless of online).
 *     UI suppresses the OS toast when their tab is focused via the
 *     `clientFocused` check inside the SW; presence here would race the
 *     foreground state.
 *   - Mentioned users (regardless of channel type).
 *   - Thread participants (everyone who already posted in the thread).
 *
 * Filtering: skip the author; skip anyone currently online (live WS),
 * since they see the message in-app. Leftover targets get one push each.
 *
 * Caller wires this in after every successful message POST. Async; never
 * throws — push failures are best-effort and logged via the webPush
 * wrapper (which also cleans up 410/404 subscriptions). */
export async function dispatchPushForMessage(
  input: DispatchInput,
): Promise<void> {
  const audience = new Set<number>(input.mentionedUserIds);

  // DM participants — both, minus self (added below by skip).
  if (input.channelType === "dm") {
    const members = await input.db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(eq(chatChannelMembers.channelId, input.channelId));
    for (const m of members) audience.add(m.userId);
  }

  // Thread participants — anyone who posted in this thread (including the
  // root author). Cheap query bounded by parent_message_id index.
  if (input.parentMessageId != null) {
    const replies = await input.db
      .select({ authorUserId: chatMessages.authorUserId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.parentMessageId, input.parentMessageId),
          ne(chatMessages.id, input.messageId),
        ),
      );
    for (const r of replies) {
      if (r.authorUserId != null) audience.add(r.authorUserId);
    }
    // Also the root author — they presumably want to know.
    const [root] = await input.db
      .select({ authorUserId: chatMessages.authorUserId })
      .from(chatMessages)
      .where(eq(chatMessages.id, input.parentMessageId));
    if (root?.authorUserId != null) audience.add(root.authorUserId);
  }

  // Skip the author and currently-online users.
  audience.delete(input.authorUserId);
  const targets: number[] = [];
  for (const uid of audience) {
    if (!isUserOnline(input.workspaceId, uid)) targets.push(uid);
  }
  if (targets.length === 0) return;

  const isDm = input.channelType === "dm";
  const title = isDm ? input.authorName : `#${input.channelName}`;
  const bodyPrefix = isDm
    ? ""
    : input.parentMessageId != null
      ? `${input.authorName} в треде: `
      : `${input.authorName}: `;
  const body = truncate(bodyPrefix + (input.body || "📎 вложение"), BODY_PREVIEW_MAX);

  const url = `${input.appUrl}/?chat=1&channel=${input.channelId}&message=${input.messageId}`;
  const payload: PushPayload = {
    title,
    body,
    url,
    tag: `channel-${input.channelId}`,
    data: {
      channelId: input.channelId,
      messageId: input.messageId,
      type: isDm ? "dm" : input.parentMessageId != null ? "reply" : "message",
    },
  };

  await sendPushToUsers(input.db, targets, payload);
}

/** Variant used when the caller already loaded the channel row — saves a
 * lookup. Same audience logic. */
export async function dispatchPushForMessageWithChannel(input: {
  db: DB;
  workspaceId: number;
  channel: typeof chatChannels.$inferSelect & { name: string };
  messageId: number;
  authorUserId: number;
  authorName: string;
  body: string;
  parentMessageId: number | null;
  mentionedUserIds: ReadonlyArray<number>;
  appUrl: string;
  /** For DMs — pass the peer's display name as the notification title; for
   *  channels — uses channel.name verbatim. */
  dmTitleOverride?: string;
}): Promise<void> {
  return dispatchPushForMessage({
    db: input.db,
    workspaceId: input.workspaceId,
    channelId: input.channel.id,
    messageId: input.messageId,
    authorUserId: input.authorUserId,
    authorName: input.authorName,
    body: input.body,
    channelName: input.dmTitleOverride ?? input.channel.name,
    channelType: input.channel.type,
    parentMessageId: input.parentMessageId,
    mentionedUserIds: input.mentionedUserIds,
    appUrl: input.appUrl,
  });
}

/** Probe non-empty audience targets — used by tests to assert the
 * dispatch decision without actually firing pushes. Kept separate from
 * dispatchPushForMessage so the actual orchestration stays a single
 * code path. */
export async function _selectPushTargets(input: {
  db: DB;
  workspaceId: number;
  channelId: number;
  channelType: "channel" | "dm";
  messageId: number;
  authorUserId: number;
  parentMessageId: number | null;
  mentionedUserIds: ReadonlyArray<number>;
}): Promise<number[]> {
  const audience = new Set<number>(input.mentionedUserIds);
  if (input.channelType === "dm") {
    const members = await input.db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(eq(chatChannelMembers.channelId, input.channelId));
    for (const m of members) audience.add(m.userId);
  }
  if (input.parentMessageId != null) {
    const replies = await input.db
      .select({ authorUserId: chatMessages.authorUserId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.parentMessageId, input.parentMessageId),
          ne(chatMessages.id, input.messageId),
        ),
      );
    for (const r of replies) {
      if (r.authorUserId != null) audience.add(r.authorUserId);
    }
    const [root] = await input.db
      .select({ authorUserId: chatMessages.authorUserId })
      .from(chatMessages)
      .where(eq(chatMessages.id, input.parentMessageId));
    if (root?.authorUserId != null) audience.add(root.authorUserId);
  }
  audience.delete(input.authorUserId);
  return [...audience].filter(
    (uid) => !isUserOnline(input.workspaceId, uid),
  );
}
