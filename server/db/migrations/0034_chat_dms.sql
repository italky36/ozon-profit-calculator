-- DMs are stored in the same chat_channels table as regular channels,
-- discriminated by `type` ∈ ('channel', 'dm'). For type='channel'
-- visibility = workspace membership (current behaviour). For type='dm'
-- visibility = a row in chat_channel_members for (channel, user). Author
-- (created_by) is ignored for DM auth — both participants are equal.
ALTER TABLE `chat_channels` ADD COLUMN `type` TEXT NOT NULL DEFAULT 'channel';
--> statement-breakpoint
CREATE INDEX `chat_channels_type` ON `chat_channels` (`type`);
--> statement-breakpoint

-- Membership table — used only for type='dm' rows. Regular channels rely
-- on workspace_members for visibility, so no rows here for them.
CREATE TABLE `chat_channel_members` (
	`channel_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_channel_members_user` ON `chat_channel_members` (`user_id`);
