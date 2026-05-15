import { useCallback, useEffect, useState } from "react";
import { Ban, CircleCheck, Mail, RotateCcw, Trash2 } from "lucide-react";
import { api, type AdminUser } from "../../api";
import { errBox, okBox, td, th } from "./styles";

export default function UsersSection({ meId }: { meId: number }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.admin.listUsers();
      setUsers(list);
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

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Пользователи{" "}
          <span className="collapsible-badge" style={{ marginLeft: 4 }}>
            {users.length}
          </span>
        </h3>
        <button
          type="button"
          className="btn-icon"
          onClick={() => void reload()}
          disabled={loading}
          title="Обновить"
        >
          <RotateCcw size={14} /> Обновить
        </button>
      </div>

      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={okBox}>{notice}</div>}

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : users.length === 0 ? (
        <p className="muted">Пользователей пока нет.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <th style={th}>Email</th>
                <th style={th}>Sysadmin</th>
                <th style={th}>Подтверждён</th>
                <th style={th}>Статус</th>
                <th style={th}>Создан</th>
                <th style={{ ...th, textAlign: "right" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = meId === u.id;
                const busy = busyId === u.id;
                return (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: "1px solid var(--border-soft)",
                      opacity: u.isBlocked ? 0.55 : 1,
                    }}
                  >
                    <td style={td}>
                      <strong>{u.email}</strong>
                      {isMe && (
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          (вы)
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={u.isSysadmin}
                        disabled={busy || u.isBlocked || (isMe && u.isSysadmin)}
                        onChange={(e) => {
                          const next = e.target.checked;
                          void run(
                            u.id,
                            () =>
                              api.admin.setRole(u.id, next ? "admin" : "user"),
                            next
                              ? `${u.email} получил права sysadmin`
                              : `${u.email} больше не sysadmin`,
                          );
                        }}
                      />
                    </td>
                    <td style={td}>
                      {u.isVerified ? (
                        <span style={{ color: "#1f6b34", fontWeight: 600 }}>✓ да</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>нет</span>
                      )}
                    </td>
                    <td style={td}>
                      {u.isBlocked ? (
                        <span
                          style={{
                            color: "#a01313",
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          ⛔ заблокирован
                        </span>
                      ) : (
                        <span style={{ color: "#1f6b34", fontSize: 12 }}>
                          активен
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        {!u.isVerified && (
                          <button
                            type="button"
                            className="btn-icon"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                u.id,
                                () => api.admin.resendVerification(u.id),
                                `Письмо отправлено на ${u.email}`,
                              )
                            }
                            title="Отправить письмо повторно"
                          >
                            <Mail size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-icon"
                          disabled={busy || isMe}
                          onClick={() => {
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
                          }}
                          title={
                            isMe
                              ? "Нельзя заблокировать самого себя"
                              : u.isBlocked
                                ? "Разблокировать"
                                : "Заблокировать (без удаления данных)"
                          }
                        >
                          {u.isBlocked ? (
                            <CircleCheck size={14} />
                          ) : (
                            <Ban size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          disabled={busy || isMe}
                          onClick={() => {
                            if (
                              !confirm(
                                `Удалить пользователя ${u.email}? Все его сессии и настройки будут удалены.`,
                              )
                            )
                              return;
                            void run(
                              u.id,
                              () => api.admin.deleteUser(u.id),
                              `Пользователь ${u.email} удалён`,
                            );
                          }}
                          title={isMe ? "Нельзя удалить самого себя" : "Удалить"}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
