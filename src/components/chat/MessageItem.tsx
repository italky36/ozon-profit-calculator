import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import type { ChatMessage, WorkspaceMember } from "../../api";
import Avatar from "../Avatar";
import Attachment from "./Attachment";
import ReactionsBar from "./ReactionsBar";
import ReadByIndicator from "./ReadByIndicator";
import ReadStatusTicks from "./ReadStatusTicks";
import MessageActionsSheet from "./MessageActionsSheet";
import UserPopover from "./UserPopover";
import { useLongPress } from "../../lib/useLongPress";
import { useSwipe } from "../../lib/useSwipe";

const URL_RE = /(https?:\/\/[^\s<>]+)/g;
const MENTION_RE = /@([\p{L}\p{N}_.-]{2,40})/gu;
/** Matches strings made only of emoji glyphs + zero-width joiners + variation
 * selectors + whitespace. Used to detect «jumbomoji» messages (one-to-few
 * emojis only) which we render at increased font-size for legibility.
 * Constructed via RegExp() so the ZWJ (‍, joins emoji sequences like
 * 👨‍👩‍👧) and VS-16 (️, forces emoji presentation) are escapes, not
 * literal zero-width chars in source (ESLint's no-misleading-character-class
 * doesn't allow those inside `[]`). */
/* eslint-disable no-misleading-character-class -- ZWJ + VS-16 are
   deliberately part of the class to match emoji sequences (e.g. 👨‍👩‍👧). */
const EMOJI_ONLY_RE = new RegExp(
  "^[\\s\\p{Extended_Pictographic}\\p{Emoji_Component}\\u200D\\uFE0F]+$",
  "u",
);
/* eslint-enable no-misleading-character-class */
const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

function normalizeMention(s: string): string {
  return s.toLowerCase().replace(/[\s._-]+/g, "");
}

/** Returns a font-size px for emoji-only messages, or null when the message
 * has any non-emoji content (regular text). Cap at 8 graphemes — beyond that
 * a wall of emojis isn't really «expressive» and should stay normal-size. */
function emojiOnlyFontSize(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!EMOJI_ONLY_RE.test(trimmed)) return null;
  let count = 0;
  if (GRAPHEME_SEGMENTER) {
    for (const seg of GRAPHEME_SEGMENTER.segment(trimmed)) {
      if (seg.segment.trim()) count += 1;
      if (count > 8) return null;
    }
  } else {
    // Fallback: rough estimate via Array.from (splits surrogate pairs but
    // doesn't handle ZWJ sequences — close enough as an upper bound).
    count = [...trimmed].filter((ch) => ch.trim()).length;
    if (count > 16) return null;
  }
  if (count === 0) return null;
  if (count === 1) return 40;
  if (count <= 3) return 32;
  return 24;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  return `${d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  })} ${hh}:${mm}`;
}

interface RenderOpts {
  mentionedKeys: Set<string>;
  myMentionKey: string | null;
  /** Lookup `token-normalized → mention.userId`. Used to resolve a click
   *  back to the workspace member for the popover. */
  mentionByKey: Map<string, number>;
  onMentionClick?: (userId: number, anchor: DOMRect) => void;
}

function renderMentionToken(
  raw: string,
  opts: RenderOpts,
  key: string,
): ReactNode {
  const tokenKey = normalizeMention(raw.slice(1));
  const isResolved = opts.mentionedKeys.has(tokenKey);
  const isMine = opts.myMentionKey === tokenKey;
  if (!isResolved) return raw;
  const resolvedUserId = opts.mentionByKey.get(tokenKey);
  const baseStyle: React.CSSProperties = {
    color: "var(--accent)",
    fontWeight: isMine ? 700 : 500,
    background: isMine ? "var(--accent-soft, #eef)" : undefined,
    padding: isMine ? "0 4px" : undefined,
    borderRadius: isMine ? 4 : undefined,
  };
  if (resolvedUserId == null || !opts.onMentionClick) {
    return (
      <span key={key} style={baseStyle}>
        {raw}
      </span>
    );
  }
  return (
    <button
      key={key}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        opts.onMentionClick!(
          resolvedUserId,
          (e.currentTarget as HTMLElement).getBoundingClientRect(),
        );
      }}
      style={{
        ...baseStyle,
        border: "none",
        background: baseStyle.background ?? "transparent",
        cursor: "pointer",
        font: "inherit",
        padding: baseStyle.padding ?? 0,
      }}
    >
      {raw}
    </button>
  );
}

