import { Hono } from "hono";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { canManageWorkspace, requireAuth } from "../middleware/session";
import {
  chatAttachments,
  chatChannelMembers,
  chatChannelReads,
  chatChannels,
  chatMessageMentions,
  chatMessageReactions,
  chatMessages,
  users,
  workspaceMembers,
} from "../db/schema";
import {
  buildStorageKey,
  getFileStorage,
  safeFilename,
} from "../storage/fileStorage";
import { publish, subscribe, type ChatServerEvent } from "../chat/pubsub";
import { bumpTyping, clearAllForUser, clearTyping } from "../chat/typing";
import { attach, detach, isUserOnline, onlineUserIds } from "../chat/presence";
import { loadMentionsForMessages, resolveMentions } from "../chat/mentions";
import { cancelForUser, queueMention } from "../chat/mentionDigest";
import { resolveAppUrl } from "../lib/appUrl";

type Env = { Variables: { user: SessionUser } };

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/csv",
]);

function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("image/")) return true;
  return ALLOWED_MIME.has(mime);
}

const MESSAGE_PAGE_LIMIT = 50;
const MESSAGE_PAGE_MAX = 200;

interface AuthorOut {
  userId: number;
  email: string;
  fullName: string;
  jobTitle: string | null;
  avatarDataUrl: string | null;
}

interface AttachmentOut {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

interface ReactionAggregate {
  emoji: string;
  count: number;
  /** Reacted user ids (small list — usually <10 per emoji per message). */
  userIds: number[];
}

interface MentionOut {
  userId: number;
  name: string;
  email: string;
}

interface MessageOut {
  id: number;
  channelId: number;
  /** Thread parent id, or NULL for root-канальных сообщений. */
  parentMessageId: number | null;
  /** Кол-во ответов в треде. 0 для replies (треды одноуровневые) и для root'а
   * без ответов. Заполняется отдельным агрегатом в listing/loadMessageOut. */
  replyCount: number;
  /** Юзеры (кроме автора), у которых `last_read_message_id >= this.id`. UI
   * рисует «прочитано» только под последним собственным сообщением — иначе
   * под каждым сообщением будет шум. Пустой для replies в треде (там своя
   * семантика «прочитанности» — не реализована, тред смотрят только
   * заинтересованные). */
  readerUserIds: number[];
  body: string;
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
  author: AuthorOut;
  attachments: AttachmentOut[];
  reactions: ReactionAggregate[];
  mentions: MentionOut[];
}

interface ChannelOut {
  id: number;
  name: string;
  /** Kind discriminator. UI groups by this — «Каналы» vs «Личные сообщения». */
  type: "channel" | "dm";
  /** Private channel — visibility / pubsub scoped to chat_channel_members.
   *  Always false for DMs (the type already implies privacy). */
  isPrivate: boolean;
  isDefault: boolean;
  createdAt: number;
  archivedAt: number | null;
  /** True when the current user can edit channel metadata + member roster.
   *  Workspace owner/manager → always; channel creator → for their own.
   *  Open channels: still gated to owner/manager for rename/archive. */
  canManage: boolean;
  /** Unread = `count(messages WHERE id > lastReadMessageId AND author_user_id != currentUser
   *  AND deleted_at IS NULL AND parent_message_id IS NULL)`. Treads-replies не
   *  считаются (UI badge — про root-feed). */
  unreadCount: number;
  /** Last read pointer. NULL → юзер ни разу не отмечал прочитанным. */
  lastReadMessageId: number | null;
  /** For type='dm' — the other participant. NULL for type='channel'. */
  peer: {
    userId: number;
    email: string;
    fullName: string;
    jobTitle: string | null;
    avatarDataUrl: string | null;
  } | null;
}

async function authorsByIds(
  db: DB,
  ids: number[],
): Promise<Map<number, AuthorOut>> {
  const out = new Map<number, AuthorOut>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const row = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        jobTitle: users.jobTitle,
        avatarDataUrl: users.avatarDataUrl,
      })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (row) {
      out.set(row.id, {
        userId: row.id,
        email: row.email,
        fullName: row.fullName,
        jobTitle: row.jobTitle,
        avatarDataUrl: row.avatarDataUrl,
      });
    }
  }
  return out;
}

function attachmentUrl(attachmentId: number): string {
  return `/api/chat/attachments/${attachmentId}`;
}

function toMessageOut(
  msg: {
    id: number;
    channelId: number;
    authorUserId: number | null;
    parentMessageId: number | null;
    body: string;
    createdAt: Date;
    editedAt: Date | null;
    deletedAt: Date | null;
  },
  attachments: Array<{
    id: number;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>,
  author: AuthorOut | undefined,
  reactions: ReactionAggregate[],
  mentions: MentionOut[],
  replyCount: number,
  readerUserIds: number[],
): MessageOut {
  return {
    id: msg.id,
    channelId: msg.channelId,
    parentMessageId: msg.parentMessageId,
    replyCount,
    readerUserIds,
    body: msg.deletedAt ? "" : msg.body,
    createdAt: msg.createdAt.getTime(),
    editedAt: msg.editedAt ? msg.editedAt.getTime() : null,
    deletedAt: msg.deletedAt ? msg.deletedAt.getTime() : null,
    author: author ?? {
      userId: msg.authorUserId ?? 0,
      email: "",
      fullName: "удалённый пользователь",
      jobTitle: null,
      avatarDataUrl: null,
    },
    attachments: msg.deletedAt
      ? []
      : attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          url: attachmentUrl(a.id),
        })),
    reactions: msg.deletedAt ? [] : reactions,
    mentions: msg.deletedAt ? [] : mentions,
  };
}

/** Per-message reader list. Single SELECT over chat_channel_reads scoped to
 * the channel; in-memory bucket per message excluding the author. For a
 * 20-person workspace this is at most 20 rows even when paging 50 messages —
 * cheaper than 50 individual COUNTs. */
async function readersForMessages(
  db: DB,
  channelId: number,
  messages: Array<{ id: number; authorUserId: number | null }>,
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (messages.length === 0) return out;
  const rows = await db
    .select({
      userId: chatChannelReads.userId,
      lastReadMessageId: chatChannelReads.lastReadMessageId,
    })
    .from(chatChannelReads)
    .where(
      and(
        eq(chatChannelReads.channelId, channelId),
        // Skip pointers that haven't been set yet — they read nothing.
        // Drizzle has no notNull op; use IS NOT NULL via raw sql.
        sql`${chatChannelReads.lastReadMessageId} IS NOT NULL`,
      ),
    );
  for (const m of messages) {
    const readers: number[] = [];
    for (const r of rows) {
      if (r.lastReadMessageId == null) continue;
      if (r.userId === m.authorUserId) continue;
      if (r.lastReadMessageId >= m.id) readers.push(r.userId);
    }
    out.set(m.id, readers);
  }
  return out;
}

/** Count of non-deleted children for each parent message. */
async function replyCountsForParents(
  db: DB,
  parentIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (parentIds.length === 0) return out;
  const rows = await db
    .select({
      parentId: chatMessages.parentMessageId,
      count: sql<number>`COUNT(*)`,
    })
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.parentMessageId, parentIds),
        isNull(chatMessages.deletedAt),
      ),
    )
    .groupBy(chatMessages.parentMessageId);
  for (const r of rows) {
    if (r.parentId != null) out.set(r.parentId, Number(r.count));
  }
  return out;
}

async function reactionsByMessage(
  db: DB,
  messageIds: number[],
): Promise<Map<number, ReactionAggregate[]>> {
  const out = new Map<number, ReactionAggregate[]>();
  if (messageIds.length === 0) return out;
  const rows = await db
    .select({
      messageId: chatMessageReactions.messageId,
      userId: chatMessageReactions.userId,
      emoji: chatMessageReactions.emoji,
    })
    .from(chatMessageReactions)
    .where(inArray(chatMessageReactions.messageId, messageIds));
  // Group: messageId → emoji → ReactionAggregate.
  const grouped = new Map<number, Map<string, ReactionAggregate>>();
  for (const r of rows) {
    let perMsg = grouped.get(r.messageId);
    if (!perMsg) {
      perMsg = new Map();
      grouped.set(r.messageId, perMsg);
    }
    let agg = perMsg.get(r.emoji);
    if (!agg) {
      agg = { emoji: r.emoji, count: 0, userIds: [] };
      perMsg.set(r.emoji, agg);
    }
    agg.count += 1;
    agg.userIds.push(r.userId);
  }
  for (const [msgId, perMsg] of grouped) {
    out.set(msgId, [...perMsg.values()].sort((a, b) => b.count - a.count));
  }
  return out;
}

