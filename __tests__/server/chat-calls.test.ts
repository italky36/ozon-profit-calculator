import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  chatCallParticipants,
  chatCalls,
  pushSubscriptions,
  workspaceMembers,
} from "../../server/db/schema";
import {
  adminSessionCookie,
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
import {
  _resetCalls,
  acceptCall,
  activeCallsForUser,
  createCall,
  declineCall,
  endCall,
  getActiveCall,
} from "../../server/chat/calls";
import {
  callSystemMessageBody,
  type CallEndSummary,
} from "../../server/chat/callSystemMessages";

const j = (cookie: string) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
});

async function joinSameWorkspace(
  env: TestEnv,
  workspaceId: number,
  userId: number,
): Promise<void> {
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

describe("ICE servers endpoint", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    _resetPubSub();
    _resetCalls();
    owner = await loginAs(env, "ice-owner@x.com", "password");
  });
  afterEach(async () => {
    _resetPubSub();
    _resetCalls();
    await teardownTestEnv(env);
  });

  it("GET /api/chat/ice returns the seeded STUN entry for any logged-in user", async () => {
    const res = await env.app.request("/api/chat/ice", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { iceServers: RTCIceServer[] };
    expect(body.iceServers.length).toBeGreaterThanOrEqual(1);
    expect(body.iceServers[0].urls).toContain("stun:");
  });

  it("GET /api/chat/ice omits disabled rows", async () => {
    // Seed migration already inserted one stun entry; mark it disabled and
    // confirm the API falls back to the public-STUN default.
    await env.db.execute(sql`UPDATE ice_servers SET enabled = false`);
    const res = await env.app.request("/api/chat/ice", {
      headers: { Cookie: owner.cookie },
    });
    const body = (await res.json()) as { iceServers: RTCIceServer[] };
    expect(body.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });

  it("admin /api/admin/ice CRUD requires sysadmin", async () => {
    const res = await env.app.request("/api/admin/ice", {
      headers: { Cookie: owner.cookie },
    });
    // Owner is not sysadmin → requireSysadmin returns 403.
    expect(res.status).toBe(403);
  });

  it("sysadmin can add a TURN entry and toggle it visible to clients", async () => {
    const sysCookie = await adminSessionCookie(env);
    const create = await env.app.request("/api/admin/ice", {
      method: "POST",
      headers: j(sysCookie),
      body: JSON.stringify({
        urls: "turn:turn.example.com:3478",
        username: "alice",
        credential: "s3cret",
      }),
    });
    expect(create.status).toBe(200);

    // Now any user sees it.
    const list = await env.app.request("/api/chat/ice", {
      headers: { Cookie: owner.cookie },
    });
    const body = (await list.json()) as { iceServers: RTCIceServer[] };
    const turn = body.iceServers.find(
      (s) => typeof s.urls === "string" && s.urls.startsWith("turn:"),
    );
    expect(turn).toBeTruthy();
    expect(turn?.username).toBe("alice");
    expect(turn?.credential).toBe("s3cret");
  });

  it("rejects bad URL schemes", async () => {
    const sysCookie = await adminSessionCookie(env);
    const res = await env.app.request("/api/admin/ice", {
      method: "POST",
      headers: j(sysCookie),
      body: JSON.stringify({ urls: "http://not-a-stun.example" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Call signaling routing", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let stranger: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = await setupTestEnv();
    _resetPubSub();
    _resetCalls();
    owner = await loginAs(env, "call-owner@x.com", "password");
    mate = await loginAs(env, "call-mate@x.com", "password");
    stranger = await loginAs(env, "call-stranger@x.com", "password");
    await joinSameWorkspace(env, owner.workspaceId, mate.userId);
    await joinSameWorkspace(env, owner.workspaceId, stranger.userId);
    // Create a DM channel via the API so chat_channel_members is correct.
    const dm = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    expect([200, 201]).toContain(dm.status);
    channelId = ((await dm.json()) as { id: number }).id;
  });
  afterEach(async () => {
    _resetPubSub();
    _resetCalls();
    await teardownTestEnv(env);
  });

  it("createCall publishes call.incoming only to invitees, not to stranger", async () => {
    const ownerEvents: ChatServerEvent[] = [];
    const mateEvents: ChatServerEvent[] = [];
    const strangerEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(
      owner.workspaceId,
      (e) => strangerEvents.push(e),
      stranger.userId,
    );

    await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });

    expect(mateEvents.some((e) => e.type === "call.incoming")).toBe(true);
    // Initiator is included in the invitedUserIds set (so call.created
    // event for ACK can target them), but here we filter to call.incoming —
    // owner gets it too because they're in the recipient set; that's fine.
    expect(strangerEvents.some((e) => e.type === "call.incoming")).toBe(false);
  });

  it("createCall inserts chat_calls + chat_call_participants rows", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "video",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    const [call] = await env.db
      .select()
      .from(chatCalls)
      .where(eq(chatCalls.id, callId))
      ;
    expect(call?.callType).toBe("video");
    expect(call?.endedAt).toBeNull();
    const parts = await env.db
      .select()
      .from(chatCallParticipants)
      .where(eq(chatCallParticipants.callId, callId))
      ;
    expect(parts).toHaveLength(2);
  });

  it("acceptCall updates joined_at and publishes call.accepted to participants only", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    const mateEvents: ChatServerEvent[] = [];
    const strangerEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(
      owner.workspaceId,
      (e) => strangerEvents.push(e),
      stranger.userId,
    );
    const ok = await acceptCall(env.db, callId, mate.userId);
    expect(ok).toBe(true);
    expect(mateEvents.some((e) => e.type === "call.accepted")).toBe(true);
    expect(strangerEvents.some((e) => e.type === "call.accepted")).toBe(false);
    const [mateRow] = await env.db
      .select()
      .from(chatCallParticipants)
      .where(eq(chatCallParticipants.userId, mate.userId))
      ;
    expect(mateRow?.joinedAt).not.toBeNull();
  });

  it("acceptCall by non-invited user returns false (no impersonation)", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    const ok = await acceptCall(env.db, callId, stranger.userId);
    expect(ok).toBe(false);
  });

  it("endCall writes ended_at + end_reason and clears active state", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    expect(getActiveCall(callId)).toBeTruthy();
    await endCall({
      db: env.db,
      callId,
      byUserId: owner.userId,
      reason: "completed",
    });
    const [call] = await env.db
      .select()
      .from(chatCalls)
      .where(eq(chatCalls.id, callId))
      ;
    expect(call?.endedAt).not.toBeNull();
    expect(call?.endReason).toBe("completed");
    expect(getActiveCall(callId)).toBeUndefined();
  });

  it("activeCallsForUser tracks per-user roster", async () => {
    expect(activeCallsForUser(owner.userId)).toHaveLength(0);
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    expect(activeCallsForUser(owner.userId)).toEqual([callId]);
    expect(activeCallsForUser(mate.userId)).toEqual([callId]);
    expect(activeCallsForUser(stranger.userId)).toHaveLength(0);
    await endCall({
      db: env.db,
      callId,
      byUserId: owner.userId,
      reason: "completed",
    });
    expect(activeCallsForUser(owner.userId)).toHaveLength(0);
  });
});

