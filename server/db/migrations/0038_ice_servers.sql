-- ICE servers (STUN / TURN) for WebRTC negotiation. Sysadmin-managed
-- through /api/admin/ice; consumed by /api/chat/ice for clients building
-- `new RTCPeerConnection({ iceServers })`. Each row is one server entry;
-- TURN entries supply `username`/`credential`, STUN entries leave them
-- NULL. `enabled` lets sysadmin disable an entry without deleting it.
CREATE TABLE `ice_servers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`urls` text NOT NULL,
	`username` text,
	`credential` text,
	`enabled` integer NOT NULL DEFAULT 1,
	`sort_order` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `ice_servers` (`urls`, `username`, `credential`, `enabled`, `sort_order`, `created_at`, `updated_at`)
VALUES ('stun:stun.l.google.com:19302', NULL, NULL, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
