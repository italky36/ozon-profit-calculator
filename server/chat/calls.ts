/** WebRTC signaling state machine — Stage 5.
 *
 * Calls live in two places:
 *   - chat_calls / chat_call_participants — persistent history (who called
 *     whom, when, why it ended). Hardened on every state transition.
 *   - this module — in-memory roster of *active* peers so SDP/ICE messages
 *     can be routed to the right set of users and missed-call timers can
 *     fire without polling the DB.
 *
 * The DB is the source of truth for «did this call happen at all»; the
 * in-memory roster is the source of truth for «who is talking *right now*».
 * A server restart loses active calls (clients reconnect → invitation lapses
 * → callee gets missed-call), which is the acceptable failure mode for a
 * single-process design. */

import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  chatCallParticipants,
  chatCalls,
  chatChannelMembers,
  chatChannels,
} from "../db/schema";
import { publish } from "./pubsub";

export type CallType = "audio" | "video";
export type EndReason = "completed" | "declined" | "missed" | "failed";

interface ActiveCall {
  callId: number;
  channelId: number;
  workspaceId: number;
  initiatorUserId: number;
  callType: CallType;
  /** All users invited to the call (initiator + targets). */
  invitedUserIds: Set<number>;
  /** Users currently connected (sent accept + WS still open). */
  connectedUserIds: Set<number>;
  /** Pending ringing timeout — fires missed-call if no one accepts. */
  ringTimer: NodeJS.Timeout | null;
  startedAt: Date;
}

const activeCalls = new Map<number, ActiveCall>();
/** Reverse index: user → callIds they're invited to. Lets onWsClose hang up
 * all calls for that user without scanning every active call. */
const userCalls = new Map<number, Set<number>>();

const RING_TIMEOUT_MS = 45_000;

function indexUser(userId: number, callId: number): void {
  let s = userCalls.get(userId);
  if (!s) {
    s = new Set();
    userCalls.set(userId, s);
  }
  s.add(callId);
}

function unindexUser(userId: number, callId: number): void {
  const s = userCalls.get(userId);
  if (!s) return;
  s.delete(callId);
  if (s.size === 0) userCalls.delete(userId);
}

export function getActiveCall(callId: number): ActiveCall | undefined {
  return activeCalls.get(callId);
}

export function activeCallsForUser(userId: number): number[] {
  return [...(userCalls.get(userId) ?? [])];
}

/** Pre-flight check: does `userId` have a seat in this call? Used by SDP/ICE
 * proxy handlers to reject impersonators. */
export function isParticipant(callId: number, userId: number): boolean {
  return activeCalls.get(callId)?.invitedUserIds.has(userId) ?? false;
}

interface CreateCallInput {
  db: DB;
  workspaceId: number;
  channelId: number;
  initiatorUserId: number;
  callType: CallType;
  /** Users to invite, excluding the initiator. */
  inviteeUserIds: number[];
  /** Fires when the ring timeout elapses with nobody connected — caller
   * provides this so the chat-route can write a system message + push without
   * importing the route here. */
  onMissed: (call: ActiveCall) => void | Promise<void>;
}

/** Begin a new call: insert chat_calls row + participants, register in
 * memory, publish call.incoming to invitees. Returns the persisted call id. */