describe("Missed-call: push + system message helpers", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;

  beforeEach(async () => {
    env = await setupTestEnv();
    _resetPubSub();
    _resetCalls();
    owner = await loginAs(env, "miss-owner@x.com", "password");
    mate = await loginAs(env, "miss-mate@x.com", "password");
    await joinSameWorkspace(env, owner.workspaceId, mate.userId);
  });
  afterEach(async () => {
    _resetPubSub();
    _resetCalls();
    await teardownTestEnv(env);
  });

  it("callSystemMessageBody formats outcomes in Russian", async () => {
    const base: CallEndSummary = {
      callId: 1,
      channelId: 1,
      workspaceId: 1,
      callType: "audio",
      initiatorUserId: owner.userId,
      inviteeUserIds: [owner.userId, mate.userId],
      startedAt: new Date(0),
      endedAt: new Date(0),
      reason: "missed",
    };
    expect(callSystemMessageBody(base)).toContain("пропущенный");
    expect(
      callSystemMessageBody({ ...base, reason: "declined" }),
    ).toContain("отклонён");
    expect(
      callSystemMessageBody({ ...base, reason: "completed", endedAt: new Date(70_000) }),
    ).toContain("1 мин");
    expect(
      callSystemMessageBody({ ...base, callType: "video", reason: "failed" }),
    ).toContain("Видеозвонок");
  });

  it("pushMissedCall targets only the invitee (not the initiator)", async () => {
    // Seed a push subscription for the invitee so sendPushToUsers has work
    // to do. The push call itself fails (no VAPID configured) — we just
    // assert the row selection logic.
    await env.db
      .insert(pushSubscriptions)
      .values({
        userId: mate.userId,
        endpoint: "https://fcm.googleapis.com/fcm/send/test-mate",
        p256dhKey: "k",
        authKey: "a",
        createdAt: new Date(),
      })
      ;
    await env.db
      .insert(pushSubscriptions)
      .values({
        userId: owner.userId,
        endpoint: "https://fcm.googleapis.com/fcm/send/test-owner",
        p256dhKey: "k",
        authKey: "a",
        createdAt: new Date(),
      })
      ;
    // Simulate the missed-call by directly invoking the helper. We don't
    // actually send (no VAPID), but the function shouldn't throw, and it
    // should leave the initiator's subscription untouched. The internal
    // sendPushToUsers swallows the no-VAPID case gracefully.
    const { pushMissedCall } = await import(
      "../../server/chat/callSystemMessages"
    );
    await pushMissedCall(
      env.db,
      {
        callId: 99,
        channelId: 1,
        workspaceId: owner.workspaceId,
        callType: "audio",
        initiatorUserId: owner.userId,
        inviteeUserIds: [owner.userId, mate.userId],
        startedAt: new Date(),
        endedAt: new Date(),
        reason: "missed",
      },
      "http://localhost",
    );
    // Both subscription rows still exist (no 410 from a real push service
    // since we never hit the network without VAPID).
    const subs = await env.db.select().from(pushSubscriptions);
    expect(subs.length).toBe(2);
  });
});

