import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  chatChannels,
  chatMessageMentions,
  chatMessageReactions,
  chatMessages,
  workspaceMembers,
} from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import { _resetPubSub } from "../../server/chat/pubsub";
import { _resetPresence, isUserOnline } from "../../server/chat/presence";
import { _resetTyping } from "../../server/chat/typing";
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

describe("chat stage 1.1 — edit messages", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let member: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(memStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "edit-owner@x.com", "password");
    member = await loginAs(env, "edit-member@x.com", "password");
    // Поместить member в workspace owner'а как member.
    env.db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, member.userId))
      .run();
    env.db
      .insert(workspaceMembers)
      .values({
        userId: member.userId,
        workspaceId: owner.workspaceId,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .run();
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    channelId = ((await list.json()) as Array<{ id: number }>)[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  async function postText(cookie: string, body: string): Promise<number> {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      { method: "POST", headers: j(cookie), body: JSON.stringify({ body }) },
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }

  it("author edits own message; editedAt set, body updated, body returned in feed", async () => {
    const id = await postText(owner.cookie, "old text");
    const res = await env.app.request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "new text" }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as {
      body: string;
      editedAt: number | null;
    };
    expect(updated.body).toBe("new text");
    expect(updated.editedAt).not.toBeNull();
  });

  it("non-author (even moderator) cannot edit", async () => {
    const id = await postText(member.cookie, "member's text");
    const res = await env.app.request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "owner overwrite" }),
    });
    expect(res.status).toBe(403);
  });

  it("deleted message cannot be edited", async () => {
    const id = await postText(owner.cookie, "to be deleted");
    await env.app.request(`/api/chat/messages/${id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    const res = await env.app.request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "revive" }),
    });
    expect(res.status).toBe(400);
  });

  it("empty body rejected", async () => {
    const id = await postText(owner.cookie, "non-empty");
    const res = await env.app.request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("chat stage 1.2 — reactions", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let member: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;
  let messageId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(memStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "rx-owner@x.com", "password");
    member = await loginAs(env, "rx-member@x.com", "password");
    env.db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, member.userId))
      .run();
    env.db
      .insert(workspaceMembers)
      .values({
        userId: member.userId,
        workspaceId: owner.workspaceId,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .run();
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    channelId = ((await list.json()) as Array<{ id: number }>)[0]!.id;
    const posted = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "react to me" }),
      },
    );
    messageId = ((await posted.json()) as { id: number }).id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("add then remove reaction toggles count", async () => {
    const add = await env.app.request(
      `/api/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: j(member.cookie),
        body: JSON.stringify({ emoji: "👍" }),
      },
    );
    expect(add.status).toBe(200);
    let body = (await add.json()) as {
      reactions: Array<{ emoji: string; count: number; userIds: number[] }>;
    };
    const thumbs = body.reactions.find((r) => r.emoji === "👍")!;
    expect(thumbs.count).toBe(1);
    expect(thumbs.userIds).toEqual([member.userId]);

    const remove = await env.app.request(
      `/api/chat/messages/${messageId}/reactions/${encodeURIComponent("👍")}`,
      { method: "DELETE", headers: { Cookie: member.cookie } },
    );
    expect(remove.status).toBe(200);
    body = (await remove.json()) as typeof body;
    expect(body.reactions.find((r) => r.emoji === "👍")).toBeUndefined();
  });

  it("duplicate add is idempotent (PK conflict swallowed)", async () => {
    await env.app.request(`/api/chat/messages/${messageId}/reactions`, {
      method: "POST",
      headers: j(member.cookie),
      body: JSON.stringify({ emoji: "🎉" }),
    });
    const res = await env.app.request(
      `/api/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: j(member.cookie),
        body: JSON.stringify({ emoji: "🎉" }),
      },
    );
    expect(res.status).toBe(200);
    const rows = env.db
      .select()
      .from(chatMessageReactions)
      .where(eq(chatMessageReactions.messageId, messageId))
      .all();
    const tada = rows.filter((r) => r.emoji === "🎉");
    expect(tada).toHaveLength(1);
  });

  it("two users reacting same emoji gives count=2", async () => {
    await env.app.request(`/api/chat/messages/${messageId}/reactions`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ emoji: "🔥" }),
    });
    const res = await env.app.request(
      `/api/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: j(member.cookie),
        body: JSON.stringify({ emoji: "🔥" }),
      },
    );
    const body = (await res.json()) as {
      reactions: Array<{ emoji: string; count: number }>;
    };
    expect(body.reactions.find((r) => r.emoji === "🔥")!.count).toBe(2);
  });

  it("cross-workspace cannot react", async () => {
    const stranger = await loginAs(env, "rx-stranger@x.com", "password");
    const res = await env.app.request(
      `/api/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: j(stranger.cookie),
        body: JSON.stringify({ emoji: "👍" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("chat stage 1.4 — presence refcount", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  beforeEach(async () => {
    env = setupTestEnv();
    _resetPresence();
    owner = await loginAs(env, "pres@x.com", "password");
  });
  afterEach(() => {
    _resetPresence();
    teardownTestEnv(env);
  });

  it("attach/detach refcount: only last detach flips to offline", async () => {
    const { attach, detach, onlineUserIds } = await import(
      "../../server/chat/presence"
    );
    expect(onlineUserIds(owner.workspaceId)).toEqual([]);
    expect(attach(owner.workspaceId, owner.userId)).toBe(true);
    expect(attach(owner.workspaceId, owner.userId)).toBe(false); // multi-tab
    expect(isUserOnline(owner.workspaceId, owner.userId)).toBe(true);
    expect(detach(owner.workspaceId, owner.userId)).toBe(false);
    expect(isUserOnline(owner.workspaceId, owner.userId)).toBe(true);
    expect(detach(owner.workspaceId, owner.userId)).toBe(true);
    expect(isUserOnline(owner.workspaceId, owner.userId)).toBe(false);
  });

  it("/api/chat/presence returns current online set", async () => {
    const { attach } = await import("../../server/chat/presence");
    attach(owner.workspaceId, owner.userId);
    const res = await env.app.request("/api/chat/presence", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { onlineUserIds: number[] };
    expect(body.onlineUserIds).toContain(owner.userId);
  });
});

describe("chat stage 1.3 — typing TTL", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = setupTestEnv();
    _resetPubSub();
    _resetTyping();
    owner = await loginAs(env, "type@x.com", "password");
  });
  afterEach(() => {
    _resetPubSub();
    _resetTyping();
    teardownTestEnv(env);
  });

  it("bumpTyping publishes typing.start once, clearTyping publishes typing.stop", async () => {
    const { bumpTyping, clearTyping } = await import("../../server/chat/typing");
    const { subscribe } = await import("../../server/chat/pubsub");
    const events: Array<{ type: string }> = [];
    subscribe(owner.workspaceId, (e) => events.push(e), owner.userId);

    bumpTyping(
      { workspaceId: owner.workspaceId, channelId: 1, userId: owner.userId },
      {
        userId: owner.userId,
        fullName: "Owner",
        email: "o@x.com",
        avatarDataUrl: null,
      },
    );
    // Дублирующий bump — не должен публиковать снова.
    bumpTyping(
      { workspaceId: owner.workspaceId, channelId: 1, userId: owner.userId },
      {
        userId: owner.userId,
        fullName: "Owner",
        email: "o@x.com",
        avatarDataUrl: null,
      },
    );
    const starts = events.filter((e) => e.type === "typing.start");
    expect(starts).toHaveLength(1);

    clearTyping({
      workspaceId: owner.workspaceId,
      channelId: 1,
      userId: owner.userId,
    });
    const stops = events.filter((e) => e.type === "typing.stop");
    expect(stops).toHaveLength(1);
  });
});

describe("chat stage 1.5 — mentions", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let member: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(memStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "mention-owner@x.com", "password");
    // Создадим member с осмысленным fullName для мэтчинга.
    member = await loginAs(env, "ivan.petrov@x.com", "password");
    env.db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, member.userId))
      .run();
    env.db
      .insert(workspaceMembers)
      .values({
        userId: member.userId,
        workspaceId: owner.workspaceId,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .run();
    // Обновим fullName в DB для member.
    const { users } = await import("../../server/db/schema");
    env.db
      .update(users)
      .set({ fullName: "Иван Петров" })
      .where(eq(users.id, member.userId))
      .run();
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    channelId = ((await list.json()) as Array<{ id: number }>)[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("parses @ivan.petrov via email prefix → persists mention row", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "привет @ivan.petrov как дела" }),
      },
    );
    expect(res.status).toBe(201);
    const out = (await res.json()) as {
      id: number;
      mentions: Array<{ userId: number; name: string }>;
    };
    expect(out.mentions).toHaveLength(1);
    expect(out.mentions[0]!.userId).toBe(member.userId);
    const rows = env.db
      .select()
      .from(chatMessageMentions)
      .where(eq(chatMessageMentions.messageId, out.id))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("parses @Иван.Петров via fullName collapsed", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "@иван.петров привет" }),
      },
    );
    const out = (await res.json()) as {
      mentions: Array<{ userId: number }>;
    };
    expect(out.mentions.map((m) => m.userId)).toContain(member.userId);
  });

  it("unresolved tokens are silently dropped (no error, no mention)", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "@nobody-here hi" }),
      },
    );
    expect(res.status).toBe(201);
    const out = (await res.json()) as { mentions: unknown[] };
    expect(out.mentions).toEqual([]);
  });

  it("editing message re-syncs mention rows", async () => {
    const posted = await env.app.request(
      `/api/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "@ivan.petrov hi" }),
      },
    );
    const id = ((await posted.json()) as { id: number }).id;
    expect(
      env.db
        .select()
        .from(chatMessageMentions)
        .where(eq(chatMessageMentions.messageId, id))
        .all(),
    ).toHaveLength(1);
    await env.app.request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "no mentions now" }),
    });
    expect(
      env.db
        .select()
        .from(chatMessageMentions)
        .where(eq(chatMessageMentions.messageId, id))
        .all(),
    ).toHaveLength(0);
  });
});

