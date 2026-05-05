ALTER TABLE `user_settings` ADD `auto_refresh_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_refresh_interval_min` integer DEFAULT 30 NOT NULL;