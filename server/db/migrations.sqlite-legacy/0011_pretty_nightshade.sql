CREATE TABLE `smtp_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`user` text NOT NULL,
	`pass` text NOT NULL,
	`from_addr` text NOT NULL,
	`updated_at` integer NOT NULL
);