function linkify(text: string, opts: RenderOpts): ReactNode[] {
  // Two-pass: split text by URL tokens, then within each non-URL chunk
  // additionally split by @mention tokens.
  const urlParts: Array<{ kind: "url" | "text"; value: string }> = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      urlParts.push({ kind: "text", value: text.slice(lastIdx, match.index) });
    }
    urlParts.push({ kind: "url", value: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    urlParts.push({ kind: "text", value: text.slice(lastIdx) });
  }

  const out: ReactNode[] = [];
  let nodeKey = 0;
  for (const part of urlParts) {
    if (part.kind === "url") {
      out.push(
        <a
          key={`u${nodeKey++}`}
          href={part.value}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)" }}
        >
          {part.value}
        </a>,
      );
      continue;
    }
    // text — find @mentions inside.
    let li = 0;
    let m: RegExpExecArray | null;
    const s = part.value;
    MENTION_RE.lastIndex = 0;
    while ((m = MENTION_RE.exec(s)) !== null) {
      if (m.index > li) out.push(s.slice(li, m.index));
      out.push(renderMentionToken(m[0], opts, `m${nodeKey++}`));
      li = m.index + m[0].length;
    }
    if (li < s.length) out.push(s.slice(li));
  }
  return out;
}

interface Props {
  message: ChatMessage;
  currentUserId: number;
  canDelete: boolean;
  canEdit: boolean;
  isAuthorOnline: boolean;
  onDelete: (id: number) => void;
  onEdit: (id: number, body: string) => Promise<void>;
  onToggleReaction: (messageId: number, emoji: string, mine: boolean) => void;
  /** Open the thread panel for this message. Omitted when the message is
   * already inside a thread (ThreadPanel doesn't show a nested-thread button). */
  onOpenThread?: (messageId: number) => void;
  /** Stage a quoted reply: parent (ChatPage) records this message as the
   *  quote target so the composer renders the preview banner. Omit to hide
   *  the «Цитировать» action (e.g. inside ThreadPanel which has its own
   *  reply mechanic). */
  onQuoteMessage?: (message: ChatMessage) => void;
  /** Workspace roster — used for read-status tooltip + reader avatars. */
  members?: WorkspaceMember[];
  /** Count of other workspace members (total − author). Drives the
   * «прочитано всеми» heuristic. Pass 0 (or omit) to suppress ticks. */
  otherMembersCount?: number;
  /** Touch-device mode: hide hover icons, enable long-press → bottom-sheet
   *  and swipe-left → open thread. Desktop pass false. */
  isTouch?: boolean;
  /** Open / find-or-create a DM with the given workspace member. Wired
   *  through ChatPage → ChatLayout → MessageStream. When omitted, the
   *  «Написать в личку» button hides from the avatar / mention popover. */
  onOpenDm?: (userId: number) => void;
  /** Online userIds set — drives the presence dot on UserPopover avatars. */
  onlineUsers?: Set<number>;
}

