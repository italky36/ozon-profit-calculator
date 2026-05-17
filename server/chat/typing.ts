/** Серверный TTL для typing-индикаторов. Клиент шлёт typing.start при первом
 * нажатии, потом каждые ~4 сек продлевает; typing.stop при отправке. Если WS
 * рвётся с залипшим indicator'ом, этот watchdog снимает его через 6 сек
 * тишины и публикует typing.stop. */

import { publish } from "./pubsub";

const TYPING_TTL_MS = 6_000;

interface TypingKey {
  workspaceId: number;
  channelId: number;
  userId: number;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function key(k: TypingKey): string {
  return `${k.workspaceId}:${k.channelId}:${k.userId}`;
}

export interface TypingUser {
  userId: number;
  fullName: string;
  email: string;
  avatarDataUrl: string | null;
}

/** Бамп typing-таймера. Если такой записи ещё не было — publish typing.start.
 * Если была — просто сбрасываем TTL без publish (троттлинг для UI). */
export function bumpTyping(k: TypingKey, who: TypingUser): boolean {
  const id = key(k);
  const had = timers.has(id);
  if (had) clearTimeout(timers.get(id)!);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      publish(k.workspaceId, {
        type: "typing.stop",
        channelId: k.channelId,
        workspaceId: k.workspaceId,
        payload: { userId: k.userId },
      });
    }, TYPING_TTL_MS),
  );
  if (!had) {
    publish(k.workspaceId, {
      type: "typing.start",
      channelId: k.channelId,
      workspaceId: k.workspaceId,
      payload: who,
    });
  }
  return !had;
}

/** Явный typing.stop от клиента (например, после Enter/cancel). */
export function clearTyping(k: TypingKey): boolean {
  const id = key(k);
  const t = timers.get(id);
  if (!t) return false;
  clearTimeout(t);
  timers.delete(id);
  publish(k.workspaceId, {
    type: "typing.stop",
    channelId: k.channelId,
    workspaceId: k.workspaceId,
    payload: { userId: k.userId },
  });
  return true;
}

/** Снять все typing-индикаторы юзера в workspace при обрыве WS. */
export function clearAllForUser(workspaceId: number, userId: number): void {
  const prefix = `${workspaceId}:`;
  const suffix = `:${userId}`;
  for (const id of [...timers.keys()]) {
    if (!id.startsWith(prefix) || !id.endsWith(suffix)) continue;
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    const [, channelStr] = id.split(":");
    const channelId = Number(channelStr);
    publish(workspaceId, {
      type: "typing.stop",
      channelId,
      workspaceId,
      payload: { userId },
    });
  }
}

/** Test helper. */
export function _resetTyping(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
