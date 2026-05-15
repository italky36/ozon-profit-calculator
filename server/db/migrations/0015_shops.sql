-- Multi-shop architecture:
--   * Создаём таблицу `shops` (per-user namespace для товаров/финансов/Ozon-кредов/налогов).
--   * Для каждого user'а бэкфилим один дефолтный shop, забирая
--     tax_settings + auto_refresh_* из user_settings и Ozon-креды из api_credentials.
--   * Перевязываем products / finance_transactions / import_runs:
--     колонка user_id → shop_id (новой строки в shops, привязанной к тому же юзеру).
--   * user_settings: добавляем active_shop_id; удаляем tax_settings и auto_refresh_*.
--   * api_credentials: удаляем per-user строки (мигрировали в shops);
--     остаётся одна глобальная строка (user_id IS NULL) как admin fallback.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. Таблица shops.
CREATE TABLE `shops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`color` text,
	`tax_settings` text NOT NULL,
	`auto_refresh_enabled` integer DEFAULT false NOT NULL,
	`auto_refresh_interval_min` integer DEFAULT 30 NOT NULL,
	`ozon_client_id` text,
	`ozon_api_key` text,
	`ozon_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_user_short_unique` ON `shops` (`user_id`,`short_name`);--> statement-breakpoint

-- 2. Бэкфил: для каждого user'а — один shop с дефолтными значениями и данными
-- из user_settings + api_credentials.
INSERT INTO `shops` (
	`user_id`, `name`, `short_name`, `color`,
	`tax_settings`, `auto_refresh_enabled`, `auto_refresh_interval_min`,
	`ozon_client_id`, `ozon_api_key`, `ozon_updated_at`,
	`created_at`, `updated_at`
)
SELECT
	u.id,
	'Мой магазин',
	'M1',
	NULL,
	COALESCE(us.tax_settings, '{}'),
	COALESCE(us.auto_refresh_enabled, 0),
	COALESCE(us.auto_refresh_interval_min, 30),
	ac.client_id,
	ac.api_key,
	ac.updated_at,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
LEFT JOIN `user_settings` us ON us.user_id = u.id
LEFT JOIN `api_credentials` ac ON ac.user_id = u.id;
--> statement-breakpoint

-- 3. Rebuild products: user_id → shop_id, UNIQUE(article_id) → UNIQUE(shop_id, article_id).
DROP INDEX `products_user_article_unique`;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` integer NOT NULL,
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
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_products`(
	"id", "shop_id", "article_id", "product_name", "category", "product_type",
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
	(SELECT s.id FROM `shops` s WHERE s.user_id = p.user_id LIMIT 1),
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
CREATE UNIQUE INDEX `products_shop_article_unique` ON `products` (`shop_id`,`article_id`);--> statement-breakpoint

-- 4. Rebuild finance_transactions: user_id → shop_id, PK (shop_id, operation_id).
CREATE TABLE `__new_finance_transactions` (
	`shop_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`operation_type` text NOT NULL,
	`operation_date` integer NOT NULL,
	`posting_number` text,
	`article_id` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`shop_id`, `operation_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions`(
	"shop_id", "operation_id", "operation_type", "operation_date",
	"posting_number", "article_id", "amount", "type", "raw"
)
SELECT
	(SELECT s.id FROM `shops` s WHERE s.user_id = ft.user_id LIMIT 1),
	ft."operation_id", ft."operation_type", ft."operation_date",
	ft."posting_number", ft."article_id", ft."amount", ft."type", ft."raw"
FROM `finance_transactions` ft;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint

-- 5. Rebuild import_runs: user_id → shop_id.
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_import_runs`(
	"id", "shop_id", "kind", "started_at", "finished_at", "status",
	"items_processed", "error_message", "params"
)
SELECT
	ir."id",
	(SELECT s.id FROM `shops` s WHERE s.user_id = ir.user_id LIMIT 1),
	ir."kind", ir."started_at", ir."finished_at", ir."status",
	ir."items_processed", ir."error_message", ir."params"
FROM `import_runs` ir;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint

-- 6. Rebuild user_settings: убираем tax/autoRefresh (переехали в shops),
-- добавляем active_shop_id. Бэкфилим active_shop_id первым (единственным)
-- магазином юзера.
CREATE TABLE `__new_user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`active_shop_id` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_user_settings` ("id", "user_id", "active_shop_id", "updated_at")
SELECT
	us."id",
	us."user_id",
	(SELECT s.id FROM `shops` s WHERE s.user_id = us.user_id LIMIT 1),
	us."updated_at"
FROM `user_settings` us;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint

-- 7. Очистка per-user строк api_credentials: их данные ушли в shops.
-- Глобальная строка (user_id IS NULL) остаётся как admin fallback.
DELETE FROM `api_credentials` WHERE `user_id` IS NOT NULL;--> statement-breakpoint

PRAGMA foreign_keys=ON;
