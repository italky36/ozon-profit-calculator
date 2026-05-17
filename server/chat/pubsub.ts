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

export type ChatServerEvent =
  | ChatMessageEvent
  | ChatChannelEvent
  | ChatReactionEvent
  | ChatTypingEvent
  | ChatPresenceEvent;

type Listener = (event: ChatServerEvent) => void;

const subscribers = new Map<number, Set<Listener>>();

export function subscribe(workspaceId: number, cb: Listener): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    subscribers.set(workspaceId, set);
  }
  set.add(cb);
  return () => {
    const current = subscribers.get(workspaceId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) subscribers.delete(workspaceId);
  };
}

export function publish(workspaceId: number, event: ChatServerEvent): void {
  const set = subscribers.get(workspaceId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      // Subscriber errors must not break sibling deliveries.
    }
  }
}

/** Test helper: clear all subscribers (used in afterEach). */
export function _resetPubSub(): void {
  subscribers.clear();
}
