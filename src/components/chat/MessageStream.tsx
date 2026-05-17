import { useLayoutEffect, useRef } from "react";
import type { ChatMessage } from "../../api";
import MessageItem from "./MessageItem";

interface MessageStreamProps {
  messages: ChatMessage[];
  currentUserId: number;
  canModerate: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onlineUsers: Set<number>;
  onLoadOlder: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, body: string) => Promise<void>;
  onToggleReaction: (messageId: number, emoji: string, mine: boolean) => void;
}

const STICK_THRESHOLD_PX = 80;
const LOAD_OLDER_THRESHOLD_PX = 80;

/** Scrolling discipline:
 *   - stick to bottom while user is at bottom (auto-scroll on new tail);
 *   - preserve viewport when prepending older history;
 *   - on first message render after mount/channel-switch: jump to bottom.
 *
 * «Was at bottom» is tracked via the scroll event (not an effect), because by
 * the time React effects run the DOM already contains the new message and
 * `scrollHeight` reflects the post-mutation size — making the
 * distance-from-bottom calculation always large, killing auto-scroll.
 * `useLayoutEffect` is used for the scroll-jump so it happens before paint. */
export default function MessageStream({
  messages,
  currentUserId,
  canModerate,
  hasMore,
  loadingOlder,
  onlineUsers,
  onLoadOlder,
  onDelete,
  onEdit,
  onToggleReaction,
}: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** True when the user is (approximately) at the bottom. Defaults to true so
   * initial mount auto-scrolls. Updated by the scroll handler on user action. */
  const stickToBottomRef = useRef(true);
  const prevFirstIdRef = useRef<number | null>(null);
  const prevScrollHeightRef = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || messages.length === 0) {
      prevFirstIdRef.current = null;
      prevScrollHeightRef.current = 0;
      return;
    }
    const firstId = messages[0]!.id;
    const prevFirst = prevFirstIdRef.current;
    const prevScrollHeight = prevScrollHeightRef.current;

    if (prevFirst !== null && firstId !== prevFirst) {
      // Older history prepended at top — preserve user's viewport position
      // by offsetting scrollTop by the inserted block's height.
      const delta = el.scrollHeight - prevScrollHeight;
      if (delta > 0) el.scrollTop += delta;
    } else if (stickToBottomRef.current) {
      // Either initial render or new tail message — keep at bottom.
      el.scrollTop = el.scrollHeight;
    }

    prevFirstIdRef.current = firstId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICK_THRESHOLD_PX;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasMore && !loadingOlder) {
      onLoadOlder();
    }
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 4px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {loadingOlder && (
        <div
          style={{
            textAlign: "center",
            padding: 8,
            fontSize: 12,
            color: "var(--muted, #888)",
          }}
        >
          загружаем…
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <div
          style={{
            textAlign: "center",
            padding: 8,
            fontSize: 12,
            color: "var(--muted, #888)",
          }}
        >
          — начало истории —
        </div>
      )}
      {messages.length === 0 && !loadingOlder && (
        <div
          style={{
            textAlign: "center",
            padding: 32,
            color: "var(--muted, #888)",
            fontSize: 14,
          }}
        >
          Пока сообщений нет. Напишите первое — команда увидит сразу.
        </div>
      )}
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          currentUserId={currentUserId}
          canDelete={canModerate || m.author.userId === currentUserId}
          canEdit={m.author.userId === currentUserId}
          isAuthorOnline={onlineUsers.has(m.author.userId)}
          onDelete={onDelete}
          onEdit={onEdit}
          onToggleReaction={onToggleReaction}
        />
      ))}
    </div>
  );
}
