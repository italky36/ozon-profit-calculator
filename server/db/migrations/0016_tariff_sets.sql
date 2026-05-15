-- Tariff-set versioning for cluster logistics:
--   * Новая таблица `logistics_cluster_tariff_sets` — именованные наборы тарифов
--     с историей. shopId IS NULL → глобальный (виден всем), иначе персональный.
--   * Существующая `ref_logistics_cluster_tariffs` переезжает в `logistics_cluster_tariffs`
--     с FK `set_id`. Старые строки backfilled в один глобальный набор «Стандартный набор».
--   * shops получает `tariff_set_id` (nullable FK на наборы). NULL → resolveTariffSet
--     возьмёт последний глобальный по uploaded_at.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 1. Таблица наборов.
CREATE TABLE `logistics_cluster_tariff_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` integer,
	`name` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- 2. Создать дефолтный глобальный набор «Стандартный набор» (если есть существующие тарифы).
INSERT INTO `logistics_cluster_tariff_sets` (`shop_id`, `name`, `uploaded_at`, `created_at`)
SELECT
	NULL,
	'Стандартный набор',
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM `ref_logistics_cluster_tariffs`);
--> statement-breakpoint

-- 3. Rebuild ref_logistics_cluster_tariffs → logistics_cluster_tariffs с set_id.
CREATE TABLE `logistics_cluster_tariffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`volume_from` real NOT NULL,
	`from_cluster` text NOT NULL,
	`to_cluster` text NOT NULL,
	`tariff_lte_300` real NOT NULL,
	`tariff_gt_300` real NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `logistics_cluster_tariff_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Все существующие строки уходят в дефолтный набор (id берётся как первый глобальный).
INSERT INTO `logistics_cluster_tariffs` (
	`set_id`, `volume_from`, `from_cluster`, `to_cluster`, `tariff_lte_300`, `tariff_gt_300`
)
SELECT
	(SELECT id FROM `logistics_cluster_tariff_sets` WHERE shop_id IS NULL ORDER BY id LIMIT 1),
	`volume_from`, `from_cluster`, `to_cluster`, `tariff_lte_300`, `tariff_gt_300`
FROM `ref_logistics_cluster_tariffs`;
--> statement-breakpoint

DROP TABLE `ref_logistics_cluster_tariffs`;--> statement-breakpoint

-- 4. shops.tariff_set_id (nullable). ALTER TABLE ADD COLUMN — поддерживается
-- т.к. колонка nullable и без NOT NULL.
ALTER TABLE `shops` ADD COLUMN `tariff_set_id` integer REFERENCES `logistics_cluster_tariff_sets`(`id`) ON DELETE SET NULL;--> statement-breakpoint

PRAGMA foreign_keys=ON;
