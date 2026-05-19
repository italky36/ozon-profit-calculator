import { useEffect, useState } from "react";
import { X } from "lucide-react";

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
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 720,
        margin: "0 auto",
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        zIndex: 1100,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", marginBottom: 2 }}>
          Этот сайт использует cookies
        </strong>
        <span style={{ color: "var(--muted, #555)" }}>
          Мы храним cookie-сессию для авторизации и небольшие настройки
          интерфейса в localStorage вашего браузера. Без них приложение
          не сможет запомнить вас между визитами и сохранить пользовательские
          предпочтения. Продолжая работу, вы соглашаетесь с этим.
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="btn-primary"
        style={{
          padding: "6px 14px",
          fontSize: 13,
          flexShrink: 0,
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
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