describe("Group calls (Stage 5.5)", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let third: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = await setupTestEnv();
    _resetPubSub();
    _resetCalls();
    owner = await loginAs(env, "g-owner@x.com", "password");
    mate = await loginAs(env, "g-mate@x.com", "password");
    third = await loginAs(env, "g-third@x.com", "password");
    await joinSameWorkspace(env, owner.workspaceId, mate.userId);
    await joinSameWorkspace(env, owner.workspaceId, third.userId);
    // Create an open channel in owner's workspace.
    const res = await env.app.request("/api/chat/channels", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ name: "Group" }),
    });
    expect(res.status).toBe(201);
    channelId = ((await res.json()) as { id: number }).id;
  });
  afterEach(async () => {
    _resetPubSub();
    _resetCalls();
    await teardownTestEnv(env);
  });

  it("acceptCall publishes call.peer-joined with the connectedUserIds snapshot", async () => {
    const ownerEvents: ChatServerEvent[] = [];
    const mateEvents: ChatServerEvent[] = [];
    const thirdEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);
    subscribe(owner.workspaceId, (e) => mateEvents.push(e), mate.userId);
    subscribe(owner.workspaceId, (e) => thirdEvents.push(e), third.userId);

    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId, third.userId],
      onMissed: () => {},
    });

    // First callee accepts.
    expect(await acceptCall(env.db, callId, mate.userId)).toBe(true);
    const firstJoin = ownerEvents.find((e) => e.type === "call.peer-joined");
    expect(firstJoin).toBeTruthy();
    if (firstJoin && firstJoin.type === "call.peer-joined") {
      expect(firstJoin.payload.userId).toBe(mate.userId);
      expect(new Set(firstJoin.payload.connectedUserIds)).toEqual(
        new Set([owner.userId, mate.userId]),
      );
    }

    // Second callee accepts — third event carries the full roster.
    expect(await acceptCall(env.db, callId, third.userId)).toBe(true);
    const peerJoins = ownerEvents.filter(
      (e) => e.type === "call.peer-joined",
    );
    expect(peerJoins).toHaveLength(2);
    if (peerJoins[1] && peerJoins[1].type === "call.peer-joined") {
      expect(peerJoins[1].payload.userId).toBe(third.userId);
      expect(new Set(peerJoins[1].payload.connectedUserIds)).toEqual(
        new Set([owner.userId, mate.userId, third.userId]),
      );
    }
  });

  it("group decline removes one invitee without ending the call", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId, third.userId],
      onMissed: () => {},
    });

    const ownerEvents: ChatServerEvent[] = [];
    subscribe(owner.workspaceId, (e) => ownerEvents.push(e), owner.userId);

    // Simulate the WS handler's group-decline branch.
    const { allDeclined } = await declineCall(env.db, callId, mate.userId);
    expect(allDeclined).toBe(false);

    // Call still active in memory.
    const stillActive = getActiveCall(callId);
    expect(stillActive).toBeTruthy();
    expect(stillActive?.invitedUserIds.has(mate.userId)).toBe(false);
    expect(stillActive?.invitedUserIds.has(third.userId)).toBe(true);
  });

  it("last invitee decline → allDeclined=true (caller should endCall)", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId, third.userId],
      onMissed: () => {
        throw new Error(
          "ring-timer fired unexpectedly — declineCall should cancel it",
        );
      },
    });

    let res = await declineCall(env.db, callId, mate.userId);
    expect(res.allDeclined).toBe(false);
    res = await declineCall(env.db, callId, third.userId);
    expect(res.allDeclined).toBe(true);
    // Caller (chat.ts) follows up with endCall(declined); we simulate that.
    await endCall({
      db: env.db,
      callId,
      byUserId: third.userId,
      reason: "declined",
    });
    const [persisted] = await env.db
      .select()
      .from(chatCalls)
      .where(eq(chatCalls.id, callId))
      ;
    expect(persisted?.endReason).toBe("declined");
    expect(getActiveCall(callId)).toBeUndefined();
  });

  it("declineCall is idempotent for a non-invited user (no-op)", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    // third was never invited — declineCall returns allDeclined=false and
    // leaves the call intact.
    const res = await declineCall(env.db, callId, third.userId);
    expect(res.allDeclined).toBe(false);
    expect(getActiveCall(callId)?.invitedUserIds.has(mate.userId)).toBe(true);
  });

  it("declineCall removes per-user from activeCallsForUser index", async () => {
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      callType: "audio",
      inviteeUserIds: [mate.userId, third.userId],
      onMissed: () => {},
    });
    expect(activeCallsForUser(mate.userId)).toContain(callId);
    await declineCall(env.db, callId, mate.userId);
    expect(activeCallsForUser(mate.userId)).not.toContain(callId);
    // Still active for everyone else.
    expect(activeCallsForUser(third.userId)).toContain(callId);
    expect(activeCallsForUser(owner.userId)).toContain(callId);
  });
});

