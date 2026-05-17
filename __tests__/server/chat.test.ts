import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  chatChannels,
  chatMessages,
  workspaceMembers,
} from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import {
  _resetPubSub,
  publish,
  subscribe,
  type ChatServerEvent,
} from "../../server/chat/pubsub";
import { setFileStorage } from "../../server/storage/fileStorage";

// In-memory FileStorage stub for tests. Avoids touching disk + lets us
// inspect what was written.
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
    store,
  };
}

const j = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

describe("chat: workspace channel lifecycle", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mem: ReturnType<typeof makeMemStorage>;

  beforeEach(async () => {
    env = setupTestEnv();
    mem = makeMemStorage();
    setFileStorage(mem.impl);
    _resetPubSub();
    owner = await loginAs(env, "owner@x.com", "password");
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("backfill creates #общий channel for new workspace", async () => {
    const res = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      id: number;
      name: string;
      isDefault: boolean;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("общий");
    expect(list[0]!.isDefault).toBe(true);
  });

  it("owner can create a new channel; member cannot", async () => {
    const member = await loginAs(env, "member@x.com", "password");
    // demote member's own workspace to use them as a member elsewhere — but
    // simpler: just test the gate in their OWN workspace. Default role from
    // loginAs is owner. So we manually switch their role.
    env.db
      .update(workspaceMembers)
      .set({ role: "member" })
      .where(eq(workspaceMembers.userId, member.userId))
      .run();

    const ok = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "general-2" }),
    });
    expect(ok.status).toBe(201);

    const forbidden = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(member.cookie),
      body: JSON.stringify({ name: "general-2" }),
    });
    expect(forbidden.status).toBe(403);
  });

  it("rejects empty channel name", async () => {
    const res = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH archives a channel; cannot archive default", async () => {
    const created = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "ops" }),
    });
    const ch = (await created.json()) as { id: number; isDefault: boolean };
    expect(ch.isDefault).toBe(false);

    const archive = await env.app.request(`/api/chat/channels/${ch.id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ archived: true }),
    });
    expect(archive.status).toBe(200);
    const after = (await archive.json()) as { archivedAt: number | null };
    expect(after.archivedAt).not.toBeNull();

    // Default channel — try to archive
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    const channels = (await list.json()) as Array<{
      id: number;
      isDefault: boolean;
    }>;
    const def = channels.find((c) => c.isDefault)!;
    const failed = await env.app.request(`/api/chat/channels/${def.id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ archived: true }),
    });
    expect(failed.status).toBe(400);
  });
});

