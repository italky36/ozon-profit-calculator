CREATE TABLE "chat_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_call_participants" (
	"call_id" integer NOT NULL,
	"user_id" integer,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	CONSTRAINT "chat_call_participants_call_id_user_id_pk" PRIMARY KEY("call_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"initiator_user_id" integer,
	"call_type" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "chat_channel_members" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_channel_reads" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_message_id" integer,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_channel_reads_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'channel' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_message_mentions" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "chat_message_mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_message_reactions" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"author_user_id" integer,
	"parent_message_id" integer,
	"quoted_message_id" integer,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"shop_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"operation_id" integer NOT NULL,
	"operation_type" text NOT NULL,
	"operation_date" timestamp with time zone NOT NULL,
	"posting_number" text,
	"article_id" text,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "finance_transactions_shop_id_user_id_operation_id_pk" PRIMARY KEY("shop_id","user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "ice_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"urls" text NOT NULL,
	"username" text,
	"credential" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"params" jsonb
);
--> statement-breakpoint
CREATE TABLE "logistics_cluster_tariff_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"name" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_cluster_tariffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"volume_from" double precision NOT NULL,
	"from_cluster" text NOT NULL,
	"to_cluster" text NOT NULL,
	"tariff_lte_300" double precision NOT NULL,
	"tariff_gt_300" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"article_id" text NOT NULL,
	"product_name" text NOT NULL,
	"category" text NOT NULL,
	"product_type" text NOT NULL,
	"is_kgt" boolean DEFAULT false NOT NULL,
	"is_kazakhstan" boolean DEFAULT false NOT NULL,
	"is_fire_hazard" boolean DEFAULT false NOT NULL,
	"planned_storage_days" integer NOT NULL,
	"volume_l" double precision NOT NULL,
	"depth_mm" double precision,
	"width_mm" double precision,
	"height_mm" double precision,
	"weight_g" double precision,
	"vat_rate" text NOT NULL,
	"redemption_percent" integer NOT NULL,
	"sales_plan" integer NOT NULL,
	"logistics_mode" text NOT NULL,
	"local_share" double precision NOT NULL,
	"clusters_count" text NOT NULL,
	"dispatch_cluster" text DEFAULT 'Москва, МО и Дальние регионы' NOT NULL,
	"destination_cluster" text DEFAULT 'Москва, МО и Дальние регионы' NOT NULL,
	"current_price" double precision NOT NULL,
	"regular_price" double precision,
	"discount_percent" double precision NOT NULL,
	"marketing_percent" double precision NOT NULL,
	"real_fbs_delivery_cost" double precision NOT NULL,
	"real_fbs_return_cost" double precision NOT NULL,
	"acceptance_tariff" text NOT NULL,
	"cost_price" double precision NOT NULL,
	"extra_expenses_per_unit" double precision NOT NULL,
	"white_purchase" boolean,
	"incoming_vat_purchase" boolean NOT NULL,
	"incoming_vat_rate" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ozon_product_id" integer,
	"ozon_sku" integer,
	"ozon_commissions" jsonb,
	"ozon_commissions_updated_at" timestamp with time zone,
	"ozon_archived" boolean,
	"ozon_visible" boolean,
	"ozon_status_name" text,
	"ozon_status_description" text
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh_key" text NOT NULL,
	"auth_key" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "ref_commissions" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"product_type" text NOT NULL,
	"fbo_buckets" jsonb NOT NULL,
	"fbs_buckets" jsonb NOT NULL,
	"real_fbs_buckets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_logistics_tariffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"volume_from" double precision NOT NULL,
	"volume_to" double precision NOT NULL,
	"local_up_to_300" double precision NOT NULL,
	"non_local_up_to_300" double precision NOT NULL,
	"local_over_300" double precision NOT NULL,
	"non_local_over_300" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_storage" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"product_type" text NOT NULL,
	"free_storage_days" integer NOT NULL,
	"free_storage_days_kgt" integer NOT NULL,
	"free_storage_days_kz" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_member" (
	"shop_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" integer,
	CONSTRAINT "shop_member_shop_id_user_id_pk" PRIMARY KEY("shop_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shop_user_settings" (
	"shop_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"tax_settings" jsonb,
	"tariff_set_id" integer,
	"auto_refresh_enabled" boolean,
	"auto_refresh_interval_min" integer,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shop_user_settings_shop_id_user_id_pk" PRIMARY KEY("shop_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"color" text,
	"tax_settings" jsonb NOT NULL,
	"auto_refresh_enabled" boolean DEFAULT false NOT NULL,
	"auto_refresh_interval_min" integer DEFAULT 30 NOT NULL,
	"ozon_client_id" text,
	"ozon_api_key" text,
	"ozon_updated_at" timestamp with time zone,
	"tariff_set_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"user" text NOT NULL,
	"pass" text NOT NULL,
	"from_addr" text NOT NULL,
	"secure" text DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"active_shop_id" integer,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_sysadmin" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"job_title" text,
	"avatar_data_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vapid_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"subject" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"token" text PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"logo_data_url" text,
	"color" text,
	"use_logo_as_app_icon" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_call_participants" ADD CONSTRAINT "chat_call_participants_call_id_chat_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."chat_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_call_participants" ADD CONSTRAINT "chat_call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_calls" ADD CONSTRAINT "chat_calls_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_calls" ADD CONSTRAINT "chat_calls_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_reads" ADD CONSTRAINT "chat_channel_reads_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_reads" ADD CONSTRAINT "chat_channel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_cluster_tariff_sets" ADD CONSTRAINT "logistics_cluster_tariff_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_cluster_tariffs" ADD CONSTRAINT "logistics_cluster_tariffs_set_id_logistics_cluster_tariff_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."logistics_cluster_tariff_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_member" ADD CONSTRAINT "shop_member_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_member" ADD CONSTRAINT "shop_member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_member" ADD CONSTRAINT "shop_member_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_user_settings" ADD CONSTRAINT "shop_user_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_user_settings" ADD CONSTRAINT "shop_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_shop_id_shops_id_fk" FOREIGN KEY ("active_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_shop_user_article_unique" ON "products" USING btree ("shop_id","user_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_workspace_short_unique" ON "shops" USING btree ("workspace_id","short_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_user_unique" ON "workspace_members" USING btree ("user_id");