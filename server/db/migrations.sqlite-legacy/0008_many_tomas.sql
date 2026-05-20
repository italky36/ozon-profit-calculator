CREATE TABLE `ref_logistics_cluster_tariffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_from` real NOT NULL,
	`from_cluster` text NOT NULL,
	`to_cluster` text NOT NULL,
	`tariff_lte_300` real NOT NULL,
	`tariff_gt_300` real NOT NULL
);