describe("chat: cross-workspace isolation", () => {
  let env: TestEnv;
  let a: Awaited<ReturnType<typeof loginAs>>;
  let b: Awaited<ReturnType<typeof loginAs>>;
  let aChannelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    a = await loginAs(env, "a-owner@x.com", "password");
    b = await loginAs(env, "b-owner@x.com", "password");
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: a.cookie },
    });
    const channels = (await list.json()) as Array<{ id: number }>;
    aChannelId = channels[0]!.id;
    // Post a secret in A's channel.
    await env.app.request(`/api/chat/channels/${aChannelId}/messages`, {
      method: "POST",
      headers: j(a.cookie),
      body: JSON.stringify({ body: "SECRET-FROM-A" }),
    });
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("B cannot GET A's channel messages (404)", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${aChannelId}/messages`,
      { headers: { Cookie: b.cookie } },
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("SECRET-FROM-A");
  });

  it("B cannot POST into A's channel (404)", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${aChannelId}/messages`,
      {
        method: "POST",
        headers: j(b.cookie),
        body: JSON.stringify({ body: "intruder" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("B cannot PATCH or archive A's channel (404)", async () => {
    const res = await env.app.request(`/api/chat/channels/${aChannelId}`, {
      method: "PATCH",
      headers: j(b.cookie),
      body: JSON.stringify({ archived: true }),
    });
    expect(res.status).toBe(404);
  });

  it("B's GET /channels does not include A's channels", async () => {
    const res = await env.app.request("/api/chat/channels", {
      headers: { Cookie: b.cookie },
    });
    const list = (await res.json()) as Array<{ id: number }>;
    expect(list.map((c) => c.id)).not.toContain(aChannelId);
  });

  it("pub/sub fans out only to subscribers of the same workspace", () => {
    const aEvents: ChatServerEvent[] = [];
    const bEvents: ChatServerEvent[] = [];
    subscribe(a.workspaceId, (e) => aEvents.push(e), a.userId);
    subscribe(b.workspaceId, (e) => bEvents.push(e), b.userId);
    publish(a.workspaceId, {
      type: "message.created",
      channelId: 1,
      messageId: 1,
      workspaceId: a.workspaceId,
      payload: {},
    });
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);
  });
});

describe("chat: messages & attachments", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let other: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;
  let mem: ReturnType<typeof makeMemStorage>;

  beforeEach(async () => {
    env = setupTestEnv();
    mem = makeMemStorage();
    setFileStorage(mem.impl);
    _resetPubSub();
    owner = await loginAs(env, "owner@chat.com", "password");
    other = await loginAs(env, "other@chat.com", "password");
    // Put `other` into owner's workspace as a member.
    env.db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, other.userId))
      .run();
    env.db
      .insert(workspaceMembers)
      .values({
        userId: other.userId,
        workspaceId: owner.workspaceId,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .run();
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    const channels = (await list.json()) as Array<{ id: number }>;
    channelId = channels[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("posts a text message and returns author identity", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "hi team" }),
      },
    );
    expect(res.status).toBe(201);
    const msg = (await res.json()) as {
      id: number;
      body: string;
      author: { email: string; userId: number };
    };
    expect(msg.body).toBe("hi team");
    expect(msg.author.email).toBe("owner@chat.com");
    expect(msg.author.userId).toBe(owner.userId);
  });

  it("rejects empty message bodies", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("history pagination via before=<ts>", async () => {
    for (let i = 0; i < 5; i++) {
      await env.app.request(
        `/api/chat/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: j(owner.cookie),
          body: JSON.stringify({ body: `msg ${i}` }),
        },
      );
    }
    const first = await env.app.request(
      `/api/chat/channels/${channelId}/messages?limit=2`,
      { headers: { Cookie: owner.cookie } },
    );
    const page1 = (await first.json()) as {
      messages: Array<{ id: number; body: string; createdAt: number }>;
      hasMore: boolean;
    };
    expect(page1.messages).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    // Newest-first ordering.
    expect(page1.messages[0]!.body).toBe("msg 4");
    const oldestTs = page1.messages[page1.messages.length - 1]!.createdAt;
    const second = await env.app.request(
      `/api/chat/channels/${channelId}/messages?limit=2&before=${oldestTs}`,
      { headers: { Cookie: owner.cookie } },
    );
    const page2 = (await second.json()) as {
      messages: Array<{ body: string }>;
    };
    expect(page2.messages.map((m) => m.body)).not.toContain("msg 4");
  });

  it("author can delete own message; member cannot delete owner's", async () => {
    const posted = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "from owner" }),
      },
    );
    const msg = (await posted.json()) as { id: number };

    // member tries to delete owner's message — forbidden.
    const forbid = await env.app.request(`/api/chat/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Cookie: other.cookie },
    });
    expect(forbid.status).toBe(403);

    // owner deletes their own — ok.
    const ok = await env.app.request(`/api/chat/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    expect(ok.status).toBe(200);
    const stored = env.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, msg.id))
      .get();
    expect(stored?.deletedAt).not.toBeNull();
  });

  it("owner can delete a member's message (moderation)", async () => {
    // member posts
    const posted = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(other.cookie),
        body: JSON.stringify({ body: "from member" }),
      },
    );
    const msg = (await posted.json()) as { id: number };

    const ok = await env.app.request(`/api/chat/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    expect(ok.status).toBe(200);
  });

  it("rejects oversized file (>25 MB)", async () => {
    const fd = new FormData();
    const huge = new Uint8Array(26 * 1024 * 1024);
    fd.append("file", new File([huge], "big.bin", { type: "image/png" }));
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages/with-attachments`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie },
        body: fd,
      },
    );
    expect(res.status).toBe(413);
  });

  it("rejects disallowed MIME", async () => {
    const fd = new FormData();
    fd.append(
      "file",
      new File([new Uint8Array(10)], "x.exe", {
        type: "application/x-msdownload",
      }),
    );
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages/with-attachments`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie },
        body: fd,
      },
    );
    expect(res.status).toBe(415);
  });

  it("accepts image attachment + serves via GET /attachments/:id", async () => {
    const fd = new FormData();
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    fd.append("body", "see image");
    fd.append("file", new File([payload], "../../evil.png", { type: "image/png" }));
    const post = await env.app.request(
      `/api/chat/channels/${channelId}/messages/with-attachments`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie },
        body: fd,
      },
    );
    expect(post.status).toBe(201);
    const msg = (await post.json()) as {
      id: number;
      attachments: Array<{ id: number; filename: string; url: string }>;
    };
    expect(msg.attachments).toHaveLength(1);
    // Filename sanitized: no path traversal in storage key.
    const att = msg.attachments[0]!;
    expect(att.filename).toBe("../../evil.png"); // original display name preserved
    expect(att.url).toContain(`/api/chat/attachments/${att.id}`);
    // Storage key must not escape root.
    const stored = [...mem.store.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toContain("..");

    const download = await env.app.request(
      `/api/chat/attachments/${att.id}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("GET /attachments/:id from another workspace returns 404", async () => {
    // Setup: post attachment in owner's workspace, then probe from b.
    const b = await loginAs(env, "stranger@x.com", "password");
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([7])], "f.txt", { type: "text/plain" }));
    const post = await env.app.request(
      `/api/chat/channels/${channelId}/messages/with-attachments`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie },
        body: fd,
      },
    );
    const msg = (await post.json()) as {
      attachments: Array<{ id: number }>;
    };
    const attId = msg.attachments[0]!.id;
    const probe = await env.app.request(`/api/chat/attachments/${attId}`, {
      headers: { Cookie: b.cookie },
    });
    expect(probe.status).toBe(404);
  });

  it("soft-deleted message is returned in feed with deletedAt set", async () => {
    const posted = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "hello" }),
      },
    );
    const msg = (await posted.json()) as { id: number };
    await env.app.request(`/api/chat/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    const list = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { headers: { Cookie: owner.cookie } },
    );
    const page = (await list.json()) as {
      messages: Array<{ id: number; body: string; deletedAt: number | null }>;
    };
    const found = page.messages.find((m) => m.id === msg.id)!;
    expect(found.deletedAt).not.toBeNull();
    expect(found.body).toBe("");
  });
});

