import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { workspaceMembers } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import { _resetPubSub } from "../../server/chat/pubsub";
import { _resetPresence, attach, detach } from "../../server/chat/presence";
import {
  _flushUserNow,
  _pendingUserIds,
  _resetMentionDigest,
} from "../../server/chat/mentionDigest";
import { setFileStorage } from "../../server/storage/fileStorage";

const j = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

// In-memory FileStorage stub (same pattern as chat.test.ts).
function makeMemStorage() {
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

interface MessageOut {
  id: number;
  channelId: number;
  parentMessageId: number | null;
  replyCount: number;
  readerUserIds: number[];
  body: string;
  author: { userId: number; email: string; fullName: string };
}

interface ChannelOut {
  id: number;
  name: string;
  unreadCount: number;
  lastReadMessageId: number | null;
}

async function postMessage(
  env: TestEnv,
  cookie: string,
  channelId: number,
  body: string,
  parentMessageId?: number,
): Promise<MessageOut> {
  const res = await env.app.request(
    `/api/chat/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: j(cookie),
      body: JSON.stringify(
        parentMessageId != null ? { body, parentMessageId } : { body },
      ),
    },
  );
  if (res.status !== 201) {
    throw new Error(`POST status=${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as MessageOut;
}

async function listChannels(
  env: TestEnv,
  cookie: string,
): Promise<ChannelOut[]> {
  const res = await env.app.request("/api/chat/channels", {
    headers: { Cookie: cookie },
  });
  if (res.status !== 200) throw new Error(`channels ${res.status}`);
  return (await res.json()) as ChannelOut[];
}

async function joinSameWorkspace(
  env: TestEnv,
  ownerWorkspaceId: number,
  memberUserId: number,
) {
  env.db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, memberUserId))
    .run();
  env.db
    .insert(workspaceMembers)
    .values({
      workspaceId: ownerWorkspaceId,
      userId: memberUserId,
      role: "member",
      status: "active",
      createdAt: new Date(),
    })
    .run();
}

describe("chat stage 2.1 — read receipts", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let other: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    owner = await loginAs(env, "stage2-owner@x.com", "password");
    other = await loginAs(env, "stage2-other@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, other.userId);
    const chs = await listChannels(env, owner.cookie);
    channelId = chs[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    teardownTestEnv(env);
  });

  it("unreadCount=0 for fresh channel; bumps for messages from others; ignores own messages", async () => {
    // Owner posts → still unread=0 for owner (own messages don't count).
    await postMessage(env, owner.cookie, channelId, "own msg");
    let chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.unreadCount).toBe(0);

    // Other posts → owner unreadCount=1.
    await postMessage(env, other.cookie, channelId, "from other");
    chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.unreadCount).toBe(1);

    // Two more from other → unread=3.
    await postMessage(env, other.cookie, channelId, "again");
    await postMessage(env, other.cookie, channelId, "again2");
    chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.unreadCount).toBe(3);
  });

  it("PUT /channels/:id/read clears unread; monotone-only (smaller messageId ignored)", async () => {
    const m1 = await postMessage(env, other.cookie, channelId, "one");
    const m2 = await postMessage(env, other.cookie, channelId, "two");
    const m3 = await postMessage(env, other.cookie, channelId, "three");

    // Owner marks up to m2 → unread = count(id > m2) = 1.
    const r1 = await env.app.request(
      `/api/chat/channels/${channelId}/read`,
      {
        method: "PUT",
        headers: j(owner.cookie),
        body: JSON.stringify({ messageId: m2.id }),
      },
    );
    expect(r1.status).toBe(200);
    const r1Body = (await r1.json()) as { lastReadMessageId: number };
    expect(r1Body.lastReadMessageId).toBe(m2.id);
    let chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.unreadCount).toBe(1);
    expect(chs[0]!.lastReadMessageId).toBe(m2.id);

    // Now try to "rewind" to m1 — server must ignore (monotone).
    const r2 = await env.app.request(
      `/api/chat/channels/${channelId}/read`,
      {
        method: "PUT",
        headers: j(owner.cookie),
        body: JSON.stringify({ messageId: m1.id }),
      },
    );
    expect(r2.status).toBe(200);
    chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.lastReadMessageId).toBe(m2.id);
    expect(chs[0]!.unreadCount).toBe(1);

    // Advance to m3 — unread clears.
    await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(owner.cookie),
      body: JSON.stringify({ messageId: m3.id }),
    });
    chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.lastReadMessageId).toBe(m3.id);
    expect(chs[0]!.unreadCount).toBe(0);
  });

  it("read pointer is per-user (other user is not affected)", async () => {
    const m1 = await postMessage(env, other.cookie, channelId, "msg");
    await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(owner.cookie),
      body: JSON.stringify({ messageId: m1.id }),
    });
    // Other user shouldn't see owner's pointer.
    const chs = await listChannels(env, other.cookie);
    expect(chs[0]!.lastReadMessageId).toBe(null);
  });

  it("rejects PUT /read for messages from a different channel (404)", async () => {
    // Create a 2nd channel.
    const created = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "other-ch" }),
    });
    const ch2 = (await created.json()) as { id: number };
    const m = await postMessage(env, other.cookie, channelId, "in default");

    const res = await env.app.request(
      `/api/chat/channels/${ch2.id}/read`,
      {
        method: "PUT",
        headers: j(owner.cookie),
        body: JSON.stringify({ messageId: m.id }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("thread replies do NOT bump unreadCount on the channel feed", async () => {
    const root = await postMessage(env, owner.cookie, channelId, "root");
    // other replies in thread
    await postMessage(env, other.cookie, channelId, "reply!", root.id);
    const chs = await listChannels(env, owner.cookie);
    expect(chs[0]!.unreadCount).toBe(0);
  });
});

describe("chat stage 2.2 — threads", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let other: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    owner = await loginAs(env, "stage2t-owner@x.com", "password");
    other = await loginAs(env, "stage2t-other@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, other.userId);
    const chs = await listChannels(env, owner.cookie);
    channelId = chs[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    teardownTestEnv(env);
  });

  it("replies are NOT returned in the channel feed", async () => {
    const root = await postMessage(env, owner.cookie, channelId, "root");
    await postMessage(env, owner.cookie, channelId, "reply", root.id);
    await postMessage(env, other.cookie, channelId, "reply2", root.id);
    const list = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: owner.cookie } },
    );
    const page = (await list.json()) as { messages: MessageOut[] };
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]!.id).toBe(root.id);
    expect(page.messages[0]!.replyCount).toBe(2);
  });

  it("rejects reply to a non-existent parent (404)", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "x", parentMessageId: 99999 }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects reply where parent is in a different channel (400)", async () => {
    // Make 2nd channel
    const c2res = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "second" }),
    });
    const c2 = (await c2res.json()) as { id: number };
    const rootInCh1 = await postMessage(env, owner.cookie, channelId, "ch1");

    const res = await env.app.request(
      `/api/chat/channels/${c2.id}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "x", parentMessageId: rootInCh1.id }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects nested replies (parent must itself be root)", async () => {
    const root = await postMessage(env, owner.cookie, channelId, "root");
    const reply = await postMessage(
      env,
      owner.cookie,
      channelId,
      "reply",
      root.id,
    );
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({
          body: "nested",
          parentMessageId: reply.id,
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("GET /messages/:id/thread returns parent + replies in ASC order", async () => {
    const root = await postMessage(env, owner.cookie, channelId, "root");
    const r1 = await postMessage(env, owner.cookie, channelId, "r1", root.id);
    const r2 = await postMessage(env, other.cookie, channelId, "r2", root.id);
    const res = await env.app.request(
      `/api/chat/messages/${root.id}/thread`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parent: MessageOut;
      replies: MessageOut[];
    };
    expect(body.parent.id).toBe(root.id);
    expect(body.parent.replyCount).toBe(2);
    expect(body.replies.map((r) => r.id)).toEqual([r1.id, r2.id]);
  });

  it("thread access is workspace-scoped (404 cross-workspace)", async () => {
    const stranger = await loginAs(env, "stage2t-stranger@x.com", "password");
    const root = await postMessage(env, owner.cookie, channelId, "secret root");
    const res = await env.app.request(
      `/api/chat/messages/${root.id}/thread`,
      { headers: { Cookie: stranger.cookie } },
    );
    expect(res.status).toBe(404);
  });
});

describe("chat stage 2.3 — mention email digest", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mentioned: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    owner = await loginAs(env, "owner.mention@x.com", "password");
    // The user must be findable by @full-name; loginAs only sets email, so
    // backfill fullName manually.
    mentioned = await loginAs(env, "alice@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mentioned.userId);
    const chs = await listChannels(env, owner.cookie);
    channelId = chs[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    teardownTestEnv(env);
  });

  it("queues a digest when mentioned user is offline", async () => {
    expect(_pendingUserIds()).toEqual([]);
    await postMessage(env, owner.cookie, channelId, "hi @alice");
    expect(_pendingUserIds()).toContain(mentioned.userId);

    // Flush synchronously (avoid 5-min wait in tests).
    await _flushUserNow(env.db, mentioned.userId);
    expect(_pendingUserIds()).not.toContain(mentioned.userId);

    expect(env.emails.length).toBeGreaterThan(0);
    const digest = env.emails.find(
      (m) => m.to === "alice@x.com" && /упомин/i.test(m.subject),
    );
    expect(digest).toBeTruthy();
    expect(digest!.text).toMatch(/hi @alice/);
  });

  it("does NOT queue a digest when mentioned user is online", async () => {
    // Simulate online presence via attach() refcount (WS open).
    attach(owner.workspaceId, mentioned.userId);
    await postMessage(env, owner.cookie, channelId, "hi @alice");
    expect(_pendingUserIds()).not.toContain(mentioned.userId);
    detach(owner.workspaceId, mentioned.userId);
  });

  it("does NOT queue a digest when the author mentions themselves", async () => {
    // owner's email prefix is "owner.mention" — also tests email-style mention.
    await postMessage(env, owner.cookie, channelId, "note to self @owner.mention");
    expect(_pendingUserIds()).toEqual([]);
  });

  it("coming online cancels the pending digest", async () => {
    await postMessage(env, owner.cookie, channelId, "ping @alice");
    expect(_pendingUserIds()).toContain(mentioned.userId);

    // Mimic WS-open → attach (which calls cancelForUser via the WS handler).
    // The presence module itself does not cancel; the chat route's onOpen
    // does. So we exercise cancelForUser directly via the public re-export.
    const { cancelForUser } = await import(
      "../../server/chat/mentionDigest"
    );
    cancelForUser(mentioned.userId);
    expect(_pendingUserIds()).not.toContain(mentioned.userId);

    await _flushUserNow(env.db, mentioned.userId);
    expect(env.emails.length).toBe(0);
  });

  it("multiple mentions for the same user are batched into one email", async () => {
    await postMessage(env, owner.cookie, channelId, "first @alice");
    await postMessage(env, owner.cookie, channelId, "second @alice");
    await postMessage(env, owner.cookie, channelId, "third @alice");
    expect(_pendingUserIds()).toContain(mentioned.userId);

    await _flushUserNow(env.db, mentioned.userId);
    const digests = env.emails.filter((m) => m.to === "alice@x.com");
    expect(digests).toHaveLength(1);
    expect(digests[0]!.text).toMatch(/first/);
    expect(digests[0]!.text).toMatch(/second/);
    expect(digests[0]!.text).toMatch(/third/);
  });
});

describe("chat per-message read indicator (readerUserIds)", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let reader: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    owner = await loginAs(env, "rd-owner@x.com", "password");
    reader = await loginAs(env, "rd-reader@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, reader.userId);
    const chs = await listChannels(env, owner.cookie);
    channelId = chs[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    _resetMentionDigest();
    teardownTestEnv(env);
  });

  async function listMessages(cookie: string): Promise<MessageOut[]> {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: cookie } },
    );
    const page = (await res.json()) as { messages: MessageOut[] };
    return page.messages;
  }

  it("readerUserIds is empty before anyone marks read", async () => {
    const m = await postMessage(env, owner.cookie, channelId, "hi");
    const msgs = await listMessages(owner.cookie);
    const found = msgs.find((x) => x.id === m.id)!;
    expect(found.readerUserIds).toEqual([]);
  });

  it("reader's PUT /read populates readerUserIds with reader.userId (NOT author)", async () => {
    const m = await postMessage(env, owner.cookie, channelId, "hello team");
    // Reader marks the message as read.
    const r = await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(reader.cookie),
      body: JSON.stringify({ messageId: m.id }),
    });
    expect(r.status).toBe(200);
    const msgs = await listMessages(owner.cookie);
    const found = msgs.find((x) => x.id === m.id)!;
    expect(found.readerUserIds).toEqual([reader.userId]);
    // Author never appears in their own readerUserIds.
    expect(found.readerUserIds).not.toContain(owner.userId);
  });

  it("readerUserIds reflects monotone pointer — old messages stay marked read after pointer advances", async () => {
    const m1 = await postMessage(env, owner.cookie, channelId, "one");
    const m2 = await postMessage(env, owner.cookie, channelId, "two");
    // Reader reads m1 only.
    await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(reader.cookie),
      body: JSON.stringify({ messageId: m1.id }),
    });
    let msgs = await listMessages(owner.cookie);
    expect(msgs.find((x) => x.id === m1.id)!.readerUserIds).toEqual([
      reader.userId,
    ]);
    expect(msgs.find((x) => x.id === m2.id)!.readerUserIds).toEqual([]);
    // Reader advances to m2 → both messages now show reader.
    await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(reader.cookie),
      body: JSON.stringify({ messageId: m2.id }),
    });
    msgs = await listMessages(owner.cookie);
    expect(msgs.find((x) => x.id === m1.id)!.readerUserIds).toEqual([
      reader.userId,
    ]);
    expect(msgs.find((x) => x.id === m2.id)!.readerUserIds).toEqual([
      reader.userId,
    ]);
  });

  it("workspace isolation: cross-workspace reads do NOT appear in readerUserIds", async () => {
    const stranger = await loginAs(env, "rd-stranger@x.com", "password");
    const m = await postMessage(env, owner.cookie, channelId, "scoped");
    // Stranger can't PUT /read on this channel (404).
    const r = await env.app.request(`/api/chat/channels/${channelId}/read`, {
      method: "PUT",
      headers: j(stranger.cookie),
      body: JSON.stringify({ messageId: m.id }),
    });
    expect(r.status).toBe(404);
    const msgs = await listMessages(owner.cookie);
    expect(msgs.find((x) => x.id === m.id)!.readerUserIds).toEqual([]);
  });

  it("thread replies have empty readerUserIds (per-message read not tracked for replies)", async () => {
    const root = await postMessage(env, owner.cookie, channelId, "root");
    await postMessage(env, reader.cookie, channelId, "reply", root.id);
    // Reader marks the reply's id as read on the channel — but replies
    // aren't returned in the channel feed at all, so we check the thread.
    const threadRes = await env.app.request(
      `/api/chat/messages/${root.id}/thread`,
      { headers: { Cookie: owner.cookie } },
    );
    const body = (await threadRes.json()) as {
      parent: MessageOut;
      replies: MessageOut[];
    };
    expect(body.replies[0]!.readerUserIds).toEqual([]);
  });
});
