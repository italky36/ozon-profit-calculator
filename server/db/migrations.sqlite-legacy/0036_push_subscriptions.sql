-- Web Push (RFC 8030) per-device subscriptions. One row per browser
-- session that opted in: `endpoint` is the push service URL the browser
-- gives us (UNIQUE), `p256dh_key` + `auth_key` are the encryption
-- material from PushSubscription.getKey(). On HTTP 410 Gone we delete the
-- row — the subscription has expired or the user revoked it.
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh_key` text NOT NULL,
	`auth_key` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint` ON `push_subscriptions` (`endpoint`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user` ON `push_subscriptions` (`user_id`);
--> statement-breakpoint

-- VAPID server identity for the sender. Single-row table (id=1) edited
-- through sysadmin UI; falls back to env (VAPID_PUBLIC_KEY etc) when
-- the row is empty. `subject` is a mailto: URL the push service uses to
-- contact us about deliverability issues — required by spec.
CREATE TABLE `vapid_settings` (
	`id` integer PRIMARY KEY DEFAULT 1,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`subject` text NOT NULL,
	`updated_at` integer NOT NULL
);
