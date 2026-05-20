ALTER TABLE `users` ADD `full_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `users` ADD `job_title` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_data_url` text;
--> statement-breakpoint
UPDATE `users`
SET `full_name` = upper(substr(`email`, 1, 1)) || substr(`email`, 2, instr(`email`, '@') - 2)
WHERE `full_name` = '';
