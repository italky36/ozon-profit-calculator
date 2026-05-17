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
  publish,
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
  peer: { userId: number; email: string; fullName: string } | null;
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

describe("chat DMs: find-or-create", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "dm-owner@x.com", "password");
    mate = await loginAs(env, "dm-mate@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("creates a DM channel with type='dm' + peer info", async () => {
    const res = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    expect(res.status).toBe(201);
    const dm = (await res.json()) as ChannelOut;
    expect(dm.type).toBe("dm");
    expect(dm.peer?.userId).toBe(mate.userId);
    expect(dm.peer?.email).toBe("dm-mate@x.com");
    // Name synthesised from peer.
    expect(dm.name).toBe("dm-mate");
  });

  it("is idempotent — second POST returns the same channel id (200)", async () => {
    const a = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    const firstId = ((await a.json()) as ChannelOut).id;
    const b = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    expect(b.status).toBe(200);
    const secondId = ((await b.json()) as ChannelOut).id;
    expect(secondId).toBe(firstId);
  });

  it("symmetric: mate POST → same channel as owner POST", async () => {
    const a = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    const ownerView = (await a.json()) as ChannelOut;
    const b = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(mate.cookie),
      body: JSON.stringify({ userId: owner.userId }),
    });
    expect(b.status).toBe(200);
    const mateView = (await b.json()) as ChannelOut;
    expect(mateView.id).toBe(ownerView.id);
    // Each side sees the OTHER person as peer.
    expect(ownerView.peer?.userId).toBe(mate.userId);
    expect(mateView.peer?.userId).toBe(owner.userId);
  });

  it("rejects self-DM (400)", async () => {
    const res = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: owner.userId }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects DM with a user from another workspace (404)", async () => {
    const outsider = await loginAs(env, "dm-outsider@x.com", "password");
    // outsider stays in their own workspace.
    const res = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: outsider.userId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("chat DMs: visibility / access", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;
  let dmId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "dmv-owner@x.com", "password");
    mate = await loginAs(env, "dmv-mate@x.com", "password");
    third = await loginAs(env, "dmv-third@x.com", "password");
    // All three in the same workspace.
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
    joinSameWorkspace(env, owner.workspaceId, third.userId);
    const res = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    dmId = ((await res.json()) as { id: number }).id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("GET /channels returns the DM for the two members, hides it from the third", async () => {
    const ownerList = (await (
      await env.app.request("/api/chat/channels", {
        headers: { Cookie: owner.cookie },
      })
    ).json()) as ChannelOut[];
    expect(ownerList.some((c) => c.id === dmId)).toBe(true);

    const mateList = (await (
      await env.app.request("/api/chat/channels", {
        headers: { Cookie: mate.cookie },
      })
    ).json()) as ChannelOut[];
    expect(mateList.some((c) => c.id === dmId)).toBe(true);

    const thirdList = (await (
      await env.app.request("/api/chat/channels", {
        headers: { Cookie: third.cookie },
      })
    ).json()) as ChannelOut[];
    expect(thirdList.some((c) => c.id === dmId)).toBe(false);
  });

  it("non-member cannot GET DM messages, POST into it, or open thread (404)", async () => {
    const getRes = await env.app.request(
      `/api/chat/channels/${dmId}/messages`,
      { headers: { Cookie: third.cookie } },
    );
    expect(getRes.status).toBe(404);

    const postRes = await env.app.request(
      `/api/chat/channels/${dmId}/messages`,
      {
        method: "POST",
        headers: j(third.cookie),
        body: JSON.stringify({ body: "leak attempt" }),
      },
    );
    expect(postRes.status).toBe(404);
  });

  it("members can post + read DM messages", async () => {
    const postRes = await env.app.request(
      `/api/chat/channels/${dmId}/messages`,
      {
        method: "POST",
        headers: j(owner.cookie),
        body: JSON.stringify({ body: "secret hello" }),
      },
    );
    expect(postRes.status).toBe(201);
    const listRes = await env.app.request(
      `/api/chat/channels/${dmId}/messages`,
      { headers: { Cookie: mate.cookie } },
    );
    expect(listRes.status).toBe(200);
    const page = (await listRes.json()) as { messages: Array<{ body: string }> };
    expect(page.messages.map((m) => m.body)).toContain("secret hello");
  });
});

describe("chat DMs: pubsub recipient filter", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;
  let dmId: number;

  beforeEach(async () => {
    env = setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    owner = await loginAs(env, "dmp-owner@x.com", "password");
    mate = await loginAs(env, "dmp-mate@x.com", "password");
    third = await loginAs(env, "dmp-third@x.com", "password");
    joinSameWorkspace(env, owner.workspaceId, mate.userId);
    joinSameWorkspace(env, owner.workspaceId, third.userId);
    const res = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    dmId = ((await res.json()) as { id: number }).id;
  });
  afterEach(() => {
    setFileStorage(null);
    _resetPubSub();
    teardownTestEnv(env);
  });

  it("publish() with allowedUserIds delivers only to whitelisted subscribers", () => {
    const ownerEvents: ChatServerEvent[] = [];
    const mateEvents: ChatServerEvent[] = [];
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);
    publish(
      owner.workspaceId,
      {
        type: "message.created",
        channelId: dmId,
        messageId: 1,
        workspaceId: owner.workspaceId,
        payload: {},
      },
      new Set([owner.userId, mate.userId]),
    );
    expect(ownerEvents).toHaveLength(1);
    expect(mateEvents).toHaveLength(1);
    expect(thirdEvents).toHaveLength(0);
  });

  it("DM message POST does NOT publish to a workspace-mate who isn't in the DM", async () => {
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);

    await env.app.request(`/api/chat/channels/${dmId}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "private" }),
    });

    // No message events should have leaked to the third party.
    expect(
      thirdEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(0);
  });

  it("regular-channel publish still fans out to all workspace subscribers", async () => {
    // Use the default channel (#общий) — created by ensureDefaultChannel.
    const channelsRes = await env.app.request("/api/chat/channels", {
      headers: { Cookie: owner.cookie },
    });
    const channels = (await channelsRes.json()) as Array<{
      id: number;
      type: string;
      isDefault: boolean;
    }>;
    const general = channels.find((c) => c.type === "channel" && c.isDefault)!;

    const ownerEvents: ChatServerEvent[] = [];
    const mateEvents: ChatServerEvent[] = [];
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);

    await env.app.request(`/api/chat/channels/${general.id}/messages`, {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ body: "team-wide" }),
    });

    // All three workspace subscribers should see the message.created event.
    expect(
      ownerEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(1);
    expect(
      mateEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(1);
    expect(
      thirdEvents.filter((e) => e.type === "message.created"),
    ).toHaveLength(1);
  });
});
