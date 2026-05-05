CREATE TABLE `api_credentials` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`client_id` text NOT NULL,
	`api_key` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`operation_id` integer PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`operation_date` integer NOT NULL,
	`posting_number` text,
	`article_id` text,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text
);
--> statement-breakpoint
CREATE TABLE `products` (
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
	`current_price` real NOT NULL,
	`discount_percent` real NOT NULL,
	`marketing_percent` real NOT NULL,
	`real_fbs_delivery_cost` real NOT NULL,
	`real_fbs_return_cost` real NOT NULL,
	`acceptance_tariff` text NOT NULL,
	`cost_price` real NOT NULL,
	`extra_expenses_per_unit` real NOT NULL,
	`white_purchase` integer NOT NULL,
	`incoming_vat_purchase` integer NOT NULL,
	`incoming_vat_rate` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ozon_product_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_article_id_unique` ON `products` (`article_id`);--> statement-breakpoint
CREATE TABLE `ref_commissions` (
	`key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`product_type` text NOT NULL,
	`fbo_buckets` text NOT NULL,
	`fbs_buckets` text NOT NULL,
	`real_fbs_buckets` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ref_logistics_tariffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_from` real NOT NULL,
	`volume_to` real NOT NULL,
	`local_up_to_300` real NOT NULL,
	`non_local_up_to_300` real NOT NULL,
	`local_over_300` real NOT NULL,
	`non_local_over_300` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ref_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ref_storage` (
	`key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`product_type` text NOT NULL,
	`free_storage_days` integer NOT NULL,
	`free_storage_days_kgt` integer NOT NULL,
	`free_storage_days_kz` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`tax_settings` text NOT NULL,
	`updated_at` integer NOT NULL
);
