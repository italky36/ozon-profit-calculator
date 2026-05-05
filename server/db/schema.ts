import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import type {
  CommissionBuckets,
  OzonCommissions,
  TaxSettings,
} from "../../src/types";

// === Reference tables (replace src/data/*.json) ===
export const refCommissions = sqliteTable("ref_commissions", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  productType: text("product_type").notNull(),
  fboBuckets: text("fbo_buckets", { mode: "json" })
    .$type<Required<CommissionBuckets>>()
    .notNull(),
  fbsBuckets: text("fbs_buckets", { mode: "json" })
    .$type<Required<CommissionBuckets>>()
    .notNull(),
  realFbsBuckets: text("real_fbs_buckets", { mode: "json" })
    .$type<CommissionBuckets>()
    .notNull(),
});

export const refStorage = sqliteTable("ref_storage", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  productType: text("product_type").notNull(),
  freeStorageDays: integer("free_storage_days").notNull(),
  freeStorageDaysKgt: integer("free_storage_days_kgt").notNull(),
  freeStorageDaysKz: integer("free_storage_days_kz").notNull(),
});

export const refLogisticsTariffs = sqliteTable("ref_logistics_tariffs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  volumeFrom: real("volume_from").notNull(),
  volumeTo: real("volume_to").notNull(),
  localUpTo300: real("local_up_to_300").notNull(),
  nonLocalUpTo300: real("non_local_up_to_300").notNull(),
  localOver300: real("local_over_300").notNull(),
  nonLocalOver300: real("non_local_over_300").notNull(),
});

// key/value bag for lists.json + logisticsSettings.json
export const refSettings = sqliteTable("ref_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

// === User data ===
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().unique(),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  productType: text("product_type").notNull(),
  isKgt: integer("is_kgt", { mode: "boolean" }).notNull().default(false),
  isKazakhstan: integer("is_kazakhstan", { mode: "boolean" })
    .notNull()
    .default(false),
  isFireHazard: integer("is_fire_hazard", { mode: "boolean" })
    .notNull()
    .default(false),
  plannedStorageDays: integer("planned_storage_days").notNull(),
  volumeL: real("volume_l").notNull(),
  vatRate: text("vat_rate").notNull(),
  redemptionPercent: integer("redemption_percent").notNull(),
  salesPlan: integer("sales_plan").notNull(),
  logisticsMode: text("logistics_mode").notNull(),
  localShare: real("local_share").notNull(),
  clustersCount: text("clusters_count").notNull(),
  currentPrice: real("current_price").notNull(),
  /** Ozon sticker price (`price.price`) when a marketing promo brings the
   * actual selling price (`currentPrice`) below it. NULL otherwise. Purely
   * informational — used by the UI to show "regular: 3000" below the
   * effective price. Not used in calc. */
  regularPrice: real("regular_price"),
  discountPercent: real("discount_percent").notNull(),
  marketingPercent: real("marketing_percent").notNull(),
  realFbsDeliveryCost: real("real_fbs_delivery_cost").notNull(),
  realFbsReturnCost: real("real_fbs_return_cost").notNull(),
  acceptanceTariff: text("acceptance_tariff").notNull(),
  costPrice: real("cost_price").notNull(),
  extraExpensesPerUnit: real("extra_expenses_per_unit").notNull(),
  whitePurchase: integer("white_purchase", { mode: "boolean" }).notNull(),
  incomingVatPurchase: integer("incoming_vat_purchase", { mode: "boolean" })
    .notNull(),
  incomingVatRate: real("incoming_vat_rate").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ozonProductId: integer("ozon_product_id"),
  /** Public SKU used in `https://www.ozon.ru/product/{sku}/` URLs.
   * Different from `ozonProductId`: that's the seller's internal product_id;
   * `ozonSku` is the marketplace-facing identifier. */
  ozonSku: integer("ozon_sku"),
  ozonCommissions: text("ozon_commissions", { mode: "json" }).$type<OzonCommissions>(),
  ozonCommissionsUpdatedAt: integer("ozon_commissions_updated_at", {
    mode: "timestamp_ms",
  }),
});

export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey().default(1),
  taxSettings: text("tax_settings", { mode: "json" })
    .$type<TaxSettings>()
    .notNull(),
  autoRefreshEnabled: integer("auto_refresh_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  autoRefreshIntervalMin: integer("auto_refresh_interval_min")
    .notNull()
    .default(30),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// === Ozon credentials (used in phase 2) ===
export const apiCredentials = sqliteTable("api_credentials", {
  id: integer("id").primaryKey().default(1),
  clientId: text("client_id").notNull(),
  apiKey: text("api_key").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// === Imported finance (used in phase 3) ===
export const financeTransactions = sqliteTable("finance_transactions", {
  operationId: integer("operation_id").primaryKey(),
  operationType: text("operation_type").notNull(),
  operationDate: integer("operation_date", { mode: "timestamp_ms" }).notNull(),
  postingNumber: text("posting_number"),
  articleId: text("article_id"),
  amount: real("amount").notNull(),
  type: text("type").notNull(),
  raw: text("raw", { mode: "json" }).notNull(),
});

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status").notNull(),
  itemsProcessed: integer("items_processed").default(0).notNull(),
  errorMessage: text("error_message"),
  params: text("params", { mode: "json" }),
});

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
