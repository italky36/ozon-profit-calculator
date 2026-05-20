import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  pushSubscriptions,
  vapidSettings,
  workspaceMembers,
} from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import { _resetPubSub } from "../../server/chat/pubsub";
import { _resetPresence, attach, detach } from "../../server/chat/presence";
import { setFileStorage } from "../../server/storage/fileStorage";
import { invalidateVapid } from "../../server/lib/webPush";
import { _selectPushTargets } from "../../server/chat/notifications";

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

async function joinSameWorkspace(env: TestEnv, workspaceId: number, userId: number) {
  await env.db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    ;
  await env.db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId,
      role: "member",
      status: "active",
      createdAt: new Date(),
    })
    ;
}

describe("push subscriptions API", () => {
  let env: TestEnv;
  let user: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    invalidateVapid();
    user = await loginAs(env, "push-user@x.com", "password");
  });
  afterEach(async () => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    invalidateVapid();
    await teardownTestEnv(env);
  });

  it("GET /api/push/public-key → null when not configured", async () => {
    const res = await env.app.request("/api/push/public-key", {
      headers: { Cookie: user.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      publicKey: string | null;
      configured: boolean;
    };
    expect(body.publicKey).toBeNull();
    expect(body.configured).toBe(false);
  });

  it("GET /api/push/public-key returns the key when VAPID is set in DB", async () => {
    await env.db
      .insert(vapidSettings)
      .values({
        id: 1,
        publicKey: "BPK...",
        privateKey: "PRV...",
        subject: "mailto:test@x.com",
        updatedAt: new Date(),
      })
      ;
    invalidateVapid();
    const res = await env.app.request("/api/push/public-key", {
      headers: { Cookie: user.cookie },
    });
    const body = (await res.json()) as {
      publicKey: string | null;
      configured: boolean;
    };
    expect(body.publicKey).toBe("BPK...");
    expect(body.configured).toBe(true);
  });

  it("POST /api/push/subscriptions creates a new subscription", async () => {
    const res = await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: { p256dh: "pubpub", auth: "secret" },
        userAgent: "Vitest",
      }),
    });
    expect(res.status).toBe(201);
    const rows = await env.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.userId))
      ;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoint).toContain("abc123");
    expect(rows[0]!.userAgent).toBe("Vitest");
  });

  it("POST is idempotent on endpoint — re-subscribe updates keys + user", async () => {
    const endpoint = "https://updates.example.com/abc";
    await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "old-p", auth: "old-a" },
      }),
    });
    const res = await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "new-p", auth: "new-a" },
      }),
    });
    expect(res.status).toBe(200);
    const rows = await env.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      ;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dhKey).toBe("new-p");
    expect(rows[0]!.authKey).toBe("new-a");
  });

  it("rejects missing keys", async () => {
    const res = await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({ endpoint: "https://x.com/e" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE removes only own subscription", async () => {
    const endpoint = "https://x.com/mine";
    await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "p", auth: "a" },
      }),
    });
    // Stranger tries to delete it.
    const stranger = await loginAs(env, "push-stranger@x.com", "password");
    const evil = await env.app.request("/api/push/subscriptions", {
      method: "DELETE",
      headers: j(stranger.cookie),
      body: JSON.stringify({ endpoint }),
    });
    expect(evil.status).toBe(200); // success but didn't delete
    let rows = await env.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows).toHaveLength(1);
    // Owner can delete.
    const ok = await env.app.request("/api/push/subscriptions", {
      method: "DELETE",
      headers: j(user.cookie),
      body: JSON.stringify({ endpoint }),
    });
    expect(ok.status).toBe(200);
    rows = await env.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows).toHaveLength(0);
  });

  it("POST /test fails when VAPID not configured", async () => {
    await env.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: j(user.cookie),
      body: JSON.stringify({
        endpoint: "https://x.com/e",
        keys: { p256dh: "p", auth: "a" },
      }),
    });
    const res = await env.app.request("/api/push/test", {
      method: "POST",
      headers: { Cookie: user.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe("push notifications audience selection", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    _resetPubSub();
    _resetPresence();
    invalidateVapid();
    owner = await loginAs(env, "pn-owner@x.com", "password");
    mate = await loginAs(env, "pn-mate@x.com", "password");
    third = await loginAs(env, "pn-third@x.com", "password");
    await joinSameWorkspace(env, owner.workspaceId, mate.userId);
    await joinSameWorkspace(env, owner.workspaceId, third.userId);
  });
  afterEach(async () => {
    setFileStorage(null);
    _resetPubSub();
    _resetPresence();
    await teardownTestEnv(env);
  });

  it("DM: includes the other participant when offline", async () => {
    const dmRes = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    const dm = (await dmRes.json()) as { id: number };
    const targets = await _selectPushTargets({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId: dm.id,
      channelType: "dm",
      messageId: 999, // any id
      authorUserId: owner.userId,
      parentMessageId: null,
      mentionedUserIds: [],
    });
    expect(targets).toEqual([mate.userId]);
  });

  it("DM: skips the other participant when online", async () => {
    const dmRes = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    const dm = (await dmRes.json()) as { id: number };
    attach(owner.workspaceId, mate.userId);
    const targets = await _selectPushTargets({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId: dm.id,
      channelType: "dm",
      messageId: 999,
      authorUserId: owner.userId,
      parentMessageId: null,
      mentionedUserIds: [],
    });
    expect(targets).toEqual([]);
    detach(owner.workspaceId, mate.userId);
  });

  it("Channel @mention: includes mentioned offline users, skips author + online", async () => {
    // mate is online, third is offline. Both are mentioned.
    attach(owner.workspaceId, mate.userId);
    const targets = await _selectPushTargets({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId: 12345, // unused for type='channel'
      channelType: "channel",
      messageId: 999,
      authorUserId: owner.userId,
      parentMessageId: null,
      mentionedUserIds: [owner.userId, mate.userId, third.userId],
    });
    expect(targets).toEqual([third.userId]);
    detach(owner.workspaceId, mate.userId);
  });

  it("author is always skipped even if mentioned & offline", async () => {
    const targets = await _selectPushTargets({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId: 0,
      channelType: "channel",
      messageId: 1,
      authorUserId: owner.userId,
      parentMessageId: null,
      mentionedUserIds: [owner.userId],
    });
    expect(targets).not.toContain(owner.userId);
  });
});