/** Re-sync mention rows for a message after insert/edit. Idempotent —
 * deletes existing rows for the message and re-inserts the current set.
 * Returns the resolved user ids so the caller can dispatch downstream
 * notifications (digest queue, push) without re-running the regex. */
async function syncMentions(
  db: DB,
  messageId: number,
  workspaceId: number,
  body: string,
): Promise<number[]> {
  await db
    .delete(chatMessageMentions)
    .where(eq(chatMessageMentions.messageId, messageId));
  const userIds = await resolveMentions(db, workspaceId, body);
  if (userIds.length === 0) return [];
  await db.insert(chatMessageMentions).values(
    userIds.map((userId) => ({ messageId, userId })),
  );
  return userIds;
}

/** Notify mentioned users who are currently offline. Online users see the
 * mention in-app (live WS feed); for them this is a no-op. The author is
 * always skipped (self-mentions don't email). */
function dispatchMentionDigests(input: {
  db: DB;
  workspaceId: number;
  authorUserId: number;
  messageId: number;
  userIds: number[];
  appUrl: string;
}): void {
  for (const uid of input.userIds) {
    if (uid === input.authorUserId) continue;
    if (isUserOnline(input.workspaceId, uid)) continue;
    queueMention({
      db: input.db,
      workspaceId: input.workspaceId,
      userId: uid,
      messageId: input.messageId,
      appUrl: input.appUrl,
    });
  }
}

async function loadMessageOut(
  db: DB,
  messageId: number,
): Promise<MessageOut | null> {
  const msg = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .get();
  if (!msg) return null;
  const atts = await db
    .select({
      id: chatAttachments.id,
      filename: chatAttachments.filename,
      mimeType: chatAttachments.mimeType,
      sizeBytes: chatAttachments.sizeBytes,
    })
    .from(chatAttachments)
    .where(eq(chatAttachments.messageId, messageId));
  const authors =
    msg.authorUserId != null
      ? await authorsByIds(db, [msg.authorUserId])
      : new Map<number, AuthorOut>();
  const reactionsMap = await reactionsByMessage(db, [messageId]);
  const mentionsMap = await loadMentionsForMessages(db, [messageId]);
  // Only root messages (parent_message_id IS NULL) can have replies — for
  // reply rows replyCount is always 0.
  const replyMap =
    msg.parentMessageId == null
      ? await replyCountsForParents(db, [messageId])
      : new Map<number, number>();
  // Readers only computed for root messages — reply read-status isn't
  // tracked separately (thread participants self-select).
  const readersMap =
    msg.parentMessageId == null
      ? await readersForMessages(db, msg.channelId, [msg])
      : new Map<number, number[]>();
  return toMessageOut(
    msg,
    atts,
    msg.authorUserId != null ? authors.get(msg.authorUserId) : undefined,
    reactionsMap.get(messageId) ?? [],
    mentionsMap.get(messageId) ?? [],
    replyMap.get(messageId) ?? 0,
    readersMap.get(messageId) ?? [],
  );
}

/** Workspace + per-channel-type access check.
 *
 * - type='channel' → any workspace member can access (current behaviour).
 * - type='dm'      → only if the user has a row in chat_channel_members.
 *
 * Returns the channel row on success, null on miss / forbidden. Distinct
 * 404 vs 403 is deliberately collapsed: «not found» is the same response
 * a third party would get for a non-existent channel — avoids leaking the
 * existence of DMs to non-participants. */
async function userCanAccessChannel(
  db: DB,
  user: SessionUser,
  channelId: number,
): Promise<typeof chatChannels.$inferSelect | null> {
  const row = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .get();
  if (!row) return null;
  if (row.workspaceId !== user.workspaceId) return null;
  // DM and private channels both gate by chat_channel_members. Open
  // channels (type='channel' && !is_private) are visible to every
  // workspace member.
  const needsMembership = row.type === "dm" || row.isPrivate;
  if (needsMembership) {
    const member = await db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, user.id),
        ),
      )
      .get();
    if (!member) return null;
  }
  return row;
}

/** Compute the recipient set for a publish() call on a given channel:
 *   - 'channel' → undefined (workspace-wide broadcast preserved).
 *   - 'dm'      → Set of the DM's two member userIds.
 *
 * Routes call this whenever they publish a message/reaction/read/delete so
 * DM events stay scoped to participants only. */
async function channelRecipients(
  db: DB,
  channel: typeof chatChannels.$inferSelect,
): Promise<ReadonlySet<number> | undefined> {
  // Both DMs and private channels gate delivery by membership; open
  // channels broadcast workspace-wide (undefined ⇒ no filter).
  if (channel.type !== "dm" && !channel.isPrivate) return undefined;
  const rows = await db
    .select({ userId: chatChannelMembers.userId })
    .from(chatChannelMembers)
    .where(eq(chatChannelMembers.channelId, channel.id));
  return new Set(rows.map((r) => r.userId));
}

/** Hono environment-typed upgradeWebSocket — injected from server/index.ts so
 * we can share the singleton @hono/node-ws instance with all routes. */
