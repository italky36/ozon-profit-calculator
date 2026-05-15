-- Stage 7' of SaaS migration: per-shop assignment + per-user manual fields,
-- finance, imports, and tax/tariff settings.
--
-- The Stage 2 cutover (0020) collapsed everything to workspace_id under the
-- assumption that all members of a workspace share one calculator state.
-- Real-world use case (per user 2026-05-15): different members analyze
-- different shops, or the same shop under different what-if tax/tariff configs.
-- This migration restores the pre-Stage-2 sharing semantics on top of the
-- workspace foundation, with these distinctions:
--
--   * Assignment is now `shop_member(shop_id, user_id)` — workspace member
--     does not automatically see all shops; owner/manager grants access.
--   * `shop_user_settings(shop_id, user_id)` — per-user overrides for
--     tax_settings / tariff_set_id / auto_refresh_*; fallback to shops.* default.
--   * `products` get `user_id`: catalog fields stay synced across all assignees
--     (catalog import will fan-out by user), manual fields are per-user.
--   * `finance_transactions` get `user_id`: each member imports their own period.
--   * `import_runs` get `user_id`: per-user history.
--
-- Backfill:
--   * `shop_member`: every (shop, workspace_member) pair — preserves the
--     current «всё видно всем» state until owner explicitly restricts.
--   * `products`: for each existing row, owner of workspace keeps the row as-is
--     (their data — they were the one editing in the unified Stage 2 model).
--     Each other member gets a fresh duplicate: catalog and Ozon fields copied,
--     financial/manual fields zeroed (cost_price, sales_plan, marketing_percent,
--     redemption_percent=100, white_purchase=NULL, incoming_vat_purchase=0,
--     incoming_vat_rate=0, extra_expenses_per_unit=0, realFbs delivery/return=0).
--     New unique id generated with lower(hex(randomblob(16))).
--   * `finance_transactions`, `import_runs`: `user_id` = workspace owner.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. Per-shop assignment.
CREATE TABLE `shop_member` (
	`shop_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` integer,
	PRIMARY KEY(`shop_id`, `user_id`),
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

-- Backfill: every workspace member is assigned to every shop of their
-- workspace (preserves «all-see-all» initial state; owner reduces later).
INSERT INTO `shop_member`(`shop_id`, `user_id`, `created_at`, `created_by`)
SELECT
	s.id AS shop_id,
	wm.user_id,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS created_at,
	NULL AS created_by
FROM `shops` s
JOIN `workspace_members` wm ON wm.workspace_id = s.workspace_id;--> statement-breakpoint

-- 2. Per-user override of shop defaults (tax_settings / tariff / auto-refresh).
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
);--> statement-breakpoint

-- 3. Rebuild import_runs to add user_id (audit + per-user filter).
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`params` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_import_runs`(
	"id", "shop_id", "workspace_id", "user_id", "kind", "started_at",
	"finished_at", "status", "items_processed", "error_message", "params"
)
SELECT
	r.id, r.shop_id, r.workspace_id,
	(SELECT wm.user_id FROM `workspace_members` wm
	  WHERE wm.workspace_id = r.workspace_id AND wm.role = 'owner' LIMIT 1) AS user_id,
	r.kind, r.started_at, r.finished_at, r.status, r.items_processed,
	r.error_message, r.params
FROM `import_runs` r;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint

-- 4. Rebuild finance_transactions: add user_id, change PK to
--    (shop_id, user_id, operation_id). Same Ozon operation_id can now appear
--    once per user (each member imports the cabinet themselves).
CREATE TABLE `__new_finance_transactions` (
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
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
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_finance_transactions`(
	"shop_id", "workspace_id", "user_id", "operation_id", "operation_type",
	"operation_date", "posting_number", "article_id", "amount", "type", "raw"
)
SELECT
	f.shop_id, f.workspace_id,
	(SELECT wm.user_id FROM `workspace_members` wm
	  WHERE wm.workspace_id = f.workspace_id AND wm.role = 'owner' LIMIT 1) AS user_id,
	f.operation_id, f.operation_type, f.operation_date, f.posting_number,
	f.article_id, f.amount, f.type, f.raw
