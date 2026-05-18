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
import ChatLayout from "./layout/ChatLayout";

const PAGE_SIZE = 50;

export interface ChatPageProps {
  /** Cross-tab intent: when set, ChatPage opens a DM with this user on the
   *  next render and then calls onDmConsumed to clear it. */
  pendingDmUserId?: number | null;
  onDmConsumed?: () => void;
}

export default function ChatPage({
  pendingDmUserId,
  onDmConsumed,
}: ChatPageProps = {}) {
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
  /** When non-null, the right-side ThreadPanel is open for this root message. */
  const [threadParentId, setThreadParentId] = useState<number | null>(null);
  /** Recent ChatMessage events forwarded from WS for the open ThreadPanel.
   * Trimmed to the last 50 — ThreadPanel merges idempotently by id. */
  const [threadUpdates, setThreadUpdates] = useState<ChatMessage[]>([]);

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

  // Cross-tab DM intent: when App sets pendingDmUserId (from TeamPage's
  // «Написать» button), find-or-create the DM channel and switch to it.
  // Cleared via onDmConsumed so we don't loop. Waits until channels are
  // loaded — otherwise the freshly-created channel would be missing from
  // the local list on render.
  useEffect(() => {
    if (!chatAvailable || pendingDmUserId == null || loadingChannels) return;
    let cancelled = false;
    void (async () => {
      try {
        const dm = await api.chat.openDm(pendingDmUserId);
        if (cancelled) return;
        setChannels((prev) =>
          prev.some((c) => c.id === dm.id) ? prev : [...prev, dm],
        );
        setActiveChannelId(dm.id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) onDmConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatAvailable, pendingDmUserId, loadingChannels, onDmConsumed]);

  // Service worker → page bridge: when a push notification is clicked, the
  // SW posts {type: 'notification.click', url} to focused clients. We parse
  // the deep-link query (?chat=1&channel=N&message=M) and switch the
  // active channel so the user lands on the right place without reloading.
  useEffect(() => {
    if (!chatAvailable || typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (!data || data.type !== "notification.click" || !data.url) return;
      try {
        const u = new URL(data.url, window.location.origin);
        const channelParam = u.searchParams.get("channel");
        if (!channelParam) return;
        const channelId = Number(channelParam);
        if (Number.isFinite(channelId) && channelId > 0) {
          setActiveChannelId(channelId);
        }
      } catch {
        /* ignore malformed URL */
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [chatAvailable]);

  // WS lifecycle: one socket per ChatPage mount.
  useEffect(() => {
    if (!chatAvailable) return;
    const handle = (event: ChatServerEvent) => {
      if (event.type === "message.created") {
        const payload = event.payload as ChatMessage;
        // Skip thread-replies in the channel feed; ThreadPanel listens
        // separately. Reply rows still bump replyCount on the parent via the
        // matching message.updated event.
        const isReply = payload.parentMessageId != null;
        if (event.channelId === activeChannelIdRef.current && !isReply) {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.id) ? prev : [...prev, payload],
          );
        }
        // Forward thread-relevant events to ThreadPanel (when it's open).
        if (isReply || payload.replyCount > 0) {
          setThreadUpdates((prev) => {
            const next = [...prev, payload];
            return next.length > 50 ? next.slice(-50) : next;
          });
        }
        // Update unreadCount: bump on non-active channels for non-own,
        // non-reply messages. Skip own messages — author already saw them.
        if (
          !isReply &&
          payload.author.userId !== currentUserId &&
          event.channelId !== activeChannelIdRef.current
        ) {
          setChannels((prev) =>
            prev.map((c) =>
              c.id === event.channelId
                ? { ...c, unreadCount: c.unreadCount + 1 }
                : c,
            ),
          );
        }
        return;
      }
      if (event.type === "message.updated") {
        const payload = event.payload as ChatMessage;
        if (event.channelId === activeChannelIdRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.id ? payload : m)),
          );
        }
        // Forward to ThreadPanel: updates to parent (replyCount changed) and
        // edits to thread replies both flow through here.
        if (payload.parentMessageId != null || payload.replyCount > 0) {
          setThreadUpdates((prev) => {
            const next = [...prev, payload];
            return next.length > 50 ? next.slice(-50) : next;
          });
        }
        return;
      }
      if (event.type === "read.advanced") {
        const { userId, messageId } = event.payload;
        // Reflect own reads from other tabs / devices in the channel badge.
        if (userId === currentUserId) {
          setChannels((prev) =>
            prev.map((c) =>
              c.id === event.channelId
                ? {
                    ...c,
                    unreadCount: 0,
                    lastReadMessageId: messageId,
                  }
                : c,
            ),
          );
        }
        // Update readerUserIds on local messages — any message with id ≤
        // messageId (in the same channel) gains this reader, except own
        // messages of THAT user (server filters this on initial load; we
        // mirror the same rule). Idempotent: skip if already present.
        if (event.channelId === activeChannelIdRef.current) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id > messageId) return m;
              if (m.author.userId === userId) return m;
              if (m.readerUserIds.includes(userId)) return m;
              return { ...m, readerUserIds: [...m.readerUserIds, userId] };
            }),
          );
        }
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
    setThreadParentId(null);
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

  /** Debounced bump of the read pointer. The IntersectionObserver inside
   * MessageStream fires on every viewport-intersecting tail message; we
   * dedupe both inside the component (only the latest id matters) and here
   * (drop calls that are not strictly greater than the local lastRead). */
  /** Find-or-create a DM with a workspace member and switch to it.
   *  Wired from in-feed avatar / mention popovers; the cross-tab variant
   *  (TeamPage → App → ChatPage) goes through the pendingDmUserId effect
   *  above which calls the same api. */
  const openDmFor = useCallback(async (userId: number) => {
    if (!userId || userId <= 0) return;
    try {
      const dm = await api.chat.openDm(userId);
      setChannels((prev) =>
        prev.some((c) => c.id === dm.id) ? prev : [...prev, dm],
      );
      setActiveChannelId(dm.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const onMarkRead = useCallback(
    async (channelId: number, messageId: number) => {
      const channel = channels.find((c) => c.id === channelId);
      if (!channel) return;
      if (
        channel.lastReadMessageId != null &&
        channel.lastReadMessageId >= messageId
      ) {
        return;
      }
      // Optimistic local update — server will publish read.advanced for any
      // other tabs of this user.
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channelId
            ? { ...c, unreadCount: 0, lastReadMessageId: messageId }
            : c,
        ),
      );
      try {
        await api.chat.markRead(channelId, messageId);
      } catch {
        // Best-effort — next viewport intersection will retry. Don't surface
        // the error: stale read pointers are not user-visible failures.
      }
    },
    [channels],
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

  const onCreateChannel = useCallback(
    async (
      name: string,
      opts: { isPrivate: boolean; memberIds: number[] },
    ) => {
      const ch = await api.chat.createChannel(name, opts);
      setChannels((prev) =>
        prev.some((c) => c.id === ch.id) ? prev : [...prev, ch],
      );
      setActiveChannelId(ch.id);
    },
    [],
  );

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
    <ChatLayout
      currentUserId={currentUserId}
      canManage={canManage}
      channels={channels}
      activeChannelId={activeChannelId}
      activeChannel={activeChannel}
      messages={messages}
      loadingMessages={loadingMessages}
      loadingOlder={loadingOlder}
      hasMore={hasMore}
      onlineUsers={onlineUsers}
      members={members}
      typingByChannel={typingByChannel}
      connectionState={connectionState}
      threadParentId={threadParentId}
      threadUpdates={threadUpdates}
      searchOpen={searchOpen}
      error={error}
      onSelectChannel={setActiveChannelId}
      onCreateChannel={onCreateChannel}
      onSendText={onSendText}
      onSendWithAttachments={onSendWithAttachments}
      onDelete={onDelete}
      onEdit={onEdit}
      onToggleReaction={onToggleReaction}
      onMarkRead={onMarkRead}
      onOpenThread={(messageId) => setThreadParentId(messageId)}
      onCloseThread={() => setThreadParentId(null)}
      onLoadOlder={() => void onLoadOlder()}
      onTypingStart={onTypingStart}
      onTypingStop={onTypingStop}
      onToggleSearch={() => setSearchOpen((v) => !v)}
      onCloseSearch={() => setSearchOpen(false)}
      onClearError={() => setError(null)}
      onOpenDm={(userId) => void openDmFor(userId)}
    />
  );
}
