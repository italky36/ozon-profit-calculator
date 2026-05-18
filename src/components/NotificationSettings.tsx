import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2 } from "lucide-react";
import {
  getNotificationPermission,
  isPushSubscribed,
  isPushSupported,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "../lib/pushSubscription";

/** Inline panel that shows / manages this device's web-push opt-in. Pure
 * client-side state — derived from `navigator.serviceWorker` +
 * `Notification.permission` + `pushManager.getSubscription()`. We don't
 * persist the toggle separately on the server: the presence of a
 * subscription row IS the persistence.
 *
 * Hidden entirely on browsers that lack `'PushManager' in window`. */
export default function NotificationSettings() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sup = isPushSupported();
      if (cancelled) return;
      setSupported(sup);
      if (!sup) return;
      setPermission(getNotificationPermission());
      const sub = await isPushSubscribed();
      if (cancelled) return;
      setSubscribed(sub);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!supported) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: "var(--bg-soft, #f7f7f7)",
          fontSize: 13,
          color: "var(--muted, #666)",
        }}
      >
        Этот браузер не поддерживает push-уведомления.
      </div>
    );
  }

  const onToggle = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
        setInfo("Push-уведомления отключены");
      } else {
        await subscribeToPush();
        setSubscribed(true);
        setPermission("granted");
        setInfo(
          "Push-уведомления включены. Нажмите «Отправить тестовый», чтобы проверить.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await sendTestPush();
      setInfo("Тестовое уведомление отправлено — оно должно появиться сейчас.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: "var(--bg-soft, #f7f7f7)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 16,
            background: subscribed ? "var(--accent-soft, #eef)" : "var(--bg, #fff)",
            color: subscribed ? "var(--accent)" : "var(--muted, #888)",
          }}
        >
          {subscribed ? <Bell size={18} /> : <BellOff size={18} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            Push-уведомления о упоминаниях и DM
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #666)" }}>
            {subscribed
              ? "На этом устройстве включены."
              : permission === "denied"
                ? "Разрешение отозвано в настройках браузера — снимите блокировку, чтобы включить."
                : "Получайте уведомления, даже когда вкладка свёрнута."}
          </div>
        </div>
        <button
          type="button"
          className={subscribed ? "" : "btn-primary"}
          onClick={() => void onToggle()}
          disabled={busy || permission === "denied"}
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          {subscribed ? "Выключить" : "Включить"}
        </button>
      </div>
      {subscribed && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => void onTest()}
            disabled={busy}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckCircle2 size={12} />
            Отправить тестовое
          </button>
        </div>
      )}
      {error && (
        <div style={{ color: "var(--danger, #c33)", fontSize: 12 }}>{error}</div>
      )}
      {info && !error && (
        <div style={{ color: "var(--muted, #666)", fontSize: 12 }}>{info}</div>
      )}
    </div>
  );
}
