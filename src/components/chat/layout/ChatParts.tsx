/** Shared building blocks for the chat layouts. None of these own state —
 * they consume bits of ChatViewProps and render a single visual region.
 * Keeping them in one file so the three layout files (Desktop/Tablet/
 * Mobile) stay focused on arrangement, not on what's inside each region. */
import type { ReactNode } from "react";
import { Hash, Phone, Search, Video, X } from "lucide-react";
import MessageStream from "../MessageStream";
import Composer from "../Composer";
import TypingIndicator from "../TypingIndicator";
import SearchPanel from "../SearchPanel";
import ThreadPanel from "../ThreadPanel";
import type { ChatViewProps } from "./types";

interface ChannelHeaderProps {
  v: ChatViewProps;
  /** Optional left-side widget — used by mobile to inject a hamburger
   *  toggle for the channel-list drawer. */
  leftSlot?: ReactNode;
}

export function ChannelHeader({ v, leftSlot }: ChannelHeaderProps) {
  if (!v.activeChannel) return null;
  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--border, #e2e2e2)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      {leftSlot}
      <strong
        style={{
          fontSize: 15,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        #{v.activeChannel.name}
      </strong>
      <ConnectionDot state={v.connectionState} />
      <button
        type="button"
        className="btn-icon"
        onClick={v.onToggleSearch}
        title="Поиск по сообщениям"
        aria-label="Поиск по сообщениям"
      >
        <Search size={16} />
      </button>
      {v.onStartCall && !v.activeChannel.archivedAt && (
        <>
          <button
            type="button"
            className="btn-icon"
            onClick={() =>
              v.onStartCall?.(v.activeChannel!.id, "audio")
            }
            title="Аудиозвонок"
            aria-label="Аудиозвонок"
          >
            <Phone size={16} />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() =>
              v.onStartCall?.(v.activeChannel!.id, "video")
            }
            title="Видеозвонок"
            aria-label="Видеозвонок"
          >
            <Video size={16} />
          </button>
        </>
      )}
    </div>
  );
}

/** Small coloured dot for the WebSocket connection state. Replaces the
 * previous "в реальном времени"/"соединение"/"оффлайн" text — the colour
 * carries the same info without eating horizontal space. Tooltip preserves
 * accessibility. */
function ConnectionDot({
  state,
}: {
  state: "open" | "connecting" | "closed";
}) {
  const color =
    state === "open"
      ? "#22c55e"
      : state === "connecting"
        ? "#eab308"
        : "var(--danger, #c33)";
  const label =
    state === "open"
      ? "в реальном времени"
      : state === "connecting"
        ? "соединение…"
        : "оффлайн";
  return (
    <span
      aria-label={label}
      title={label}
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function ErrorBanner({ v }: { v: ChatViewProps }) {
  if (!v.error) return null;
  return (
    <div
      style={{
        padding: "6px 12px",
        background: "var(--danger-soft, #fee)",
        color: "var(--danger, #c33)",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{v.error}</span>
      <button
        type="button"
        className="btn-icon"
        onClick={v.onClearError}
        aria-label="Закрыть ошибку"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function FeedRegion({ v }: { v: ChatViewProps }) {
  if (v.loadingMessages) {
    return (
      <p className="muted" style={{ padding: 16 }}>
        Загрузка…
      </p>
    );
  }
  return (
    <MessageStream
      messages={v.messages}
      currentUserId={v.currentUserId}
      canModerate={v.canManage}
      hasMore={v.hasMore}
      loadingOlder={v.loadingOlder}
      channelId={v.activeChannel?.id ?? null}
      onlineUsers={v.onlineUsers}
      members={v.members}
      isTouch={v.isTouch}
      isDm={v.activeChannel?.type === "dm"}
      onLoadOlder={v.onLoadOlder}
      onDelete={v.onDelete}
      onEdit={v.onEdit}
      onToggleReaction={v.onToggleReaction}
      onMarkRead={v.onMarkRead}
      onOpenThread={v.onOpenThread}
      onOpenDm={v.onOpenDm}
      onQuoteMessage={v.onQuoteMessage}
      scrollToBottomToken={v.scrollToBottomToken}
    />
  );
}

export function TypingRow({ v }: { v: ChatViewProps }) {
  if (!v.activeChannel) return null;
  return (
    <TypingIndicator
      people={[...(v.typingByChannel.get(v.activeChannel.id)?.values() ?? [])]}
    />
  );
}

export function ComposerRow({
  v,
  hideHints,
}: {
  v: ChatViewProps;
  /** Hide keyboard-shortcut hints on touch (Enter/Shift+Enter are PC-only). */
  hideHints?: boolean;
}) {
  if (!v.activeChannel || v.activeChannel.archivedAt) return null;
  return (
    <div
      style={{
        padding: 10,
        borderTop: "1px solid var(--border, #e2e2e2)",
      }}
    >
      <Composer
        channelName={v.activeChannel.name}
        members={v.members}
        onSendText={v.onSendText}
        onSendWithAttachments={v.onSendWithAttachments}
        onTypingStart={v.onTypingStart}
        onTypingStop={v.onTypingStop}
        hideHints={hideHints}
        quoting={v.quoting}
        onCancelQuote={v.onCancelQuote}
      />
    </div>
  );
}

export function SearchRow({ v }: { v: ChatViewProps }) {
  if (!v.searchOpen || !v.activeChannel) return null;
  return (
    <SearchPanel
      channelId={v.activeChannel.id}
      channelName={v.activeChannel.name}
      onJump={(chId) => {
        v.onSelectChannel(chId);
        v.onCloseSearch();
      }}
      onClose={v.onCloseSearch}
    />
  );
}

/** Inline thread panel — used by Desktop (third column) and Tablet (drawer
 * mode). For Mobile, see MobileLayout which mounts the thread as a
 * bottom-sheet directly. */
export function InlineThreadPanel({ v }: { v: ChatViewProps }) {
  if (v.threadParentId == null || !v.activeChannel) return null;
  // Fixed-width slot in the desktop 3-col layout; ThreadPanel itself now
  // fills its parent (width: 100%) so wherever it's placed (this slot, or
  // a drawer), it expands edge-to-edge.
  return (
    <div
      style={{
        width: 360,
        flex: "0 0 360px",
        display: "flex",
        minHeight: 0,
      }}
    >
      <ThreadPanel
        parentMessageId={v.threadParentId}
        channelName={v.activeChannel.name}
        currentUserId={v.currentUserId}
        canModerate={v.canManage}
        onlineUsers={v.onlineUsers}
        members={v.members}
        externalUpdates={v.threadUpdates}
        onOpenDm={v.onOpenDm}
        onClose={v.onCloseThread}
      />
    </div>
  );
}

/** Channels button — used in MobileLayout to open the channels drawer.
 *  Uses Hash (not Menu) so it doesn't visually collide with the app-level
 *  TabBar hamburger that sits right above the chat card. */
export function HamburgerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-icon"
      onClick={onClick}
      aria-label="Каналы"
      title="Каналы"
      style={{ flex: "0 0 auto" }}
    >
      <Hash size={18} />
    </button>
  );
}
