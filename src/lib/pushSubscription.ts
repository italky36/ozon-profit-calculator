/** Client-side helpers for Web Push opt-in.
 *
 * Flow when the user toggles «включить push»:
 *   1. Check browser support (`'serviceWorker' in navigator && 'PushManager' in window`).
 *   2. Request Notification permission.
 *   3. Register /sw.js (idempotent — getRegistration is preferred).
 *   4. GET /api/push/public-key — VAPID public from server.
 *   5. pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).
 *   6. POST the resulting subscription to /api/push/subscriptions.
 *
 * Disabling: pushManager.getSubscription() → unsubscribe() → DELETE.
 *
 * All functions are no-ops on browsers that lack support — UI gates them
 * with `isPushSupported()` before exposing the toggle. */

const SW_URL = "/sw.js";
const SW_SCOPE = "/";

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Idempotent SW registration. Returns the registration on success, null on
 *  unsupported / failed. SW updates on every page load via the browser's
 *  built-in 24h max-age check. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch {
    return null;
  }
}

/** True if the user already opted in on this device — checks for an
 *  active push subscription (NOT just notification permission). */
export async function isPushSubscribed(): Promise<boolean> {
  const reg = await ensureServiceWorker();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return sub != null;
}

/** Full opt-in flow. Returns true on success, throws on failure with a
 *  human-readable Russian message. UI should catch and toast. */
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Браузер не поддерживает push-уведомления");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Разрешение на уведомления отозвано — включите в настройках браузера"
        : "Разрешение не выдано",
    );
  }
  const reg = await ensureServiceWorker();
  if (!reg) throw new Error("Не удалось зарегистрировать service worker");

  // Fetch VAPID public key.
  const keyRes = await fetch("/api/push/public-key", {
    credentials: "include",
  });
  if (!keyRes.ok) {
    throw new Error("Не удалось получить ключ push-сервера");
  }
  const { publicKey, configured } = (await keyRes.json()) as {
    publicKey: string | null;
    configured: boolean;
  };
  if (!configured || !publicKey) {
    throw new Error("Push-уведомления не настроены администратором");
  }

  // Subscribe — userVisibleOnly is required by browsers, the alternative
  // (silent push) requires a different permission flow we don't use.
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // `Uint8Array` is the standard type per the Push API spec; the strict
      // TS DOM lib widened BufferSource to exclude SharedArrayBuffer so we
      // explicitly cast the underlying ArrayBuffer to satisfy the typings.
      applicationServerKey: urlBase64ToUint8Array(publicKey)
        .buffer as ArrayBuffer,
    });
  } catch (e) {
    throw new Error(
      "Не удалось подписаться на push: " + (e as Error).message,
      { cause: e },
    );
  }

  const p256dh = arrayBufferToBase64(sub.getKey("p256dh"));
  const auth = arrayBufferToBase64(sub.getKey("auth"));
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh, auth },
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    // Roll back the browser-side subscription so we don't accumulate
    // orphans on the push service if our server later refuses again.
    await sub.unsubscribe().catch(() => {});
    throw new Error("Сервер отказался сохранить подписку");
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await ensureServiceWorker();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/** Trigger a self-test push from the server — useful for the «попробовать»
 *  button after opt-in. */
export async function sendTestPush(): Promise<void> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
}

// ─── base64-url ↔ Uint8Array helpers (mirror sw.js) ─────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
