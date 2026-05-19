-- Inline quote / reply-with-preview (Telegram/WhatsApp style). Distinct
-- from `parent_message_id` (which drives Slack-style threads / ThreadPanel):
-- a quoted reply stays in the main channel feed and renders the parent body
-- as a small banner above its own body.
--
-- ON DELETE SET NULL — when the quoted message is hard-deleted (rare; soft
-- delete is the norm), the quoting message survives but loses the link.
-- Soft-delete (deletedAt) on the quoted message is preserved through the
-- FK; UI renders «сообщение удалено» in that case.
ALTER TABLE `chat_messages` ADD COLUMN `quoted_message_id` integer
  REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `chat_messages_quoted_id` ON `chat_messages` (`quoted_message_id`);
