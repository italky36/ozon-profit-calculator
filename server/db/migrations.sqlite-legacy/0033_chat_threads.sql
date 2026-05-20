-- Threads: parent_message_id is nullable; root messages have NULL.
-- One-level only — server validates that parent itself has parent_message_id
-- IS NULL (Slack-style flat threads, no nested replies).
-- ON DELETE CASCADE: hard-deleting the root takes the whole thread with it.
-- Soft-delete (deletedAt) keeps the row, so replies still render.
ALTER TABLE `chat_messages` ADD COLUMN `parent_message_id` integer
	REFERENCES `chat_messages`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `chat_messages_parent` ON `chat_messages` (`parent_message_id`);
