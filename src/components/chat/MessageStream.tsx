import { useEffect, useLayoutEffect, useRef } from "react";
import type { ChatMessage, WorkspaceMember } from "../../api";
import MessageItem from "./MessageItem";

interface MessageStreamProps {
  messages: ChatMessage[];
  currentUserId: number;
  canModerate: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  channelId: number | null;
  onlineUsers: Set<number>;
  /** Workspace roster — passed to MessageItem for read-indicator avatars. */
  members: WorkspaceMember[];
  /** Touch-device mode — forwarded to MessageItem (long-press / swipe). */
  isTouch?: boolean;
  /** True when the active channel is a DM. Forwarded so MessageItem can
   *  suppress the «who read» avatar strip (redundant in 1-on-1 chats). */
  isDm?: boolean;
  onLoadOlder: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, body: string) => Promise<void>;
  onToggleReaction: (messageId: number, emoji: string, mine: boolean) => void;
  onMarkRead: (channelId: number, messageId: number) => void;
  onOpenThread: (messageId: number) => void;
  /** Forwarded to MessageItem for avatar / mention popovers. */
  onOpenDm?: (userId: number) => void;
  /** Stage a message as the inline-quote target (Composer renders banner). */
  onQuoteMessage?: (message: ChatMessage) => void;
  /** Monotonically-increasing token. When it bumps, the stream forces a
   *  scroll-to-bottom regardless of current scroll position. Used after the
   *  user sends a message — without this, replying to an older quoted
   *  message would leave the viewport stuck at the quote location. */
  scrollToBottomToken?: number;
}

const STICK_THRESHOLD_PX = 80;
const LOAD_OLDER_THRESHOLD_PX = 80;
const MARK_READ_DEBOUNCE_MS = 800;

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
  channelId,
  onlineUsers,
  members,
  isTouch = false,
  isDm = false,
  onLoadOlder,
  onDelete,
  onEdit,
  onToggleReaction,
  onMarkRead,
  onOpenThread,
  onOpenDm,
  onQuoteMessage,
  scrollToBottomToken,
}: MessageStreamProps) {
  // Other-members count for the «✓✓ all read» heuristic. Author is always
  // current user for own messages (the only rows that get ticks), so
  // subtract 1 from total members.
  const otherMembersCount = Math.max(0, members.length - 1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** True when the user is (approximately) at the bottom. Defaults to true so
   * initial mount auto-scrolls. Updated by the scroll handler on user action. */
  const stickToBottomRef = useRef(true);
  const prevFirstIdRef = useRef<number | null>(null);
  const prevScrollHeightRef = useRef(0);
  /** Highest visible messageId we've seen (any author). Debounced mark-read
   * publishes this. */
  const maxVisibleIdRef = useRef<number>(0);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced read pointer bump. Re-scheduled on every visibility change.
  const scheduleMarkRead = (id: number) => {
    if (id <= maxVisibleIdRef.current) return;
    maxVisibleIdRef.current = id;
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null;
      if (channelId != null && maxVisibleIdRef.current > 0) {
        onMarkRead(channelId, maxVisibleIdRef.current);
      }
    }, MARK_READ_DEBOUNCE_MS);
  };

  // Reset the read tracker when the channel switches; otherwise we'd treat
  // the previous channel's lastReadId as already-known for the new one.
  useEffect(() => {
    maxVisibleIdRef.current = 0;
    if (markReadTimerRef.current) {
      clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = null;
    }
  }, [channelId]);

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
    // When user is near the bottom of the feed, mark the latest message as
    // read. Cheap heuristic — proper IntersectionObserver per-row would be
    // more precise but the bottom-of-feed semantic matches user intent
    // («I see what's new»).
    if (distanceFromBottom < STICK_THRESHOLD_PX && messages.length > 0) {
      const lastId = messages[messages.length - 1]!.id;
      scheduleMarkRead(lastId);
    }
  };

  // Also mark-read on mount / new tail when the user is already at the
  // bottom (auto-scroll keeps them there for active conversations).
  useEffect(() => {
    if (messages.length === 0 || channelId == null) return;
    if (!stickToBottomRef.current) return;
    const lastId = messages[messages.length - 1]!.id;
    scheduleMarkRead(lastId);
    // scheduleMarkRead is stable enough — only channelId / messages drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, channelId]);

  // Forced scroll-to-bottom on token bump (after a successful send). Runs in
  // layout phase so the user never sees an intermediate "stuck at quote"
  // frame between optimistic append and the viewport jump.
  useLayoutEffect(() => {
    if (scrollToBottomToken == null || scrollToBottomToken === 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
  }, [scrollToBottomToken]);

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
          onOpenThread={onOpenThread}
          onQuoteMessage={onQuoteMessage}
          members={members}
          otherMembersCount={otherMembersCount}
          isTouch={isTouch}
          isDm={isDm}
          onOpenDm={onOpenDm}
          onlineUsers={onlineUsers}
        />
      ))}
    </div>
  );
}
