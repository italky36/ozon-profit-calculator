import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { ChatMessage } from "../../api";
import Avatar from "../Avatar";
import Attachment from "./Attachment";
import ReactionsBar from "./ReactionsBar";

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
  return (
    <span
      key={key}
      style={{
        color: "var(--accent)",
        fontWeight: isMine ? 700 : 500,
        background: isMine ? "var(--accent-soft, #eef)" : undefined,
        padding: isMine ? "0 4px" : undefined,
        borderRadius: isMine ? 4 : undefined,
      }}
    >
      {raw}
    </span>
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
}: Props) {
  const isDeleted = message.deletedAt != null;
  const author = message.author;
  const displayName = author.fullName || author.email || "—";
  const role = author.jobTitle?.trim() || null;
  const mentionedKeys = new Set<string>();
  let myMentionKey: string | null = null;
  for (const m of message.mentions) {
    const nameKey = normalizeMention(m.name);
    const emailKey = normalizeMention(m.email.split("@")[0] ?? "");
    if (nameKey) mentionedKeys.add(nameKey);
    if (emailKey) mentionedKeys.add(emailKey);
    if (m.userId === currentUserId) {
      myMentionKey = nameKey || emailKey || null;
    }
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      }}
      className="chat-message"
    >
      <div style={{ flex: "0 0 auto", paddingTop: 2 }}>
        <Avatar
          name={author.fullName}
          email={author.email}
          avatarDataUrl={author.avatarDataUrl}
          size={36}
          isOnline={isAuthorOnline}
        />
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
          {!isDeleted && !editing && (
            <div style={{ marginLeft: "auto", display: "inline-flex", gap: 2 }}>
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
                  {linkify(message.body, { mentionedKeys, myMentionKey })}
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
            <ReactionsBar
              reactions={message.reactions}
              currentUserId={currentUserId}
              onToggle={(emoji, mine) =>
                onToggleReaction(message.id, emoji, mine)
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
