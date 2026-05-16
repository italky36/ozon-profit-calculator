import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  CircleCheck,
  Eye,
  Mail,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import { api, type AdminUser } from "../../api";
import {
  Avatar,
  CheckBox,
  CheckOk,
  RowAction,
  Section,
  Stat,
  StatusPill,
  Td,
  Th,
  Toggle,
} from "../atoms";
import { MONO_FONT } from "../utils";

interface Props {
  meId: number;
  narrow: boolean;
  onCountChange?: (count: number) => void;
}

function fmtDateTime(s: string): string {
  try {
    return new Date(s).toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return s;
  }
}

export default function UsersSection({ meId, narrow, onCountChange }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.admin.listUsers();
      setUsers(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const run = useCallback(
    async (id: number, fn: () => Promise<unknown>, successMsg?: string) => {
      setBusyId(id);
      setError(null);
      setNotice(null);
      try {
        await fn();
        if (successMsg) setNotice(successMsg);
        await reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email.toLowerCase().includes(q));
  }, [users, search]);

  const sysadminCount = users.filter((u) => u.isSysadmin).length;
  const verifiedCount = users.filter((u) => u.isVerified).length;
  const activeCount = users.filter((u) => !u.isBlocked).length;

  const toggleSysadmin = (u: AdminUser, isMe: boolean) => {
    if (isMe && u.isSysadmin) return; // can't demote self
    const next = !u.isSysadmin;
    void run(
      u.id,
      () => api.admin.setRole(u.id, next ? "admin" : "user"),
      next
        ? `${u.email} получил права sysadmin`
        : `${u.email} больше не sysadmin`,
    );
  };

  const toggleBlocked = (u: AdminUser, isMe: boolean) => {
    if (isMe) return;
    const next = !u.isBlocked;
    if (
      next &&
      !confirm(
        `Заблокировать пользователя ${u.email}? Он будет отключён от всех устройств и не сможет войти, пока вы не разблокируете.`,
      )
    )
      return;
    void run(
      u.id,
      () => api.admin.setBlocked(u.id, next),
      next
        ? `Пользователь ${u.email} заблокирован`
        : `Пользователь ${u.email} разблокирован`,
    );
  };

  const deleteUser = (u: AdminUser, isMe: boolean) => {
    if (isMe) return;
    if (
      !confirm(
        `Удалить пользователя ${u.email}? Все его сессии и настройки будут удалены.`,
      )
    )
      return;
    void run(u.id, () => api.admin.deleteUser(u.id), `Пользователь ${u.email} удалён`);
  };

  const resendVerification = (u: AdminUser) => {
    void run(
      u.id,
      () => api.admin.resendVerification(u.id),
      `Письмо отправлено на ${u.email}`,
    );
  };

  // ---- Bulk actions ----

  /** User ids that are eligible for bulk operations — everyone except the
   * current sysadmin (can't block/delete self). */
  const selectableIds = filtered.filter((u) => u.id !== meId).map((u) => u.id);

  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selected.has(id));
  const someSelected =
    selected.size > 0 && !allSelected;

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const id of selectableIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of selectableIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /** Run an async op for each selected userId in parallel; aggregate errors. */
  const runBulk = async (
    label: string,
    fn: (u: AdminUser) => Promise<unknown>,
  ) => {
    const ids = [...selected];
    const targets = users.filter((u) => ids.includes(u.id) && u.id !== meId);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    const results = await Promise.allSettled(targets.map(fn));
    const failures = results.filter((r) => r.status === "rejected").length;
    const ok = results.length - failures;
    if (failures === 0) {
      setNotice(`${label}: ${ok} из ${results.length}`);
      clearSelection();
    } else {
      setError(
        `${label}: успешно ${ok}, ошибок ${failures}. Подробности — выделите оставшиеся и попробуйте снова.`,
      );
    }
    await reload();
    setBulkBusy(false);
  };

  const bulkBlock = async (blocked: boolean) => {
    const ids = [...selected].filter((id) => id !== meId);
    if (ids.length === 0) return;
    if (
      blocked &&
      !confirm(
        `Заблокировать ${ids.length} пользователей? Каждый из них будет разлогинен со всех устройств и не сможет войти, пока вы не разблокируете.`,
      )
    )
      return;
    await runBulk(
      blocked ? "Заблокировано" : "Разблокировано",
      (u) => api.admin.setBlocked(u.id, blocked),
    );
  };

  const bulkDelete = async () => {
    const targets = users.filter(
      (u) => selected.has(u.id) && u.id !== meId,
    );
    if (targets.length === 0) return;
    if (
      !confirm(
        `Удалить ${targets.length} пользователей навсегда? Это сотрёт их сессии и связанные данные. Действие необратимо.`,
      )
    )
      return;
    await runBulk("Удалено", (u) => api.admin.deleteUser(u.id));
  };

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: narrow ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))",
          gap: narrow ? 8 : 12,
          marginBottom: narrow ? 12 : 16,
        }}
      >
        <Stat
          label="Пользователей"
          value={users.length}
          icon={<UsersIcon size={17} />}
          accent={{ bg: "#eff6ff", fg: "#1d4ed8" }}
        />
        <Stat
          label="Sysadmin"
          value={sysadminCount}
          icon={<ShieldCheck size={17} />}
          accent={{ bg: "#fef3c7", fg: "#92400e" }}
        />
        <Stat
          label="Подтверждены"
          value={verifiedCount}
          icon={<CheckOk size={17} />}
          accent={{ bg: "#ecfdf5", fg: "#047857" }}
        />
        <Stat
          label="Активны сейчас"
          value={activeCount}
          icon={<Eye size={17} />}
          accent={{ bg: "#f1f5f9", fg: "#475569" }}
        />
      </div>

      <Section
        icon={<UsersIcon size={16} style={{ color: "var(--muted)" }} />}
        title="Пользователи"
        count={users.length}
        headerRight={
          <div style={{ position: "relative" }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#94a3b8",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={narrow ? "Поиск" : "Поиск по email"}
              style={{
                width: narrow ? 160 : 240,
                height: 30,
                padding: "0 12px 0 30px",
                border: "1px solid var(--border)",
                borderRadius: 7,
                fontSize: 12.5,
                fontFamily: "inherit",
                outline: "none",
                background: "#fff",
              }}
            />
          </div>
        }
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

        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            busy={bulkBusy}
            onBlock={() => void bulkBlock(true)}
            onUnblock={() => void bulkBlock(false)}
            onDelete={() => void bulkDelete()}
            onClear={clearSelection}
          />
        )}

        {narrow ? (
          <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                isMe={u.id === meId}
                busy={busyId === u.id || bulkBusy}
                selected={selected.has(u.id)}
                onToggleSelect={() => toggleOne(u.id)}
                onToggleSysadmin={() => toggleSysadmin(u, u.id === meId)}
                onToggleBlocked={() => toggleBlocked(u, u.id === meId)}
                onDelete={() => deleteUser(u, u.id === meId)}
                onResend={() => resendVerification(u)}
              />
            ))}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: "30px 18px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Ничего не нашлось по «{search}»
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <Th width={40}>
                    <CheckBox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                      ariaLabel="Выделить всех"
                      disabled={selectableIds.length === 0}
                    />
                  </Th>
                  <Th>Email</Th>
                  <Th width={180}>Workspace</Th>
                  <Th align="center" width={100}>
                    Sysadmin
                  </Th>
                  <Th align="center" width={120}>
                    Подтверждён
                  </Th>
                  <Th width={110}>Статус</Th>
                  <Th width={170}>Создан</Th>
                  <Th align="right" width={110}>
                    Действия
                  </Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isMe={u.id === meId}
                    busy={busyId === u.id || bulkBusy}
                    selected={selected.has(u.id)}
                    onToggleSelect={() => toggleOne(u.id)}
                    onToggleSysadmin={() => toggleSysadmin(u, u.id === meId)}
                    onToggleBlocked={() => toggleBlocked(u, u.id === meId)}
                    onDelete={() => deleteUser(u, u.id === meId)}
                    onResend={() => resendVerification(u)}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: "40px 18px",
                        textAlign: "center",
                        color: "var(--muted)",
                      }}
                    >
                      {search
                        ? `Ничего не нашлось по «${search}»`
                        : "Пользователей пока нет"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

interface RowProps {
  user: AdminUser;
  isMe: boolean;
  busy: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleSysadmin: () => void;
  onToggleBlocked: () => void;
  onDelete: () => void;
  onResend: () => void;
}

function UserRow({
  user,
  isMe,
  busy,
  selected,
  onToggleSelect,
  onToggleSysadmin,
  onToggleBlocked,
  onDelete,
  onResend,
}: RowProps) {
  const [hover, setHover] = useState(false);
  const cannotDemoteSelf = isMe && user.isSysadmin;
  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: selected ? "#eff6ff" : hover ? "#f8fafc" : "#fff",
        transition: "background .1s",
        opacity: user.isBlocked ? 0.7 : 1,
      }}
    >
      <Td>
        <CheckBox
          checked={selected}
          onChange={onToggleSelect}
          disabled={isMe}
          ariaLabel={`Выделить ${user.email}`}
        />
      </Td>
      <Td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={user.email} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
              {user.email}
              {isMe && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#1d4ed8",
                    background: "#eff6ff",
                    padding: "2px 7px",
                    borderRadius: 999,
                  }}
                >
                  вы
                </span>
              )}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        {user.workspace ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "#0f172a", fontWeight: 500 }}>
              {user.workspace.name}
            </span>
            <span
              style={{
                color: "var(--muted)",
                fontSize: 11,
                fontFamily: MONO_FONT,
              }}
            >
              {user.workspace.slug} · {user.workspace.role}
            </span>
          </div>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {user.isSysadmin ? "—" : "(нет команды)"}
          </span>
        )}
      </Td>
      <Td align="center">
        <Toggle
          on={user.isSysadmin}
          onChange={onToggleSysadmin}
          disabled={busy || user.isBlocked || cannotDemoteSelf}
          label="Sysadmin"
        />
      </Td>
      <Td align="center">
        {user.isVerified ? (
          <StatusPill tone="ok" icon={<CheckOk />}>
            да
          </StatusPill>
        ) : (
          <StatusPill tone="warn">нет</StatusPill>
        )}
      </Td>
      <Td>
        {user.isBlocked ? (
          <StatusPill tone="bad">заблокирован</StatusPill>
        ) : (
          <StatusPill tone="ok">активен</StatusPill>
        )}
      </Td>
      <Td>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            fontFamily: MONO_FONT,
            letterSpacing: 0.1,
            whiteSpace: "nowrap",
          }}
        >
          {fmtDateTime(user.createdAt)}
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
        >
          {!user.isVerified && (
            <RowAction
              icon={<Mail size={14} />}
              title="Отправить письмо повторно"
              onClick={onResend}
              disabled={busy}
            />
          )}
          <RowAction
            icon={user.isBlocked ? <CircleCheck size={14} /> : <Ban size={14} />}
            title={
              isMe
                ? "Нельзя заблокировать самого себя"
                : user.isBlocked
                  ? "Разблокировать"
                  : "Заблокировать (без удаления данных)"
            }
            onClick={onToggleBlocked}
            disabled={busy || isMe}
          />
          <RowAction
            icon={<Trash2 size={14} />}
            title={isMe ? "Нельзя удалить самого себя" : "Удалить"}
            tone="danger"
            onClick={onDelete}
            disabled={busy || isMe}
          />
        </div>
      </Td>
    </tr>
  );
}

