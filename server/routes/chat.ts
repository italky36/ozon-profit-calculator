import { Hono } from "hono";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { canManageWorkspace, requireAuth } from "../middleware/session";
import {
  chatAttachments,
  chatChannels,
  chatMessageMentions,
  chatMessageReactions,
  chatMessages,
  users,
} from "../db/schema";
import {
  buildStorageKey,
  getFileStorage,
  safeFilename,
} from "../storage/fileStorage";
import { publish, subscribe, type ChatServerEvent } from "../chat/pubsub";
import { bumpTyping, clearAllForUser, clearTyping } from "../chat/typing";
import { attach, detach, onlineUserIds } from "../chat/presence";
import { loadMentionsForMessages, resolveMentions } from "../chat/mentions";

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
  isDefault: boolean;
  createdAt: number;
  archivedAt: number | null;
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
): MessageOut {
  return {
    id: msg.id,
    channelId: msg.channelId,
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
 * deletes existing rows for the message and re-inserts the current set. */
async function syncMentions(
  db: DB,
  messageId: number,
  workspaceId: number,
  body: string,
): Promise<void> {
  await db
    .delete(chatMessageMentions)
    .where(eq(chatMessageMentions.messageId, messageId));
  const userIds = await resolveMentions(db, workspaceId, body);
  if (userIds.length === 0) return;
  await db.insert(chatMessageMentions).values(
    userIds.map((userId) => ({ messageId, userId })),
  );
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
  return toMessageOut(
    msg,
    atts,
    msg.authorUserId != null ? authors.get(msg.authorUserId) : undefined,
    reactionsMap.get(messageId) ?? [],
    mentionsMap.get(messageId) ?? [],
  );
}

async function getChannelInWorkspace(
  db: DB,
  channelId: number,
  workspaceId: number,
): Promise<typeof chatChannels.$inferSelect | null> {
  const row = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .get();
  if (!row) return null;
  if (row.workspaceId !== workspaceId) return null;
  return row;
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
    const rows = await db
      .select({
        id: chatChannels.id,
        name: chatChannels.name,
        isDefault: chatChannels.isDefault,
        createdAt: chatChannels.createdAt,
        archivedAt: chatChannels.archivedAt,
      })
      .from(chatChannels)
      .where(eq(chatChannels.workspaceId, user.workspaceId))
      .orderBy(chatChannels.createdAt);
    const out: ChannelOut[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      createdAt: r.createdAt.getTime(),
      archivedAt: r.archivedAt ? r.archivedAt.getTime() : null,
    }));
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
    let body: { name?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown };
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: "name is required" }, 400);
    if (name.length > 80)
      return c.json({ error: "name must be ≤80 chars" }, 400);
    const now = new Date();
    const created = await db
      .insert(chatChannels)
      .values({
        workspaceId: user.workspaceId,
        name,
        isDefault: false,
        createdBy: user.id,
        createdAt: now,
      })
      .returning()
      .get();
    const out: ChannelOut = {
      id: created.id,
      name: created.name,
      isDefault: created.isDefault,
      createdAt: created.createdAt.getTime(),
      archivedAt: null,
    };
    publish(user.workspaceId, {
      type: "channel.created",
      channelId: created.id,
      workspaceId: user.workspaceId,
      payload: out,
    });
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
    const channel = await getChannelInWorkspace(db, id, user.workspaceId);
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
    const out: ChannelOut = {
      id: updated.id,
      name: updated.name,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt.getTime(),
      archivedAt: updated.archivedAt ? updated.archivedAt.getTime() : null,
    };
    publish(user.workspaceId, {
      type: patch.archivedAt !== undefined ? "channel.archived" : "channel.updated",
      channelId: id,
      workspaceId: user.workspaceId,
      payload: out,
    });
    return c.json(out);
  });

  // === Messages ===
  app.get("/channels/:id/messages", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await getChannelInWorkspace(db, channelId, user.workspaceId);
    if (!channel) return c.json({ error: "channel not found" }, 404);

    const beforeRaw = c.req.query("before");
    const limitRaw = c.req.query("limit");
    const before = beforeRaw ? Number(beforeRaw) : null;
    const limit = Math.min(
      MESSAGE_PAGE_MAX,
      Math.max(1, Number(limitRaw ?? MESSAGE_PAGE_LIMIT) || MESSAGE_PAGE_LIMIT),
    );

    const where =
      before != null && Number.isFinite(before)
        ? and(
            eq(chatMessages.channelId, channelId),
            lt(chatMessages.createdAt, new Date(before)),
          )
        : eq(chatMessages.channelId, channelId);

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
    const result: MessageOut[] = rows.map((r) =>
      toMessageOut(
        r,
        attachmentsByMsg.get(r.id) ?? [],
        r.authorUserId != null ? authors.get(r.authorUserId) : undefined,
        reactionsMap.get(r.id) ?? [],
        mentionsMap.get(r.id) ?? [],
      ),
    );

    return c.json({
      messages: result,
      hasMore: rows.length === limit,
    });
  });

  app.post("/channels/:id/messages", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await getChannelInWorkspace(db, channelId, user.workspaceId);
    if (!channel) return c.json({ error: "channel not found" }, 404);
    if (channel.archivedAt) {
      return c.json({ error: "канал заархивирован" }, 400);
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

    const now = new Date();
    const created = await db
      .insert(chatMessages)
      .values({
        channelId,
        authorUserId: user.id,
        body: text,
        createdAt: now,
      })
      .returning()
      .get();
    await syncMentions(db, created.id, user.workspaceId, text);

    const out = await loadMessageOut(db, created.id);
    if (!out) return c.json({ error: "internal" }, 500);
    publish(user.workspaceId, {
      type: "message.created",
      channelId,
      messageId: created.id,
      workspaceId: user.workspaceId,
      payload: out,
    });
    return c.json(out, 201);
  });

  app.post("/channels/:id/messages/with-attachments", async (c) => {
    const user = c.get("user");
    const channelId = Number(c.req.param("id"));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const channel = await getChannelInWorkspace(db, channelId, user.workspaceId);
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
        body: bodyText,
        createdAt: now,
      })
      .returning()
      .get();
    if (bodyText) {
      await syncMentions(db, message.id, user.workspaceId, bodyText);
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
    publish(user.workspaceId, {
      type: "message.created",
      channelId,
      messageId: message.id,
      workspaceId: user.workspaceId,
      payload: out,
    });
    return c.json(out, 201);
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
    const channel = await getChannelInWorkspace(
      db,
      msg.channelId,
      user.workspaceId,
    );
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

    const now = new Date();
    await db
      .update(chatMessages)
      .set({ body: text, editedAt: now })
      .where(eq(chatMessages.id, messageId));
    await syncMentions(db, messageId, user.workspaceId, text);

    const out = await loadMessageOut(db, messageId);
    if (!out) return c.json({ error: "internal" }, 500);
    publish(user.workspaceId, {
      type: "message.updated",
      channelId: msg.channelId,
      messageId,
      workspaceId: user.workspaceId,
      payload: out,
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
    const channel = await getChannelInWorkspace(
      db,
      msg.channelId,
      user.workspaceId,
    );
    if (!channel) return c.json({ error: "message not found" }, 404);

    const now = new Date();
    // Idempotent insert — PK conflict means user already reacted with this
    // emoji. We still want to return the current aggregate.
    try {
      await db
        .insert(chatMessageReactions)
        .values({ messageId, userId: user.id, emoji, createdAt: now });
      publish(user.workspaceId, {
        type: "reaction.added",
        channelId: msg.channelId,
        messageId,
        workspaceId: user.workspaceId,
        payload: { emoji, userId: user.id },
      });
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
    const channel = await getChannelInWorkspace(
      db,
      msg.channelId,
      user.workspaceId,
    );
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
      publish(user.workspaceId, {
        type: "reaction.removed",
        channelId: msg.channelId,
        messageId,
        workspaceId: user.workspaceId,
        payload: { emoji, userId: user.id },
      });
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
    const channel = await getChannelInWorkspace(
      db,
      msg.channelId,
      user.workspaceId,
    );
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

    publish(user.workspaceId, {
      type: "message.deleted",
      channelId: msg.channelId,
      messageId,
      workspaceId: user.workspaceId,
      payload: { id: messageId, deletedAt: now.getTime() },
    });
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
    if (row.channel.workspaceId !== user.workspaceId) {
      return c.json({ error: "attachment not found" }, 404);
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
      const channel = await getChannelInWorkspace(db, n, user.workspaceId);
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
            unsub = subscribe(user.workspaceId, (event: ChatServerEvent) => {
              try {
                ws.send(JSON.stringify(event));
              } catch {
                // socket closing; ignore
              }
            });
            attach(user.workspaceId, user.id);
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
