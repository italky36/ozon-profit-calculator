-- Stage 5 — WebRTC voice/video calls.
-- chat_calls: one row per call (DM or group). `channel_id` ties it to a
-- chat channel (DM has 2 participants, regular channel could have N≤5 for
-- mesh topology). `end_reason` distinguishes outcomes for history/system
-- messages: 'completed' (hangup after talk), 'declined', 'missed' (timed
-- out / nobody picked up), 'failed' (network / ICE error).
CREATE TABLE `chat_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`initiator_user_id` integer,
	`call_type` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_calls_channel` ON `chat_calls` (`channel_id`);
--> statement-breakpoint

-- Per-user state in a call: who joined, when they left. Active (non-ended)
-- participants are rows with `left_at IS NULL`. PK keeps it idempotent —
-- joining twice (e.g., reconnect) just upserts joined_at.
CREATE TABLE `chat_call_participants` (
	`call_id` integer NOT NULL,
	`user_id` integer,
	`joined_at` integer,
	`left_at` integer,
	PRIMARY KEY (`call_id`, `user_id`),
	FOREIGN KEY (`call_id`) REFERENCES `chat_calls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
