import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { workspaceMembers } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import {
  _resetPubSub,
  subscribe,
  type ChatServerEvent,
} from "../../server/chat/pubsub";
import { setFileStorage } from "../../server/storage/fileStorage";

const j = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

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

interface ChannelOut {
  id: number;
  name: string;
  type: "channel" | "dm";
  isPrivate: boolean;
  canManage: boolean;
}

function joinSameWorkspace(
  env: TestEnv,
  workspaceId: number,
  userId: number,
): void {
  env.db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .run();
  env.db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId,
      role: "member",
      status: "active",
      createdAt: new Date(),
    })
    .run();
}

async function listChannels(env: TestEnv, cookie: string): Promise<ChannelOut[]> {
  const res = await env.app.request("/api/chat/channels", {
    headers: { Cookie: cookie },
  });
  return (await res.json()) as ChannelOut[];
}

describe("private channels: creation + visibility", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "pc-owner@x.com", "password");
    mate = await loginAs(env, "pc-mate@x.com", "password");
    third = await loginAs(env, "pc-third@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
    joinSameWorkspace(env, owner.workspaceId, third.userId);
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("creates a private channel with creator + initial members", async () => {
    const res = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "sales-team",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    expect(res.status).toBe(201);
    const ch = (await res.json()) as ChannelOut;
    expect(ch.isPrivate).toBe(true);
    expect(ch.canManage).toBe(true);

    // Roster lookup
    const rosterRes = await env.app.request(
      `/api/chat/channels/${ch.id}/members`,
      { headers: { Cookie: owner.cookie } },
    );
    const roster = (await rosterRes.json()) as {
      members: Array<{ userId: number }>;
    };
    const ids = roster.members.map((m) => m.userId).sort();
    expect(ids).toEqual([owner.userId, mate.userId].sort());
  });

  it("private channel hidden from non-members in GET /channels", async () => {
    const created = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "secret",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    const ch = (await created.json()) as ChannelOut;

    const ownerList = await listChannels(env, owner.cookie);
    const mateList = await listChannels(env, mate.cookie);
    const thirdList = await listChannels(env, third.cookie);

    expect(ownerList.some((c) => c.id === ch.id)).toBe(true);
    expect(mateList.some((c) => c.id === ch.id)).toBe(true);
    expect(thirdList.some((c) => c.id === ch.id)).toBe(false);
  });

  it("non-member cannot fetch messages / roster / send to private channel", async () => {
    const created = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "secret-2",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    const ch = (await created.json()) as ChannelOut;

    const msgsRes = await env.app.request(
      `/api/chat/channels/${ch.id}/messages`,
      { headers: { Cookie: third.cookie } },
    );
    expect(msgsRes.status).toBe(404);
    const rosterRes = await env.app.request(
      `/api/chat/channels/${ch.id}/members`,
      { headers: { Cookie: third.cookie } },
    );
    expect(rosterRes.status).toBe(404);
    const postRes = await env.app.request(
      `/api/chat/channels/${ch.id}/messages`,
      {
        method: "POST",
        headers: j(third.cookie),
        body: JSON.stringify({ body: "leak" }),
      },
    );
    expect(postRes.status).toBe(404);
  });

  it("open channel roster returns all workspace members", async () => {
    // Default «общий» channel is open.
    const list = await listChannels(env, owner.cookie);
    const general = list.find((c) => c.type === "channel" && !c.isPrivate)!;
    const rosterRes = await env.app.request(
      `/api/chat/channels/${general.id}/members`,
      { headers: { Cookie: owner.cookie } },
    );
    const roster = (await rosterRes.json()) as {
      members: Array<{ userId: number }>;
    };
    const ids = roster.members.map((m) => m.userId).sort();
    expect(ids).toEqual([owner.userId, mate.userId, third.userId].sort());
  });
});

describe("private channels: members CRUD gating", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "pcm-owner@x.com", "password");
    mate = await loginAs(env, "pcm-mate@x.com", "password");
    third = await loginAs(env, "pcm-third@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
    joinSameWorkspace(env, owner.workspaceId, third.userId);
    // owner creates private channel with only owner + mate
    const r = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "ops",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    channelId = ((await r.json()) as ChannelOut).id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("creator can add a third member", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/members`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ userId: third.userId }),
      },
    );
    expect(res.status).toBe(200);
    const list = await listChannels(env, third.cookie);
    expect(list.some((c) => c.id === channelId)).toBe(true);
  });

  it("non-creator non-owner/manager cannot add members (404 — opaque)", async () => {
    // mate is a workspace 'owner' of her own workspace by loginAs default,
    // but here we explicitly demoted her by joinSameWorkspace (role=member).
    // So she is a member of owner's workspace, member of the channel, but
    // not creator and not owner/manager → cannot edit roster.
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/members`,
      {
        method: "POST",
        headers: j(mate.cookie),
        body: JSON.stringify({ userId: third.userId }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("cannot add a user from another workspace", async () => {
    const outsider = await loginAs(env, "pcm-outsider@x.com", "password");
    // outsider in their own separate workspace, NOT joined to owner's.
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/members`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ userId: outsider.userId }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("creator can remove a non-creator member", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/members/${mate.userId}`,
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const mateList = await listChannels(env, mate.cookie);
    expect(mateList.some((c) => c.id === channelId)).toBe(false);
  });

  it("cannot remove the channel creator", async () => {
    const res = await env.app.request(
      `/api/chat/channels/${channelId}/members/${owner.userId}`,
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(400);
  });

  it("rejects add/remove on an open channel (no explicit roster)", async () => {
    const list = await listChannels(env, owner.cookie);
    const general = list.find((c) => c.type === "channel" && !c.isPrivate)!;
    const addRes = await env.app.request(
      `/api/chat/channels/${general.id}/members`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ userId: third.userId }),
      },
    );
    expect(addRes.status).toBe(400);
  });
});

describe("private channels: pubsub leak protection", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "pcl-owner@x.com", "password");
    mate = await loginAs(env, "pcl-mate@x.com", "password");
    third = await loginAs(env, "pcl-third@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
    joinSameWorkspace(env, owner.workspaceId, third.userId);
    const r = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "huddle",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    channelId = ((await r.json()) as ChannelOut).id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("third workspace member doesn't receive WS events from private channel", async () => {
    const ownerEvents: ChatServerEvent[] = [];
    const mateEvents: ChatServerEvent[] = [];
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);

    await env.app.request(`/api/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "ops only" }),
    });

    expect(
      ownerEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(1);
    expect(
      mateEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(1);
    expect(
      thirdEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(0);
  });

  it("channel.created event for private channel scoped to members only", async () => {
    const ownerEvents: ChatServerEvent[] = [];
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);
    await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({
        name: "new-secret",
        isPrivate: true,
        memberIds: [mate.userId],
      }),
    });
    expect(
      ownerEvents.filter((e) => e.type === "channel.created"),
    ).toHaveLength(1);
    expect(
      thirdEvents.filter((e) => e.type === "channel.created"),
    ).toHaveLength(0);
  });
});