export async function createCall(
  input: CreateCallInput,
): Promise<{ callId: number }> {
  const now = new Date();
  const inserted = input.db
    .insert(chatCalls)
    .values({
      channelId: input.channelId,
      initiatorUserId: input.initiatorUserId,
      callType: input.callType,
      startedAt: now,
    })
    .returning({ id: chatCalls.id })
    .get();
  const callId = inserted.id;

  const invited = new Set<number>([
    input.initiatorUserId,
    ...input.inviteeUserIds,
  ]);
  for (const uid of invited) {
    input.db
      .insert(chatCallParticipants)
      .values({ callId, userId: uid, joinedAt: null, leftAt: null })
      .onConflictDoNothing()
      .run();
  }

  const ringTimer = setTimeout(() => {
    const call = activeCalls.get(callId);
    if (!call) return;
    // If anyone connected, the call has moved past ringing.
    if (call.connectedUserIds.size > 1) return;
    void input.onMissed(call);
  }, RING_TIMEOUT_MS);
  // Don't let the timer hold the event loop open in tests / shutdown.
  ringTimer.unref?.();

  const active: ActiveCall = {
    callId,
    channelId: input.channelId,
    workspaceId: input.workspaceId,
    initiatorUserId: input.initiatorUserId,
    callType: input.callType,
    invitedUserIds: invited,
    connectedUserIds: new Set([input.initiatorUserId]),
    ringTimer,
    startedAt: now,
  };
  activeCalls.set(callId, active);
  for (const uid of invited) indexUser(uid, callId);

  publish(
    input.workspaceId,
    {
      type: "call.incoming",
      workspaceId: input.workspaceId,
      callId,
      channelId: input.channelId,
      payload: {
        from: input.initiatorUserId,
        callType: input.callType,
        invitedUserIds: [...invited],
      },
    },
    invited,
  );
  return { callId };
}

/** Callee picks up. Records joined_at in DB, broadcasts two events:
 *   - `call.accepted { from }` — legacy UI signal, kept for backward-compat
 *     with clients that don't yet consume `call.peer-joined`. 1-on-1 DM
 *     handshake relies on this for the caller-offers-callee flow.
 *   - `call.peer-joined { userId, connectedUserIds }` — authoritative
 *     mesh-handshake signal. Every previously-connected peer with a smaller
 *     userId offers SDP to the newcomer (glare resolution); the new peer
 *     consumes incoming offers. */
export async function acceptCall(
  db: DB,
  callId: number,
  userId: number,
): Promise<boolean> {
  const call = activeCalls.get(callId);
  if (!call) return false;
  if (!call.invitedUserIds.has(userId)) return false;
  call.connectedUserIds.add(userId);
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = null;
  }
  db.update(chatCallParticipants)
    .set({ joinedAt: new Date() })
    .where(
      and(
        eq(chatCallParticipants.callId, callId),
        eq(chatCallParticipants.userId, userId),
      ),
    )
    .run();
  publish(
    call.workspaceId,
    {
      type: "call.accepted",
      workspaceId: call.workspaceId,
      callId,
      channelId: call.channelId,
      payload: { from: userId },
    },
    call.invitedUserIds,
  );
  publish(
    call.workspaceId,
    {
      type: "call.peer-joined",
      workspaceId: call.workspaceId,
      callId,
      channelId: call.channelId,
      payload: {
        userId,
        connectedUserIds: [...call.connectedUserIds],
      },
    },
    call.invitedUserIds,
  );
  return true;
}

interface EndCallInput {
  db: DB;
  callId: number;
  /** User triggering the end (for the audit row in chat_call_participants). */
  byUserId: number | null;
  reason: EndReason;
}

/** Hangup / decline / missed / failed terminator. Idempotent — if the call
 * isn't active anymore (already ended), returns null. Otherwise returns the
 * snapshot needed by the caller to write a system-message. */
export async function endCall(
  input: EndCallInput,
): Promise<ActiveCall | null> {
  const call = activeCalls.get(input.callId);
  if (!call) return null;
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = null;
  }
  const endedAt = new Date();
  input.db
    .update(chatCalls)
    .set({ endedAt, endReason: input.reason })
    .where(eq(chatCalls.id, input.callId))
    .run();
  if (input.byUserId != null) {
    input.db
      .update(chatCallParticipants)
      .set({ leftAt: endedAt })
      .where(
        and(
          eq(chatCallParticipants.callId, input.callId),
          eq(chatCallParticipants.userId, input.byUserId),
        ),
      )
      .run();
  }
  // Notify everyone before tearing down the in-memory roster.
  publish(
    call.workspaceId,
    {
      type: "call.ended",
      workspaceId: call.workspaceId,
      callId: input.callId,
      channelId: call.channelId,
      payload: { reason: input.reason, by: input.byUserId },
    },
    call.invitedUserIds,
  );
  activeCalls.delete(input.callId);
  for (const uid of call.invitedUserIds) unindexUser(uid, input.callId);
  return call;
}

