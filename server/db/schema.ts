import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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

/** Наборы тарифов кластерной логистики Ozon. Несколько версий могут
 * сосуществовать (исторические, для расчёта факта за прошлые периоды).
 * `workspaceId IS NULL` → глобальный набор (виден всем, грузит sysadmin).
 * `workspaceId IS NOT NULL` → набор внутри одной команды. */
export const logisticsClusterTariffSets = sqliteTable(
  "logistics_cluster_tariff_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
);

/** Точная per-cluster-pair матрица логистики. Каждая строка принадлежит
 * одному набору (`setId`); удаление набора каскадно сносит его строки. */
export const logisticsClusterTariffs = sqliteTable(
  "logistics_cluster_tariffs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    setId: integer("set_id")
      .notNull()
      .references(() => logisticsClusterTariffSets.id, {
        onDelete: "cascade",
      }),
    volumeFrom: real("volume_from").notNull(),
    fromCluster: text("from_cluster").notNull(),
    toCluster: text("to_cluster").notNull(),
    tariffLte300: real("tariff_lte_300").notNull(),
    tariffGt300: real("tariff_gt_300").notNull(),
  },
);

// key/value bag for lists.json + logisticsSettings.json
export const refSettings = sqliteTable("ref_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

// === SaaS multi-tenancy ===
// workspace ≈ «команда» в UI. Один user ↔ один workspace через UNIQUE-индекс
// на workspace_members.user_id. Все бизнес-данные (shops, products, finance,
// imports, tariff sets) scoped по workspace_id.
export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "manager", "member"] }).notNull(),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.userId] }),
    userUnique: uniqueIndex("workspace_members_user_unique").on(t.userId),
  }),
);

export const workspaceInvites = sqliteTable("workspace_invites", {
  token: text("token").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "manager", "member"] }).notNull(),
  invitedBy: integer("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// === Shops (workspace-scoped) ===
// Магазин принадлежит workspace'у; все его данные видны всем member'ам этого
// workspace'а. shortName уникален в рамках workspace. color — HEX (опц.);
// NULL → нейтральный (фоллбэк на UI-accent).
export const shops = sqliteTable(
  "shops",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    color: text("color"),
    taxSettings: text("tax_settings", { mode: "json" })
      .$type<TaxSettings>()
      .notNull(),
    autoRefreshEnabled: integer("auto_refresh_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    autoRefreshIntervalMin: integer("auto_refresh_interval_min")
      .notNull()
      .default(30),
    /** Per-shop Ozon API credentials. NULL → импорт вернёт 400 «не настроены». */
    ozonClientId: text("ozon_client_id"),
    ozonApiKey: text("ozon_api_key"),
    ozonUpdatedAt: integer("ozon_updated_at", { mode: "timestamp_ms" }),
    /** Активный набор тарифов кластерной логистики. NULL → последний
     * глобальный набор по uploadedAt. FK enforced at SQL migration level —
     * not modeled here to avoid Drizzle circular ref. */
    tariffSetId: integer("tariff_set_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    workspaceShortUnique: uniqueIndex("shops_workspace_short_unique").on(
      t.workspaceId,
      t.shortName,
    ),
  }),
);

// === Products ===
export const products = sqliteTable(
  "products",
  {
  id: text("id").primaryKey(),
  shopId: integer("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  articleId: text("article_id").notNull(),
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
  /** Габариты упаковки в мм (как в Ozon LK). Опциональны: для не-Ozon
   * товаров пользователь может заполнить вручную → volumeL пересчитается. */
  depthMm: real("depth_mm"),
  widthMm: real("width_mm"),
  heightMm: real("height_mm"),
  /** Вес упаковки в граммах. */
  weightG: real("weight_g"),
  vatRate: text("vat_rate").notNull(),
  redemptionPercent: integer("redemption_percent").notNull(),
  salesPlan: integer("sales_plan").notNull(),
  logisticsMode: text("logistics_mode").notNull(),
  localShare: real("local_share").notNull(),
  clustersCount: text("clusters_count").notNull(),
  dispatchCluster: text("dispatch_cluster")
    .notNull()
    .default("Москва, МО и Дальние регионы"),
  destinationCluster: text("destination_cluster")
    .notNull()
    .default("Москва, МО и Дальние регионы"),
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
  whitePurchase: integer("white_purchase", { mode: "boolean" }),
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
  /** Card archive flag from Ozon. NULL when the product wasn't imported from Ozon. */
  ozonArchived: integer("ozon_archived", { mode: "boolean" }),
  /** True when the card is on sale (Ozon's `visibility_details.active_product`). */
  ozonVisible: integer("ozon_visible", { mode: "boolean" }),
  /** Short status code/name from `status.state_name` ("processed", "moderating", ...). */
  ozonStatusName: text("ozon_status_name"),
  /** Free-text reason / description (failed moderation, missing price, etc.). */
  ozonStatusDescription: text("ozon_status_description"),
  },
  (t) => ({
    shopArticleUnique: uniqueIndex("products_shop_article_unique").on(
      t.shopId,
      t.articleId,
    ),
  }),
);

// Per-user UI state. Workspace tax / autoRefresh / Ozon creds живут в shops.
// Здесь остался только трекер активного магазина (для дефолта на «куда
// импортировать / создавать товар»).
export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  activeShopId: integer("active_shop_id").references(() => shops.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// === Auth ===
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Платформенный sysadmin-флаг (управление SaaS-ом: SMTP, все workspace'ы,
   * глобальные tariff sets). Не путать с workspace-уровнем (owner/manager/
   * member в workspace_members). */
  isSysadmin: integer("is_sysadmin", { mode: "boolean" })
    .notNull()
    .default(false),
  isVerified: integer("is_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  isBlocked: integer("is_blocked", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
);

// === SMTP settings (sysadmin-editable; overrides env if a row exists) ===
export const smtpSettings = sqliteTable("smtp_settings", {
  id: integer("id").primaryKey().default(1),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  user: text("user").notNull(),
  pass: text("pass").notNull(),
  fromAddr: text("from_addr").notNull(),
  secure: text("secure", {
    enum: ["auto", "ssl", "starttls", "none"],
  })
    .notNull()
    .default("auto"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// === Imported finance ===
// PK composite (workspace_id, operation_id) — одна команда импортирует один
// Ozon-аккаунт; PK гарантирует идемпотентность повторных импортов.
export const financeTransactions = sqliteTable(
  "finance_transactions",
  {
    shopId: integer("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operationId: integer("operation_id").notNull(),
    operationType: text("operation_type").notNull(),
    operationDate: integer("operation_date", { mode: "timestamp_ms" }).notNull(),
    postingNumber: text("posting_number"),
    articleId: text("article_id"),
    amount: real("amount").notNull(),
    type: text("type").notNull(),
    raw: text("raw", { mode: "json" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.operationId] }),
  }),
);

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopId: integer("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