function UserCard({
  user,
  isMe,
  busy,
  selected,
  onToggleSelect,
  onToggleSysadmin,
  onToggleBlocked,
  onDelete,
  onResend,
}: RowProps) {
  const cannotDemoteSelf = isMe && user.isSysadmin;
  return (
    <div
      style={{
        border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
        borderRadius: 10,
        background: selected ? "#eff6ff" : "#fff",
        padding: "12px 12px 10px",
        opacity: user.isBlocked ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <CheckBox
          checked={selected}
          onChange={onToggleSelect}
          disabled={isMe}
          ariaLabel={`Выделить ${user.email}`}
        />
        <Avatar name={user.email} size={32} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: "#0f172a",
                wordBreak: "break-all",
              }}
            >
              {user.email}
            </span>
            {isMe && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#1d4ed8",
                  background: "#eff6ff",
                  padding: "2px 6px",
                  borderRadius: 999,
                }}
              >
                вы
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {user.isBlocked ? (
              <StatusPill tone="bad">заблокирован</StatusPill>
            ) : (
              <StatusPill tone="ok">активен</StatusPill>
            )}
            {user.isVerified ? (
              <StatusPill tone="ok" icon={<CheckOk />}>
                подтв.
              </StatusPill>
            ) : (
              <StatusPill tone="warn">не подтв.</StatusPill>
            )}
          </div>
          {user.workspace ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: "var(--muted)",
                lineHeight: 1.4,
              }}
            >
              Команда: <b style={{ color: "#0f172a" }}>{user.workspace.name}</b>
              <span style={{ marginLeft: 6, fontFamily: MONO_FONT }}>
                {user.workspace.role}
              </span>
            </div>
          ) : (
            !user.isSysadmin && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>
                Без команды
              </div>
            )
          )}
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              color: "var(--muted)",
              fontFamily: MONO_FONT,
            }}
          >
            {fmtDateTime(user.createdAt)}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border-soft)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Toggle
            on={user.isSysadmin}
            onChange={onToggleSysadmin}
            disabled={busy || user.isBlocked || cannotDemoteSelf}
            label="Sysadmin"
          />
          <span
            style={{
              fontSize: 12.5,
              color: user.isSysadmin ? "#0f172a" : "var(--muted)",
              fontWeight: 500,
            }}
          >
            Sysadmin
          </span>
        </div>
        {!user.isVerified && (
          <RowAction
            icon={<Mail size={15} />}
            title="Отправить письмо повторно"
            onClick={onResend}
            disabled={busy}
          />
        )}
        <RowAction
          icon={user.isBlocked ? <CircleCheck size={15} /> : <Ban size={15} />}
          title={
            isMe
              ? "Нельзя заблокировать самого себя"
              : user.isBlocked
                ? "Включить"
                : "Отключить"
          }
          onClick={onToggleBlocked}
          disabled={busy || isMe}
        />
        <RowAction
          icon={<Trash2 size={15} />}
          title="Удалить"
          tone="danger"
          onClick={onDelete}
          disabled={busy || isMe}
        />
      </div>
    </div>
  );
}

function BulkBar({
  count,
  busy,
  onBlock,
  onUnblock,
  onDelete,
  onClear,
}: {
  count: number;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        margin: "12px 18px 0",
        padding: "8px 12px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#1d4ed8", fontWeight: 600 }}>
        Выбрано: {count}
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        disabled={busy}
        onClick={onBlock}
        style={{
          padding: "6px 12px",
          border: "1px solid #fde68a",
          background: "#fffbeb",
          color: "#92400e",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Ban size={13} />
        Заблокировать
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onUnblock}
        style={{
          padding: "6px 12px",
          border: "1px solid #a7f3d0",
          background: "#ecfdf5",
          color: "#047857",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <CircleCheck size={13} />
        Разблокировать
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        style={{
          padding: "6px 12px",
          border: "1px solid #fecaca",
          background: "#fef2f2",
          color: "#b91c1c",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Trash2 size={13} />
        Удалить
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        style={{
          padding: "6px 10px",
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--muted)",
          borderRadius: 7,
          fontSize: 12.5,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        Снять выделение
      </button>
    </div>
  );
}