/** Per-call participant leave (multi-party mid-call exit). For 2-party calls,
 * one peer leaving collapses the call → caller should follow up with
 * endCall(). Returns true when the call is now empty enough to terminate. */
export async function leaveCall(
  db: DB,
  callId: number,
  userId: number,
): Promise<boolean> {
  const call = activeCalls.get(callId);
  if (!call) return false;
  call.connectedUserIds.delete(userId);
  db.update(chatCallParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(chatCallParticipants.callId, callId),
        eq(chatCallParticipants.userId, userId),
      ),
    )
    .run();
  publish(
    call.workspaceId,
    {
      type: "call.peer-left",
      workspaceId: call.workspaceId,
      callId,
      channelId: call.channelId,
      payload: { userId },
    },
    call.invitedUserIds,
  );
  return call.connectedUserIds.size <= 1;
}

/** Group-call decline: drop one invitee from the roster without ending the
 * whole call. Used by chat.ts when `invitedUserIds.size > 2` so one
 * declining callee doesn't collapse the session for everyone else.
 *
 * - Removes user from `invitedUserIds` and `connectedUserIds`.
 * - Cleans up the per-user index.
 * - Persists `left_at` on the participants row.
 * - Returns `{ allDeclined: true }` when only the initiator remains in
 *   `connectedUserIds` AND no other invitee is still pending (i.e. every
 *   non-initiator either declined or hung up before joining). Caller then
 *   triggers `endCall(declined)`. The ring-timer is also cancelled in that
 *   case to avoid a double finalize.
 *
 * Idempotent — declining an already-removed user is a no-op returning
 * `{ allDeclined: false }`. */
export async function declineCall(
  db: DB,
  callId: number,
  userId: number,
): Promise<{ allDeclined: boolean }> {
  const call = activeCalls.get(callId);
  if (!call) return { allDeclined: false };
  const wasInvited = call.invitedUserIds.delete(userId);
  call.connectedUserIds.delete(userId);
  if (wasInvited) unindexUser(userId, callId);
  db.update(chatCallParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(chatCallParticipants.callId, callId),
        eq(chatCallParticipants.userId, userId),
      ),
    )
    .run();
  // After removal: the only user left in `invitedUserIds` is the initiator
  // → nobody else to wait for / talk to → caller wraps up with endCall.
  const onlyInitiatorLeft =
    call.invitedUserIds.size === 1 &&
    call.invitedUserIds.has(call.initiatorUserId);
  if (onlyInitiatorLeft && call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = null;
  }
  return { allDeclined: onlyInitiatorLeft };
}

/** Compute the list of users to invite into a new call given the channel.
 *
 * - DM → the peer (the one non-initiator member).
 * - Private channel → all chat_channel_members minus the initiator.
 * - Open channel → all workspace members (capped at MAX_INVITEES; over the
 *   cap is currently rejected upstream).
 *
 * Returns null if the channel isn't valid for calls (archived / cross-
 * workspace). Caller must already have verified userCanAccessChannel. */
export async function resolveInvitees(
  db: DB,
  channel: typeof chatChannels.$inferSelect,
  initiatorUserId: number,
): Promise<number[] | null> {
  if (channel.archivedAt != null) return null;
  if (channel.type === "dm" || channel.isPrivate) {
    const rows = await db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(eq(chatChannelMembers.channelId, channel.id));
    return rows.map((r) => r.userId).filter((uid) => uid !== initiatorUserId);
  }
  // Open channel — mesh group call. Plan caps mesh at 5 total participants,
  // so the channel must have ≤4 other workspace members or we refuse.
  // Workspace-member resolution happens in the route to avoid an extra import
  // cycle here.
  return null;
}

/** Test helper. Clears all in-memory calls. */
export function _resetCalls(): void {
  for (const call of activeCalls.values()) {
    if (call.ringTimer) clearTimeout(call.ringTimer);
  }
  activeCalls.clear();
  userCalls.clear();
}
