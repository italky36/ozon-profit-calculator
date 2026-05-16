import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Crown,
  Grid3x3,
  Lock,
  Pause,
  RotateCcw,
  ShieldCheck,
  Store,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import {
  api,
  type AdminWorkspace,
  type AdminWorkspaceMember,
} from "../../api";
import {
  Avatar,
  CheckOk,
  RowAction,
  Section,
  StatusPill,
  Td,
  Th,
} from "../atoms";
import { MONO_FONT } from "../utils";

interface Props {
  narrow: boolean;
  onCountChange?: (count: number) => void;
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function WorkspacesSection({ narrow, onCountChange }: Props) {
  const [rows, setRows] = useState<AdminWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Expanded workspace id (accordion). Only one open at a time keeps DOM
   * small; clicking the open row collapses it. */
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [membersCache, setMembersCache] = useState<
    Map<number, AdminWorkspaceMember[] | "loading" | { error: string }>
  >(new Map());

  const expand = useCallback(
    async (id: number) => {
      // Toggle off if already open.
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (membersCache.has(id)) return;
      setMembersCache((prev) => new Map(prev).set(id, "loading"));
      try {
        const list = await api.admin.listWorkspaceMembers(id);
        setMembersCache((prev) => new Map(prev).set(id, list));
      } catch (e) {
        setMembersCache((prev) =>
          new Map(prev).set(id, { error: (e as Error).message }),
        );
      }
    },
    [expandedId, membersCache],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.admin.listWorkspaces();
      setRows(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleSuspended = async (w: AdminWorkspace) => {
    const next = w.suspendedAt == null;
    const msg = next
      ? `Приостановить команду «${w.name}»? Все ${w.memberCount} участников будут принудительно разлогинены, новые входы блокируются. Данные команды сохранятся.`
      : `Возобновить доступ команде «${w.name}»? Участники смогут заново войти.`;
    if (!confirm(msg)) return;
    setBusyId(w.id);
    setError(null);
    setNotice(null);
    try {
      await api.admin.setWorkspaceSuspended(w.id, next);
      setNotice(
        next
          ? `Команда «${w.name}» приостановлена`
          : `Команда «${w.name}» возобновлена`,
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (w: AdminWorkspace) => {
    if (
      !confirm(
        `Удалить команду «${w.name}»? Это удалит ВСЕ её магазины, товары, финансы и импорты безвозвратно. Действие нельзя отменить.`,
      )
    )
      return;
    if (
      !confirm(
        `Подтвердите ещё раз. ${w.memberCount} участников будут отвязаны, ${w.shopCount} магазинов будут удалены.`,
      )
    )
      return;
    setBusyId(w.id);
    setError(null);
    setNotice(null);
    try {
      await api.admin.deleteWorkspace(w.id);
      setNotice(`Команда «${w.name}» удалена`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section
      icon={<Grid3x3 size={16} style={{ color: "var(--muted)" }} />}
      title={narrow ? "Команды" : "Команды (workspaces)"}
      count={rows.length}
      action={
        !narrow && (
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="btn-secondary"
            style={{
              padding: "5px 10px",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <RotateCcw size={13} />
            Обновить
          </button>
        )
      }
    >
      {error && (
        <div
          role="alert"
          style={{
            margin: 12,
            padding: "8px 12px",
            background: "#FEEFEF",
            color: "#a01313",
            border: "1px solid #FFB3B3",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            margin: 12,
            padding: "8px 12px",
            background: "#EAF6EC",
            color: "#1f6b34",
            border: "1px solid #B7DFC0",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="muted" style={{ padding: 18 }}>
          Загрузка…
        </p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ padding: 18 }}>
          Команд пока нет.
        </p>
      ) : narrow ? (
        <div
          style={{
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {rows.map((w) => (
            <WorkspaceCard
              key={w.id}
              ws={w}
              busy={busyId === w.id}
              onToggleSuspended={() => void toggleSuspended(w)}
              onDelete={() => void remove(w)}
            />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <Th width={36}>{""}</Th>
                <Th>Имя</Th>
                <Th width={140}>Slug</Th>
                <Th>Владелец</Th>
                <Th width={110}>Статус</Th>
                <Th align="center" width={120}>
                  Участников
                </Th>
                <Th align="center" width={110}>
                  Магазинов
                </Th>
                <Th width={130}>Создана</Th>
                <Th align="right" width={110}>
                  Действия
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <WorkspaceRow
                  key={w.id}
                  ws={w}
                  busy={busyId === w.id}
                  expanded={expandedId === w.id}
                  members={membersCache.get(w.id) ?? null}
                  onToggleExpand={() => void expand(w.id)}
                  onToggleSuspended={() => void toggleSuspended(w)}
                  onDelete={() => void remove(w)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

interface RowProps {
  ws: AdminWorkspace;
  busy: boolean;
  expanded?: boolean;
  members?: AdminWorkspaceMember[] | "loading" | { error: string } | null;
  onToggleExpand?: () => void;
  onToggleSuspended: () => void;
  onDelete: () => void;
}

function WorkspaceMonogram({ name }: { name: string }) {
  const letters = name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "linear-gradient(135deg, #fef3c7, #fde68a)",
        color: "#92400e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 13,
        flex: "0 0 auto",
        letterSpacing: 0.3,
      }}
    >
      {letters}
    </div>
  );
}

function WorkspaceRow({
  ws,
  busy,
  expanded,
  members,
  onToggleExpand,
  onToggleSuspended,
  onDelete,
}: RowProps) {
  const [hover, setHover] = useState(false);
  const suspended = ws.suspendedAt != null;
  return (
    <>
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: expanded ? "#eff6ff" : hover ? "#f8fafc" : "#fff",
        transition: "background .1s",
        opacity: suspended ? 0.7 : 1,
        cursor: onToggleExpand ? "pointer" : "default",
      }}
      onClick={onToggleExpand}
    >
      <Td>
        <button
          type="button"
          aria-label={expanded ? "Свернуть" : "Развернуть"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          style={{
            width: 24,
            height: 24,
            border: "1px solid transparent",
            background: "transparent",
            cursor: "pointer",
            color: "var(--muted)",
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </Td>
      <Td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <WorkspaceMonogram name={ws.name} />
          <div style={{ fontWeight: 600, fontSize: 13 }}>{ws.name}</div>
        </div>
      </Td>
      <Td>
        <code
          style={{
            fontFamily: MONO_FONT,
            fontSize: 12,
            padding: "2px 7px",
            background: "#f1f5f9",
            borderRadius: 5,
            color: "#1e293b",
          }}
        >
          {ws.slug}
        </code>
      </Td>
      <Td>
        <span style={{ fontSize: 13, color: "#1e293b" }}>
          {ws.ownerEmail ?? (
            <span className="muted">— (нет owner'а)</span>
          )}
        </span>
      </Td>
      <Td>
        {suspended ? (
          <StatusPill tone="bad" icon={<Pause size={11} strokeWidth={2.25} />}>
            приостановлена
          </StatusPill>
        ) : (
          <StatusPill tone="ok">активна</StatusPill>
        )}
      </Td>
      <Td align="center">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#1e293b",
            fontWeight: 500,
          }}
        >
          <UsersIcon size={14} style={{ color: "var(--muted)" }} />
          {ws.memberCount}
        </span>
      </Td>
      <Td align="center">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#1e293b",
            fontWeight: 500,
          }}
        >
          <Store size={14} style={{ color: "var(--muted)" }} />
          {ws.shopCount}
        </span>
      </Td>
      <Td>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            fontFamily: MONO_FONT,
          }}
        >
          {fmtDate(ws.createdAt)}
        </span>
      </Td>
      <Td align="right">
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            opacity: hover ? 1 : 0.55,
            transition: "opacity .12s",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <RowAction
            icon={
              suspended ? <CirclePlay size={14} /> : <Pause size={14} />
            }
            title={suspended ? "Возобновить" : "Приостановить"}
            onClick={onToggleSuspended}
            disabled={busy}
          />
          <RowAction
            icon={<Trash2 size={14} />}
            title="Удалить"
            tone="danger"
            onClick={onDelete}
            disabled={busy}
          />
        </div>
      </Td>
    </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ padding: 0, background: "#f8fafc" }}>
            <WorkspaceMembersPanel members={members ?? null} />
          </td>
        </tr>
      )}
    </>
  );
}

function WorkspaceMembersPanel({
  members,
}: {
  members: AdminWorkspaceMember[] | "loading" | { error: string } | null;
}) {
  if (members === null || members === "loading") {
    return (
      <div
        style={{ padding: "16px 22px", fontSize: 12.5, color: "var(--muted)" }}
      >
        Загрузка участников…
      </div>
    );
  }
  if (typeof members === "object" && !Array.isArray(members)) {
    return (
      <div
        role="alert"
        style={{
          margin: 12,
          padding: "8px 12px",
          background: "#FEEFEF",
          color: "#a01313",
          border: "1px solid #FFB3B3",
          borderRadius: 6,
          fontSize: 12.5,
        }}
      >
        Не удалось загрузить участников: {members.error}
      </div>
    );
  }
  if (members.length === 0) {
    return (
      <div
        style={{ padding: "16px 22px", fontSize: 12.5, color: "var(--muted)" }}
      >
        В команде нет участников.
      </div>
    );
  }
  return (
    <div style={{ padding: "10px 22px 14px 56px" }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--muted)",
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Участники команды
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map((m) => (
          <div
            key={m.userId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              background: "#fff",
              border: "1px solid var(--border-soft)",
              borderRadius: 8,
              flexWrap: "wrap",
              opacity: m.isBlocked ? 0.65 : 1,
            }}
          >
            <Avatar name={m.email} size={26} />
            <span
              style={{ fontWeight: 600, fontSize: 13, color: "#0f172a", flex: 1 }}
            >
              {m.email}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px 3px 7px",
                borderRadius: 999,
                background:
                  m.role === "owner"
                    ? "rgba(180,83,9,0.12)"
                    : m.role === "manager"
                      ? "rgba(3,105,161,0.10)"
                      : "rgba(15,23,42,0.06)",
                color:
                  m.role === "owner"
                    ? "#b45309"
                    : m.role === "manager"
                      ? "#0369a1"
                      : "#1e293b",
                fontWeight: 600,
                fontSize: 11,
                whiteSpace: "nowrap",
              }}
            >
              {m.role === "owner" ? (
                <Crown size={11} strokeWidth={2.2} />
              ) : m.role === "manager" ? (
                <ShieldCheck size={11} strokeWidth={2.2} />
              ) : (
                <UsersIcon size={11} strokeWidth={2.2} />
              )}
              {m.role === "owner"
                ? "владелец"
                : m.role === "manager"
                  ? "менеджер"
                  : "участник"}
            </span>
            {m.isBlocked && (
              <StatusPill tone="bad" icon={<Lock size={10} strokeWidth={2.5} />}>
                заблокирован
              </StatusPill>
            )}
            {!m.isVerified && (
              <StatusPill tone="warn">не подтв.</StatusPill>
            )}
            {m.isVerified && !m.isBlocked && (
              <StatusPill tone="ok" icon={<CheckOk />}>
                активен
              </StatusPill>
            )}
            <span
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: MONO_FONT,
              }}
            >
              {fmtDate(m.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceCard({ ws, busy, onToggleSuspended, onDelete }: RowProps) {
  const suspended = ws.suspendedAt != null;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "#fff",
        padding: 12,
        opacity: suspended ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <WorkspaceMonogram name={ws.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
            {ws.name}
          </div>
          <div
            style={{
              marginTop: 3,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <code
              style={{
                fontFamily: MONO_FONT,
                fontSize: 11.5,
                padding: "1px 6px",
                background: "#f1f5f9",
                borderRadius: 5,
                color: "#1e293b",
              }}
            >
              {ws.slug}
            </code>
            {suspended ? (
              <StatusPill
                tone="bad"
                icon={<Pause size={11} strokeWidth={2.25} />}
              >
                приостановлена
              </StatusPill>
            ) : (
              <StatusPill tone="ok">активна</StatusPill>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "var(--muted)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Crown size={12} />
          <span style={{ color: "#1e293b", wordBreak: "break-all" }}>
            {ws.ownerEmail ?? "— (нет owner'а)"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "#1e293b",
              fontWeight: 500,
            }}
          >
            <UsersIcon size={12} />
            {ws.memberCount}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "#1e293b",
              fontWeight: 500,
            }}
          >
            <Store size={12} />
            {ws.shopCount}
          </span>
          <span style={{ fontFamily: MONO_FONT, fontSize: 11.5 }}>
            {fmtDate(ws.createdAt)}
          </span>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
        }}
      >
        <RowAction
          icon={suspended ? <CirclePlay size={15} /> : <Pause size={15} />}
          title={suspended ? "Возобновить" : "Приостановить"}
          onClick={onToggleSuspended}
          disabled={busy}
        />
        <RowAction
          icon={<Trash2 size={15} />}
          title="Удалить"
          tone="danger"
          onClick={onDelete}
          disabled={busy}
        />
      </div>
    </div>
  );
}
