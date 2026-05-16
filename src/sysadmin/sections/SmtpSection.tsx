import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  History,
  Info,
  Link2,
  Mail,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { api, type AdminSmtpSettings, type SmtpSecureMode } from "../../api";
import { CheckOk, Section, StatusPill } from "../atoms";
import { MONO_FONT } from "../utils";

interface Props {
  narrow: boolean;
}

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
  if (mode === "ssl")
    return "Implicit TLS с момента подключения (обычно порт 465).";
  if (mode === "starttls")
    return "Plain-соединение апгрейдится до TLS командой STARTTLS (обычно 587).";
  if (mode === "none")
    return "Без шифрования. Используй только во внутренней сети.";
  if (!Number.isFinite(p))
    return "Авто: SSL/TLS при 465, иначе STARTTLS/plain (определит nodemailer).";
  return p === 465
    ? "Авто → SSL/TLS (порт 465)."
    : "Авто → STARTTLS / plain (nodemailer апгрейдится, если сервер поддерживает).";
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
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

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  fontSize: 13,
  color: "#0f172a",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

export default function SmtpSection({ narrow }: Props) {
  const [data, setData] = useState<AdminSmtpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState<SmtpSecureMode>("auto");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [showPwd, setShowPwd] = useState(false);
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

  if (loading && !data) {
    return (
      <p className="muted" style={{ padding: 18 }}>
        Загрузка…
      </p>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,1fr) 380px",
        gap: 16,
        alignItems: "start",
      }}
    >
      <Section
        icon={<Mail size={16} style={{ color: "var(--muted)" }} />}
        title="SMTP для писем подтверждения"
        headerRight={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 9px",
              borderRadius: 999,
              background: "#eff6ff",
              color: "#1d4ed8",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            <Info size={11} />
            источник: {sourceLabel(data?.source ?? null)}
          </span>
        }
        action={
          !narrow && (
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading || busy}
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
        <div
          style={{
            padding: narrow ? "12px 14px" : "14px 18px",
            background: "#f8fafc",
            borderBottom: "1px solid var(--border-soft)",
            fontSize: 12.5,
            color: "var(--muted)",
          }}
        >
          <strong style={{ color: "#1e293b", fontWeight: 600 }}>
            Приоритет:
          </strong>{" "}
          запись в БД → переменные{" "}
          <code
            style={{
              fontFamily: MONO_FONT,
              fontSize: 11.5,
              background: "#fff",
              padding: "1px 5px",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
          >
            SMTP_HOST/PORT/USER/PASS/FROM
          </code>{" "}
          → fallback в stdout (dev). Пароль никогда не возвращается из API —
          оставьте поле пустым, чтобы не менять.
        </div>

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

        <div
          style={{
            padding: narrow ? "16px 14px" : "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: narrow ? 12 : 14,
          }}
        >
          <Field narrow={narrow} label="Host">
            <input
              style={INPUT_STYLE}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
              disabled={busy}
            />
          </Field>
          <Field narrow={narrow} label="Port">
            <input
              style={{ ...INPUT_STYLE, width: 160 }}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={portPlaceholder(secure)}
              inputMode="numeric"
              disabled={busy}
            />
          </Field>
          <Field narrow={narrow} label="Шифрование" hint={secureHint(secure, port)}>
            <select
              style={INPUT_STYLE}
              value={secure}
              onChange={(e) => setSecure(e.target.value as SmtpSecureMode)}
              disabled={busy}
            >
              <option value="auto">Авто (по порту)</option>
              <option value="ssl">SSL/TLS (implicit, порт 465)</option>
              <option value="starttls">STARTTLS (порт 587/25)</option>
              <option value="none">Без шифрования (только dev)</option>
            </select>
          </Field>
          <Field narrow={narrow} label="User">
            <input
              style={INPUT_STYLE}
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
          </Field>
          <Field narrow={narrow} label="Password">
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                style={INPUT_STYLE}
                type={showPwd ? "text" : "password"}
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
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                title={showPwd ? "Скрыть" : "Показать"}
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 28,
                  height: 28,
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--muted)",
                  borderRadius: 5,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {data?.hasPassword && (
              <div
                style={{
                  marginTop: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  color: "#047857",
                }}
              >
                <CheckOk />
                Пароль сохранён в БД
              </div>
            )}
          </Field>
          <Field
            narrow={narrow}
            label="From"
            hint="Mail.ru / Яндекс / Gmail отвергают письма, если email в From не совпадает с User."
          >
            <input
              style={INPUT_STYLE}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={user || "mymail@mail.ru"}
              disabled={busy}
            />
          </Field>
        </div>

        <div
          style={{
            padding: narrow ? "12px 14px" : "14px 22px",
            borderTop: "1px solid var(--border-soft)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "#f8fafc",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            disabled={
              busy ||
              !host.trim() ||
              !user.trim() ||
              !from.trim() ||
              (!data?.hasPassword && !pass)
            }
            style={{
              height: 36,
              padding: "0 14px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
            }}
          >
            <Save size={14} />
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy || data?.source !== "db"}
            title={
              data?.source !== "db"
                ? "Удалять нечего — настройки берутся из .env или stdout"
                : "Удалить запись из БД"
            }
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 8,
              border: "1px solid #fecaca",
              background: "#fff",
              color: "#b91c1c",
              cursor: busy || data?.source !== "db" ? "not-allowed" : "pointer",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "inherit",
              opacity: busy || data?.source !== "db" ? 0.5 : 1,
            }}
          >
            <Trash2 size={14} />
            {narrow ? "Удалить" : "Удалить из БД"}
          </button>
          <div
            style={{
              marginLeft: narrow ? 0 : "auto",
              width: narrow ? "100%" : "auto",
              fontSize: 12,
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <History size={13} />
            обновлено {fmtDateTime(data?.updatedAt)}
          </div>
        </div>
      </Section>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          position: narrow ? "static" : "sticky",
          top: 84,
        }}
      >
        <Section
          icon={<Info size={16} style={{ color: "var(--muted)" }} />}
          title="Эффективный источник"
        >
          <div
            style={{
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {data?.source === "console" ? (
                <StatusPill tone="warn">stdout (dev)</StatusPill>
              ) : (
                <StatusPill tone="ok" icon={<CheckOk />}>
                  Подключено
                </StatusPill>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {data?.source === "db"
                  ? "через запись в БД"
                  : data?.source === "env"
                    ? "через переменные .env"
                    : "SMTP не настроен — письма пишутся в stdout сервера"}
              </span>
            </div>
            <KV k="Host" v={data?.host ?? "—"} />
            <KV k="Port" v={data?.port != null ? String(data.port) : "—"} />
            <KV k="From" v={data?.from ?? "—"} />
          </div>
        </Section>

        <TestSendCard />
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  narrow,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  narrow: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: narrow ? "1fr" : "130px 1fr",
        gap: narrow ? 6 : 14,
        alignItems: "start",
      }}
    >
      <label
        style={{
          fontSize: 12.5,
          color: "var(--muted)",
          fontWeight: 500,
          paddingTop: narrow ? 0 : 10,
        }}
      >
        {label}
      </label>
      <div style={{ minWidth: 0 }}>
        {children}
        {hint && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ color: "var(--muted)", width: 50, fontSize: 12 }}>{k}</span>
      <span
        style={{
          fontFamily: MONO_FONT,
          fontSize: 12.5,
          color: "#0f172a",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function TestSendCard() {
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
    <Section
      icon={<Link2 size={16} style={{ color: "var(--muted)" }} />}
      title="Тест отправки"
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
            fontSize: 12.5,
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
            fontSize: 12.5,
          }}
        >
          {notice}
        </div>
      )}
      <div
        style={{
          padding: "18px 18px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <label
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Тема
          </label>
          <input
            style={INPUT_STYLE}
            value={testSubject}
            onChange={(e) => setTestSubject(e.target.value)}
            placeholder="Тест отправки писем — Калькулятор"
            disabled={busy}
          />
        </div>
        <div>
          <label
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Кому
          </label>
          <input
            style={INPUT_STYLE}
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </div>
      </div>
      <div
        style={{
          padding: "12px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <button
          type="button"
          className="btn-primary"
          onClick={() => void sendTest()}
          disabled={busy || !testTo.trim()}
          style={{
            width: "100%",
            height: 38,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 13,
          }}
        >
          <Send size={14} />
          Отправить тест
        </button>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            lineHeight: 1.45,
          }}
        >
          Использует <strong style={{ color: "#1e293b", fontWeight: 600 }}>
            текущий эффективный источник
          </strong>. Сохраните настройки перед отправкой, если хотите проверить
          новые значения.
        </div>
      </div>
    </Section>
  );
}
