-- Shared admin shops + per-user overrides:
--   * Новая таблица `shop_access(shop_id, user_id)` — назначенные viewer'ы.
--     Owner всегда видит свой shop через shops.user_id; viewer'ы — через эту.
--   * Новая таблица `shop_user_settings(shop_id, user_id, …)` — per-user
--     overrides поверх shops (TaxSettings/tariffSetId/auto_refresh_*). NULL =
--     наследовать с shops.
--   * Перестройка products / finance_transactions / import_runs: добавляем
--     `user_id` (NOT NULL), backfill `user_id := shops.user_id`.
--     products: UNIQUE(shop_id, article_id) → UNIQUE(shop_id, user_id, article_id).
--     finance_transactions: PK (shop_id, operation_id) → PK (shop_id, user_id, operation_id).
--     import_runs: добавляем колонку user_id.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. Список доступов.
CREATE TABLE `shop_access` (
	`shop_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`shop_id`, `user_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 2. Per-user overrides.
CREATE TABLE `shop_user_settings` (
	`shop_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`tax_settings` text,
	`tariff_set_id` integer,
	`auto_refresh_enabled` integer,
	`auto_refresh_interval_min` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`shop_id`, `user_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 3. Rebuild products: добавляем user_id, обновляем уникальный индекс.
DROP INDEX `products_shop_article_unique`;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` integer NOT NULL,
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
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_products`(
	"id", "shop_id", "user_id", "article_id", "product_name", "category", "product_type",
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
	p."id",
	p."shop_id",
	(SELECT s.user_id FROM `shops` s WHERE s.id = p.shop_id),
	p."article_id", p."product_name", p."category", p."product_type",
	p."is_kgt", p."is_kazakhstan", p."is_fire_hazard", p."planned_storage_days",
	p."volume_l", p."depth_mm", p."width_mm", p."height_mm", p."weight_g", p."vat_rate",
	p."redemption_percent", p."sales_plan", p."logistics_mode", p."local_share",
	p."clusters_count", p."dispatch_cluster", p."destination_cluster",
	p."current_price", p."regular_price", p."discount_percent", p."marketing_percent",
	p."real_fbs_delivery_cost", p."real_fbs_return_cost", p."acceptance_tariff",
	p."cost_price", p."extra_expenses_per_unit", p."white_purchase",
	p."incoming_vat_purchase", p."incoming_vat_rate", p."created_at", p."updated_at",
	p."ozon_product_id", p."ozon_sku", p."ozon_commissions",
	p."ozon_commissions_updated_at", p."ozon_archived", p."ozon_visible",
	p."ozon_status_name", p."ozon_status_description"
FROM `products` p;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_shop_user_article_unique` ON `products` (`shop_id`,`user_id`,`article_id`);--> statement-breakpoint

-- 4. Rebuild finance_transactions: добавляем user_id, новый PK.
CREATE TABLE `__new_finance_transactions` (
	`shop_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`operation_type` text NOT NULL,
	`operation_date` integer NOT NULL,
	`posting_number` text,
	`article_id` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`shop_id`, `user_id`, `operation_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions`(
	"shop_id", "user_id", "operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
)
SELECT
	ft."shop_id",
	(SELECT s.user_id FROM `shops` s WHERE s.id = ft.shop_id),
	ft."operation_id", ft."operation_type", ft."operation_date",
	ft."posting_number", ft."article_id", ft."amount", ft."type", ft."raw"
FROM `finance_transactions` ft;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint

-- 5. Rebuild import_runs: добавляем user_id.
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_import_runs`(
	"id", "shop_id", "user_id", "kind", "started_at", "finished_at", "status",
	"items_processed", "error_message", "params"
)
SELECT
	ir."id",
	ir."shop_id",
	(SELECT s.user_id FROM `shops` s WHERE s.id = ir.shop_id),
	ir."kind", ir."started_at", ir."finished_at", ir."status",
	ir."items_processed", ir."error_message", ir."params"
FROM `import_runs` ir;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint

PRAGMA foreign_keys=ON;
