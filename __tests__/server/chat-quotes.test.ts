import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { chatMessages, workspaceMembers } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import { _resetPubSub } from "../../server/chat/pubsub";
import { setFileStorage } from "../../server/storage/fileStorage";

function memStorage() {
  const store = new Map<string, Buffer>();
  return {
    impl: {
      async put(key: string, data: Buffer) {
        store.set(key, data);
      },
      async read(key: string) {
        const v = store.get(key);
        if (!v) throw new Error("ENOENT");
        return v;
      },
      async delete(key: string) {
        store.delete(key);
      },
      async stat(key: string) {
        const v = store.get(key);
        return v ? { size: v.length } : null;
      },
    },
  };
}

const j = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

interface MessageOut {
  id: number;
  body: string;
  quotedMessage: {
    id: number;
    authorUserId: number | null;
    authorName: string;
    body: string;
    deletedAt: number | null;
    hasAttachments: boolean;
  } | null;
}

describe("Inline quotes (Telegram/WhatsApp-style reply)", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = await setupTestEnv();
    setFileStorage(memStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "q-owner@x.com", "password");
    mate = await loginAs(env, "q-mate@x.com", "password");
    await env.db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, mate.userId))
      ;
    await env.db
      .insert(workspaceMembers)
      .values({
        userId: mate.userId,
        workspaceId: owner.workspaceId,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      ;
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    channelId = ((await list.json()) as Array<{ id: number }>)[0]!.id;
  });
  afterEach(async () => {
    setFileStorage(null);
    _resetPubSub();
    await teardownTestEnv(env);
  });

  it("stores quotedMessageId + returns quotedMessage in the response", async () => {
    const first = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "Привет команде" }),
      },
    );
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { id: number }).id;

    const replyRes = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(mate.cookie),
        body: JSON.stringify({
          body: "И тебе привет",
          quotedMessageId: firstId,
        }),
      },
    );
    expect(replyRes.status).toBe(201);
    const reply = (await replyRes.json()) as MessageOut;
    expect(reply.quotedMessage).toBeTruthy();
    expect(reply.quotedMessage?.id).toBe(firstId);
    expect(reply.quotedMessage?.authorUserId).toBe(owner.userId);
    // authorName falls back to email-prefix when fullName isn't set in tests.
    expect(reply.quotedMessage?.authorName).toBe("q-owner");
    expect(reply.quotedMessage?.body).toBe("Привет команде");
  });

  it("quotedMessage carries the original author + body in the listing", async () => {
    const first = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "Оригинал" }),
      },
    );
    const firstId = ((await first.json()) as { id: number }).id;
    await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(mate.cookie),
        body: JSON.stringify({
          body: "Reply",
          quotedMessageId: firstId,
        }),
      },
    );
    const list = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: mate.cookie } },
    );
    const page = (await list.json()) as { messages: MessageOut[] };
    const reply = page.messages.find((m) => m.body === "Reply");
    expect(reply?.quotedMessage).toBeTruthy();
    expect(reply?.quotedMessage?.id).toBe(firstId);
    expect(reply?.quotedMessage?.body).toBe("Оригинал");
    expect(reply?.quotedMessage?.authorName).toBeTruthy();
    expect(reply?.quotedMessage?.authorUserId).toBe(owner.userId);
  });

  it("rejects cross-channel quotes (400)", async () => {
    // Create a second channel.
    const ch2 = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "Другой" }),
    });
    const ch2Id = ((await ch2.json()) as { id: number }).id;
    // Post a message in channel 2.
    const otherMsg = await env.app.request(
      `/api/chat/channels/${ch2Id}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "В другом канале" }),
      },
    );
    const otherId = ((await otherMsg.json()) as { id: number }).id;
    // Try to quote it from channel 1 — rejected.
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({
          body: "Ответ",
          quotedMessageId: otherId,
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects quotes of non-existent messages (404)", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({
          body: "Quote of nothing",
          quotedMessageId: 999999,
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("preserves quote when the original is soft-deleted (carries deletedAt)", async () => {
    const first = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "Будет удалено" }),
      },
    );
    const firstId = ((await first.json()) as { id: number }).id;
    const replyRes = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(mate.cookie),
        body: JSON.stringify({
          body: "Ответ до удаления",
          quotedMessageId: firstId,
        }),
      },
    );
    const replyId = ((await replyRes.json()) as { id: number }).id;
    // Soft-delete the original.
    const del = await env.app.request(`/api/chat/messages/${firstId}`, {
      method: "DELETE",
      headers: j(owner.cookie),
    });
    expect(del.status).toBe(200);
    // Reload the reply via listing — quotedMessage should still resolve,
    // body emptied + deletedAt populated.
    const list = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: mate.cookie } },
    );
    const page = (await list.json()) as { messages: MessageOut[] };
    const reply = page.messages.find((m) => m.id === replyId);
    expect(reply?.quotedMessage).toBeTruthy();
    expect(reply?.quotedMessage?.deletedAt).not.toBeNull();
    expect(reply?.quotedMessage?.body).toBe("");
  });

  it("survives hard-delete of the original via FK SET NULL", async () => {
    const first = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "Будет hard-deleted" }),
      },
    );
    const firstId = ((await first.json()) as { id: number }).id;
    const replyRes = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(mate.cookie),
        body: JSON.stringify({
          body: "Ответ",
          quotedMessageId: firstId,
        }),
      },
    );
    const replyId = ((await replyRes.json()) as { id: number }).id;
    // Hard-delete bypassing soft-delete (simulating a future admin op).
    await env.db.delete(chatMessages).where(eq(chatMessages.id, firstId));
    // Reply should remain; quoted_message_id NULLed by ON DELETE SET NULL.
    const list = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: mate.cookie } },
    );
    const page = (await list.json()) as { messages: MessageOut[] };
    const reply = page.messages.find((m) => m.id === replyId);
    expect(reply).toBeTruthy();
    expect(reply?.quotedMessage).toBeNull();
  });
});