describe("chat: pub/sub event delivery", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "owner@evt.com", "password");
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    const channels = (await list.json()) as Array<{ id: number }>;
    channelId = channels[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("POST message publishes a message.created event to the workspace bus", async () => {
    const events: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => events.push(e), owner.userId);
    await env.app.request(`/api/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "hi" }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("message.created");
  });
});

describe("chat: sysadmin has no chat access", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
    _resetPubSub();
  });
  afterEach(() => {
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("sysadmin GET /api/chat/channels → 403", async () => {
    const admin = await loginAs(env, "admin@x.com", "password", "admin");
    const res = await env.app.request("/api/chat/channels", {
      headers: { Cookie: admin.cookie, "X-App-Scope": "sysadmin" },
    });
    expect(res.status).toBe(403);
    // sysadmin's workspace existed (loginAs creates one), but the workspace
    // sessionMiddleware path strips them since they're isSysadmin=true.
    // Confirm the rejection isn't from missing auth.
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/chat is workspace-scoped|unauthorized/);
  });
});

describe("chat: backfill seeded channel for new workspaces", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  it("a workspace created mid-test has #общий (runtime seed)", async () => {
    const user = await loginAs(env, "fresh@x.com", "password");
    const row = env.db
      .select()
      .from(chatChannels)
      .where(eq(chatChannels.workspaceId, user.workspaceId))
      .get();
    expect(row).not.toBeNull();
    expect(row?.name).toBe("общий");
    expect(row?.isDefault).toBe(true);
  });
});
