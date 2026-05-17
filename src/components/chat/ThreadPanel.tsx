import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ChatMessage, type WorkspaceMember } from "../../api";
import MessageItem from "./MessageItem";
import Composer from "./Composer";

interface Props {
  parentMessageId: number;
  channelName: string;
  currentUserId: number;
  canModerate: boolean;
  onlineUsers: Set<number>;
  members: WorkspaceMember[];
  /** Forwarded to MessageItem for avatar / mention popovers. */
  onOpenDm?: (userId: number) => void;
  /** Updated reply from the WS stream (we subscribe in ChatPage and forward
   * the events that touch this thread). */
  externalUpdates: ChatMessage[];
  onClose: () => void;
}

/** Right-side panel showing a single thread (root message + flat list of
 * replies). The composer at the bottom posts back with parentMessageId set.
 *
 * The panel owns its own data fetch (`/messages/:id/thread`). For real-time
 * updates it consumes `externalUpdates` — ChatPage forwards each
 * message.created / message.updated / message.deleted relevant to this
 * thread. We could re-fetch on every event but that's wasteful for a hot
 * thread; merging in-place keeps the panel responsive. */
export default function ThreadPanel({
  parentMessageId,
  channelName,
  currentUserId,
  canModerate,
  onlineUsers,
  members,
  externalUpdates,
  onOpenDm,
  onClose,
}: Props) {
  const [parent, setParent] = useState<ChatMessage | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setParent(null);
    setReplies([]);
    void (async () => {
      try {
        const res = await api.chat.getThread(parentMessageId);
        if (cancelled) return;
        setParent(res.parent);
        setReplies(res.replies);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentMessageId]);

  // Merge external WS updates into local state. We don't subscribe to the
  // socket ourselves — ChatPage holds the single subscription and forwards.
  // This is the canonical pattern of «sync to external source»: when the
  // upstream events buffer changes, fold them into local state.
  useEffect(() => {
    if (externalUpdates.length === 0) return;
    const parentUpdates = externalUpdates.filter(
      (m) => m.id === parentMessageId,
    );
    const replyUpdates = externalUpdates.filter(
      (m) => m.parentMessageId === parentMessageId,
    );
    if (parentUpdates.length > 0) {
      const latest = parentUpdates[parentUpdates.length - 1]!;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParent(latest);
    }
    if (replyUpdates.length > 0) {
      setReplies((prev) => {
        const next = prev.slice();
        for (const m of replyUpdates) {
          const idx = next.findIndex((r) => r.id === m.id);
          if (idx === -1) next.push(m);
          else next[idx] = m;
        }
        next.sort((a, b) => a.createdAt - b.createdAt);
        return next;
      });
    }
  }, [externalUpdates, parentMessageId]);

  const onSendText = useCallback(
    async (text: string) => {
      const sent = await api.chat.sendMessage(
        parent?.channelId ?? 0,
        text,
        { parentMessageId },
      );
      setReplies((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
    },
    [parent, parentMessageId],
  );
  const onSendWithAttachments = useCallback(
    async (text: string, files: File[]) => {
      const sent = await api.chat.sendMessageWithAttachments(
        parent?.channelId ?? 0,
        { body: text || undefined, files, parentMessageId },
      );
      setReplies((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
    },
    [parent, parentMessageId],
  );

  const onDelete = useCallback(async (id: number) => {
    try {
      await api.chat.deleteMessage(id);
      // Soft delete locally; WS will sync other tabs.
      setReplies((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, deletedAt: Date.now(), body: "", attachments: [] }
            : m,
        ),
      );
      if (parent && parent.id === id) {
        setParent({ ...parent, deletedAt: Date.now(), body: "", attachments: [] });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [parent]);

  const onEdit = useCallback(async (id: number, body: string) => {
    const updated = await api.chat.editMessage(id, body);
    if (updated.id === parentMessageId) {
      setParent(updated);
    } else {
      setReplies((prev) => prev.map((m) => (m.id === id ? updated : m)));
    }
  }, [parentMessageId]);

  const onToggleReaction = useCallback(
    async (messageId: number, emoji: string, mine: boolean) => {
      try {
        const res = mine
          ? await api.chat.removeReaction(messageId, emoji)
          : await api.chat.addReaction(messageId, emoji);
        if (messageId === parentMessageId && parent) {
          setParent({ ...parent, reactions: res.reactions });
        } else {
          setReplies((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, reactions: res.reactions } : m,
            ),
          );
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [parent, parentMessageId],
  );

  return (
    <div
      style={{
        // Flex-fill: in desktop ChatPage (3-column layout) ThreadPanel is
        // a sibling flex item sized by the parent; in tablet/mobile it
        // sits inside a Drawer that owns its own width — either way, 100%
        // of whatever the parent gives is the right answer. Fixed width
        // caused the contents to hug the left edge in wider drawers.
        width: "100%",
        flex: "1 1 auto",
        minWidth: 0,
        borderLeft: "1px solid var(--border, #e2e2e2)",
        background: "var(--bg, #fff)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border, #e2e2e2)",
        }}
      >
        <strong style={{ fontSize: 14 }}>Тред</strong>
        <span style={{ fontSize: 12, color: "var(--muted, #888)" }}>
          в #{channelName}
        </span>
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          title="Закрыть тред"
          style={{ marginLeft: "auto" }}
        >
          <X size={16} />
        </button>
      </div>
      {loading && (
        <p className="muted" style={{ padding: 12 }}>
          Загрузка треда…
        </p>
      )}
      {error && (
        <div
          style={{
            padding: "6px 12px",
            background: "var(--danger-soft, #fee)",
            color: "var(--danger, #c33)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {parent && (
          <>
            <MessageItem
              message={parent}
              currentUserId={currentUserId}
              canDelete={canModerate || parent.author.userId === currentUserId}
              canEdit={parent.author.userId === currentUserId}
              isAuthorOnline={onlineUsers.has(parent.author.userId)}
              members={members}
              otherMembersCount={Math.max(0, members.length - 1)}
              onOpenDm={onOpenDm}
              onlineUsers={onlineUsers}
              onDelete={onDelete}
              onEdit={onEdit}
              onToggleReaction={onToggleReaction}
            />
            <div
              style={{
                margin: "4px 12px",
                paddingTop: 6,
                borderTop: "1px solid var(--border, #e2e2e2)",
                fontSize: 12,
                color: "var(--muted, #888)",
              }}
            >
              {replies.length === 0
                ? "Ответов пока нет"
                : `${replies.length} ${replies.length === 1 ? "ответ" : replies.length < 5 ? "ответа" : "ответов"}`}
            </div>
            {replies.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                currentUserId={currentUserId}
                canDelete={canModerate || m.author.userId === currentUserId}
                canEdit={m.author.userId === currentUserId}
                isAuthorOnline={onlineUsers.has(m.author.userId)}
                members={members}
                onOpenDm={onOpenDm}
                onlineUsers={onlineUsers}
                onDelete={onDelete}
                onEdit={onEdit}
                onToggleReaction={onToggleReaction}
              />
            ))}
          </>
        )}
      </div>
      {parent && !parent.deletedAt && (
        <div
          style={{
            padding: 10,
            borderTop: "1px solid var(--border, #e2e2e2)",
          }}
        >
          <Composer
            channelName={`тред в #${channelName}`}
            members={members}
            onSendText={onSendText}
            onSendWithAttachments={onSendWithAttachments}
            onTypingStart={() => {}}
            onTypingStop={() => {}}
          />
        </div>
      )}
    </div>
  );
}
