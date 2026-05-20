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

/** WebRTC signaling fan-out. All variants share `callId` so clients can route
 * the event to the right call session. `payload.from` is the originating user
 * (added by the server, not trusted from client). Most variants are restricted
 * to the call's participant set via pubsub's `allowedUserIds` — `call.incoming`
 * is delivered to the callee(s) only, SDP/ICE go to the specific peer.
 *
 * `call.peer-joined` carries the full snapshot of `connectedUserIds` after
 * the new peer connected — clients use this to drive the mesh handshake
 * (already-connected peers offer SDP to the newcomer; see callManager.ts).
 *
 * `call.peer-declined` fires in group calls (≥3 invitees) when one callee
 * declines but the call should continue with the rest — distinct from
 * `call.declined`/`call.ended` which terminate the whole session.
 *
 * `call.handled-elsewhere` — фанаут на остальные WS-сессии того же юзера,
 * когда одна из его сессий приняла/отклонила звонок. На клиенте баннер
 * IncomingCallBanner снимается, чтобы 2-е/3-е устройство не звонило вечно. */
export interface ChatCallEvent {
  type:
    | "call.incoming"
    | "call.accepted"
    | "call.declined"
    | "call.ended"
    | "call.offer"
    | "call.answer"
    | "call.ice"
    | "call.peer-joined"
    | "call.peer-left"
    | "call.peer-declined"
    | "call.handled-elsewhere";
  workspaceId: number;
  callId: number;
  channelId: number;
  payload: Record<string, unknown>;
}

export type ChatServerEvent =
  | ChatMessageEvent
  | ChatChannelEvent
  | ChatReactionEvent
  | ChatTypingEvent
  | ChatPresenceEvent
  | ChatReadEvent
  | ChatCallEvent;

type Listener = (event: ChatServerEvent) => void;

interface Subscriber {
  cb: Listener;
  /** userId of the subscribing session — used by publish() to filter
   * recipients when an event is restricted to a known set (DM events). */
  userId: number;
  /** Уникальный id WS-сокета (per-connection). Звонковый сигналинг
   * адресует SDP/ICE конкретной сессии, чтобы при двух одновременно
   * залогиненных вкладках одного юзера ответы/кандидаты не шли с обоих
   * устройств в один PeerConnection. */
  sessionId: string;
}

const subscribers = new Map<number, Set<Subscriber>>();

let sessionCounter = 0;
export function nextSessionId(): string {
  sessionCounter += 1;
  return `s${Date.now().toString(36)}-${sessionCounter}`;
}

export function subscribe(
  workspaceId: number,
  cb: Listener,
  userId: number,
  sessionId?: string,
): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    subscribers.set(workspaceId, set);
  }
  const entry: Subscriber = {
    cb,
    userId,
    sessionId: sessionId ?? nextSessionId(),
  };
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
 * non-participants' sockets — do not bypass.
 *
 * `allowedSessionIds` дополнительно сужает доставку до конкретных WS-сессий —
 * нужен для звонкового сигналинга, где у одного юзера может быть несколько
 * сокетов, а offer/answer/ICE должен прийти только в ту сессию, что
 * принимала/инициировала звонок.
 *
 * `excludeSessionIds` — исключить конкретные сокеты (например, при фанауте
 * `call.handled-elsewhere` нужно НЕ отправлять событие в ту сессию, что
 * звонок и приняла). */
export function publish(
  workspaceId: number,
  event: ChatServerEvent,
  allowedUserIds?: ReadonlySet<number>,
  options?: {
    allowedSessionIds?: ReadonlySet<string>;
    excludeSessionIds?: ReadonlySet<string>;
  },
): void {
  const set = subscribers.get(workspaceId);
  if (!set) return;
  for (const e of set) {
    if (allowedUserIds && !allowedUserIds.has(e.userId)) continue;
    if (
      options?.allowedSessionIds &&
      !options.allowedSessionIds.has(e.sessionId)
    ) {
      continue;
    }
    if (options?.excludeSessionIds?.has(e.sessionId)) continue;
    try {
      e.cb(event);
    } catch {
      // Subscriber errors must not break sibling deliveries.
    }
  }
}

/** Возвращает все sessionId, подписанные на workspace под заданным userId.
 * Используется звонковым роутом для фанаута `call.handled-elsewhere` на
 * все остальные сокеты юзера, кроме той, что приняла/отклонила звонок. */
export function sessionIdsForUser(
  workspaceId: number,
  userId: number,
): string[] {
  const set = subscribers.get(workspaceId);
  if (!set) return [];
  const ids: string[] = [];
  for (const e of set) {
    if (e.userId === userId) ids.push(e.sessionId);
  }
  return ids;
}

/** Test helper: clear all subscribers (used in afterEach). */
export function _resetPubSub(): void {
  subscribers.clear();
}
