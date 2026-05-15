import { useCallback, useEffect, useState } from "react";
import {
  Crown,
  Mail,
  MailPlus,
  ShieldCheck,
  Trash2,
  UserCog,
  UserX,
  Users,
} from "lucide-react";
import {
  api,
  type WorkspaceInfo,
  type WorkspaceInviteRow,
  type WorkspaceMember,
  type WorkspaceRole,
} from "../api";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

const ROLE_ICON: Record<WorkspaceRole, React.ReactNode> = {
  owner: <Crown size={12} />,
  manager: <ShieldCheck size={12} />,
  member: <Users size={12} />,
};

const canManage = (role: WorkspaceRole | undefined) =>
  role === "owner" || role === "manager";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ru-RU", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const palette: Record<WorkspaceRole, { bg: string; fg: string }> = {
    owner: { bg: "rgba(255, 176, 32, 0.18)", fg: "#a06600" },
    manager: { bg: "rgba(0, 132, 255, 0.14)", fg: "#005bff" },
    member: { bg: "rgba(0, 0, 0, 0.06)", fg: "var(--text)" },
  };
  const p = palette[role];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 700,
        background: p.bg,
        color: p.fg,
      }}
    >
      {ROLE_ICON[role]}
      {ROLE_LABEL[role]}
    </span>
  );
}

export default function TeamPage() {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, inv] = await Promise.all([
        api.workspace.me(),
        api.workspace.listInvites(),
      ]);
      setInfo(i);
      setInvites(inv);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (loading && !info) {
    return (
      <div className="card">
        <span className="muted">Загрузка команды…</span>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="card">
        <span className="muted">{error ?? "Команда не найдена"}</span>
      </div>
    );
  }

  const isOwner = info.role === "owner";
  const allowManage = canManage(info.role);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div className="error-panel">
          <span>Ошибка: {error}</span>
          <button className="btn-icon" onClick={() => setError(null)}>
            Закрыть
          </button>
        </div>
      )}
      {notice && (
        <div
          className="card"
          style={{
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{notice}</span>
          <button className="btn-icon" onClick={() => setNotice(null)}>
            Закрыть
          </button>
        </div>
      )}

      <WorkspaceHeader
        info={info}
        isOwner={isOwner}
        busy={busy}
        onRenamed={(name) => setInfo((i) => (i ? { ...i, name } : i))}
        onError={setError}
        setBusy={setBusy}
      />

      <MembersSection
        info={info}
        allowManage={allowManage}
        isOwner={isOwner}
        busy={busy}
        setBusy={setBusy}
        onError={setError}
        onNotice={setNotice}
        onReload={reload}
      />

      <InvitesSection
        invites={invites}
        allowManage={allowManage}
        isOwner={isOwner}
        busy={busy}
        setBusy={setBusy}
        onError={setError}
        onNotice={setNotice}
        onReload={reload}
      />
    </div>
  );
}

