import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ChatChannel,
  type ChatMessage,
  type ChatServerEvent,
  type WorkspaceMember,
} from "../../api";
import { useAuth } from "../../contexts/useAuth";
import { ChatSocket } from "../../lib/chatSocket";
import { Search } from "lucide-react";
import ChannelList from "./ChannelList";
import MessageStream from "./MessageStream";
import Composer from "./Composer";
import TypingIndicator from "./TypingIndicator";
import SearchPanel from "./SearchPanel";

const PAGE_SIZE = 50;

export default function ChatPage() {
  const { user } = useAuth();
  const canManage =
    user?.workspaceRole === "owner" || user?.workspaceRole === "manager";
  const currentUserId = user?.id ?? 0;
  // Users without a workspace (workspaceId=0) and sysadmins (who live in the
  // separate sysadmin SPA) cannot use the chat. Render an info card instead
  // of mounting the WS/REST plumbing — otherwise ChatSocket loops 403's.
  const chatAvailable =
    user != null && user.workspaceId > 0 && !user.isSysadmin;

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "open" | "closed"
  >("connecting");
  /** Map<channelId, Map<userId, person>> — кто сейчас печатает в каком канале. */
  const [typingByChannel, setTypingByChannel] = useState<
    Map<number, Map<number, { userId: number; fullName: string; email: string }>>
  >(new Map());
  /** Set<userId> — кто сейчас онлайн в workspace. */
  const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
  /** Кэш members команды — для @-autocomplete и будущих DM-flyout'ов. */
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const socketRef = useRef<ChatSocket | null>(null);
  // Keep the active channel id in a ref so the WS event handler (registered
  // once) can route incoming events without re-subscribing on each change.
  const activeChannelIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  // Load channel list + presence snapshot once.
  useEffect(() => {
    if (!chatAvailable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingChannels(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [list, presence, ws] = await Promise.all([
          api.chat.listChannels(),
          api.chat.presence().catch(() => ({ onlineUserIds: [] as number[] })),
          api.workspace.me().catch(() => null),
        ]);
        if (cancelled) return;
        setChannels(list);
        setOnlineUsers(new Set(presence.onlineUserIds));
        if (ws) setMembers(ws.members);
        // Pick default (#общий) or first active channel.
        const def = list.find((c) => c.isDefault && !c.archivedAt) ?? list[0];
        if (def) setActiveChannelId(def.id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingChannels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatAvailable]);

  // WS lifecycle: one socket per ChatPage mount.
  useEffect(() => {
    if (!chatAvailable) return;
    const handle = (event: ChatServerEvent) => {
      if (event.type === "message.created") {
        if (event.channelId !== activeChannelIdRef.current) return;
        const payload = event.payload as ChatMessage;
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.id)) return prev;
          return [...prev, payload];
        });
        return;
      }
      if (event.type === "message.updated") {
        if (event.channelId !== activeChannelIdRef.current) return;
        const payload = event.payload as ChatMessage;
        setMessages((prev) =>
          prev.map((m) => (m.id === payload.id ? payload : m)),
        );
        return;
      }
      if (event.type === "reaction.added") {
        if (event.channelId !== activeChannelIdRef.current) return;
        const { emoji, userId } = event.payload;
        const messageId = event.messageId;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const existing = m.reactions.find((r) => r.emoji === emoji);
            let nextReactions: typeof m.reactions;
            if (existing) {
              if (existing.userIds.includes(userId)) return m;
              nextReactions = m.reactions.map((r) =>
                r.emoji === emoji
                  ? { ...r, count: r.count + 1, userIds: [...r.userIds, userId] }
                  : r,
              );
            } else {
              nextReactions = [
                ...m.reactions,
                { emoji, count: 1, userIds: [userId] },
              ];
            }
            return { ...m, reactions: nextReactions };
          }),
        );
        return;
      }
      if (event.type === "reaction.removed") {
        if (event.channelId !== activeChannelIdRef.current) return;
        const { emoji, userId } = event.payload;
        const messageId = event.messageId;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const existing = m.reactions.find((r) => r.emoji === emoji);
            if (!existing) return m;
            const nextUserIds = existing.userIds.filter((u) => u !== userId);
            const nextReactions =
              nextUserIds.length === 0
                ? m.reactions.filter((r) => r.emoji !== emoji)
                : m.reactions.map((r) =>
                    r.emoji === emoji
                      ? { ...r, count: nextUserIds.length, userIds: nextUserIds }
                      : r,
                  );
            return { ...m, reactions: nextReactions };
          }),
        );
        return;
      }
      if (event.type === "message.deleted") {
        if (event.channelId !== activeChannelIdRef.current) return;
        const { id, deletedAt } = event.payload as {
          id: number;
          deletedAt: number;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, deletedAt, body: "", attachments: [] }
              : m,
          ),
        );
        return;
      }
      if (event.type === "hello") {
        setOnlineUsers(new Set(event.onlineUserIds));
        return;
      }
      if (event.type === "presence.online") {
        setOnlineUsers((prev) => {
          if (prev.has(event.payload.userId)) return prev;
          const next = new Set(prev);
          next.add(event.payload.userId);
          return next;
        });
        return;
      }
      if (event.type === "presence.offline") {
        setOnlineUsers((prev) => {
          if (!prev.has(event.payload.userId)) return prev;
          const next = new Set(prev);
          next.delete(event.payload.userId);
          return next;
        });
        return;
      }
      if (event.type === "typing.start") {
        const { channelId } = event;
        const p = event.payload;
        if (p.userId === currentUserId) return; // не показываем себя
        setTypingByChannel((prev) => {
          const next = new Map(prev);
          const perChan = new Map(next.get(channelId) ?? []);
          perChan.set(p.userId, {
            userId: p.userId,
            fullName: p.fullName,
            email: p.email,
          });
          next.set(channelId, perChan);
          return next;
        });
        return;
      }
      if (event.type === "typing.stop") {
        const { channelId } = event;
        const userId = event.payload.userId;
        setTypingByChannel((prev) => {
          const perChan = prev.get(channelId);
          if (!perChan || !perChan.has(userId)) return prev;
          const next = new Map(prev);
          const updated = new Map(perChan);
          updated.delete(userId);
          if (updated.size === 0) next.delete(channelId);
          else next.set(channelId, updated);
          return next;
        });
        return;
      }
      if (
        event.type === "channel.created" ||
        event.type === "channel.updated" ||
        event.type === "channel.archived"
      ) {
        const ch = event.payload as ChatChannel;
        setChannels((prev) => {
          const idx = prev.findIndex((c) => c.id === ch.id);
          if (idx === -1) return [...prev, ch];
          const next = prev.slice();
          next[idx] = ch;
          return next;
        });
      }
    };
    const sock = new ChatSocket(handle);
    socketRef.current = sock;
    const offStatus = sock.onStatus((s) => setConnectionState(s.state));
    sock.start();
    return () => {
      offStatus();
      sock.stop();
      socketRef.current = null;
    };
  }, [chatAvailable, currentUserId]);

  // Load messages when channel switches.
  useEffect(() => {
    if (activeChannelId == null) return;
    let cancelled = false;
    // Sync-to-external-state: when channel switches we must clear the
    // previous channel's messages before fetching the new ones.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setHasMore(false);
    setLoadingMessages(true);
    // Typing state — drop entries for non-active channels to avoid stale UI.
    setTypingByChannel((prev) => {
      const me = prev.get(activeChannelId);
      if (!me) return new Map();
      const next = new Map<
        number,
        Map<number, { userId: number; fullName: string; email: string }>
      >();
      next.set(activeChannelId, me);
      return next;
    });
    void (async () => {
      try {
        const page = await api.chat.listMessages(activeChannelId, {
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        // API returns newest-first (DESC); UI shows oldest at top.
        setMessages(page.messages.slice().reverse());
        setHasMore(page.hasMore);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  const onLoadOlder = useCallback(async () => {
    if (!activeChannelId || messages.length === 0 || loadingOlder || !hasMore)
      return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0]!.createdAt;
      const page = await api.chat.listMessages(activeChannelId, {
        before: oldest,
        limit: PAGE_SIZE,
      });
      setMessages((prev) => [...page.messages.slice().reverse(), ...prev]);
      setHasMore(page.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeChannelId, messages, hasMore, loadingOlder]);

  const onSendText = useCallback(
    async (text: string) => {
      if (!activeChannelId) return;
      const sent = await api.chat.sendMessage(activeChannelId, text);
      // Optimistic local append (WS will dedupe via id check).
      setMessages((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
    },
    [activeChannelId],
  );

  const onSendWithAttachments = useCallback(
    async (text: string, files: File[]) => {
      if (!activeChannelId) return;
      const sent = await api.chat.sendMessageWithAttachments(activeChannelId, {
        body: text || undefined,
        files,
      });
      setMessages((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
    },
    [activeChannelId],
  );

  const onDelete = useCallback(async (id: number) => {
    try {
      await api.chat.deleteMessage(id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, deletedAt: Date.now(), body: "", attachments: [] }
            : m,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const onEdit = useCallback(async (id: number, body: string) => {
    const updated = await api.chat.editMessage(id, body);
    setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
  }, []);

  const onToggleReaction = useCallback(
    async (messageId: number, emoji: string, mine: boolean) => {
      try {
        const res = mine
          ? await api.chat.removeReaction(messageId, emoji)
          : await api.chat.addReaction(messageId, emoji);
        // Replace reactions from server response (authoritative for same-tab).
        // WS event for other tabs handled separately via handle().
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, reactions: res.reactions } : m,
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  const onTypingStart = useCallback(() => {
    if (!activeChannelId) return;
    socketRef.current?.send({ type: "typing.start", channelId: activeChannelId });
  }, [activeChannelId]);

  const onTypingStop = useCallback(() => {
    if (!activeChannelId) return;
    socketRef.current?.send({ type: "typing.stop", channelId: activeChannelId });
  }, [activeChannelId]);

  const onCreateChannel = useCallback(async (name: string) => {
    const ch = await api.chat.createChannel(name);
    setChannels((prev) =>
      prev.some((c) => c.id === ch.id) ? prev : [...prev, ch],
    );
    setActiveChannelId(ch.id);
  }, []);

  const activeChannel = activeChannelId
    ? channels.find((c) => c.id === activeChannelId) ?? null
    : null;

  if (!chatAvailable) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 32 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Чат недоступен</h3>
        <p className="muted">
          {user?.isSysadmin
            ? "Чат — это командный инструмент. Sysadmin-консоль не входит в workspace и не имеет доступа к чату."
            : "Ваш аккаунт не привязан ни к одной команде. Войдите по приглашению или зарегистрируйте новую команду."}
        </p>
      </div>
    );
  }

  if (loadingChannels) {
    return <p className="muted">Загрузка каналов…</p>;
  }

  if (channels.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 32 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
          Каналы ещё не созданы
        </h3>
        <p className="muted">
          Запросите у owner/manager команды создать канал в чате.
        </p>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        display: "flex",
        gap: 0,
        height: "calc(100vh - 200px)",
        minHeight: 400,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          borderRight: "1px solid var(--border, #e2e2e2)",
          background: "var(--bg-soft, #fafafa)",
          minWidth: 220,
        }}
      >
        <ChannelList
          channels={channels}
          activeChannelId={activeChannelId}
          canManage={canManage}
          onSelect={setActiveChannelId}
          onCreate={onCreateChannel}
        />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {activeChannel && (
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border, #e2e2e2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 15 }}>#{activeChannel.name}</strong>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setSearchOpen((v) => !v)}
              title="Поиск по сообщениям"
              style={{ marginLeft: "auto" }}
            >
              <Search size={16} />
            </button>
            <span
              style={{
                fontSize: 11,
                color:
                  connectionState === "open"
                    ? "var(--muted, #888)"
                    : "var(--danger, #c33)",
              }}
            >
              {connectionState === "open"
                ? "в реальном времени"
                : connectionState === "connecting"
                  ? "соединение…"
                  : "оффлайн"}
            </span>
          </div>
        )}
        {searchOpen && activeChannel && (
          <SearchPanel
            channelId={activeChannel.id}
            channelName={activeChannel.name}
            onJump={(chId) => {
              setActiveChannelId(chId);
              setSearchOpen(false);
            }}
            onClose={() => setSearchOpen(false)}
          />
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
            {error}{" "}
            <button
              type="button"
              className="btn-icon"
              onClick={() => setError(null)}
              style={{ marginLeft: 8 }}
            >
              ✕
            </button>
          </div>
        )}
        {loadingMessages ? (
          <p className="muted" style={{ padding: 16 }}>
            Загрузка…
          </p>
        ) : (
          <MessageStream
            messages={messages}
            currentUserId={currentUserId}
            canModerate={canManage}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onlineUsers={onlineUsers}
            onLoadOlder={() => void onLoadOlder()}
            onDelete={onDelete}
            onEdit={onEdit}
            onToggleReaction={onToggleReaction}
          />
        )}
        {activeChannel && (
          <TypingIndicator
            people={
              [...(typingByChannel.get(activeChannel.id)?.values() ?? [])]
            }
          />
        )}
        {activeChannel && !activeChannel.archivedAt && (
          <div style={{ padding: 10, borderTop: "1px solid var(--border, #e2e2e2)" }}>
            <Composer
              channelName={activeChannel.name}
              members={members}
              onSendText={onSendText}
              onSendWithAttachments={onSendWithAttachments}
              onTypingStart={onTypingStart}
              onTypingStop={onTypingStop}
            />
          </div>
        )}
      </div>
    </div>
  );
}
