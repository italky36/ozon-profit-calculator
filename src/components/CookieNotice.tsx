import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useMediaQuery } from "../lib/useMediaQuery";

/** Persisted flag — once the user dismisses the notice, we don't show it
 *  again on this browser. The check runs entirely client-side; no server
 *  round-trip. */
const ACK_KEY = "ozon-calc.cookies-ack";

/** Informational cookie / data-storage notice. Shown at the bottom of the
 *  viewport until the user clicks «Понятно». Single «soft» acknowledgement
 *  rather than a multi-category consent dialog — the app only uses
 *  essential cookies (the auth session + UI tweaks in localStorage), which
 *  Russian law and GDPR both treat as «strictly necessary» and do not
 *  require granular opt-in for. The notice is purely informational so
 *  users know what's stored on their device. */
export default function CookieNotice() {
  const narrow = useMediaQuery("(max-width: 560px)");
  // Lazy-init the visibility flag from localStorage so we never flash the
  // banner for returning users on first render.
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ACK_KEY) !== "1";
    } catch {
      // localStorage can throw in private-mode Safari; default to showing
      // the notice — same as a fresh visitor.
      return true;
    }
  });
  const [expanded, setExpanded] = useState(false);

  // Cross-tab sync: if the user dismisses in another tab, mirror the
  // change here so the banner doesn't linger.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACK_KEY && e.newValue === "1") setVisible(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* swallow — banner closes either way */
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Использование cookies"
      style={{
        position: "fixed",
        bottom: narrow ? 12 : 16,
        left: narrow ? 12 : 16,
        right: narrow ? 12 : 16,
        maxWidth: 720,
        margin: "0 auto",
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        padding: narrow ? "12px 14px" : "14px 18px",
        display: "flex",
        flexDirection: narrow ? "column" : "row",
        alignItems: narrow ? "stretch" : "center",
        gap: narrow ? 10 : 14,
        zIndex: 1100,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <strong>Cookies</strong>
          <span style={{ color: "var(--muted, #555)" }}>
            используем для авторизации и UI-настроек.
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--accent, #2563eb)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            {expanded ? "Свернуть" : "Подробнее"}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
        {expanded && (
          <div
            style={{
              marginTop: 8,
              color: "var(--muted, #555)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Сессионная cookie держит вход, без неё придётся логиниться на каждой
            странице. В <code>localStorage</code> сохраняются UI-настройки (цвет
            акцента, последний выбранный магазин, видимые колонки таблицы) —
            ничего из этого не покидает ваш браузер. Сторонних трекеров и
            рекламных cookies в приложении нет.
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          justifyContent: narrow ? "flex-end" : "flex-start",
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          className="btn-primary"
          style={{
            padding: "6px 14px",
            fontSize: 13,
          }}
        >
          Понятно
        </button>
        <button
          type="button"
          onClick={dismiss}
          title="Закрыть"
          aria-label="Закрыть"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--muted, #888)",
            padding: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
