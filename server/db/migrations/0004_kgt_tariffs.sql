ALTER TABLE "logistics_cluster_tariff_sets" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_user_settings" ADD COLUMN "kgt_tariff_set_id" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "kgt_tariff_set_id" integer;