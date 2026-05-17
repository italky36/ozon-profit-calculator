/** Workspace-scoped presence tracking. Reference-counted per (workspace,
 * user) — каждая активная WS-сессия инкрементит, onClose декрементит.
 * Publish 'presence.online' только на переходе 0→1, 'presence.offline' на 1→0
 * — мульти-таб не плодит лишних event'ов. */

import { publish } from "./pubsub";

const counters = new Map<number, Map<number, number>>();

function getMap(workspaceId: number): Map<number, number> {
  let m = counters.get(workspaceId);
  if (!m) {
    m = new Map();
    counters.set(workspaceId, m);
  }
  return m;
}

/** Returns true if this is the first session for the user (0→1 transition). */
export function attach(workspaceId: number, userId: number): boolean {
  const m = getMap(workspaceId);
  const prev = m.get(userId) ?? 0;
  m.set(userId, prev + 1);
  if (prev === 0) {
    publish(workspaceId, {
      type: "presence.online",
      workspaceId,
      payload: { userId },
    });
    return true;
  }
  return false;
}

/** Returns true if this was the last session for the user (1→0 transition). */
export function detach(workspaceId: number, userId: number): boolean {
  const m = counters.get(workspaceId);
  if (!m) return false;
  const prev = m.get(userId) ?? 0;
  if (prev <= 1) {
    m.delete(userId);
    if (m.size === 0) counters.delete(workspaceId);
    if (prev === 1) {
      publish(workspaceId, {
        type: "presence.offline",
        workspaceId,
        payload: { userId },
      });
      return true;
    }
    return false;
  }
  m.set(userId, prev - 1);
  return false;
}

/** Snapshot of online userIds in a workspace (used for bootstrap). */
export function onlineUserIds(workspaceId: number): number[] {
  const m = counters.get(workspaceId);
  return m ? [...m.keys()] : [];
}

/** Cheap check used by notification orchestrator (Stage 4). */
export function isUserOnline(workspaceId: number, userId: number): boolean {
  return (counters.get(workspaceId)?.get(userId) ?? 0) > 0;
}

export function _resetPresence(): void {
  counters.clear();
}
