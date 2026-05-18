/* Service Worker for Web Push notifications.
 *
 * Responsibilities:
 *   - Receive `push` events from the browser, decode the JSON payload our
 *     server sent, and show a system notification via showNotification().
 *   - Handle `notificationclick`: focus an existing tab on the right URL
 *     when possible, otherwise open a new one.
 *   - Handle `pushsubscriptionchange`: when the browser rotates a
 *     subscription endpoint, re-subscribe and POST the new one to /api/push
 *     so the server stays in sync (best-effort; user must be signed in
 *     for the POST to succeed).
 *
 * No build step — this file is served as-is from /public. Keep it ES2017
 * to match browser support floor of the rest of the app. */

self.addEventListener("install", (event) => {
  // Activate immediately so push subscription works without a reload after
  // the user opts in.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Уведомление", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON payload — keep defaults but show the raw text in body.
    try {
      payload.body = event.data.text();
    } catch {
      /* nothing more we can do */
    }
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/favicon.svg",
    badge: payload.badge || "/favicon.svg",
    tag: payload.tag,
    data: { url: payload.url, ...(payload.data || {}) },
    // Re-fire vibration on replacement notifications too.
    renotify: Boolean(payload.tag),
    // Stack within OS notification center until user dismisses — better
    // than the default short-display behavior on some Android builds.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(focusOrOpen(targetUrl));
});

async function focusOrOpen(url) {
  const allClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  // Prefer an existing tab on the same origin — focus it and ask it to
  // navigate to the deep link via postMessage so the SPA can route
  // without a full reload.
  for (const client of allClients) {
    const sameOrigin = new URL(client.url).origin === new URL(url, self.location.origin).origin;
    if (sameOrigin) {
      try {
        client.postMessage({ type: "notification.click", url });
        return client.focus();
      } catch {
        /* fall through to plain open */
      }
    }
  }
  return self.clients.openWindow(url);
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribeAndSync());
});

async function resubscribeAndSync() {
  try {
    // We need the VAPID public key to resubscribe — fetch from our API.
    const res = await fetch("/api/push/public-key", { credentials: "include" });
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (!publicKey) return;
    const newSub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        endpoint: newSub.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(newSub.getKey("p256dh")),
          auth: arrayBufferToBase64(newSub.getKey("auth")),
        },
      }),
    });
  } catch {
    /* best-effort — user will lose push until next opt-in */
  }
}

/** Convert base64-url string (VAPID public key format) to Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