type UpgradeWebSocket = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (c: any) => {
    onOpen?: (evt: unknown, ws: { send: (data: string) => void; close?: () => void }) => void;
    onMessage?: (evt: { data: unknown }, ws: { send: (data: string) => void; close?: () => void }) => void;
    onClose?: () => void;
    onError?: (err: unknown) => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any;

export function chatRoutes(
  db: DB,
  upgradeWebSocket: UpgradeWebSocket | null,
): Hono<Env> {
  const app = new Hono<Env>();

  // Sysadmins don't belong to any workspace's chat. Everything below requires
  // a workspace; reject sysadmin requests at the top of the route.
  app.use("*", async (c, next) => {
    const user = c.get("user");
    if (user.isSysadmin || user.workspaceId === 0) {
      return c.json({ error: "chat is workspace-scoped" }, 403);
    }
    await next();
  });

  // === Channels ===
  app.get("/channels", async (c) => {
    const user = c.get("user");
    // Two-query union: regular channels (open OR private-where-I'm-a-member)
    // + DMs where the current user is a participant. The LEFT JOIN +
    // OR clause for channels keeps public ones visible to everyone while
    // gating private ones by membership.
    const channelRows = await db
      .select({
        id: chatChannels.id,
        name: chatChannels.name,
        type: chatChannels.type,
        isPrivate: chatChannels.isPrivate,
        isDefault: chatChannels.isDefault,
        createdBy: chatChannels.createdBy,
        createdAt: chatChannels.createdAt,
        archivedAt: chatChannels.archivedAt,
      })
      .from(chatChannels)
      .leftJoin(
        chatChannelMembers,
        and(
          eq(chatChannelMembers.channelId, chatChannels.id),
          eq(chatChannelMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(chatChannels.workspaceId, user.workspaceId),
          eq(chatChannels.type, "channel"),
          or(
            eq(chatChannels.isPrivate, false),
            sql`${chatChannelMembers.userId} IS NOT NULL`,
          ),
        ),
      )
      .orderBy(chatChannels.createdAt);
    const dmRows = await db
      .select({
        id: chatChannels.id,
        name: chatChannels.name,
        type: chatChannels.type,
        isPrivate: chatChannels.isPrivate,
        isDefault: chatChannels.isDefault,
        createdBy: chatChannels.createdBy,
        createdAt: chatChannels.createdAt,
        archivedAt: chatChannels.archivedAt,
      })
      .from(chatChannels)
      .innerJoin(
        chatChannelMembers,
        and(
          eq(chatChannelMembers.channelId, chatChannels.id),
          eq(chatChannelMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(chatChannels.workspaceId, user.workspaceId),
          eq(chatChannels.type, "dm"),
        ),
      )
      .orderBy(chatChannels.createdAt);
    const rows = [...channelRows, ...dmRows];
    const channelIds = rows.map((r) => r.id);

    // Peer enrichment for DMs: load the «other» member's identity.
    const dmIds = dmRows.map((r) => r.id);
    const peerByChannel = new Map<
      number,
      {
        userId: number;
        email: string;
        fullName: string;
        jobTitle: string | null;
        avatarDataUrl: string | null;
      }
    >();
    if (dmIds.length > 0) {
      const peerRows = await db
        .select({
          channelId: chatChannelMembers.channelId,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          jobTitle: users.jobTitle,
          avatarDataUrl: users.avatarDataUrl,
        })
        .from(chatChannelMembers)
        .innerJoin(users, eq(users.id, chatChannelMembers.userId))
        .where(
          and(
            inArray(chatChannelMembers.channelId, dmIds),
            ne(chatChannelMembers.userId, user.id),
          ),
        );
      for (const r of peerRows) {
        peerByChannel.set(r.channelId, {
          userId: r.userId,
          email: r.email,
          fullName: r.fullName,
          jobTitle: r.jobTitle,
          avatarDataUrl: r.avatarDataUrl,
        });
      }
    }
    // Read pointers per channel for current user.
    const reads =
      channelIds.length > 0
        ? await db
            .select({
              channelId: chatChannelReads.channelId,
              lastReadMessageId: chatChannelReads.lastReadMessageId,
            })
            .from(chatChannelReads)
            .where(
              and(
                eq(chatChannelReads.userId, user.id),
                inArray(chatChannelReads.channelId, channelIds),
              ),
            )
        : [];
    const lastReadByChannel = new Map<number, number | null>();
    for (const r of reads) {
      lastReadByChannel.set(r.channelId, r.lastReadMessageId);
    }
    // unreadCount per channel: count messages newer than the read pointer
    // (or all messages if no pointer), excluding own messages, deleted ones,
    // and thread-replies (those don't bump the channel-feed badge).
    const unreadByChannel = new Map<number, number>();
    if (channelIds.length > 0) {
      const counts = await db
        .select({
          channelId: chatMessages.channelId,
          count: sql<number>`COUNT(*)`,
        })
        .from(chatMessages)
        .leftJoin(
          chatChannelReads,
          and(
            eq(chatChannelReads.channelId, chatMessages.channelId),
            eq(chatChannelReads.userId, user.id),
          ),
        )
        .where(
          and(
            inArray(chatMessages.channelId, channelIds),
            isNull(chatMessages.deletedAt),
            isNull(chatMessages.parentMessageId),
            ne(chatMessages.authorUserId, user.id),
            or(
              isNull(chatChannelReads.lastReadMessageId),
              gt(
                chatMessages.id,
                sql`${chatChannelReads.lastReadMessageId}`,
              ),
            ),
          ),
        )
        .groupBy(chatMessages.channelId);
      for (const r of counts) {
        unreadByChannel.set(r.channelId, Number(r.count));
      }
    }
    const isWorkspaceManager = canManageWorkspace(user.workspaceRole);
    const out: ChannelOut[] = rows.map((r) => {
      const peer = r.type === "dm" ? peerByChannel.get(r.id) ?? null : null;
      const name =
        r.type === "dm"
          ? peer?.fullName ||
            peer?.email.split("@")[0] ||
            `user${peer?.userId ?? 0}`
          : r.name;
      // Manage rights: workspace owner/manager → any channel; channel
      // creator → their own. DMs never «managed» (no roster editing).
      const canManage =
        r.type === "dm"
          ? false
          : isWorkspaceManager || r.createdBy === user.id;
      return {
        id: r.id,
        name,
        type: r.type,
        isPrivate: r.isPrivate,
        isDefault: r.isDefault,
        createdAt: r.createdAt.getTime(),
        archivedAt: r.archivedAt ? r.archivedAt.getTime() : null,
        canManage,
        unreadCount: unreadByChannel.get(r.id) ?? 0,
        lastReadMessageId: lastReadByChannel.get(r.id) ?? null,
        peer,
      };
    });
    return c.json(out);
  });

  app.post("/channels", async (c) => {
    const user = c.get("user");
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json(
        { error: "только owner или manager может создавать каналы" },
        403,
      );
    }
    let body: { name?: unknown; isPrivate?: unknown; memberIds?: unknown };
    try {
      body = (await c.req.json()) as {
        name?: unknown;
        isPrivate?: unknown;
        memberIds?: unknown;
      };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: "name is required" }, 400);
    if (name.length > 80)
      return c.json({ error: "name must be ≤80 chars" }, 400);
    const isPrivate = body.isPrivate === true;
    let memberIds: number[] = [];
    if (isPrivate) {
      // For private channels we accept an explicit member list (creator is
      // always added). Empty list is fine — owner can add later.
      const rawIds = Array.isArray(body.memberIds) ? body.memberIds : [];
      const cleaned = new Set<number>();
      cleaned.add(user.id);
      for (const v of rawIds) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        if (n === user.id) continue;
        cleaned.add(n);
      }
      // Verify all are in the same workspace — drop any outsiders silently.
      const candidates = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, user.workspaceId),
            inArray(workspaceMembers.userId, [...cleaned]),
          ),
        );
      memberIds = candidates.map((r) => r.userId);
    }

    const now = new Date();
    const created = await db
      .insert(chatChannels)
      .values({
        workspaceId: user.workspaceId,
        name,
        type: "channel",
        isPrivate,
        isDefault: false,
        createdBy: user.id,
        createdAt: now,
      })
      .returning()
      .get();
    if (isPrivate && memberIds.length > 0) {
      await db.insert(chatChannelMembers).values(
        memberIds.map((userId) => ({
          channelId: created.id,
          userId,
          createdAt: now,
        })),
      );
    }
    const out: ChannelOut = {
      id: created.id,
      name: created.name,
      type: "channel",
      isPrivate: created.isPrivate,
      isDefault: created.isDefault,
      createdAt: created.createdAt.getTime(),
      archivedAt: null,
      canManage: true,
      unreadCount: 0,
      lastReadMessageId: null,
      peer: null,
    };
    // For private channels, scope channel.created to actual members so
    // non-members don't even learn the channel exists.
    publish(
      user.workspaceId,
      {
        type: "channel.created",
        channelId: created.id,
        workspaceId: user.workspaceId,
        payload: out,
      },
      isPrivate ? new Set(memberIds) : undefined,
    );
    return c.json(out, 201);
  });

  app.patch("/channels/:id", async (c) => {
    const user = c.get("user");
    if (!canManageWorkspace(user.workspaceRole)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, id);
    if (!channel) return c.json({ error: "channel not found" }, 404);

    let body: { name?: unknown; archived?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown; archived?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const patch: Partial<typeof chatChannels.$inferInsert> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return c.json({ error: "name cannot be empty" }, 400);
      if (name.length > 80)
        return c.json({ error: "name must be ≤80 chars" }, 400);
      patch.name = name;
    }
    if (typeof body.archived === "boolean") {
      if (channel.isDefault && body.archived) {
        return c.json({ error: "нельзя архивировать дефолтный канал" }, 400);
      }
      patch.archivedAt = body.archived ? new Date() : null;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "nothing to update" }, 400);
    }
    const updated = await db
      .update(chatChannels)
      .set(patch)
      .where(eq(chatChannels.id, id))
      .returning()
      .get();
    // After PATCH we send back the read-state for current user; other users'
    // unread counters update via the existing channel.* event + their own
    // refetch flow (channel meta change is rare).
    const myRead = await db
      .select({
        lastReadMessageId: chatChannelReads.lastReadMessageId,
      })
      .from(chatChannelReads)
      .where(
        and(
          eq(chatChannelReads.channelId, id),
          eq(chatChannelReads.userId, user.id),
        ),
      )
      .get();
    const out: ChannelOut = {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      isPrivate: updated.isPrivate,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt.getTime(),
      archivedAt: updated.archivedAt ? updated.archivedAt.getTime() : null,
      canManage: true,
      unreadCount: 0,
      lastReadMessageId: myRead?.lastReadMessageId ?? null,
      peer: null,
    };
    publish(user.workspaceId, {
      type: patch.archivedAt !== undefined ? "channel.archived" : "channel.updated",
      channelId: id,
      workspaceId: user.workspaceId,
      payload: out,
    });
    return c.json(out);
  });

  // === Channel members ===
  // GET /channels/:id/members → roster for the accordion.
  //   public channel  → all workspace members.
  //   private channel → rows from chat_channel_members joined with users.
  //   dm              → both participants joined with users (same as private).
  // Visible to anyone who can access the channel (userCanAccessChannel).
  app.get("/channels/:id/members", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);
    const needsExplicitRoster = channel.type === "dm" || channel.isPrivate;
    if (needsExplicitRoster) {
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          jobTitle: users.jobTitle,
          avatarDataUrl: users.avatarDataUrl,
        })
        .from(chatChannelMembers)
        .innerJoin(users, eq(users.id, chatChannelMembers.userId))
        .where(eq(chatChannelMembers.channelId, channelId));
      return c.json({ members: rows });
    }
    // Open channel — roster = entire workspace.
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        jobTitle: users.jobTitle,
        avatarDataUrl: users.avatarDataUrl,
      })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, user.workspaceId));
    return c.json({ members: rows });
  });

  /** Gate for editing a channel's roster: workspace owner/manager OR the
   *  channel's creator. Returns the channel row on success, error tuple
   *  otherwise. */
  async function authorizeChannelManage(
    user: SessionUser,
    channelId: number,
  ): Promise<
    | { channel: typeof chatChannels.$inferSelect }
    | { status: 403 | 404; error: string }
  > {
    const channel = await db
      .select()
      .from(chatChannels)
      .where(eq(chatChannels.id, channelId))
      .get();
    if (!channel || channel.workspaceId !== user.workspaceId) {
      return { status: 404, error: "channel not found" };
    }
    if (channel.type === "dm") {
      return { status: 400 as never, error: "DM roster is fixed" };
    }
    const allowed =
      canManageWorkspace(user.workspaceRole) || channel.createdBy === user.id;
    if (!allowed) {
      return {
        status: 403,
        error: "редактировать состав может создатель канала или owner/manager",
      };
    }
    return { channel };
  }

  // POST /channels/:id/members { userId } — add user to a private channel.
  // Open channels can't have explicit members (visibility = workspace).
  // Idempotent: re-adding an existing member is a no-op success.
  app.post("/channels/:id/members", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const gate = await authorizeChannelManage(user, channelId);
    if ("error" in gate) {
      return c.json({ error: gate.error }, gate.status);
    }
    const { channel } = gate;
    if (!channel.isPrivate) {
      return c.json(
        { error: "открытый канал виден всей команде — добавлять не нужно" },
        400,
      );
    }
    let body: { userId?: unknown };
    try {
      body = (await c.req.json()) as { userId?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const targetUserId = Number(body.userId);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return c.json({ error: "invalid userId" }, 400);
    }
    const target = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          eq(users.id, targetUserId),
          eq(workspaceMembers.workspaceId, user.workspaceId),
        ),
      )
      .get();
    if (!target) {
      return c.json({ error: "пользователь не найден в команде" }, 404);
    }
    const now = new Date();
    try {
      await db
        .insert(chatChannelMembers)
        .values({ channelId, userId: targetUserId, createdAt: now });
    } catch {
      // PK conflict — already a member. Idempotent success.
    }
    return c.json({ ok: true });
  });

  // DELETE /channels/:id/members/:userId — remove a user from a private
  // channel. Cannot remove the creator (avoids orphaned channels).
  app.delete("/channels/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    const targetUserId = Number(c.req.param("userId"));
    if (
      !Number.isFinite(channelId) ||
      channelId <= 0 ||
      !Number.isFinite(targetUserId) ||
      targetUserId <= 0
    ) {
      return c.json({ error: "invalid id" }, 400);
    }
    const gate = await authorizeChannelManage(user, channelId);
    if ("error" in gate) {
      return c.json({ error: gate.error }, gate.status);
    }
    const { channel } = gate;
    if (!channel.isPrivate) {
      return c.json({ error: "у открытого канала нет явного состава" }, 400);
    }
    if (channel.createdBy === targetUserId) {
      return c.json({ error: "нельзя удалить создателя канала" }, 400);
    }
    await db
      .delete(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, targetUserId),
        ),
      );
    return c.json({ ok: true });
  });

  // === DMs ===
  // POST /api/chat/dms { userId } — find-or-create a 2-person DM channel
  // between currentUser and target. Idempotent: returns the existing one
  // if it's already there. Both users must be in the same workspace; no
  // self-DM. The DM's `name` in the DB is a placeholder («—»); UI synth-
  // esises a human name from `peer` on the client.
  app.post("/dms", async (c) => {
    const user = c.get("user");
    let body: { userId?: unknown };
    try {
      body = (await c.req.json()) as { userId?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const targetUserId = Number(body.userId);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return c.json({ error: "invalid userId" }, 400);
    }
    if (targetUserId === user.id) {
      return c.json({ error: "нельзя написать самому себе" }, 400);
    }
    // Target must be a member of the same workspace.
    const target = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        jobTitle: users.jobTitle,
        avatarDataUrl: users.avatarDataUrl,
      })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          eq(users.id, targetUserId),
          eq(workspaceMembers.workspaceId, user.workspaceId),
        ),
      )
      .get();
    if (!target) {
      return c.json({ error: "пользователь не найден в команде" }, 404);
    }

    // Find an existing DM where members = {user.id, target.id} exactly.
    // Approach: find dm-channels in this workspace where currentUser is a
    // member, then for each check whether target is also a member and that
    // there are exactly 2 members. With a 1–2 row scan this is fast for any
    // realistic team size.
    const myDmChannels = await db
      .select({ channelId: chatChannels.id })
      .from(chatChannels)
      .innerJoin(
        chatChannelMembers,
        and(
          eq(chatChannelMembers.channelId, chatChannels.id),
          eq(chatChannelMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(chatChannels.workspaceId, user.workspaceId),
          eq(chatChannels.type, "dm"),
        ),
      );
    let existingChannelId: number | null = null;
    for (const c0 of myDmChannels) {
      const memberRows = await db
        .select({ userId: chatChannelMembers.userId })
        .from(chatChannelMembers)
        .where(eq(chatChannelMembers.channelId, c0.channelId));
      if (
        memberRows.length === 2 &&
        memberRows.some((m) => m.userId === target.id)
      ) {
        existingChannelId = c0.channelId;
        break;
      }
    }

    let channelId: number;
    let createdAt: Date;
    if (existingChannelId != null) {
      channelId = existingChannelId;
      const row = await db
        .select({ createdAt: chatChannels.createdAt })
        .from(chatChannels)
        .where(eq(chatChannels.id, channelId))
        .get();
      createdAt = row?.createdAt ?? new Date();
    } else {
      const now = new Date();
      const created = await db
        .insert(chatChannels)
        .values({
          workspaceId: user.workspaceId,
          name: "—",
          type: "dm",
          isDefault: false,
          createdBy: user.id,
          createdAt: now,
        })
        .returning()
        .get();
      channelId = created.id;
      createdAt = created.createdAt;
      await db.insert(chatChannelMembers).values([
        { channelId, userId: user.id, createdAt: now },
        { channelId, userId: target.id, createdAt: now },
      ]);

      // Notify participants — channel.created event scoped to DM members
      // only. The recipient set keeps it out of any other workspace
      // subscribers' sockets.
      const dmRecipients = new Set<number>([user.id, target.id]);
      const peerForOwner = {
        userId: target.id,
        email: target.email,
        fullName: target.fullName,
        jobTitle: target.jobTitle,
        avatarDataUrl: target.avatarDataUrl,
      };
      const out: ChannelOut = {
        id: channelId,
        name: target.fullName || target.email.split("@")[0] || `user${target.id}`,
        type: "dm",
        isPrivate: false,
        isDefault: false,
        createdAt: now.getTime(),
        archivedAt: null,
        canManage: false,
        unreadCount: 0,
        lastReadMessageId: null,
        peer: peerForOwner,
      };
      publish(
        user.workspaceId,
        {
          type: "channel.created",
          channelId,
          workspaceId: user.workspaceId,
          payload: out,
        },
        dmRecipients,
      );
    }

    // Read pointer for current user (if any).
    const myRead = await db
      .select({ lastReadMessageId: chatChannelReads.lastReadMessageId })
      .from(chatChannelReads)
      .where(
        and(
          eq(chatChannelReads.channelId, channelId),
          eq(chatChannelReads.userId, user.id),
        ),
      )
      .get();

    const out: ChannelOut = {
      id: channelId,
      name: target.fullName || target.email.split("@")[0] || `user${target.id}`,
      type: "dm",
      isPrivate: false,
      isDefault: false,
      createdAt: createdAt.getTime(),
      archivedAt: null,
      canManage: false,
      unreadCount: 0,
      lastReadMessageId: myRead?.lastReadMessageId ?? null,
      peer: {
        userId: target.id,
        email: target.email,
        fullName: target.fullName,
        jobTitle: target.jobTitle,
        avatarDataUrl: target.avatarDataUrl,
      },
    };
    return c.json(out, existingChannelId != null ? 200 : 201);
  });

  // === Read receipts ===
  // Bumps the user's read pointer for a channel. Monotone: a smaller messageId
  // is silently ignored (UI may race). messageId must belong to the channel
  // and not be soft-deleted at the moment of the call.
  app.put("/channels/:id/read", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);

    let body: { messageId?: unknown };
    try {
      body = (await c.req.json()) as { messageId?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const messageId = Number(body.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "invalid messageId" }, 400);
    }
    const msg = await db
      .select({ id: chatMessages.id, channelId: chatMessages.channelId })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .get();
    if (!msg || msg.channelId !== channelId) {
      return c.json({ error: "message not in channel" }, 404);
    }

    const now = new Date();
    const existing = await db
      .select({ lastReadMessageId: chatChannelReads.lastReadMessageId })
      .from(chatChannelReads)
      .where(
        and(
          eq(chatChannelReads.channelId, channelId),
          eq(chatChannelReads.userId, user.id),
        ),
      )
      .get();
    let effectiveMessageId = messageId;
    if (!existing) {
      await db.insert(chatChannelReads).values({
        channelId,
        userId: user.id,
        lastReadMessageId: messageId,
        updatedAt: now,
      });
    } else if ((existing.lastReadMessageId ?? 0) < messageId) {
      await db
        .update(chatChannelReads)
        .set({ lastReadMessageId: messageId, updatedAt: now })
        .where(
          and(
            eq(chatChannelReads.channelId, channelId),
            eq(chatChannelReads.userId, user.id),
          ),
        );
    } else {
      // Already at or past this message — no-op, return current pointer.
      effectiveMessageId = existing.lastReadMessageId ?? messageId;
    }

    if (effectiveMessageId === messageId) {
      publish(
        user.workspaceId,
        {
          type: "read.advanced",
          channelId,
          workspaceId: user.workspaceId,
          payload: { userId: user.id, messageId: effectiveMessageId },
        },
        await channelRecipients(db, channel),
      );
    }
    return c.json({
      channelId,
      lastReadMessageId: effectiveMessageId,
    });
  });

  // === Messages ===
  app.get("/channels/:id/messages", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);

    const beforeRaw = c.req.query("before");
    const limitRaw = c.req.query("limit");
    const before = beforeRaw ? Number(beforeRaw) : null;
    const limit = Math.min(
      MESSAGE_PAGE_MAX,
      Math.max(1, Number(limitRaw ?? MESSAGE_PAGE_LIMIT) || MESSAGE_PAGE_LIMIT),
    );

    // Root-only feed — thread replies are loaded separately via
    // GET /messages/:id/thread. Without this filter the channel feed would
    // explode with replies once threads are heavily used.
    const where =
      before != null && Number.isFinite(before)
        ? and(
            eq(chatMessages.channelId, channelId),
            isNull(chatMessages.parentMessageId),
            lt(chatMessages.createdAt, new Date(before)),
          )
        : and(
            eq(chatMessages.channelId, channelId),
            isNull(chatMessages.parentMessageId),
          );

    const rows = await db
      .select()
      .from(chatMessages)
      .where(where)
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);

    const ids = rows.map((r) => r.id);
    const atts =
      ids.length > 0
        ? await db
            .select({
              id: chatAttachments.id,
              messageId: chatAttachments.messageId,
              filename: chatAttachments.filename,
              mimeType: chatAttachments.mimeType,
              sizeBytes: chatAttachments.sizeBytes,
            })
            .from(chatAttachments)
            .where(inArray(chatAttachments.messageId, ids))
        : [];

    const attachmentsByMsg = new Map<
      number,
      Array<{
        id: number;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      }>
    >();
    for (const a of atts) {
      const arr = attachmentsByMsg.get(a.messageId) ?? [];
      arr.push({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      });
      attachmentsByMsg.set(a.messageId, arr);
    }

    const authors = await authorsByIds(
      db,
      rows
        .map((r) => r.authorUserId)
        .filter((id): id is number => id != null),
    );
    const reactionsMap = await reactionsByMessage(db, ids);
    const mentionsMap = await loadMentionsForMessages(db, ids);
    const replyMap = await replyCountsForParents(db, ids);
    const readersMap = await readersForMessages(db, channelId, rows);
    const result: MessageOut[] = rows.map((r) =>
      toMessageOut(
        r,
        attachmentsByMsg.get(r.id) ?? [],
        r.authorUserId != null ? authors.get(r.authorUserId) : undefined,
        reactionsMap.get(r.id) ?? [],
        mentionsMap.get(r.id) ?? [],
        replyMap.get(r.id) ?? 0,
        readersMap.get(r.id) ?? [],
      ),
    );

    return c.json({
      messages: result,
      hasMore: rows.length === limit,
    });
  });

  /** Validate a thread parent: must exist, live in the same channel, not be
   * itself a reply (one-level threads only), and not be hard-deleted. Returns
   * an HTTP error tuple if invalid, or `null` to proceed. */
  async function validateThreadParent(
    parentMessageId: number,
    channelId: number,
  ): Promise<{ status: number; error: string } | null> {
    const parent = await db
      .select({
        id: chatMessages.id,
        channelId: chatMessages.channelId,
        parentMessageId: chatMessages.parentMessageId,
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, parentMessageId))
      .get();
    if (!parent) return { status: 404, error: "parent message not found" };
    if (parent.channelId !== channelId)
      return { status: 400, error: "parent message is in another channel" };
    if (parent.parentMessageId != null)
      return {
        status: 400,
        error: "вложенные треды не поддерживаются — отвечайте на root-сообщение",
      };
    return null;
  }

  app.post("/channels/:id/messages", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);
    if (channel.archivedAt) {
      return c.json({ error: "канал заархивирован" }, 400);
    }

    let body: { body?: unknown; parentMessageId?: unknown };
    try {
      body = (await c.req.json()) as {
        body?: unknown;
        parentMessageId?: unknown;
      };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const text = String(body.body ?? "").trim();
    if (!text) return c.json({ error: "сообщение не может быть пустым" }, 400);
    if (text.length > 10000)
      return c.json({ error: "сообщение слишком длинное" }, 400);

    let parentMessageId: number | null = null;
    if (body.parentMessageId != null) {
      const n = Number(body.parentMessageId);
      if (!Number.isFinite(n) || n <= 0) {
        return c.json({ error: "invalid parentMessageId" }, 400);
      }
      const err = await validateThreadParent(n, channelId);
      if (err) return c.json({ error: err.error }, err.status as 400 | 404);
      parentMessageId = n;
    }

    const now = new Date();
    const created = await db
      .insert(chatMessages)
      .values({
        channelId,
        authorUserId: user.id,
        parentMessageId,
        body: text,
        createdAt: now,
      })
      .returning()
      .get();
    const mentionedIds = await syncMentions(
      db,
      created.id,
      user.workspaceId,
      text,
    );

    const out = await loadMessageOut(db, created.id);
    if (!out) return c.json({ error: "internal" }, 500);
    const recipients = await channelRecipients(db, channel);
    publish(
      user.workspaceId,
      {
        type: "message.created",
        channelId,
        messageId: created.id,
        workspaceId: user.workspaceId,
        payload: out,
      },
      recipients,
    );
    dispatchMentionDigests({
      db,
      workspaceId: user.workspaceId,
      authorUserId: user.id,
      messageId: created.id,
      userIds: mentionedIds,
      appUrl: resolveAppUrl(c),
    });
    // Thread reply also bumps the parent's reply count for any open
    // ThreadPanel — emit a message.updated event for the parent with the
    // fresh count. Cheap: one extra loadMessageOut.
    if (parentMessageId != null) {
      const updatedParent = await loadMessageOut(db, parentMessageId);
      if (updatedParent) {
        publish(
          user.workspaceId,
          {
            type: "message.updated",
            channelId,
            messageId: parentMessageId,
            workspaceId: user.workspaceId,
            payload: updatedParent,
          },
          recipients,
        );
      }
    }
    return c.json(out, 201);
  });

  app.post("/channels/:id/messages/with-attachments", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await userCanAccessChannel(db, user, channelId);
    if (!channel) return c.json({ error: "channel not found" }, 404);
    if (channel.archivedAt) {
      return c.json({ error: "канал заархивирован" }, 400);
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "expected multipart/form-data" }, 400);
    }

    const bodyText = String(formData.get("body") ?? "").trim().slice(0, 10000);
    const files = formData.getAll("file").filter((v): v is File => v instanceof File);
    if (files.length === 0 && !bodyText) {
      return c.json({ error: "пустое сообщение без вложений" }, 400);
    }
    if (files.length > 10) {
      return c.json({ error: "не более 10 вложений за раз" }, 400);
    }

    const parentRaw = formData.get("parentMessageId");
    let parentMessageId: number | null = null;
    if (parentRaw != null && parentRaw !== "") {
      const n = Number(parentRaw);
      if (!Number.isFinite(n) || n <= 0) {
        return c.json({ error: "invalid parentMessageId" }, 400);
      }
      const err = await validateThreadParent(n, channelId);
      if (err) return c.json({ error: err.error }, err.status as 400 | 404);
      parentMessageId = n;
    }

    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return c.json(
          { error: `файл «${f.name}» больше 25 МБ` },
          413,
        );
      }
      if (!isAllowedMime(f.type)) {
        return c.json(
          { error: `тип файла «${f.type || "unknown"}» не разрешён` },
          415,
        );
      }
    }

    const now = new Date();
    const message = await db
      .insert(chatMessages)
      .values({
        channelId,
        authorUserId: user.id,
        parentMessageId,
        body: bodyText,
        createdAt: now,
      })
      .returning()
      .get();
    let mentionedIds: number[] = [];
    if (bodyText) {
      mentionedIds = await syncMentions(
        db,
        message.id,
        user.workspaceId,
        bodyText,
      );
    }

    const storage = getFileStorage();
    const savedAttachments: Array<{
      id: number;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }> = [];

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const attachment = await db
        .insert(chatAttachments)
        .values({
          messageId: message.id,
          storageKey: "pending",
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          createdAt: now,
        })
        .returning()
        .get();
      const key = buildStorageKey(
        user.workspaceId,
        attachment.id,
        file.name,
        now,
      );
      try {
        await storage.put(key, buf);
      } catch (err) {
        await db
          .delete(chatAttachments)
          .where(eq(chatAttachments.id, attachment.id));
        await db.delete(chatMessages).where(eq(chatMessages.id, message.id));
        return c.json(
          { error: `не удалось сохранить файл: ${(err as Error).message}` },
          500,
        );
      }
      await db
        .update(chatAttachments)
        .set({ storageKey: key })
        .where(eq(chatAttachments.id, attachment.id));
      savedAttachments.push({
        id: attachment.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
    }

    const out = await loadMessageOut(db, message.id);
    if (!out) return c.json({ error: "internal" }, 500);
    const recipients = await channelRecipients(db, channel);
    publish(
      user.workspaceId,
      {
        type: "message.created",
        channelId,
        messageId: message.id,
        workspaceId: user.workspaceId,
        payload: out,
      },
      recipients,
    );
    dispatchMentionDigests({
      db,
      workspaceId: user.workspaceId,
      authorUserId: user.id,
      messageId: message.id,
      userIds: mentionedIds,
      appUrl: resolveAppUrl(c),
    });
    if (parentMessageId != null) {
      const updatedParent = await loadMessageOut(db, parentMessageId);
      if (updatedParent) {
        publish(
          user.workspaceId,
          {
            type: "message.updated",
            channelId,
            messageId: parentMessageId,
            workspaceId: user.workspaceId,
            payload: updatedParent,
          },
          recipients,
        );
      }
    }
    return c.json(out, 201);
  });

  // === Threads ===
  // GET /messages/:id/thread → all replies (parent + replies, replies sorted
  // ASC by createdAt). Workspace-scoped via the parent message's channel.
  // Returns `{ parent, replies }` so the client can render the panel without
  // a second roundtrip for the root.
  app.get("/messages/:id/thread", async (c) => {
    const user = c.get("user");
    const parentId = Number(c.req.param("id"));
    if (!Number.isFinite(parentId) || parentId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const parentRow = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, parentId))
      .get();
    if (!parentRow) return c.json({ error: "message not found" }, 404);
    const channel = await userCanAccessChannel(db, user, parentRow.channelId);
    if (!channel) return c.json({ error: "message not found" }, 404);
    if (parentRow.parentMessageId != null) {
      // Asked for a thread on a reply — return its thread (i.e. the root's
      // thread) so the client can recover without an extra fetch.
      return c.json({ error: "вложенные треды не поддерживаются" }, 400);
    }

    const replyRows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.parentMessageId, parentId))
      .orderBy(asc(chatMessages.createdAt));

    const allIds = [parentRow.id, ...replyRows.map((r) => r.id)];
    const atts =
      allIds.length > 0
        ? await db
            .select({
              id: chatAttachments.id,
              messageId: chatAttachments.messageId,
              filename: chatAttachments.filename,
              mimeType: chatAttachments.mimeType,
              sizeBytes: chatAttachments.sizeBytes,
            })
            .from(chatAttachments)
            .where(inArray(chatAttachments.messageId, allIds))
        : [];
    const attachmentsByMsg = new Map<
      number,
      Array<{
        id: number;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      }>
    >();
    for (const a of atts) {
      const arr = attachmentsByMsg.get(a.messageId) ?? [];
      arr.push({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      });
      attachmentsByMsg.set(a.messageId, arr);
    }
    const authors = await authorsByIds(
      db,
      [parentRow, ...replyRows]
        .map((r) => r.authorUserId)
        .filter((id): id is number => id != null),
    );
    const reactionsMap = await reactionsByMessage(db, allIds);
    const mentionsMap = await loadMentionsForMessages(db, allIds);
    const replyMap = await replyCountsForParents(db, [parentRow.id]);
    // Readers only for the root parent — replies don't get individual
    // read tracking (thread participants are self-selecting).
    const readersMap = await readersForMessages(db, parentRow.channelId, [
      parentRow,
    ]);

    const parent = toMessageOut(
      parentRow,
      attachmentsByMsg.get(parentRow.id) ?? [],
      parentRow.authorUserId != null
        ? authors.get(parentRow.authorUserId)
        : undefined,
      reactionsMap.get(parentRow.id) ?? [],
      mentionsMap.get(parentRow.id) ?? [],
      replyMap.get(parentRow.id) ?? 0,
      readersMap.get(parentRow.id) ?? [],
    );
    const replies = replyRows.map((r) =>
      toMessageOut(
        r,
        attachmentsByMsg.get(r.id) ?? [],
        r.authorUserId != null ? authors.get(r.authorUserId) : undefined,
        reactionsMap.get(r.id) ?? [],
        mentionsMap.get(r.id) ?? [],
        0,
        [],
      ),
    );
    return c.json({ parent, replies });
  });

  app.patch("/messages/:id", async (c) => {
    const user = c.get("user");
    const messageId = Number(c.req.param("id"));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const msg = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .get();
    if (!msg) return c.json({ error: "message not found" }, 404);
    const channel = await userCanAccessChannel(db, user, msg.channelId);
    if (!channel) return c.json({ error: "message not found" }, 404);
    // Only the author can edit. Moderators (owner/manager) can delete, not
    // rewrite — editing someone else's words is a different kind of power.
    if (msg.authorUserId !== user.id) {
      return c.json({ error: "редактировать может только автор" }, 403);
    }
    if (msg.deletedAt) {
      return c.json({ error: "удалённое сообщение нельзя редактировать" }, 400);
    }

    let body: { body?: unknown };
    try {
      body = (await c.req.json()) as { body?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const text = String(body.body ?? "").trim();
    if (!text) return c.json({ error: "сообщение не может быть пустым" }, 400);
    if (text.length > 10000)
      return c.json({ error: "сообщение слишком длинное" }, 400);
    if (text === msg.body) {
      // No-op edit. Return current state without bumping editedAt.
      const out = await loadMessageOut(db, messageId);
      if (!out) return c.json({ error: "internal" }, 500);
      return c.json(out);
    }

    // Capture previous mention set so we only digest people who weren't
    // already mentioned in the pre-edit version.
    const previousMentionRows = await db
      .select({ userId: chatMessageMentions.userId })
      .from(chatMessageMentions)
      .where(eq(chatMessageMentions.messageId, messageId));
    const previousMentionIds = new Set(
      previousMentionRows.map((r) => r.userId),
    );

    const now = new Date();
    await db
      .update(chatMessages)
      .set({ body: text, editedAt: now })
      .where(eq(chatMessages.id, messageId));
    const mentionedIds = await syncMentions(
      db,
      messageId,
      user.workspaceId,
      text,
    );

    const out = await loadMessageOut(db, messageId);
    if (!out) return c.json({ error: "internal" }, 500);
    publish(
      user.workspaceId,
      {
        type: "message.updated",
        channelId: msg.channelId,
        messageId,
        workspaceId: user.workspaceId,
        payload: out,
      },
      await channelRecipients(db, channel),
    );
    const newlyMentioned = mentionedIds.filter(
      (id) => !previousMentionIds.has(id),
    );
    dispatchMentionDigests({
      db,
      workspaceId: user.workspaceId,
      authorUserId: user.id,
      messageId,
      userIds: newlyMentioned,
      appUrl: resolveAppUrl(c),
    });
    return c.json(out);
  });

  // === Reactions ===
  // Emoji storage: any unicode string ≤32 chars. We accept either raw emoji
  // ("👍") or shortcodes (":+1:") — server treats them as opaque strings;
  // dedup is by exact match within PK (message, user, emoji).
  const EMOJI_MAX_LEN = 32;

  app.post("/messages/:id/reactions", async (c) => {
    const user = c.get("user");
    const messageId = Number(c.req.param("id"));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    let body: { emoji?: unknown };
    try {
      body = (await c.req.json()) as { emoji?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const emoji = String(body.emoji ?? "").trim();
    if (!emoji) return c.json({ error: "emoji is required" }, 400);
    if (emoji.length > EMOJI_MAX_LEN)
      return c.json({ error: "emoji too long" }, 400);

    const msg = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .get();
    if (!msg) return c.json({ error: "message not found" }, 404);
    if (msg.deletedAt)
      return c.json({ error: "сообщение удалено" }, 400);
    const channel = await userCanAccessChannel(db, user, msg.channelId);
    if (!channel) return c.json({ error: "message not found" }, 404);

    const now = new Date();
    // Idempotent insert — PK conflict means user already reacted with this
    // emoji. We still want to return the current aggregate.
    try {
      await db
        .insert(chatMessageReactions)
        .values({ messageId, userId: user.id, emoji, createdAt: now });
      publish(
        user.workspaceId,
        {
          type: "reaction.added",
          channelId: msg.channelId,
          messageId,
          workspaceId: user.workspaceId,
          payload: { emoji, userId: user.id },
        },
        await channelRecipients(db, channel),
      );
    } catch {
      // Already reacted — return current state without publishing.
    }
    const map = await reactionsByMessage(db, [messageId]);
    return c.json({ reactions: map.get(messageId) ?? [] });
  });

  app.delete("/messages/:id/reactions/:emoji", async (c) => {
    const user = c.get("user");
    const messageId = Number(c.req.param("id"));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const emoji = decodeURIComponent(c.req.param("emoji"));
    if (!emoji) return c.json({ error: "emoji is required" }, 400);

    const msg = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .get();
    if (!msg) return c.json({ error: "message not found" }, 404);
    const channel = await userCanAccessChannel(db, user, msg.channelId);
    if (!channel) return c.json({ error: "message not found" }, 404);

    const result = await db
      .delete(chatMessageReactions)
      .where(
        and(
          eq(chatMessageReactions.messageId, messageId),
          eq(chatMessageReactions.userId, user.id),
          eq(chatMessageReactions.emoji, emoji),
        ),
      );
    if ((result as { changes?: number }).changes ?? 0 > 0) {
      publish(
        user.workspaceId,
        {
          type: "reaction.removed",
          channelId: msg.channelId,
          messageId,
          workspaceId: user.workspaceId,
          payload: { emoji, userId: user.id },
        },
        await channelRecipients(db, channel),
      );
    }
    const map = await reactionsByMessage(db, [messageId]);
    return c.json({ reactions: map.get(messageId) ?? [] });
  });

  app.delete("/messages/:id", async (c) => {
    const user = c.get("user");
    const messageId = Number(c.req.param("id"));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const msg = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .get();
    if (!msg) return c.json({ error: "message not found" }, 404);
    const channel = await userCanAccessChannel(db, user, msg.channelId);
    if (!channel) return c.json({ error: "message not found" }, 404);

    const isAuthor = msg.authorUserId === user.id;
    const canModerate = canManageWorkspace(user.workspaceRole);
    if (!isAuthor && !canModerate) {
      return c.json({ error: "удалять может только автор или owner/manager" }, 403);
    }
    if (msg.deletedAt) {
      return c.json({ ok: true, alreadyDeleted: true });
    }

    const now = new Date();
    await db
      .update(chatMessages)
      .set({ deletedAt: now })
      .where(eq(chatMessages.id, messageId));

    // Physically delete attachment files (metadata stays for audit until
    // the message is hard-deleted).
    const atts = await db
      .select({ id: chatAttachments.id, storageKey: chatAttachments.storageKey })
      .from(chatAttachments)
      .where(eq(chatAttachments.messageId, messageId));
    const storage = getFileStorage();
    for (const a of atts) {
      try {
        await storage.delete(a.storageKey);
      } catch {
        // best-effort; logged at storage layer
      }
    }
    await db
      .delete(chatAttachments)
      .where(eq(chatAttachments.messageId, messageId));

    const recipients = await channelRecipients(db, channel);
    publish(
      user.workspaceId,
      {
        type: "message.deleted",
        channelId: msg.channelId,
        messageId,
        workspaceId: user.workspaceId,
        payload: { id: messageId, deletedAt: now.getTime() },
      },
      recipients,
    );
    // If this was a thread reply, the parent's replyCount just dropped — let
    // any open ThreadPanel / root-message in the feed re-render with the
    // updated count.
    if (msg.parentMessageId != null) {
      const updatedParent = await loadMessageOut(db, msg.parentMessageId);
      if (updatedParent) {
        publish(
          user.workspaceId,
          {
            type: "message.updated",
            channelId: msg.channelId,
            messageId: msg.parentMessageId,
            workspaceId: user.workspaceId,
            payload: updatedParent,
          },
          recipients,
        );
      }
    }
    return c.json({ ok: true });
  });

  // === Attachments stream ===
  app.get("/attachments/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const row = await db
      .select({
        attachment: chatAttachments,
        channel: chatChannels,
      })
      .from(chatAttachments)
      .innerJoin(
        chatMessages,
        eq(chatMessages.id, chatAttachments.messageId),
      )
      .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
      .where(eq(chatAttachments.id, id))
      .get();
    if (!row) return c.json({ error: "attachment not found" }, 404);
    // Workspace match + DM membership (when applicable) — same gate as
    // userCanAccessChannel, expressed inline since we already have the
    // channel row from the join.
    if (row.channel.workspaceId !== user.workspaceId) {
      return c.json({ error: "attachment not found" }, 404);
    }
    if (row.channel.type === "dm") {
      const member = await db
        .select({ userId: chatChannelMembers.userId })
        .from(chatChannelMembers)
        .where(
          and(
            eq(chatChannelMembers.channelId, row.channel.id),
            eq(chatChannelMembers.userId, user.id),
          ),
        )
        .get();
      if (!member) return c.json({ error: "attachment not found" }, 404);
    }
    const buf = await getFileStorage().read(row.attachment.storageKey).catch(
      () => null,
    );
    if (!buf) return c.json({ error: "file missing on disk" }, 404);

    const filename = safeFilename(row.attachment.filename);
    // For images / PDFs we want inline preview (open in new tab, render in
    // <img>). For everything else — force download — otherwise the browser
    // may try to render text/binary inline and confuse the user.
    const mime = row.attachment.mimeType || "application/octet-stream";
    const inline =
      mime.startsWith("image/") || mime === "application/pdf";
    c.header("Content-Type", mime);
    c.header(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    c.header("Cache-Control", "private, max-age=3600");
    // Cast Buffer → ArrayBuffer-typed for @hono/node-server's body serializer.
    // Same idiom is used in server/routes/export.ts:418.
    return c.body(buf as unknown as ArrayBuffer);
  });

  // === Search ===
  // FTS5 over chat_messages.body. Scoped to user's workspace (and optionally
  // a specific channel). Returns full MessageOut rows with a `snippet` field
  // for inline highlight. Phrase queries use FTS5 syntax (`"hello world"`);
  // plain queries get implicit AND. We strip user-supplied FTS operators that
  // can blow up the query (e.g. `*` standalone) by wrapping each token in
  // double quotes — safe even for cyrillic / hyphens.
  const SEARCH_LIMIT_MAX = 100;
  const SEARCH_LIMIT_DEFAULT = 20;

  function sanitizeFtsQuery(raw: string): string | null {
    const tokens = raw
      .replace(/["()]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) return null;
    // Quote each token; FTS5 will OR within phrase, AND between phrases.
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
  }

  app.get("/search", async (c) => {
    const user = c.get("user");
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ results: [] });
    const ftsQuery = sanitizeFtsQuery(q);
    if (!ftsQuery) return c.json({ results: [] });

    const limitRaw = c.req.query("limit");
    const limit = Math.min(
      SEARCH_LIMIT_MAX,
      Math.max(1, Number(limitRaw ?? SEARCH_LIMIT_DEFAULT) || SEARCH_LIMIT_DEFAULT),
    );

    const channelIdRaw = c.req.query("channelId");
    let channelFilter: number | null = null;
    if (channelIdRaw) {
      const n = Number(channelIdRaw);
      if (!Number.isFinite(n) || n <= 0) {
        return c.json({ error: "invalid channelId" }, 400);
      }
      const channel = await userCanAccessChannel(db, user, n);
      if (!channel) return c.json({ error: "channel not found" }, 404);
      channelFilter = n;
    }

    // FTS5 → joined with chat_messages + chat_channels to enforce workspace
    // scope. Snippet uses FTS5 `snippet()` for highlighted excerpt.
    const channelClause = channelFilter
      ? sql`AND m.channel_id = ${channelFilter}`
      : sql``;
    const rows = await db.all<{
      id: number;
      snippet: string;
    }>(sql`
      SELECT m.id AS id, snippet(chat_messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
      FROM chat_messages_fts
      JOIN chat_messages m ON m.id = chat_messages_fts.rowid
      JOIN chat_channels  ch ON ch.id = m.channel_id
      WHERE chat_messages_fts MATCH ${ftsQuery}
        AND ch.workspace_id = ${user.workspaceId}
        AND m.deleted_at IS NULL
        ${channelClause}
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `);

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return c.json({ results: [] });

    const messages = await db
      .select()
      .from(chatMessages)
      .where(inArray(chatMessages.id, ids));
    const attachmentsRaw = await db
      .select({
        id: chatAttachments.id,
        messageId: chatAttachments.messageId,
        filename: chatAttachments.filename,
        mimeType: chatAttachments.mimeType,
        sizeBytes: chatAttachments.sizeBytes,
      })
      .from(chatAttachments)
      .where(inArray(chatAttachments.messageId, ids));
    const attachmentsByMsg = new Map<
      number,
      Array<{
        id: number;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      }>
    >();
    for (const a of attachmentsRaw) {
      const arr = attachmentsByMsg.get(a.messageId) ?? [];
      arr.push({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      });
      attachmentsByMsg.set(a.messageId, arr);
    }
    const authors = await authorsByIds(
      db,
      messages
        .map((m) => m.authorUserId)
        .filter((id): id is number => id != null),
    );
    const reactionsMap = await reactionsByMessage(db, ids);
    const mentionsMap = await loadMentionsForMessages(db, ids);
    const replyMap = await replyCountsForParents(db, ids);
    // Search results span channels; computing readers per channel here is
    // possible but the snippet UI doesn't render read indicators (you're
    // looking at a search hit, not the live feed). Pass empty.
    const snippetsById = new Map(rows.map((r) => [r.id, r.snippet]));
    const byId = new Map(messages.map((m) => [m.id, m]));
    const results = ids
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map((m) => ({
        ...toMessageOut(
          m,
          attachmentsByMsg.get(m.id) ?? [],
          m.authorUserId != null ? authors.get(m.authorUserId) : undefined,
          reactionsMap.get(m.id) ?? [],
          mentionsMap.get(m.id) ?? [],
          replyMap.get(m.id) ?? 0,
          [],
        ),
        snippet: snippetsById.get(m.id) ?? "",
      }));

    return c.json({ results });
  });

  // === Presence ===
  // Bootstrap on ChatPage mount, then maintained via WS presence.online/offline.
  app.get("/presence", async (c) => {
    const user = c.get("user");
    return c.json({ onlineUserIds: onlineUserIds(user.workspaceId) });
  });

  // === WebSocket ===
  if (upgradeWebSocket) {
    app.get(
      "/ws",
      upgradeWebSocket((c) => {
        const user = (c as { get: (k: string) => SessionUser }).get("user");
        let unsub: (() => void) | null = null;
        return {
          onOpen(_evt, ws) {
            unsub = subscribe(
              user.workspaceId,
              (event: ChatServerEvent) => {
                try {
                  ws.send(JSON.stringify(event));
                } catch {
                  // socket closing; ignore
                }
              },
              user.id,
            );
            const wasOffline = attach(user.workspaceId, user.id);
            // User just came online (0→1 ref-count transition) — cancel any
            // pending mention digest, they'll see the mentions in-app.
            if (wasOffline) cancelForUser(user.id);
            try {
              ws.send(
                JSON.stringify({
                  type: "hello",
                  workspaceId: user.workspaceId,
                  onlineUserIds: onlineUserIds(user.workspaceId),
                }),
              );
            } catch {
              /* ignore */
            }
          },
          onMessage(evt, ws) {
            try {
              const raw = typeof evt.data === "string" ? evt.data : "";
              if (!raw) return;
              const parsed = JSON.parse(raw) as {
                type?: string;
                channelId?: number;
              };
              if (parsed.type === "ping") {
                ws.send(JSON.stringify({ type: "pong" }));
                return;
              }
              if (
                parsed.type === "typing.start" &&
                typeof parsed.channelId === "number"
              ) {
                bumpTyping(
                  {
                    workspaceId: user.workspaceId,
                    channelId: parsed.channelId,
                    userId: user.id,
                  },
                  {
                    userId: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    avatarDataUrl: user.avatarDataUrl,
                  },
                );
                return;
              }
              if (
                parsed.type === "typing.stop" &&
                typeof parsed.channelId === "number"
              ) {
                clearTyping({
                  workspaceId: user.workspaceId,
                  channelId: parsed.channelId,
                  userId: user.id,
                });
                return;
              }
            } catch {
              // ignore malformed
            }
          },
          onClose() {
            clearAllForUser(user.workspaceId, user.id);
            detach(user.workspaceId, user.id);
            unsub?.();
            unsub = null;
          },
          onError() {
            clearAllForUser(user.workspaceId, user.id);
            detach(user.workspaceId, user.id);
            unsub?.();
            unsub = null;
          },
        };
      }),
    );
  }

  return app;
}

export { requireAuth };
