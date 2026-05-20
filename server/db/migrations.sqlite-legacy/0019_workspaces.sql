-- Stage 1 of SaaS migration: workspaces + members + invites.
-- Additive only — old tables (shop_access, shop_user_settings) and
-- columns (users.role) stay until Stage 2, which switches routes over
-- to workspace_id scoping atomically and then drops the legacy.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. workspaces — tenant container ("команда" в UI). slug для будущих
-- публичных URL; verified_domain отложен до v2.
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);
--> statement-breakpoint

-- 2. workspace_members. role ∈ {owner, manager, member}.
-- UNIQUE on user_id enforces «один user = один workspace» — снимем при
-- появлении multi-workspace UX (тогда дропнем индекс).
CREATE TABLE `workspace_members` (
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_user_unique` ON `workspace_members` (`user_id`);
--> statement-breakpoint

-- 3. workspace_invites. Token-based, паттерн как у email_verification_tokens.
CREATE TABLE `workspace_invites` (
	`token` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 4. is_sysadmin flag on users. Backfill: existing role='admin' → is_sysadmin=1.
-- users.role остаётся пока (Stage 2 дропнет, когда роуты перестанут его читать).
ALTER TABLE `users` ADD COLUMN `is_sysadmin` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `is_sysadmin` = 1 WHERE `role` = 'admin';
--> statement-breakpoint

-- 5. Personal workspace per existing user.
-- name = «Workspace {email-prefix}», slug = lower(prefix without dots) + '-' + user.id
-- (id-suffix гарантирует уникальность без collision-логики).
INSERT INTO `workspaces` (`name`, `slug`, `created_at`, `updated_at`)
SELECT
	'Workspace ' || substr(email, 1, instr(email, '@') - 1),
	lower(replace(substr(email, 1, instr(email, '@') - 1), '.', '-')) || '-' || id,
	(unixepoch() * 1000),
	(unixepoch() * 1000)
FROM `users`;
--> statement-breakpoint

INSERT INTO `workspace_members` (`workspace_id`, `user_id`, `role`, `status`, `created_at`)
SELECT
	w.id,
	u.id,
	'owner',
	'active',
	(unixepoch() * 1000)
FROM `users` u
JOIN `workspaces` w
	ON w.slug = lower(replace(substr(u.email, 1, instr(u.email, '@') - 1), '.', '-')) || '-' || u.id;
--> statement-breakpoint

-- 6. workspace_id columns on scoped tables. Nullable initially — Stage 2
-- enforces NOT NULL after routes start writing it on every insert.
ALTER TABLE `shops` ADD COLUMN `workspace_id` integer REFERENCES `workspaces`(`id`);
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `workspace_id` integer REFERENCES `workspaces`(`id`);
--> statement-breakpoint
ALTER TABLE `finance_transactions` ADD COLUMN `workspace_id` integer REFERENCES `workspaces`(`id`);
--> statement-breakpoint
ALTER TABLE `import_runs` ADD COLUMN `workspace_id` integer REFERENCES `workspaces`(`id`);
--> statement-breakpoint
ALTER TABLE `logistics_cluster_tariff_sets` ADD COLUMN `workspace_id` integer REFERENCES `workspaces`(`id`);
--> statement-breakpoint

-- 7. Backfill workspace_id from user_id (via workspace_members).
-- Tariff sets: глобальные (shop_id IS NULL) — workspace_id остаётся NULL;
-- персональные — берут workspace_id своего shop'а.
UPDATE `shops` SET `workspace_id` = (
	SELECT `workspace_id` FROM `workspace_members` WHERE `user_id` = `shops`.`user_id`
);
--> statement-breakpoint
UPDATE `products` SET `workspace_id` = (
	SELECT `workspace_id` FROM `workspace_members` WHERE `user_id` = `products`.`user_id`
);
--> statement-breakpoint
UPDATE `finance_transactions` SET `workspace_id` = (
	SELECT `workspace_id` FROM `workspace_members` WHERE `user_id` = `finance_transactions`.`user_id`
);
--> statement-breakpoint
UPDATE `import_runs` SET `workspace_id` = (
	SELECT `workspace_id` FROM `workspace_members` WHERE `user_id` = `import_runs`.`user_id`
);
--> statement-breakpoint
UPDATE `logistics_cluster_tariff_sets` SET `workspace_id` = (
	SELECT `workspace_id` FROM `shops` WHERE `id` = `logistics_cluster_tariff_sets`.`shop_id`
) WHERE `shop_id` IS NOT NULL;
--> statement-breakpoint

PRAGMA foreign_keys=ON;
