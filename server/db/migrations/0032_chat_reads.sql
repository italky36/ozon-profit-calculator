-- Per-user, per-channel read pointer. Stores the id of the latest message
-- the user has acknowledged seeing; UI shows unread = `count(messages where
-- id > last_read_message_id AND author != currentUser)`.
-- last_read_message_id is nullable (no FK enforcement, ON DELETE SET NULL
-- semantics via app logic) so that hard-deleting a message later doesn't
-- cascade-zero a user's read pointer.
CREATE TABLE `chat_channel_reads` (
	`channel_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`last_read_message_id` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_read_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_channel_reads_user` ON `chat_channel_reads` (`user_id`);