describe("chat stage 1.6 — FTS5 search", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(memStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "search@x.com", "password");
    const list = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    channelId = ((await list.json()) as Array<{ id: number }>)[0]!.id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  async function post(body: string) {
    await env.app.request(`/api/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body }),
    });
  }

  it("matches a word in body and returns snippet with <mark>", async () => {
    await post("привет команда работаем сегодня");
    await post("обед в час");
    const res = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("привет")}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ body: string; snippet: string }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.snippet).toContain("<mark>");
  });

  it("cross-workspace search isolation", async () => {
    await post("SUPER_SECRET keyword");
    const stranger = await loginAs(env, "search-other@x.com", "password");
    const res = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("SUPER_SECRET")}`,
      { headers: { Cookie: stranger.cookie } },
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("deleted messages are excluded", async () => {
    await post("findable text");
    const msg = env.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.channelId, channelId))
      .all()[0]!;
    await env.app.request(`/api/chat/messages/${msg.id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    const res = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("findable")}`,
      { headers: { Cookie: owner.cookie } },
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("channelId scope filters by channel", async () => {
    await post("scoped here");
    // Create a 2nd channel and add a message there.
    const created = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "ops" }),
    });
    const ch2 = ((await created.json()) as { id: number }).id;
    await env.app.request(`/api/chat/channels/${ch2}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "scoped over here too" }),
    });

    const both = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("scoped")}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(((await both.json()) as { results: unknown[] }).results).toHaveLength(
      2,
    );

    const onlyCh1 = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("scoped")}&channelId=${channelId}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(
      ((await onlyCh1.json()) as { results: unknown[] }).results,
    ).toHaveLength(1);
  });

  it("query < 2 chars returns empty without error", async () => {
    await post("anything");
    const res = await env.app.request(
      `/api/chat/search?q=${encodeURIComponent("a")}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { results: unknown[] }).results).toEqual([]);
  });
});

describe("chat stage 1 — channel default still seeded", () => {
  // Smoke-проверка что миграции 0029-0031 не сломали backfill миграции 0028.
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  it("new workspace still gets #общий via ensureDefaultChannel", async () => {
    const u = await loginAs(env, "smoke@x.com", "password");
    const row = env.db
      .select()
      .from(chatChannels)
      .where(eq(chatChannels.workspaceId, u.workspaceId))
      .get();
    expect(row?.name).toBe("общий");
  });
});
