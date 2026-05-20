-- Private channels: a regular workspace channel (type='channel') with
-- explicit membership. Visibility = a row in chat_channel_members for the
-- viewer; only the creator + workspace owner/manager can edit the roster.
-- Open channels (is_private=0) preserve the existing «visible to all
-- workspace members» behaviour — no membership rows needed.
ALTER TABLE `chat_channels` ADD COLUMN `is_private` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `chat_channels_private` ON `chat_channels` (`is_private`);