describe("sysadmin VAPID admin", () => {
  let env: TestEnv;
  let admin: Awaited<ReturnType<typeof loginAs>>;
  let regular: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    setFileStorage(makeMemStorage().impl);
    invalidateVapid();
    admin = await loginAs(env, "admin@x.com", "password", "admin");
    regular = await loginAs(env, "regular@x.com", "password");
  });
  afterEach(async () => {
    setFileStorage(null);
    invalidateVapid();
    await teardownTestEnv(env);
  });

  it("non-sysadmin gets 403 on GET /admin/vapid", async () => {
    const res = await env.app.request("/api/admin/vapid", {
      headers: { Cookie: regular.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("PUT /admin/vapid validates subject scheme", async () => {
    const res = await env.app.request("/api/admin/vapid", {
      method: "PUT",
      headers: { ...j(admin.cookie), "X-App-Scope": "sysadmin" },
      body: JSON.stringify({
        publicKey: "BPK",
        privateKey: "PRV",
        subject: "not-a-url",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT saves keys, GET returns source=db + configured=true", async () => {
    const put = await env.app.request("/api/admin/vapid", {
      method: "PUT",
      headers: { ...j(admin.cookie), "X-App-Scope": "sysadmin" },
      body: JSON.stringify({
        publicKey: "BPK",
        privateKey: "PRV",
        subject: "mailto:a@b.com",
      }),
    });
    expect(put.status).toBe(200);
    const get = await env.app.request("/api/admin/vapid", {
      headers: { Cookie: admin.cookie, "X-App-Scope": "sysadmin" },
    });
    const body = (await get.json()) as {
      source: string;
      configured: boolean;
      publicKey: string | null;
      hasPrivateKey: boolean;
    };
    expect(body.source).toBe("db");
    expect(body.configured).toBe(true);
    expect(body.publicKey).toBe("BPK");
    expect(body.hasPrivateKey).toBe(true);
  });

  it("POST /admin/vapid/generate returns a fresh keypair", async () => {
    const res = await env.app.request("/api/admin/vapid/generate", {
      method: "POST",
      headers: { Cookie: admin.cookie, "X-App-Scope": "sysadmin" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      publicKey: string;
      privateKey: string;
    };
    expect(body.publicKey.length).toBeGreaterThan(20);
    expect(body.privateKey.length).toBeGreaterThan(20);
  });
});
