/** In-memory pub/sub keyed by workspaceId. Single-process scope by design:
 * cross-process delivery requires Redis / Postgres LISTEN. Each WebSocket
 * subscriber gets one callback; publish() fans out synchronously to all
 * subscribers of the matching workspace. */

export interface ChatMessageEvent {
  type: "message.created" | "message.updated" | "message.deleted";
  channelId: number;
  messageId: number;
  workspaceId: number;
  payload: unknown;
}

export interface ChatChannelEvent {
  type: "channel.created" | "channel.updated" | "channel.archived";
  channelId: number;
  workspaceId: number;
  payload: unknown;
}

export interface ChatReactionEvent {
  type: "reaction.added" | "reaction.removed";
  channelId: number;
  messageId: number;
  workspaceId: number;
  payload: { emoji: string; userId: number };
}

export interface ChatTypingEvent {
  type: "typing.start" | "typing.stop";
  channelId: number;
  workspaceId: number;
  /** Для start: identity печатающего; для stop: только userId. */
  payload:
    | { userId: number; fullName: string; email: string; avatarDataUrl: string | null }
    | { userId: number };
}

export interface ChatPresenceEvent {
  type: "presence.online" | "presence.offline";
  workspaceId: number;
  payload: { userId: number };
}

export interface ChatReadEvent {
  type: "read.advanced";
  channelId: number;
  workspaceId: number;
  payload: { userId: number; messageId: number };
}

export type ChatServerEvent =
  | ChatMessageEvent
  | ChatChannelEvent
  | ChatReactionEvent
  | ChatTypingEvent
  | ChatPresenceEvent
  | ChatReadEvent;

type Listener = (event: ChatServerEvent) => void;

interface Subscriber {
  cb: Listener;
  /** userId of the subscribing session — used by publish() to filter
   * recipients when an event is restricted to a known set (DM events). */
  userId: number;
}

const subscribers = new Map<number, Set<Subscriber>>();

export function subscribe(
  workspaceId: number,
  cb: Listener,
  userId: number,
): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    subscribers.set(workspaceId, set);
  }
  const entry: Subscriber = { cb, userId };
  set.add(entry);
  return () => {
    const current = subscribers.get(workspaceId);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) subscribers.delete(workspaceId);
  };
}

/** Publish an event to subscribers of a workspace.
 *
 * Optional `allowedUserIds` restricts delivery — used for DM events where
 * only the two participants should ever see the payload. Without it, every
 * workspace subscriber gets the event (current behaviour for regular
 * channels). The filter is **the** mechanism that keeps DM contents out of
 * non-participants' sockets — do not bypass. */
export function publish(
  workspaceId: number,
  event: ChatServerEvent,
  allowedUserIds?: ReadonlySet<number>,
): void {
  const set = subscribers.get(workspaceId);
  if (!set) return;
  for (const e of set) {
    if (allowedUserIds && !allowedUserIds.has(e.userId)) continue;
    try {
      e.cb(event);
    } catch {
      // Subscriber errors must not break sibling deliveries.
    }
  }
}

/** Test helper: clear all subscribers (used in afterEach). */
export function _resetPubSub(): void {
  subscribers.clear();
}
