import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Copy,
  RotateCcw,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";
import { api } from "../../api";
import { Section, StatusPill } from "../atoms";
import { MONO_FONT } from "../utils";

interface Props {
  narrow: boolean;
}

function sourceLabel(s: "db" | "env" | "none"): string {
  if (s === "db") return "БД";
  if (s === "env") return ".env";
  return "не настроено";
}

/** Sysadmin panel for VAPID keys (Web Push server identity). Same pattern
 *  as SmtpSection: показывает текущий источник, позволяет редактировать
 *  или сгенерировать новую пару. private_key с сервера не приходит —
 *  только флажок `hasPrivateKey`. Поле private key в UI пустое; чтобы
 *  оставить старый — нужно сохранить с пустыми обоими полями (тогда DB
 *  не трогается) или сгенерировать заново. */
export default function VapidSection({ narrow }: Props) {
  const [source, setSource] = useState<"db" | "env" | "none">("none");
  const [configured, setConfigured] = useState(false);
  const [hasPrivate, setHasPrivate] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [subject, setSubject] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await api.admin.getVapid();
      setSource(cfg.source);
      setConfigured(cfg.configured);
      setHasPrivate(cfg.hasPrivateKey);
      setPublicKey(cfg.publicKey ?? "");
      setSubject(cfg.subject ?? "mailto:admin@example.com");
      setUpdatedAt(cfg.updatedAt);
      setPrivateKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() sets local state — canonical «sync to external source» case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const keys = await api.admin.generateVapid();
      setPublicKey(keys.publicKey);
      setPrivateKey(keys.privateKey);
      setOkMsg(
        "Новые ключи сгенерированы. Нажмите «Сохранить», чтобы применить — все существующие push-подписки придётся пересоздать.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.admin.putVapid({
        publicKey: publicKey.trim(),
        privateKey: privateKey.trim(),
        subject: subject.trim(),
      });
      setOkMsg("VAPID-ключи сохранены");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Удалить VAPID-ключи из БД? Бэк перейдёт на .env (если есть).")) {
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.admin.deleteVapid();
      setOkMsg("Ключи из БД удалены");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setOkMsg("Скопировано в буфер обмена");
      setTimeout(() => setOkMsg(null), 1500);
    } catch {
      /* clipboard may be denied */
    }
  };

  if (loading) {
    return (
      <Section icon={<Bell size={15} />} title="Push (VAPID)">
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Загрузка…</p>
      </Section>
    );
  }

  return (
    <Section
      icon={<Bell size={15} />}
      title="Push-уведомления (VAPID)"
      headerRight={
        <StatusPill tone={configured ? "ok" : "warn"}>
          {configured ? `источник: ${sourceLabel(source)}` : "не настроено"}
        </StatusPill>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>
          VAPID (Voluntary Application Server Identification) — пара ключей,
          которой сервер подписывает push-сообщения. <b>Публичный ключ</b>{" "}
          раздаётся браузерам пользователей для подписки. <b>Приватный
          ключ</b> хранится только на сервере. Меняйте только когда нужна
          ротация — все существующие подписки станут невалидными.
          {updatedAt && (
            <>
              {" "}
              <span style={{ color: "var(--muted-2)" }}>
                Обновлено: {new Date(updatedAt).toLocaleString("ru-RU")}
              </span>
            </>
          )}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: narrow ? "1fr" : "1fr 1fr",
            gap: 10,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              Subject (mailto: или https://)
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="mailto:admin@example.com"
              disabled={busy}
              style={{ fontFamily: MONO_FONT, fontSize: 12.5 }}
            />
          </label>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Public key (base64-url)
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              disabled={busy}
              style={{
                flex: 1,
                fontFamily: MONO_FONT,
                fontSize: 12,
                minWidth: 0,
              }}
            />
            {publicKey && (
              <button
                type="button"
                onClick={() => void copy(publicKey)}
                disabled={busy}
                title="Скопировать"
                style={{ padding: "0 10px" }}
              >
                <Copy size={13} />
              </button>
            )}
          </div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Private key (base64-url) — оставьте пустым, чтобы не менять
            {hasPrivate && !privateKey && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  color: "var(--success, #16a34a)",
                }}
              >
                ✓ ключ хранится в {sourceLabel(source)}
              </span>
            )}
          </span>
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder={hasPrivate ? "оставьте пустым, чтобы сохранить текущий" : ""}
            disabled={busy}
            style={{ fontFamily: MONO_FONT, fontSize: 12 }}
          />
        </label>

        {error && (
          <div
            style={{
              padding: "8px 10px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}
        {okMsg && !error && (
          <div
            style={{
              padding: "8px 10px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              color: "#15803d",
              fontSize: 12.5,
            }}
          >
            {okMsg}
          </div>
        )}

        <footer style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Wand2 size={13} />
            Сгенерировать новую пару
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            disabled={
              busy ||
              !publicKey.trim() ||
              !subject.trim() ||
              // When updating without changing key — server requires private
              // key in payload. Hint user.
              (!hasPrivate && !privateKey.trim())
            }
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Save size={13} />
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RotateCcw size={13} />
            Перечитать
          </button>
          {source === "db" && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: "auto",
                color: "var(--danger, #c33)",
              }}
            >
              <Trash2 size={13} />
              Удалить из БД
            </button>
          )}
        </footer>
      </div>
    </Section>
  );
}
