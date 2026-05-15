-- Per-user data isolation:
--   * products / finance_transactions / import_runs gain NOT NULL user_id FK
--     (existing rows are backfilled to the first admin; in a fresh DB the
--     tables are empty so the backfill is a no-op).
--   * products UNIQUE moves from (article_id) to (user_id, article_id).
--   * finance_transactions PK becomes composite (user_id, operation_id).
--   * api_credentials gains nullable user_id. NULL row = admin-managed global
--     fallback. Partial indexes enforce 1 row per user + 1 global row.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

DROP INDEX `products_article_id_unique`;--> statement-breakpoint

-- Rebuild products with user_id NOT NULL and composite unique.
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_products`(
	"id", "user_id", "article_id", "product_name", "category", "product_type",
	"is_kgt", "is_kazakhstan", "is_fire_hazard", "planned_storage_days",
	"volume_l", "depth_mm", "width_mm", "height_mm", "weight_g", "vat_rate",
	"redemption_percent", "sales_plan", "logistics_mode", "local_share",
	"clusters_count", "dispatch_cluster", "destination_cluster",
	"current_price", "regular_price", "discount_percent", "marketing_percent",
	"real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff",
	"cost_price", "extra_expenses_per_unit", "white_purchase",
	"incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at",
	"ozon_product_id", "ozon_sku", "ozon_commissions",
	"ozon_commissions_updated_at", "ozon_archived", "ozon_visible",
	"ozon_status_name", "ozon_status_description"
)
SELECT
	"id",
	COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1), 1) AS "user_id",
	"article_id", "product_name", "category", "product_type",
	"is_kgt", "is_kazakhstan", "is_fire_hazard", "planned_storage_days",
	"volume_l", "depth_mm", "width_mm", "height_mm", "weight_g", "vat_rate",
	"redemption_percent", "sales_plan", "logistics_mode", "local_share",
	"clusters_count", "dispatch_cluster", "destination_cluster",
	"current_price", "regular_price", "discount_percent", "marketing_percent",
	"real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff",
	"cost_price", "extra_expenses_per_unit", "white_purchase",
	"incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at",
	"ozon_product_id", "ozon_sku", "ozon_commissions",
	"ozon_commissions_updated_at", "ozon_archived", "ozon_visible",
	"ozon_status_name", "ozon_status_description"
FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_user_article_unique` ON `products` (`user_id`,`article_id`);--> statement-breakpoint

-- Rebuild finance_transactions with composite PK (user_id, operation_id).
CREATE TABLE `__new_finance_transactions` (
	`user_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`operation_type` text NOT NULL,
	`operation_date` integer NOT NULL,
	`posting_number` text,
	`article_id` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`user_id`, `operation_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions`(
	"user_id", "operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
)
SELECT
	COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1), 1) AS "user_id",
	"operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
FROM `finance_transactions`;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint

-- Rebuild import_runs with NOT NULL user_id FK.
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_import_runs`(
	"id", "user_id", "kind", "started_at", "finished_at", "status",
	"items_processed", "error_message", "params"
)
SELECT
	"id",
	COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1), 1) AS "user_id",
	"kind", "started_at", "finished_at", "status",
	"items_processed", "error_message", "params"
FROM `import_runs`;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint

-- Rebuild api_credentials: nullable user_id (NULL = admin global fallback).
-- Existing pre-migration row(s) become global fallback by writing NULL.
CREATE TABLE `__new_api_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`client_id` text NOT NULL,
	`api_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_api_credentials`("id", "user_id", "client_id", "api_key", "updated_at")
SELECT "id", NULL, "client_id", "api_key", "updated_at" FROM `api_credentials`;--> statement-breakpoint
DROP TABLE `api_credentials`;--> statement-breakpoint
ALTER TABLE `__new_api_credentials` RENAME TO `api_credentials`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_credentials_user_id_unique` ON `api_credentials`(`user_id`) WHERE `user_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `api_credentials_global_unique` ON `api_credentials`((`user_id` IS NULL)) WHERE `user_id` IS NULL;--> statement-breakpoint

PRAGMA foreign_keys=ON;