function WorkspaceHeader({
  info,
  isOwner,
  busy,
  onRenamed,
  onError,
  setBusy,
}: {
  info: WorkspaceInfo;
  isOwner: boolean;
  busy: boolean;
  onRenamed: (name: string) => void;
  onError: (msg: string | null) => void;
  setBusy: (v: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(info.name);

  const submit = async () => {
    const next = draft.trim();
    if (!next) {
      onError("Имя команды не может быть пустым");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const res = await api.workspace.update({ name: next });
      onRenamed(res.name);
      setEditing(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3
        style={{
          margin: "0 0 12px",
          fontSize: 14,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Users size={16} /> Команда
      </h3>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {editing ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={80}
              autoFocus
              style={{
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 14,
                minWidth: 240,
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void submit()}
              style={{ padding: "6px 12px" }}
            >
              Сохранить
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(info.name);
                setEditing(false);
              }}
              style={{ padding: "6px 12px" }}
            >
              Отмена
            </button>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 18 }}>{info.name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              slug: <code>{info.slug}</code>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · создана {fmtDate(info.createdAt)}
            </span>
            {isOwner && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(true)}
                style={{ padding: "4px 12px", marginLeft: "auto" }}
              >
                Переименовать
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MembersSection({
  info,
  allowManage,
  isOwner,
  busy,
  setBusy,
  onError,
  onNotice,
  onReload,
}: {
  info: WorkspaceInfo;
  allowManage: boolean;
  isOwner: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const setRole = async (m: WorkspaceMember, role: WorkspaceRole) => {
    if (role === m.role) return;
    setBusy(true);
    onError(null);
    try {
      await api.workspace.setMemberRole(m.userId, role);
      onNotice(`Роль ${m.email} → ${ROLE_LABEL[role]}`);
      await onReload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: WorkspaceMember) => {
    if (
      !window.confirm(
        `Удалить ${m.email} из команды? Они потеряют доступ к данным.`,
      )
    )
      return;
    setBusy(true);
    onError(null);
    try {
      await api.workspace.removeMember(m.userId);
      onNotice(`${m.email} удалён(а) из команды`);
      await onReload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3
        style={{
          margin: "0 0 12px",
          fontSize: 14,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <UserCog size={16} /> Участники{" "}
        <span className="collapsible-badge" style={{ marginLeft: 4 }}>
          {info.members.length}
        </span>
      </h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {info.members.map((m) => (
          <li
            key={m.userId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--accent) 4%, transparent)",
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <RoleBadge role={m.role} />
            <span style={{ flex: 1, minWidth: 200 }}>
              {m.email}
              {m.isYou && (
                <span className="muted" style={{ marginLeft: 6 }}>
                  (вы)
                </span>
              )}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              с {fmtDate(m.createdAt)}
            </span>
            {isOwner && !m.isYou && (
              <select
                value={m.role}
                disabled={busy}
                onChange={(e) =>
                  void setRole(m, e.target.value as WorkspaceRole)
                }
                style={{
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <option value="owner">владелец</option>
                <option value="manager">менеджер</option>
                <option value="member">участник</option>
              </select>
            )}
            {allowManage && !m.isYou && (
              <button
                type="button"
                className="btn-icon"
                disabled={busy}
                onClick={() => void remove(m)}
                title="Удалить из команды"
              >
                <UserX size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvitesSection({
  invites,
  allowManage,
  isOwner,
  busy,
  setBusy,
  onError,
  onNotice,
  onReload,
}: {
  invites: WorkspaceInviteRow[];
  allowManage: boolean;
  isOwner: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");

  const send = async () => {
    const e = email.trim().toLowerCase();
    if (!e) {
      onError("Укажите email");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.workspace.createInvite(e, role);
      onNotice(`Приглашение отправлено на ${e}`);
      setEmail("");
      setRole("member");
      await onReload();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string, e: string) => {
    if (!window.confirm(`Отозвать приглашение для ${e}?`)) return;
    setBusy(true);
    onError(null);
    try {
      await api.workspace.revokeInvite(token);
      onNotice(`Приглашение для ${e} отозвано`);
      await onReload();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3
        style={{
          margin: "0 0 12px",
          fontSize: 14,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Mail size={16} /> Приглашения{" "}
        <span className="collapsible-badge" style={{ marginLeft: 4 }}>
          {invites.length}
        </span>
      </h3>
      {allowManage ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px dashed var(--border)",
          }}
        >
          <input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            style={{
              flex: "1 1 220px",
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 13,
            }}
          />
          <select
            value={role}
            onChange={(ev) => setRole(ev.target.value as WorkspaceRole)}
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <option value="member">участник</option>
            <option value="manager">менеджер</option>
            {isOwner && <option value="owner">владелец</option>}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void send()}
            style={{
              padding: "6px 14px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <MailPlus size={14} /> Отправить приглашение
          </button>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Только владелец или менеджер может приглашать сотрудников.
        </p>
      )}
      {invites.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>
          Активных приглашений нет.
        </span>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {invites.map((inv) => (
            <li
              key={inv.token}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background:
                  "color-mix(in srgb, var(--accent) 4%, transparent)",
                fontSize: 13,
                flexWrap: "wrap",
              }}
            >
              <RoleBadge role={inv.role} />
              <span style={{ flex: 1, minWidth: 200 }}>{inv.email}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                пригласил(а) {inv.invitedBy.email} · до{" "}
                {fmtDateTime(inv.expiresAt)}
              </span>
              {allowManage && (
                <button
                  type="button"
                  className="btn-icon"
                  disabled={busy}
                  onClick={() => void revoke(inv.token, inv.email)}
                  title="Отозвать"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
