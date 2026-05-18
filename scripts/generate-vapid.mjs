#!/usr/bin/env node
/**
 * Generate a VAPID keypair for Web Push and print env-var lines you can
 * paste into .env. Run once when bootstrapping the server. Sysadmin can
 * also generate fresh keys later through the admin UI — rotating keys
 * invalidates every existing PushSubscription, so users must re-opt-in.
 *
 *   $ node scripts/generate-vapid.mjs
 *   VAPID_PUBLIC_KEY=BNc…
 *   VAPID_PRIVATE_KEY=g4…
 *   VAPID_SUBJECT=mailto:admin@example.com
 */
import webPush from "web-push";

const { publicKey, privateKey } = webPush.generateVAPIDKeys();

console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:admin@example.com");
console.log("");
console.log(
  "Подставь VAPID_SUBJECT — это mailto: URL, который push-сервис использует, чтобы связаться с тобой при проблемах с доставкой.",
);
