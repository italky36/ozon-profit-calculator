import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CircleCheck,
  Mail,
  MailPlus,
  RotateCcw,
  Send,
  ShieldAlert,
  Store,
  Trash2,
  UserPlus,
  UserMinus,
} from "lucide-react";
import {
  api,
  type AdminShop,
  type AdminShopAccess,
  type AdminShopCandidate,
  type AdminSmtpSettings,
  type AdminUser,
  type SmtpSecureMode,
} from "../../api";
import { useAuth } from "../../contexts/useAuth";

export default function AdminPage() {
  const { user: me } = useAuth();
  if (me?.role !== "admin") {
    return (
      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "var(--err)",
          }}
        >
          <ShieldAlert size={20} />
          <strong>Доступ запрещён.</strong>
          <span className="muted">Эта страница только для администраторов.</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <UsersSection meId={me.id} />
      <ShopsSection />
      <SmtpSection />
      <TestSendSection />
    </div>
  );
}

function ShopsSection() {
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessByShop, setAccessByShop] = useState<
    Record<number, AdminShopAccess[]>
  >({});
  const [granting, setGranting] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<AdminShopCandidate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.admin.shops.list();
      setShops(list);
      const access: Record<number, AdminShopAccess[]> = {};
      for (const s of list) {
        access[s.id] = await api.admin.shops.getAccess(s.id);
      }
      setAccessByShop(access);
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

  const openGrant = async (shopId: number) => {
    setGranting(shopId);
    setSelectedUserId("");
    setError(null);
    try {
      setCandidates(await api.admin.shops.getCandidates(shopId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitGrant = async () => {
    if (granting == null || typeof selectedUserId !== "number") return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.shops.grantAccess(granting, selectedUserId);
      setGranting(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shopId: number, userId: number, email: string) => {
    if (
      !window.confirm(
        `Отозвать доступ у ${email}? Его товары, финансы и импорты в этом магазине будут удалены безвозвратно.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.shops.revokeAccess(shopId, userId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
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
        <Store size={16} /> Магазины и доступы
      </h3>
      <p
        className="muted"
        style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}
      >
        Магазины, которыми вы владеете. Назначьте пользователя — он увидит
        магазин у себя со своим личным каталогом и финансами, используя API-ключи,
        привязанные к этому магазину.
      </p>
      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "color-mix(in srgb, var(--err) 12%, transparent)",
            color: "var(--err)",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      {loading ? (
        <span className="muted">Загрузка…</span>
      ) : shops.length === 0 ? (
        <span className="muted">У вас пока нет магазинов.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shops.map((s) => {
            const access = accessByShop[s.id] ?? [];
            return (
              <div
                key={s.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "2px 8px",
                      borderRadius: 5,
                      fontWeight: 700,
                      fontSize: 11,
                      background:
                        s.color ??
                        "color-mix(in srgb, var(--accent) 18%, transparent)",
                      color: s.color ? "#fff" : "var(--accent)",
                    }}
                  >
                    {s.shortName}
                  </span>
                  <strong style={{ flex: 1 }}>{s.name}</strong>
                  <span
                    className="muted"
                    style={{ fontSize: 12 }}
                    title={
                      s.hasOzonCreds
                        ? "Привязаны ключи Ozon API"
                        : "Ключи не настроены"
                    }
                  >
                    {s.hasOzonCreds ? "Ozon API ✓" : "Ozon API —"}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => void openGrant(s.id)}
                    title="Назначить пользователя"
                  >
                    <UserPlus size={14} /> Назначить
                  </button>
                </div>
                {access.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "10px 0 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {access.map((a) => (
                      <li
                        key={a.userId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 8px",
                          borderRadius: 6,
                          background:
                            "color-mix(in srgb, var(--accent) 4%, transparent)",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ flex: 1 }}>{a.email}</span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {a.role === "admin" ? "admin" : ""}
                          {a.isBlocked ? " · заблокирован" : ""}
                        </span>
                        <button
                          type="button"
                          className="btn-icon"
                          disabled={busy}
                          onClick={() => void revoke(s.id, a.userId, a.email)}
                          title="Отозвать доступ (с удалением данных пользователя в этом магазине)"
                        >
                          <UserMinus size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div
                    className="muted"
                    style={{ marginTop: 8, fontSize: 12 }}
                  >
                    Пока никому не выдан доступ.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {granting != null && (
        <div className="modal-backdrop" onClick={() => setGranting(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, width: "92vw" }}
          >
            <div className="modal-header">
              <h3>Назначить пользователя</h3>
              <button
                className="btn-icon"
                onClick={() => setGranting(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            {candidates.length === 0 ? (
              <p className="muted">
                Все подходящие пользователи уже имеют доступ или их нет.
              </p>
            ) : (
              <>
                <label
                  className="gs-field"
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span className="gs-label">Пользователь</span>
                  <select
                    value={selectedUserId}
                    onChange={(e) =>
                      setSelectedUserId(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    style={{
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border-soft)",
                      fontSize: 13,
                    }}
                  >
                    <option value="">— выберите —</option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                        {u.role === "admin" ? " (admin)" : ""}
                        {u.isBlocked ? " (заблокирован)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 16,
                  }}
                >
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setGranting(null)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      busy ||
                      typeof selectedUserId !== "number" ||
                      selectedUserId <= 0
                    }
                    onClick={() => void submitGrant()}
                  >
                    {busy ? "…" : "Назначить"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersSection({ meId }: { meId: number }) {
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

      {error && (
        <div
          style={{
            background: "#FEEFEF",
            border: "1px solid #FFB3B3",
            color: "#a01313",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            background: "#EAF6EC",
            border: "1px solid #B7DFC0",
            color: "#1f6b34",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {notice}
        </div>
      )}

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
                <th style={th}>Роль</th>
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
                      <select
                        value={u.role}
                        disabled={busy || u.isBlocked || (isMe && u.role === "admin")}
                        onChange={(e) => {
                          const role = e.target.value as "admin" | "user";
                          if (role === u.role) return;
                          void run(
                            u.id,
                            () => api.admin.setRole(u.id, role),
                            `Роль ${u.email} изменена на ${role}`,
                          );
                        }}
                        style={{
                          padding: "4px 8px",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontFamily: "inherit",
                          fontSize: 13,
                          background: "#fff",
                        }}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
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

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
};

const fieldRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 200px) 1fr",
  gap: 10,
  alignItems: "center",
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: 13,
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

const errBox: React.CSSProperties = {
  background: "#FEEFEF",
  border: "1px solid #FFB3B3",
  color: "#a01313",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 12,
};

const okBox: React.CSSProperties = {
  background: "#EAF6EC",
  border: "1px solid #B7DFC0",
  color: "#1f6b34",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 12,
};

const badge: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--border-soft)",
  color: "var(--muted)",
  fontWeight: 600,
};

function sourceLabel(s: "db" | "env" | "console" | null): string {
  if (s === "db") return "БД";
  if (s === "env") return ".env";
  if (s === "console") return "stdout (dev)";
  return "не настроено";
}

function portPlaceholder(mode: SmtpSecureMode): string {
  if (mode === "ssl") return "465";
  if (mode === "starttls") return "587";
  if (mode === "none") return "25";
  return "587";
}

function secureHint(mode: SmtpSecureMode, port: string): string {
  const p = Number(port);
  if (mode === "ssl") return "Implicit TLS с момента подключения (обычно порт 465).";
  if (mode === "starttls")
    return "Plain-соединение апгрейдится до TLS командой STARTTLS (обычно 587).";
  if (mode === "none") return "Без шифрования. Используй только во внутренней сети.";
  if (!Number.isFinite(p))
    return "Авто: SSL/TLS при 465, иначе STARTTLS/plain (определит nodemailer).";
  return p === 465
    ? "Авто → SSL/TLS (порт 465)."
    : "Авто → STARTTLS / plain (nodemailer апгрейдится, если сервер поддерживает).";
}

function SmtpSection() {
  const [data, setData] = useState<AdminSmtpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState<SmtpSecureMode>("auto");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.getSmtp();
      setData(d);
      setHost(d.host ?? "");
      setPort(d.port != null ? String(d.port) : "587");
      setSecure(d.secure ?? "auto");
      setUser(d.user ?? "");
      setFrom(d.from ?? "");
      setPass("");
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

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
        throw new Error("Порт должен быть числом 1..65535");
      }
      await api.admin.putSmtp({
        host: host.trim(),
        port: portNum,
        user: user.trim(),
        from: from.trim(),
        secure,
        pass: pass.length > 0 ? pass : undefined,
      });
      setNotice("Сохранено. Email-клиент пересоздастся при следующей отправке.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Удалить SMTP-настройки из БД? Письма будут отправляться через .env или в stdout."))
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.admin.deleteSmtp();
      setNotice("SMTP-настройки удалены из БД");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <MailPlus size={14} />
          <span className="admin-h3-full">SMTP для писем подтверждения</span>
          <span className="admin-h3-short">SMTP</span>
          <span style={badge}><span className="admin-badge-prefix">источник: </span>{sourceLabel(data?.source ?? null)}</span>
        </h3>
        <button
          type="button"
          className="btn-icon"
          onClick={() => void reload()}
          disabled={loading || busy}
          title="Обновить"
        >
          <RotateCcw size={14} /> Обновить
        </button>
      </div>

      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={okBox}>{notice}</div>}

      <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Приоритет: запись в БД → переменные <code>SMTP_HOST</code>/<code>PORT</code>/
        <code>USER</code>/<code>PASS</code>/<code>FROM</code> → fallback в stdout (dev). Пароль
        никогда не возвращается из API — оставьте поле пустым, чтобы не менять.
      </p>

      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>Host</label>
        <input
          style={inputStyle}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="smtp.example.com"
          disabled={busy}
        />
      </div>
      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>Port</label>
        <input
          style={inputStyle}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder={portPlaceholder(secure)}
          inputMode="numeric"
          disabled={busy}
        />
      </div>
      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>Шифрование</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <select
            style={inputStyle}
            value={secure}
            onChange={(e) => setSecure(e.target.value as SmtpSecureMode)}
            disabled={busy}
          >
            <option value="auto">Авто (по порту)</option>
            <option value="ssl">SSL/TLS (implicit, порт 465)</option>
            <option value="starttls">STARTTLS (порт 587/25)</option>
            <option value="none">Без шифрования (не рекомендуется)</option>
          </select>
          <span className="muted" style={{ fontSize: 11 }}>
            {secureHint(secure, port)}
          </span>
        </div>
      </div>
      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>User</label>
        <input
          style={inputStyle}
          value={user}
          onChange={(e) => {
            const next = e.target.value;
            // Mirror User → From while From is empty or still equals current User
            // (i.e. the user hasn't customized From yet). Stops mirroring as soon
            // as From contains anything different — typical для случая «свой
            // display-name», но 99% провайдеров (Mail.ru/Yandex/Gmail) требуют,
            // чтобы email в From совпадал с User.
            if (!from.trim() || from === user) setFrom(next);
            setUser(next);
          }}
          placeholder="mymail@mail.ru"
          disabled={busy}
          autoComplete="off"
        />
      </div>
      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>
          Password
          {data?.hasPassword && (
            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
              (сохранён)
            </span>
          )}
        </label>
        <input
          style={inputStyle}
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={data?.hasPassword ? "оставьте пустым, чтобы не менять" : "вставьте пароль"}
          disabled={busy}
          autoComplete="new-password"
        />
      </div>
      <div className="admin-fieldrow" style={fieldRow}>
        <label style={labelStyle}>From</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <input
            style={inputStyle}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={user || "mymail@mail.ru"}
            disabled={busy}
          />
          <span className="muted" style={{ fontSize: 11 }}>
            Mail.ru / Яндекс / Gmail отвергают письма, если email в From не
            совпадает с User. Допустимый формат: <code>mymail@mail.ru</code>
            или <code>{"Имя <mymail@mail.ru>"}</code>.
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn-icon"
          onClick={() => void save()}
          disabled={
            busy ||
            !host.trim() ||
            !user.trim() ||
            !from.trim() ||
            (!data?.hasPassword && !pass)
          }
        >
          Сохранить
        </button>
        <button
          type="button"
          className="btn-icon danger"
          onClick={() => void remove()}
          disabled={busy || data?.source !== "db"}
          title={
            data?.source !== "db"
              ? "Удалять нечего — настройки берутся из .env или stdout"
              : "Удалить запись из БД"
          }
        >
          <Trash2 size={14} /> Удалить из БД
        </button>
        {data?.updatedAt && (
          <span className="muted" style={{ fontSize: 12 }}>
            обновлено {new Date(data.updatedAt).toLocaleString()}
          </span>
        )}
      </div>

    </div>
  );
}

function TestSendSection() {
  const [testSubject, setTestSubject] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sendTest = async () => {
    if (!testTo.trim() || !testTo.includes("@")) {
      setError("Укажите валидный email для теста");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.admin.testSmtp(
        testTo.trim(),
        testSubject.trim() || undefined,
      );
      setNotice(`Тестовое письмо отправлено через ${r.source}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Send size={14} /> Тест отправки
        </h3>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={okBox}>{notice}</div>}
      <div className="admin-test-row">
        <div className="admin-fieldrow" style={fieldRow}>
          <label style={labelStyle}>Тест: тема</label>
          <input
            style={inputStyle}
            value={testSubject}
            onChange={(e) => setTestSubject(e.target.value)}
            placeholder="Тест отправки писем — Калькулятор Ozon"
            disabled={busy}
          />
        </div>
        <div className="admin-fieldrow" style={fieldRow}>
          <label style={labelStyle}>Тест: отправить на</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              disabled={busy}
            />
            <button
              type="button"
              className="btn-icon"
              onClick={() => void sendTest()}
              disabled={busy || !testTo.trim()}
            >
              <Send size={14} /> Отправить
            </button>
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Тест использует <strong>текущий эффективный источник</strong>. Сохраните настройки
        перед отправкой, если хотите проверить новые значения.
      </p>
    </div>
  );
}