export default function MessageItem({
  message,
  currentUserId,
  canDelete,
  canEdit,
  isAuthorOnline,
  onDelete,
  onEdit,
  onToggleReaction,
  onOpenThread,
  onQuoteMessage,
  members,
  otherMembersCount = 0,
  isTouch = false,
  onOpenDm,
  onlineUsers,
}: Props) {
  const isDeleted = message.deletedAt != null;
  const author = message.author;
  const displayName = author.fullName || author.email || "—";
  const role = author.jobTitle?.trim() || null;
  const mentionedKeys = new Set<string>();
  const mentionByKey = new Map<string, number>();
  let myMentionKey: string | null = null;
  for (const m of message.mentions) {
    const nameKey = normalizeMention(m.name);
    const emailKey = normalizeMention(m.email.split("@")[0] ?? "");
    if (nameKey) {
      mentionedKeys.add(nameKey);
      mentionByKey.set(nameKey, m.userId);
    }
    if (emailKey) {
      mentionedKeys.add(emailKey);
      mentionByKey.set(emailKey, m.userId);
    }
    if (m.userId === currentUserId) {
      myMentionKey = nameKey || emailKey || null;
    }
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [popover, setPopover] = useState<{
    user: {
      userId: number;
      email: string;
      fullName: string;
      jobTitle?: string | null;
      avatarDataUrl?: string | null;
    };
    anchor: DOMRect;
  } | null>(null);

  /** Resolve a userId to a workspace member for popover content. Falls
   *  back to author identity (for the avatar click case) or to a minimal
   *  shell (for mention case when the user isn't in the cached roster). */
  const resolveUserForPopover = (
    userId: number,
  ): {
    userId: number;
    email: string;
    fullName: string;
    jobTitle?: string | null;
    avatarDataUrl?: string | null;
  } | null => {
    if (userId === author.userId) {
      return {
        userId: author.userId,
        email: author.email,
        fullName: author.fullName,
        jobTitle: author.jobTitle,
        avatarDataUrl: author.avatarDataUrl,
      };
    }
    const m = members?.find((x) => x.userId === userId);
    if (m) {
      return {
        userId: m.userId,
        email: m.email,
        fullName: m.fullName,
        jobTitle: m.jobTitle,
        avatarDataUrl: m.avatarDataUrl,
      };
    }
    return null;
  };

  const openPopoverFor = (userId: number, anchor: DOMRect) => {
    const u = resolveUserForPopover(userId);
    if (!u) return;
    setPopover({ user: u, anchor });
  };

  const canReplyInThread =
    onOpenThread != null && message.parentMessageId == null && !isDeleted;
  const longPress = useLongPress({
    onLongPress: () => {
      // Suppress when the message is already in edit mode — the user is
      // interacting with the textarea, long-press would feel like a trap.
      if (editing || isDeleted) return;
      setSheetOpen(true);
    },
  });
  const swipe = useSwipe({
    onSwipeLeft: canReplyInThread
      ? () => onOpenThread?.(message.id)
      : undefined,
    threshold: 60,
    maxAngleDeg: 25,
  });
  // Compose touch handlers — long-press monitors hold, swipe monitors end.
  // Both safely run together; clearing long-press timer on touchmove also
  // protects against accidental fire when starting a swipe.
  const touchHandlers = isTouch
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          longPress.onTouchStart(e);
          swipe.onTouchStart(e);
        },
        onTouchMove: (e: React.TouchEvent) => {
          longPress.onTouchMove(e);
          swipe.onTouchMove(e);
        },
        onTouchEnd: (e: React.TouchEvent) => {
          longPress.onTouchEnd();
          swipe.onTouchEnd(e);
        },
        onTouchCancel: longPress.onTouchCancel,
        onContextMenu: longPress.onContextMenu,
      }
    : {};

  const beginEdit = () => {
    setDraft(message.body);
    setEditError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditError(null);
  };
  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditError("сообщение не может быть пустым");
      return;
    }
    if (trimmed === message.body) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await onEdit(message.id, trimmed);
      setEditing(false);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void saveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        alignItems: "flex-start",
        // Disable native text selection only on touch — otherwise long-press
        // would trigger the iOS "select word" popup instead of our sheet.
        userSelect: isTouch ? "none" : "auto",
        WebkitUserSelect: isTouch ? "none" : "auto",
        WebkitTouchCallout: isTouch ? "none" : "default",
      }}
      className="chat-message"
      {...touchHandlers}
    >
      <div style={{ flex: "0 0 auto", paddingTop: 2 }}>
        {author.userId > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openPopoverFor(
                author.userId,
                (e.currentTarget as HTMLElement).getBoundingClientRect(),
              );
            }}
            title={author.fullName || author.email}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              borderRadius: "50%",
              lineHeight: 0,
            }}
            aria-label={`Профиль ${author.fullName || author.email}`}
          >
            <Avatar
              name={author.fullName}
              email={author.email}
              avatarDataUrl={author.avatarDataUrl}
              size={36}
              isOnline={isAuthorOnline}
            />
          </button>
        ) : (
          <Avatar
            name={author.fullName}
            email={author.email}
            avatarDataUrl={author.avatarDataUrl}
            size={36}
            isOnline={isAuthorOnline}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>{displayName}</span>
          {role && (
            <span style={{ fontSize: 12, color: "var(--muted, #888)" }}>
              {role}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--muted, #888)" }}>
            {formatTime(message.createdAt)}
            {message.editedAt && !isDeleted && (
              <span title={`Изменено ${formatTime(message.editedAt)}`}>
                {" "}· изм.
              </span>
            )}
          </span>
          {!isDeleted && !editing && !isTouch && (
            <div style={{ marginLeft: "auto", display: "inline-flex", gap: 2 }}>
              {onQuoteMessage && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => onQuoteMessage(message)}
                  title="Цитировать"
                >
                  <Reply size={14} />
                </button>
              )}
              {onOpenThread && message.parentMessageId == null && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => onOpenThread(message.id)}
                  title="Ответить в треде"
                >
                  <MessageSquare size={14} />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={beginEdit}
                  title="Редактировать сообщение"
                >
                  <Pencil size={14} />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => onDelete(message.id)}
                  title="Удалить сообщение"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        {isDeleted ? (
          <div
            style={{
              fontStyle: "italic",
              color: "var(--muted, #888)",
              fontSize: 13,
              marginTop: 2,
            }}
          >
            сообщение удалено
          </div>
        ) : editing ? (
          <div style={{ marginTop: 4 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKey}
              disabled={saving}
              autoFocus
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: 14,
                padding: 6,
                border: "1px solid var(--border, #e2e2e2)",
                borderRadius: 6,
                resize: "vertical",
                background: "var(--bg, #fff)",
                color: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
                fontSize: 11,
                color: "var(--muted, #888)",
              }}
            >
              <span>Enter — сохранить · Esc — отмена</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveEdit()}
                disabled={saving}
                style={{ marginLeft: "auto", padding: "2px 10px" }}
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                style={{ padding: "2px 10px" }}
              >
                Отмена
              </button>
            </div>
            {editError && (
              <div style={{ color: "var(--danger, #c33)", fontSize: 12, marginTop: 4 }}>
                {editError}
              </div>
            )}
          </div>
        ) : (
          <>
            {message.quotedMessage && (
              <div
                style={{
                  marginTop: 4,
                  marginBottom: 4,
                  padding: "4px 8px",
                  background: "var(--bg-soft, #f3f3f3)",
                  borderRadius: 6,
                  borderLeft: "3px solid var(--accent, #2563eb)",
                  fontSize: 12,
                  cursor: "default",
                  maxWidth: "100%",
                }}
                title={
                  message.quotedMessage.deletedAt
                    ? "сообщение удалено"
                    : message.quotedMessage.body
                }
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--accent, #2563eb)",
                  }}
                >
                  {message.quotedMessage.authorName}
                </div>
                <div
                  style={{
                    color: "var(--muted, #555)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {message.quotedMessage.deletedAt
                    ? "сообщение удалено"
                    : message.quotedMessage.body ||
                      (message.quotedMessage.hasAttachments
                        ? "📎 вложение"
                        : "")}
                </div>
              </div>
            )}
            {message.body && (() => {
              const jumboPx = emojiOnlyFontSize(message.body);
              return (
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: jumboPx ?? 16,
                    lineHeight: jumboPx ? 1.1 : 1.4,
                    marginTop: jumboPx ? 4 : 2,
                  }}
                >
                  {linkify(message.body, {
                    mentionedKeys,
                    myMentionKey,
                    mentionByKey,
                    onMentionClick: openPopoverFor,
                  })}
                </div>
              );
            })()}
            {message.attachments.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {message.attachments.map((a) => (
                  <Attachment key={a.id} attachment={a} />
                ))}
              </div>
            )}
            {(() => {
              const isOwn = message.author.userId === currentUserId;
              const showStatus =
                isOwn &&
                members &&
                otherMembersCount > 0 &&
                message.parentMessageId == null;
              const prefix = showStatus ? (
                <>
                  <ReadStatusTicks
                    readerUserIds={message.readerUserIds}
                    otherMembersCount={otherMembersCount}
                    members={members}
                    authorUserId={message.author.userId}
                  />
                  <ReadByIndicator
                    readerUserIds={message.readerUserIds}
                    members={members}
                  />
                </>
              ) : null;
              return (
                <ReactionsBar
                  reactions={message.reactions}
                  currentUserId={currentUserId}
                  onToggle={(emoji, mine) =>
                    onToggleReaction(message.id, emoji, mine)
                  }
                  prefix={prefix}
                />
              );
            })()}
            {onOpenThread &&
              message.parentMessageId == null &&
              message.replyCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenThread(message.id)}
                  style={{
                    marginTop: 4,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px",
                    fontSize: 12,
                    color: "var(--accent)",
                    background: "transparent",
                    border: "1px solid var(--accent-soft, #cce)",
                    borderRadius: 12,
                    cursor: "pointer",
                  }}
                >
                  <MessageSquare size={12} />
                  {message.replyCount}{" "}
                  {message.replyCount === 1
                    ? "ответ"
                    : message.replyCount < 5
                      ? "ответа"
                      : "ответов"}
                </button>
              )}
          </>
        )}
      </div>
      <MessageActionsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        canEdit={canEdit && !isDeleted}
        canDelete={canDelete && !isDeleted}
        canReplyInThread={canReplyInThread}
        canQuote={!!onQuoteMessage && !isDeleted}
        onReact={(emoji) => {
          const existing = message.reactions.find((r) => r.emoji === emoji);
          const mine = existing?.userIds.includes(currentUserId) ?? false;
          onToggleReaction(message.id, emoji, mine);
        }}
        onOpenThread={() => onOpenThread?.(message.id)}
        onQuote={() => onQuoteMessage?.(message)}
        onEdit={beginEdit}
        onDelete={() => onDelete(message.id)}
      />
      {popover && (
        <UserPopover
          user={popover.user}
          anchor={popover.anchor}
          open
          isSelf={popover.user.userId === currentUserId}
          isOnline={onlineUsers?.has(popover.user.userId)}
          onClose={() => setPopover(null)}
          onOpenDm={(userId) => {
            setPopover(null);
            onOpenDm?.(userId);
          }}
        />
      )}
    </div>
  );
}