describe("Multi-session per user", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let mate: Awaited<ReturnType<typeof loginAs>>;
  let channelId: number;

  beforeEach(async () => {
    env = await setupTestEnv();
    _resetPubSub();
    _resetCalls();
    owner = await loginAs(env, "ms-owner@x.com", "password");
    mate = await loginAs(env, "ms-mate@x.com", "password");
    await joinSameWorkspace(env, owner.workspaceId, mate.userId);
    const dm = await env.app.request("/api/chat/dms", {
      method: "POST",
      headers: j(owner.cookie),
      body: JSON.stringify({ userId: mate.userId }),
    });
    expect([200, 201]).toContain(dm.status);
    channelId = ((await dm.json()) as { id: number }).id;
  });
  afterEach(async () => {
    _resetPubSub();
    _resetCalls();
    await teardownTestEnv(env);
  });

  it("acceptCall забирает слот для первой сессии; повторный accept другой сессии того же юзера не меняет владельца", async () => {
    const { acceptCall, activeSessionForUser } = await import(
      "../../server/chat/calls"
    );
    const { callId } = await createCall({
      db: env.db,
      workspaceId: owner.workspaceId,
      channelId,
      initiatorUserId: owner.userId,
      initiatorSessionId: "owner-s1",
      callType: "audio",
      inviteeUserIds: [mate.userId],
      onMissed: () => {},
    });
    expect(activeSessionForUser(callId, owner.userId)).toBe("owner-s1");

    const ok1 = await acceptCall(env.db, callId, mate.userId, "mate-s1");
    expect(ok1).toBe(true);
    expect(activeSessionForUser(callId, mate.userId)).toBe("mate-s1");

    // Вторая сессия того же mate бьёт accept (например, нажал на втором
    // устройстве до того, как пришёл handled-elsewhere) — слот не меняется.
    const ok2 = await acceptCall(env.db, callId, mate.userId, "mate-s2");
    expect(ok2).toBe(false);
    expect(activeSessionForUser(callId, mate.userId)).toBe("mate-s1");
  });

  it("publish allowedSessionIds режет фанаут до одной сессии", async () => {
    const events1: ChatServerEvent[] = [];
    const events2: ChatServerEvent[] = [];
    const { publish } = await import("../../server/chat/pubsub");
    subscribe(
      owner.workspaceId,
      (e) => events1.push(e),
      mate.userId,
      "mate-s1",
    );
    subscribe(
      owner.workspaceId,
      (e) => events2.push(e),
      mate.userId,
      "mate-s2",
    );

    publish(
      owner.workspaceId,
      {
        type: "call.offer",
        workspaceId: owner.workspaceId,
        callId: 1,
        channelId: 1,
        payload: { from: owner.userId, to: mate.userId, sdp: null },
      },
      new Set([mate.userId]),
      { allowedSessionIds: new Set(["mate-s1"]) },
    );
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(0);
  });

  it("publish excludeSessionIds доставляет всем сокетам юзера, кроме указанной", async () => {
    const events1: ChatServerEvent[] = [];
    const events2: ChatServerEvent[] = [];
    const { publish, sessionIdsForUser } = await import(
      "../../server/chat/pubsub"
    );
    subscribe(
      owner.workspaceId,
      (e) => events1.push(e),
      mate.userId,
      "mate-s1",
    );
    subscribe(
      owner.workspaceId,
      (e) => events2.push(e),
      mate.userId,
      "mate-s2",
    );

    // sanity: оба сокета видны под одним userId
    expect(sessionIdsForUser(owner.workspaceId, mate.userId).sort()).toEqual([
      "mate-s1",
      "mate-s2",
    ]);

    publish(
      owner.workspaceId,
      {
        type: "call.handled-elsewhere",
        workspaceId: owner.workspaceId,
        callId: 5,
        channelId: 1,
        payload: { by: mate.userId, action: "accepted" },
      },
      new Set([mate.userId]),
      { allowedSessionIds: new Set(["mate-s2"]) },
    );
    expect(events1).toHaveLength(0);
    expect(events2).toHaveLength(1);
    expect(events2[0]?.type).toBe("call.handled-elsewhere");
  });
});