FROM `finance_transactions` f;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint

-- 5. Rebuild products: add user_id, UNIQUE(shop_id, user_id, article_id).
-- Drop both potential index names: 0020 SQL claims `products_shop_article_unique`
-- but production DB shipped with `products_workspace_article_unique`. Either
-- way the index disappears with the table rebuild below; this DROP is for the
-- in-place schema check before the rebuild.
DROP INDEX IF EXISTS `products_shop_article_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `products_workspace_article_unique`;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
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
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- 5a. Owner of each workspace keeps existing rows as-is (they were the one
-- editing in the Stage 2 unified model).
INSERT INTO `__new_products`(
	"id", "shop_id", "workspace_id", "user_id", "article_id", "product_name",
	"category", "product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard",
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
	p.id, p.shop_id, p.workspace_id,
	(SELECT wm.user_id FROM `workspace_members` wm
	  WHERE wm.workspace_id = p.workspace_id AND wm.role = 'owner' LIMIT 1) AS user_id,
	p.article_id, p.product_name, p.category, p.product_type, p.is_kgt,
	p.is_kazakhstan, p.is_fire_hazard, p.planned_storage_days, p.volume_l,
	p.depth_mm, p.width_mm, p.height_mm, p.weight_g, p.vat_rate,
	p.redemption_percent, p.sales_plan, p.logistics_mode, p.local_share,
	p.clusters_count, p.dispatch_cluster, p.destination_cluster, p.current_price,
	p.regular_price, p.discount_percent, p.marketing_percent,
	p.real_fbs_delivery_cost, p.real_fbs_return_cost, p.acceptance_tariff,
	p.cost_price, p.extra_expenses_per_unit, p.white_purchase,
	p.incoming_vat_purchase, p.incoming_vat_rate, p.created_at, p.updated_at,
	p.ozon_product_id, p.ozon_sku, p.ozon_commissions,
	p.ozon_commissions_updated_at, p.ozon_archived, p.ozon_visible,
	p.ozon_status_name, p.ozon_status_description
FROM `products` p;--> statement-breakpoint

-- 5b. Each non-owner workspace member gets a duplicate row per existing product:
-- catalog and Ozon fields copied; financial/manual fields zeroed; new id.
INSERT INTO `__new_products`(
	"id", "shop_id", "workspace_id", "user_id", "article_id", "product_name",
	"category", "product_type", "is_kgt", "is_kazakhstan", "is_fire_hazard",
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
	lower(hex(randomblob(16))) AS id,
	p.shop_id,
	p.workspace_id,
	wm.user_id,
	p.article_id, p.product_name, p.category, p.product_type, p.is_kgt,
	p.is_kazakhstan, p.is_fire_hazard, p.planned_storage_days, p.volume_l,
	p.depth_mm, p.width_mm, p.height_mm, p.weight_g, p.vat_rate,
	100 AS redemption_percent,
	0 AS sales_plan,
	p.logistics_mode, p.local_share, p.clusters_count,
	p.dispatch_cluster, p.destination_cluster,
	p.current_price, p.regular_price, p.discount_percent,
	0 AS marketing_percent,
	0 AS real_fbs_delivery_cost,
	0 AS real_fbs_return_cost,
	p.acceptance_tariff,
	0 AS cost_price,
	0 AS extra_expenses_per_unit,
	NULL AS white_purchase,
	0 AS incoming_vat_purchase,
	0 AS incoming_vat_rate,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS created_at,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS updated_at,
	p.ozon_product_id, p.ozon_sku, p.ozon_commissions,
	p.ozon_commissions_updated_at, p.ozon_archived, p.ozon_visible,
	p.ozon_status_name, p.ozon_status_description
FROM `products` p
JOIN `workspace_members` wm
  ON wm.workspace_id = p.workspace_id AND wm.role <> 'owner';--> statement-breakpoint

DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_shop_user_article_unique`
  ON `products` (`shop_id`, `user_id`, `article_id`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
