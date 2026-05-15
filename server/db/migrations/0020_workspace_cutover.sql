-- Stage 2 of SaaS migration: bring backend onto pure workspace_id scoping.
-- Drops the user-scoped legacy that 0017_shared_shops added (per-user products/
-- finance/import_runs and the shop_access / shop_user_settings sharing tables)
-- and the legacy `users.role` column. Workspace membership (`workspace_members`)
-- + `users.is_sysadmin` together replace both.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. Drop sharing tables. shop_user_settings rows are discarded — Stage 1
-- agreement is to restart sharing via invites; existing per-user overrides
-- would have no meaningful destination once everyone in a workspace shares
-- one shop config.
DROP TABLE `shop_user_settings`;--> statement-breakpoint
DROP TABLE `shop_access`;--> statement-breakpoint

-- 2. Rebuild shops: drop user_id, make workspace_id NOT NULL, replace
-- per-user shortName uniqueness with per-workspace uniqueness.
DROP INDEX `shops_user_short_unique`;--> statement-breakpoint
CREATE TABLE `__new_shops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`color` text,
	`tax_settings` text NOT NULL,
	`auto_refresh_enabled` integer DEFAULT 0 NOT NULL,
	`auto_refresh_interval_min` integer DEFAULT 30 NOT NULL,
	`ozon_client_id` text,
	`ozon_api_key` text,
	`ozon_updated_at` integer,
	`tariff_set_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_shops`(
	"id", "workspace_id", "name", "short_name", "color", "tax_settings",
	"auto_refresh_enabled", "auto_refresh_interval_min",
	"ozon_client_id", "ozon_api_key", "ozon_updated_at", "tariff_set_id",
	"created_at", "updated_at"
)
SELECT
	"id", "workspace_id", "name", "short_name", "color", "tax_settings",
	"auto_refresh_enabled", "auto_refresh_interval_min",
	"ozon_client_id", "ozon_api_key", "ozon_updated_at", "tariff_set_id",
	"created_at", "updated_at"
FROM `shops`
WHERE `workspace_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `shops`;--> statement-breakpoint
ALTER TABLE `__new_shops` RENAME TO `shops`;--> statement-breakpoint
CREATE UNIQUE INDEX `shops_workspace_short_unique` ON `shops` (`workspace_id`,`short_name`);--> statement-breakpoint

