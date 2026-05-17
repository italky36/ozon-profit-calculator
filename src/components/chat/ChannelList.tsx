import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  Plus,
  Search as SearchIcon,
  UserPlus,
  X,
} from "lucide-react";
import {
  api,
  type ChatChannel,
  type ChatChannelMember,
  type WorkspaceMember,
} from "../../api";
import Avatar from "../Avatar";
import UnreadBadge from "./UnreadBadge";

/** Search-input row used in the member pickers: lupa icon on the left,
 *  full-width text input. Wraps in a relative container so the icon can
 *  overlay; padding-left on the input makes room for the icon. */
function SearchInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <SearchIcon
        size={13}
        style={{
          position: "absolute",
          left: 8,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--muted, #888)",
          pointerEvents: "none",
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          fontSize: 12,
          padding: "4px 6px 4px 26px",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

interface ChannelListProps {
  channels: ChatChannel[];
  activeChannelId: number | null;
  canManage: boolean;
  /** Current user — excluded from the «add to channel» pickers (creator
   *  of a new channel and existing members are added automatically). */
  currentUserId: number;
  /** Workspace roster — used for the «add member» picker on private channels. */
  workspaceMembers?: WorkspaceMember[];
  /** Set of userIds currently online — drives presence dot on DM peer avatars
   *  and on accordion roster avatars. */
  onlineUsers?: Set<number>;
  onSelect: (id: number) => void;
  onCreate: (
    name: string,
    opts: { isPrivate: boolean; memberIds: number[] },
  ) => Promise<void>;
  onOpenDm?: (userId: number) => void;
}

export default function ChannelList({
  channels,
  activeChannelId,
  canManage,
  currentUserId,
  workspaceMembers,
  onlineUsers,
  onSelect,
  onCreate,
  onOpenDm,
}: ChannelListProps) {
  // Exclude self once — both the «create channel» form and the per-channel
  // member picker reuse this list. Self is auto-added as creator / is
  // already a member of any channel they can manage.
  const pickableMembers = (workspaceMembers ?? []).filter(
    (m) => m.userId !== currentUserId,
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Channel id whose roster is currently expanded. Auto-tracks the active
   *  channel unless the user manually collapses it (then they own the state
   *  until they switch channels). null = nothing expanded. */
  const [expandedId, setExpandedId] = useState<number | null>(activeChannelId);
  const userTouchedRef = useRef(false);
  useEffect(() => {
    if (userTouchedRef.current) {
      // User has interacted — don't auto-override their choice this session.
      // But when they switch to a new active channel, reset the override so
      // the new active gets auto-expanded.
      userTouchedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedId(activeChannelId);
  }, [activeChannelId]);
  const toggleExpand = (id: number) => {
    userTouchedRef.current = true;
    setExpandedId((cur) => (cur === id ? null : id));
  };

  const active = channels.filter((c) => !c.archivedAt);
  const regularChannels = active.filter((c) => c.type === "channel");
  const dms = active.filter((c) => c.type === "dm");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        // No minWidth — parent (DesktopLayout / Drawer / etc) owns the
        // column width; ChannelList just fills it. minWidth: 0 lets long
        // member names ellipse instead of forcing the column wider.
        minWidth: 0,
        width: "100%",
        padding: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 12,
          color: "var(--muted, #888)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Каналы
        {canManage && (
          <button
            type="button"
            className="btn-icon"
            onClick={() => setCreating((v) => !v)}
            title="Создать канал"
            style={{ marginLeft: "auto" }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {creating && (
        <CreateChannelForm
          workspaceMembers={pickableMembers}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setError(null);
          }}
          onSubmit={async (name, isPrivate, memberIds) => {
            setBusy(true);
            setError(null);
            try {
              await onCreate(name, { isPrivate, memberIds });
              setCreating(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {error && (
        <div
          style={{
            color: "var(--danger, #c33)",
            fontSize: 11,
            padding: "0 8px",
          }}
        >
          {error}
        </div>
      )}
      {regularChannels.map((ch) => (
        <ChannelRow
          key={ch.id}
          ch={ch}
          isActive={ch.id === activeChannelId}
          isExpanded={expandedId === ch.id}
          workspaceMembers={pickableMembers}
          onlineUsers={onlineUsers}
          onSelect={onSelect}
          onToggleExpand={toggleExpand}
          onOpenDm={onOpenDm}
        />
      ))}
      {dms.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 8px 4px",
            fontSize: 12,
            color: "var(--muted, #888)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Личные сообщения
        </div>
      )}
      {dms.map((ch) => (
        <ChannelRow
          key={ch.id}
          ch={ch}
          isActive={ch.id === activeChannelId}
          isExpanded={false}
          workspaceMembers={pickableMembers}
          onlineUsers={onlineUsers}
          onSelect={onSelect}
          onToggleExpand={toggleExpand}
          onOpenDm={onOpenDm}
        />
      ))}
    </div>
  );
}

// ─── Channel row (button + optional roster accordion) ───────────────────

function ChannelRow({
  ch,
  isActive,
  isExpanded,
  workspaceMembers,
  onlineUsers,
  onSelect,
  onToggleExpand,
  onOpenDm,
}: {
  ch: ChatChannel;
  isActive: boolean;
  isExpanded: boolean;
  workspaceMembers: WorkspaceMember[];
  onlineUsers?: Set<number>;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onOpenDm?: (userId: number) => void;
}) {
  const hasUnread = ch.unreadCount > 0;
  const isDm = ch.type === "dm";
  const peerOnline =
    isDm && ch.peer && onlineUsers ? onlineUsers.has(ch.peer.userId) : false;
  const showAccordion = !isDm;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          borderRadius: 6,
          background: isActive ? "var(--accent-soft, #eef)" : "transparent",
        }}
      >
        {showAccordion && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(ch.id);
            }}
            title={isExpanded ? "Свернуть состав" : "Показать состав"}
            aria-label={isExpanded ? "Свернуть состав" : "Показать состав"}
            style={{
              padding: "2px 4px",
              border: "none",
              background: "transparent",
              color: "var(--muted, #888)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelect(ch.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px 6px 6px",
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: isActive ? "var(--accent)" : "inherit",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: isActive || hasUnread ? 600 : 400,
            textAlign: "left",
            flex: 1,
            minWidth: 0,
          }}
        >
          {isDm && ch.peer ? (
            <Avatar
              name={ch.peer.fullName}
              email={ch.peer.email}
              avatarDataUrl={ch.peer.avatarDataUrl}
              size={18}
              isOnline={peerOnline}
            />
          ) : ch.isPrivate ? (
            <Lock size={13} />
          ) : (
            <Hash size={14} />
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {ch.name}
          </span>
          {!isActive && <UnreadBadge count={ch.unreadCount} />}
        </button>
      </div>
      {showAccordion && isExpanded && (
        <ChannelRoster
          channel={ch}
          workspaceMembers={workspaceMembers}
          onlineUsers={onlineUsers}
          onOpenDm={onOpenDm}
        />
      )}
    </div>
  );
}

// ─── Roster accordion contents ─────────────────────────────────────────

function ChannelRoster({
  channel,
  workspaceMembers,
  onlineUsers,
  onOpenDm,
}: {
  channel: ChatChannel;
  workspaceMembers: WorkspaceMember[];
  onlineUsers?: Set<number>;
  onOpenDm?: (userId: number) => void;
}) {
  const [members, setMembers] = useState<ChatChannelMember[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.chat.listChannelMembers(channel.id);
      setMembers(res.members);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // refresh() sets loading/members/error — this is the canonical
    // «sync local state to external source» pattern the rule warns
    // about, but cannot be avoided here without lifting fetches up.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const memberIdSet = new Set((members ?? []).map((m) => m.userId));
  const candidates = workspaceMembers.filter(
    (m) => !memberIdSet.has(m.userId),
  );

  const handleAdd = async (userId: number) => {
    setAdding(userId);
    try {
      await api.chat.addChannelMember(channel.id, userId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (userId: number) => {
    try {
      await api.chat.removeChannelMember(channel.id, userId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      style={{
        marginLeft: 18,
        marginBottom: 4,
        padding: "4px 6px 6px",
        borderLeft: "2px solid var(--border, #e2e2e2)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {loading && !members && (
        <span style={{ fontSize: 11, color: "var(--muted, #888)" }}>
          загрузка…
        </span>
      )}
      {error && (
        <span style={{ fontSize: 11, color: "var(--danger, #c33)" }}>
          {error}
        </span>
      )}
      {members?.map((m) => {
        const online = onlineUsers?.has(m.userId) ?? false;
        const canRemove = channel.canManage && channel.isPrivate;
        return (
          <div
            key={m.userId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 4px",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <button
              type="button"
              onClick={() => onOpenDm?.(m.userId)}
              disabled={!onOpenDm}
              title={onOpenDm ? "Написать в личку" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                cursor: onOpenDm ? "pointer" : "default",
                textAlign: "left",
                padding: 0,
                color: "inherit",
              }}
            >
              <Avatar
                name={m.fullName}
                email={m.email}
                avatarDataUrl={m.avatarDataUrl}
                size={18}
                isOnline={online}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {m.fullName || m.email.split("@")[0]}
              </span>
            </button>
            {canRemove && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => handleRemove(m.userId)}
                title="Убрать из канала"
                aria-label="Убрать из канала"
                style={{ padding: 2 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      {channel.canManage && channel.isPrivate && (
        <div style={{ marginTop: 4 }}>
          {!pickerOpen ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 6px",
                border: "1px dashed var(--border, #d4d4d4)",
                borderRadius: 4,
                background: "transparent",
                color: "var(--muted, #666)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <UserPlus size={12} />
              Добавить
            </button>
          ) : (
            <MemberPicker
              candidates={candidates}
              adding={adding}
              onPick={(userId) => void handleAdd(userId)}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Member picker (for adding to private channel) ─────────────────────

function MemberPicker({
  candidates,
  adding,
  onPick,
  onClose,
}: {
  candidates: WorkspaceMember[];
  adding: number | null;
  onPick: (userId: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? candidates.filter((m) => {
        const needle = q.toLowerCase();
        return (
          m.fullName.toLowerCase().includes(needle) ||
          m.email.toLowerCase().includes(needle)
        );
      })
    : candidates;
  return (
    <div
      style={{
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 6,
        padding: 4,
        background: "var(--bg, #fff)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        maxHeight: 220,
        overflow: "auto",
      }}
    >
      <div style={{ display: "flex", gap: 4, padding: 2, alignItems: "center" }}>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="добавить участников"
          autoFocus
        />
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          aria-label="Закрыть"
          style={{ padding: 2 }}
        >
          <X size={12} />
        </button>
      </div>
      {filtered.length === 0 && (
        <span
          style={{ fontSize: 11, color: "var(--muted, #888)", padding: "6px" }}
        >
          никого не найдено
        </span>
      )}
      {filtered.map((m) => (
        <button
          key={m.userId}
          type="button"
          onClick={() => onPick(m.userId)}
          disabled={adding === m.userId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 6px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            borderRadius: 4,
            fontSize: 12,
            textAlign: "left",
            opacity: adding === m.userId ? 0.5 : 1,
          }}
        >
          <Avatar
            name={m.fullName}
            email={m.email}
            avatarDataUrl={m.avatarDataUrl}
            size={18}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {m.fullName || m.email.split("@")[0]}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Create-channel form (name + isPrivate + member picker) ────────────

function CreateChannelForm({
  workspaceMembers,
  busy,
  onCancel,
  onSubmit,
}: {
  workspaceMembers: WorkspaceMember[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    name: string,
    isPrivate: boolean,
    memberIds: number[],
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pickerQuery, setPickerQuery] = useState("");

  const togglePick = (userId: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onSubmit(trimmed, isPrivate, [...picked]);
    setName("");
    setIsPrivate(false);
    setPicked(new Set());
  };

  const filtered = pickerQuery.trim()
    ? workspaceMembers.filter((m) => {
        const needle = pickerQuery.toLowerCase();
        return (
          m.fullName.toLowerCase().includes(needle) ||
          m.email.toLowerCase().includes(needle)
        );
      })
    : workspaceMembers;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 6,
        margin: "4px 0",
      }}
    >
      <input
        type="text"
        placeholder="имя канала"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        disabled={busy}
        autoFocus
        style={{ fontSize: 13, padding: "4px 6px" }}
      />
      <label className="checkbox" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          disabled={busy}
        />
        <Lock size={12} />
        Приватный канал
      </label>
      {isPrivate && (
        <>
          <SearchInput
            value={pickerQuery}
            onChange={setPickerQuery}
            placeholder="добавить участников"
            disabled={busy}
          />
          <div
            style={{
              maxHeight: 160,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              border: "1px solid var(--border, #e2e2e2)",
              borderRadius: 4,
              padding: 4,
            }}
          >
            {filtered.map((m) => {
              const checked = picked.has(m.userId);
              return (
                <label
                  key={m.userId}
                  className="checkbox"
                  style={{
                    padding: "3px 4px",
                    fontSize: 12,
                    borderRadius: 4,
                    background: checked
                      ? "var(--accent-soft, #eef)"
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePick(m.userId)}
                    disabled={busy}
                  />
                  <Avatar
                    name={m.fullName}
                    email={m.email}
                    avatarDataUrl={m.avatarDataUrl}
                    size={16}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.fullName || m.email.split("@")[0]}
                  </span>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted, #888)",
                  padding: 4,
                }}
              >
                никого не найдено
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted, #888)" }}>
            Вы автоматически попадёте в канал как создатель. Выбрано:{" "}
            {picked.size}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          Отмена
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          Создать
        </button>
      </div>
    </div>
  );
}
