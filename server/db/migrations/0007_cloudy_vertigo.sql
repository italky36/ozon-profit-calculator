PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`product_name` text NOT NULL,
	`category` text NOT NULL,
	`product_type` text NOT NULL,
	`is_kgt` integer DEFAULT false NOT NULL,
	`is_kazakhstan` integer DEFAULT false NOT NULL,
	`is_fire_hazard` integer DEFAULT false NOT NULL,
	`planned_storage_days` integer NOT NULL,
	`volume_l` real NOT NULL,
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
	`ozon_status_description` text
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "article_id", "product_name", "category", "product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard", "planned_storage_days", "volume_l", "vat_rate", "redemption_percent", "sales_plan", "logistics_mode", "local_share", "clusters_count", "dispatch_cluster", "destination_cluster", "current_price", "regular_price", "discount_percent", "marketing_percent", "real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff", "cost_price", "extra_expenses_per_unit", "white_purchase", "incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at", "ozon_product_id", "ozon_sku", "ozon_commissions", "ozon_commissions_updated_at", "ozon_archived", "ozon_visible", "ozon_status_name", "ozon_status_description") SELECT "id", "article_id", "product_name", "category", "product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard", "planned_storage_days", "volume_l", "vat_rate", "redemption_percent", "sales_plan", "logistics_mode", "local_share", "clusters_count", "dispatch_cluster", "destination_cluster", "current_price", "regular_price", "discount_percent", "marketing_percent", "real_fbs_delivery_cost", "real_fbs_return_cost", "acceptance_tariff", "cost_price", "extra_expenses_per_unit", "white_purchase", "incoming_vat_purchase", "incoming_vat_rate", "created_at", "updated_at", "ozon_product_id", "ozon_sku", "ozon_commissions", "ozon_commissions_updated_at", "ozon_archived", "ozon_visible", "ozon_status_name", "ozon_status_description" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_article_id_unique` ON `products` (`article_id`);