-- 3. Rebuild products: drop user_id, NOT NULL workspace_id, UNIQUE(shop_id, article_id).
-- Same article can still live in two different shops of one workspace (typical
-- multi-shop workflow: same SKU stocked under FBO Main + FBS Backup).
DROP INDEX `products_shop_user_article_unique`;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`article_id` text NOT NULL,
	`product_name` text NOT NULL,
	`category` text NOT NULL,
	`product_type` text NOT NULL,
	`is_kgt` integer DEFAULT false NOT NULL,
	`is_kazakhstan` integer DEFAULT false NOT NULL,
	`is_fire_hazard` integer DEFAULT false NOT NULL,
	`planned_storage_days` integer NOT NULL,
	`volume_l` real NOT NULL,
	`depth_mm` real,
	`width_mm` real,
	`height_mm` real,
	`weight_g` real,
	`vat_rate` text NOT NULL,
	`redemption_percent` integer NOT NULL,
	`sales_plan` integer NOT NULL,
	`logistics_mode` text NOT NULL,
	`local_share` real NOT NULL,
	`clusters_count` text NOT NULL,
	`dispatch_cluster` text DEFAULT 'Москва, МО и Дальние регионы' NOT NULL,
	`destination_cluster` text DEFAULT 'Москва, МО и Дальние регионы' NOT NULL,
	`current_price` real NOT NULL,
	`regular_price` real,
	`discount_percent` real NOT NULL,
	`marketing_percent` real NOT NULL,
	`real_fbs_delivery_cost` real NOT NULL,
	`real_fbs_return_cost` real NOT NULL,
	`acceptance_tariff` text NOT NULL,
	`cost_price` real NOT NULL,
	`extra_expenses_per_unit` real NOT NULL,
	`white_purchase` integer,
	`incoming_vat_purchase` integer NOT NULL,
	`incoming_vat_rate` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ozon_product_id` integer,
	`ozon_sku` integer,
	`ozon_commissions` text,
	`ozon_commissions_updated_at` integer,
	`ozon_archived` integer,
	`ozon_visible` integer,
	`ozon_status_name` text,
	`ozon_status_description` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Drop rows where workspace_id was never backfilled (orphan products of
-- deleted users). UNIQUE(shop_id, article_id) carries over from the previous
-- schema; cross-user duplicates inside a shared shop become straight
-- duplicates under the workspace model — keep the lowest id (oldest), since
-- products that landed in the same shop with same SKU are functionally one
-- catalog entry.
INSERT OR IGNORE INTO `__new_products`(
	"id", "shop_id", "workspace_id", "article_id", "product_name", "category",
	"product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard",
	"planned_storage_days", "volume_l", "depth_mm", "width_mm", "height_mm",
	"weight_g", "vat_rate", "redemption_percent", "sales_plan", "logistics_mode",
	"local_share", "clusters_count", "dispatch_cluster", "destination_cluster",
	"current_price", "regular_price", "discount_percent", "marketing_percent",
	"real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff",
	"cost_price", "extra_expenses_per_unit", "white_purchase",
	"incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at",
	"ozon_product_id", "ozon_sku", "ozon_commissions",
	"ozon_commissions_updated_at", "ozon_archived", "ozon_visible",
	"ozon_status_name", "ozon_status_description"
)
SELECT
	"id", "shop_id", "workspace_id", "article_id", "product_name", "category",
	"product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard",
	"planned_storage_days", "volume_l", "depth_mm", "width_mm", "height_mm",
	"weight_g", "vat_rate", "redemption_percent", "sales_plan", "logistics_mode",
	"local_share", "clusters_count", "dispatch_cluster", "destination_cluster",
	"current_price", "regular_price", "discount_percent", "marketing_percent",
	"real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff",
	"cost_price", "extra_expenses_per_unit", "white_purchase",
	"incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at",
	"ozon_product_id", "ozon_sku", "ozon_commissions",
	"ozon_commissions_updated_at", "ozon_archived", "ozon_visible",
	"ozon_status_name", "ozon_status_description"
FROM `products`
WHERE `workspace_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_shop_article_unique` ON `products` (`shop_id`,`article_id`);--> statement-breakpoint

-- 4. Rebuild finance_transactions: drop user_id, PK = (workspace_id, operation_id).
CREATE TABLE `__new_finance_transactions` (
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`operation_type` text NOT NULL,
	`operation_date` integer NOT NULL,
	`posting_number` text,
	`article_id` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `operation_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `__new_finance_transactions`(
	"shop_id", "workspace_id", "operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
)
SELECT
	"shop_id", "workspace_id", "operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
FROM `finance_transactions`
WHERE `workspace_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint

-- 5. Rebuild import_runs: drop user_id (audit info goes away — every member
-- triggers imports under the workspace's shared credentials, so attribution
-- by user no longer reflects «whose namespace»).
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_import_runs`(
	"id", "shop_id", "workspace_id", "kind", "started_at", "finished_at",
	"status", "items_processed", "error_message", "params"
)
SELECT
	"id", "shop_id", "workspace_id", "kind", "started_at", "finished_at",
	"status", "items_processed", "error_message", "params"
FROM `import_runs`
WHERE `workspace_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint

-- 6. logistics_cluster_tariff_sets: drop shop_id (sets are workspace-scoped
-- now, with NULL workspace_id meaning «global», loaded by sysadmin only).
CREATE TABLE `__new_logistics_cluster_tariff_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer,
	`name` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_logistics_cluster_tariff_sets`(
	"id", "workspace_id", "name", "uploaded_at", "created_at"
)
SELECT
	"id", "workspace_id", "name", "uploaded_at", "created_at"
FROM `logistics_cluster_tariff_sets`;--> statement-breakpoint
DROP TABLE `logistics_cluster_tariff_sets`;--> statement-breakpoint
ALTER TABLE `__new_logistics_cluster_tariff_sets`
	RENAME TO `logistics_cluster_tariff_sets`;--> statement-breakpoint

-- 7. Drop legacy users.role — superseded by users.is_sysadmin (platform) +
-- workspace_members.role (per-workspace).
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_sysadmin` integer DEFAULT 0 NOT NULL,
	`is_verified` integer DEFAULT 0 NOT NULL,
	`is_blocked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`(
	"id", "email", "password_hash", "is_sysadmin", "is_verified", "is_blocked",
	"created_at", "updated_at"
)
SELECT
	"id", "email", "password_hash", "is_sysadmin", "is_verified", "is_blocked",
	"created_at", "updated_at"
FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
