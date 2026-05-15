import { useCallback, useEffect, useState } from "react";
import { MailPlus, RotateCcw, Trash2 } from "lucide-react";
import { api, type AdminSmtpSettings, type SmtpSecureMode } from "../../api";
import {
  badge,
  errBox,
  fieldRow,
  inputStyle,
  labelStyle,
  okBox,
} from "./styles";

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

export default function SmtpSection() {
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
    if (
      !confirm(
        "Удалить SMTP-настройки из БД? Письма будут отправляться через .env или в stdout.",
      )
    )
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
          <span>SMTP для писем подтверждения</span>
          <span style={badge}>источник: {sourceLabel(data?.source ?? null)}</span>
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
        Приоритет: запись в БД → переменные <code>SMTP_HOST</code>/
        <code>PORT</code>/<code>USER</code>/<code>PASS</code>/<code>FROM</code> →
        fallback в stdout (dev). Пароль никогда не возвращается из API —
        оставьте поле пустым, чтобы не менять.
      </p>

      <div style={fieldRow}>
        <label style={labelStyle}>Host</label>
        <input
          style={inputStyle}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="smtp.example.com"
          disabled={busy}
        />
      </div>
      <div style={fieldRow}>
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
      <div style={fieldRow}>
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
      <div style={fieldRow}>
        <label style={labelStyle}>User</label>
        <input
          style={inputStyle}
          value={user}
          onChange={(e) => {
            const next = e.target.value;
            if (!from.trim() || from === user) setFrom(next);
            setUser(next);
          }}
          placeholder="mymail@mail.ru"
          disabled={busy}
          autoComplete="off"
        />
      </div>
      <div style={fieldRow}>
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
          placeholder={
            data?.hasPassword
              ? "оставьте пустым, чтобы не менять"
              : "вставьте пароль"
          }
          disabled={busy}
          autoComplete="new-password"
        />
      </div>
      <div style={fieldRow}>
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
            совпадает с User.
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
