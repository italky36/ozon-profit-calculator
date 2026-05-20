import {
  pgTable,
  integer,
  bigint,
  serial,
  text,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CommissionBuckets,
  OzonCommissions,
  TaxSettings,
} from "../../src/types";

// === Reference tables (replace src/data/*.json) ===
export const refCommissions = pgTable("ref_commissions", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  productType: text("product_type").notNull(),
  fboBuckets: jsonb("fbo_buckets")
    .$type<Required<CommissionBuckets>>()
    .notNull(),
  fbsBuckets: jsonb("fbs_buckets")
    .$type<Required<CommissionBuckets>>()
    .notNull(),
  realFbsBuckets: jsonb("real_fbs_buckets")
    .$type<CommissionBuckets>()
    .notNull(),
});

export const refStorage = pgTable("ref_storage", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  productType: text("product_type").notNull(),
  freeStorageDays: integer("free_storage_days").notNull(),
  freeStorageDaysKgt: integer("free_storage_days_kgt").notNull(),
  freeStorageDaysKz: integer("free_storage_days_kz").notNull(),
});

export const refLogisticsTariffs = pgTable("ref_logistics_tariffs", {
  id: serial("id").primaryKey(),
  volumeFrom: doublePrecision("volume_from").notNull(),
  volumeTo: doublePrecision("volume_to").notNull(),
  localUpTo300: doublePrecision("local_up_to_300").notNull(),
  nonLocalUpTo300: doublePrecision("non_local_up_to_300").notNull(),
  localOver300: doublePrecision("local_over_300").notNull(),
  nonLocalOver300: doublePrecision("non_local_over_300").notNull(),
});

/** Наборы тарифов кластерной логистики Ozon. Несколько версий могут
 * сосуществовать (исторические, для расчёта факта за прошлые периоды).
 * `workspaceId IS NULL` → глобальный набор (виден всем, грузит sysadmin).
 * `workspaceId IS NOT NULL` → набор внутри одной команды. */
export const logisticsClusterTariffSets = pgTable(
  "logistics_cluster_tariff_sets",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
);

/** Точная per-cluster-pair матрица логистики. Каждая строка принадлежит
 * одному набору (`setId`); удаление набора каскадно сносит его строки. */
export const logisticsClusterTariffs = pgTable(
  "logistics_cluster_tariffs",
  {
    id: serial("id").primaryKey(),
    setId: integer("set_id")
      .notNull()
      .references(() => logisticsClusterTariffSets.id, {
        onDelete: "cascade",
      }),
    volumeFrom: doublePrecision("volume_from").notNull(),
    fromCluster: text("from_cluster").notNull(),
    toCluster: text("to_cluster").notNull(),
    tariffLte300: doublePrecision("tariff_lte_300").notNull(),
    tariffGt300: doublePrecision("tariff_gt_300").notNull(),
  },
);

// key/value bag for lists.json + logisticsSettings.json
export const refSettings = pgTable("ref_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// === SaaS multi-tenancy ===
// workspace ≈ «команда» в UI. Один user ↔ один workspace через UNIQUE-индекс
// на workspace_members.user_id. Все бизнес-данные (shops, products, finance,
// imports, tariff sets) scoped по workspace_id.
export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Platform-level pause flag. NULL → active. Non-NULL → sysadmin suspended
   * the workspace at this timestamp; members can't log in or hold sessions. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true, mode: "date" }),
  /** Header-badge customization (set by owner via AppHeader popover). NULL →
   * fall back to UI accent / Users icon. */
  logoDataUrl: text("logo_data_url"),
  color: text("color"),
  /** When true AND logoDataUrl is set, render the workspace logo in the main
   * SPA header (replacing the default «Oz» tile). Off by default — most teams
   * prefer the product mark; some want full white-label. */
  useLogoAsAppIcon: boolean("use_logo_as_app_icon").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const workspaceMembers = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.userId] }),
    userUnique: uniqueIndex("workspace_members_user_unique").on(t.userId),
  }),
);

export const workspaceInvites = pgTable("workspace_invites", {
  token: text("token").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "manager", "member"] }).notNull(),
  invitedBy: integer("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === Shops (workspace-scoped) ===
// Магазин принадлежит workspace'у; видимость member'ов ограничивается через
// shop_member (hard gate, выдаёт owner/manager). shortName уникален в рамках
// workspace. color — HEX (опц.); NULL → нейтральный (фоллбэк на UI-accent).
export const shops = pgTable(
  "shops",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    color: text("color"),
    taxSettings: jsonb("tax_settings").$type<TaxSettings>().notNull(),
    autoRefreshEnabled: boolean("auto_refresh_enabled").notNull().default(false),
    autoRefreshIntervalMin: integer("auto_refresh_interval_min")
      .notNull()
      .default(30),
    /** Per-shop Ozon API credentials. NULL → импорт вернёт 400 «не настроены». */
    ozonClientId: text("ozon_client_id"),
    ozonApiKey: text("ozon_api_key"),
    ozonUpdatedAt: timestamp("ozon_updated_at", { withTimezone: true, mode: "date" }),
    /** Активный набор тарифов кластерной логистики. NULL → последний
     * глобальный набор по uploadedAt. FK enforced at SQL migration level —
     * not modeled here to avoid Drizzle circular ref. */
    tariffSetId: integer("tariff_set_id"),
    /** Per-shop admin. Workspace owner can manage any shop; everyone else
     * (managers) can manage only shops they themselves created. NULL → the
     * creator was removed from the workspace; only workspace owner manages. */
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    workspaceShortUnique: uniqueIndex("shops_workspace_short_unique").on(
      t.workspaceId,
      t.shortName,
    ),
  }),
);

/** Assignment: who in the workspace has access to which shop.
 * Workspace owner sees every shop unconditionally; for everyone else,
 * a row here is the hard gate. Owner/manager creates/destroys rows. */
export const shopMember = pgTable(
  "shop_member",
  {
    shopId: integer("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shopId, t.userId] }),
  }),
);

/** Per-user override of shop defaults. NULL columns → inherit from shops.*.
 * resolveShopSettings(db, shopId, userId) is the canonical accessor. */
export const shopUserSettings = pgTable(
  "shop_user_settings",
  {
    shopId: integer("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taxSettings: jsonb("tax_settings").$type<TaxSettings>(),
    tariffSetId: integer("tariff_set_id"),
    autoRefreshEnabled: boolean("auto_refresh_enabled"),
    autoRefreshIntervalMin: integer("auto_refresh_interval_min"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shopId, t.userId] }),
  }),
);

// === Products ===
// Каталог-поля (productName, category, Ozon-метаданные) синкаются у всех
// assignee shop'а при импорте. Manual/финансовые поля (costPrice, salesPlan,
// marketingPercent, redemptionPercent, whitePurchase, …) — per-user.
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    shopId: integer("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    articleId: text("article_id").notNull(),
    productName: text("product_name").notNull(),
    category: text("category").notNull(),
    productType: text("product_type").notNull(),
    isKgt: boolean("is_kgt").notNull().default(false),
    isKazakhstan: boolean("is_kazakhstan").notNull().default(false),
    isFireHazard: boolean("is_fire_hazard").notNull().default(false),
    plannedStorageDays: integer("planned_storage_days").notNull(),
    volumeL: doublePrecision("volume_l").notNull(),
    /** Габариты упаковки в мм (как в Ozon LK). Опциональны: для не-Ozon
     * товаров пользователь может заполнить вручную → volumeL пересчитается. */
    depthMm: doublePrecision("depth_mm"),
    widthMm: doublePrecision("width_mm"),
    heightMm: doublePrecision("height_mm"),
    /** Вес упаковки в граммах. */
    weightG: doublePrecision("weight_g"),
    vatRate: text("vat_rate").notNull(),
    redemptionPercent: integer("redemption_percent").notNull(),
    salesPlan: integer("sales_plan").notNull(),
    logisticsMode: text("logistics_mode").notNull(),
    localShare: doublePrecision("local_share").notNull(),
    clustersCount: text("clusters_count").notNull(),
    dispatchCluster: text("dispatch_cluster")
      .notNull()
      .default("Москва, МО и Дальние регионы"),
    destinationCluster: text("destination_cluster")
      .notNull()
      .default("Москва, МО и Дальние регионы"),
    currentPrice: doublePrecision("current_price").notNull(),
    /** Ozon sticker price (`price.price`) when a marketing promo brings the
     * actual selling price (`currentPrice`) below it. NULL otherwise. Purely
     * informational — used by the UI to show "regular: 3000" below the
     * effective price. Not used in calc. */
    regularPrice: doublePrecision("regular_price"),
    discountPercent: doublePrecision("discount_percent").notNull(),
    marketingPercent: doublePrecision("marketing_percent").notNull(),
    realFbsDeliveryCost: doublePrecision("real_fbs_delivery_cost").notNull(),
    realFbsReturnCost: doublePrecision("real_fbs_return_cost").notNull(),
    acceptanceTariff: text("acceptance_tariff").notNull(),
    costPrice: doublePrecision("cost_price").notNull(),
    extraExpensesPerUnit: doublePrecision("extra_expenses_per_unit").notNull(),
    whitePurchase: boolean("white_purchase"),
    incomingVatPurchase: boolean("incoming_vat_purchase").notNull(),
    incomingVatRate: doublePrecision("incoming_vat_rate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    // bigint mode: "number" — id'ы Ozon легко > 2^31 (видели 3_097_497_118),
    // integer ловит SQLSTATE 22003. JS Number безопасен до 2^53, чего хватает
    // под Ozon-идентификаторы с большим запасом.
    ozonProductId: bigint("ozon_product_id", { mode: "number" }),
    /** Public SKU used in `https://www.ozon.ru/product/{sku}/` URLs.
     * Different from `ozonProductId`: that's the seller's internal product_id;
     * `ozonSku` is the marketplace-facing identifier. */
    ozonSku: bigint("ozon_sku", { mode: "number" }),
    ozonCommissions: jsonb("ozon_commissions").$type<OzonCommissions>(),
    ozonCommissionsUpdatedAt: timestamp("ozon_commissions_updated_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Card archive flag from Ozon. NULL when the product wasn't imported from Ozon. */
    ozonArchived: boolean("ozon_archived"),
    /** True when the card is on sale (Ozon's `visibility_details.active_product`). */
    ozonVisible: boolean("ozon_visible"),
    /** Short status code/name from `status.state_name` ("processed", "moderating", ...). */
    ozonStatusName: text("ozon_status_name"),
    /** Free-text reason / description (failed moderation, missing price, etc.). */
    ozonStatusDescription: text("ozon_status_description"),
  },
  (t) => ({
    shopUserArticleUnique: uniqueIndex("products_shop_user_article_unique").on(
      t.shopId,
      t.userId,
      t.articleId,
    ),
  }),
);

// Per-user UI state. Workspace tax / autoRefresh / Ozon creds живут в shops.
// Здесь остался только трекер активного магазина (для дефолта на «куда
// импортировать / создавать товар»).
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  activeShopId: integer("active_shop_id").references(() => shops.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === Auth ===
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Платформенный sysadmin-флаг (управление SaaS-ом: SMTP, все workspace'ы,
   * глобальные tariff sets). Не путать с workspace-уровнем (owner/manager/
   * member в workspace_members). */
  isSysadmin: boolean("is_sysadmin").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  isBlocked: boolean("is_blocked").notNull().default(false),
  fullName: text("full_name").notNull().default(""),
  jobTitle: text("job_title"),
  /** Base64 data URL (≤200KB) — see lib/dataUrl.ts for validation. */
  avatarDataUrl: text("avatar_data_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === SMTP settings (sysadmin-editable; overrides env if a row exists) ===
export const smtpSettings = pgTable("smtp_settings", {
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
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === Imported finance ===
// PK composite (shop_id, user_id, operation_id) — каждый member импортирует
// свой период (operation_id Ozon-аккаунта одинаков, но каждый юзер хранит
// свою копию выписки).
export const financeTransactions = pgTable(
  "finance_transactions",
  {
    shopId: integer("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // bigint mode:"number" — operation_id Ozon > 2^31 (видели 49_475_106_820).
    // PK по (shopId, userId, operationId) — изменение типа колонки не ломает
    // primaryKey constraint, drizzle-kit делает ALTER COLUMN ... SET DATA TYPE.
    operationId: bigint("operation_id", { mode: "number" }).notNull(),
    operationType: text("operation_type").notNull(),
    operationDate: timestamp("operation_date", { withTimezone: true, mode: "date" }).notNull(),
    postingNumber: text("posting_number"),
    articleId: text("article_id"),
    amount: doublePrecision("amount").notNull(),
    type: text("type").notNull(),
    raw: jsonb("raw").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shopId, t.userId, t.operationId] }),
  }),
);

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  shopId: integer("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  status: text("status").notNull(),
  itemsProcessed: integer("items_processed").default(0).notNull(),
  errorMessage: text("error_message"),
  params: jsonb("params"),
});

// === Chat (workspace-scoped) ===
// Каналы принадлежат workspace'у; изоляция через FK на workspaces. Сообщения
// и вложения — через chat_channels.workspace_id. Sysadmin к чату отношения
// не имеет — это командный инструмент.
export const chatChannels = pgTable("chat_channels", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Channel kind. 'channel' — обычный workspace-канал (видимость = быть
   * членом workspace'а); 'dm' — личная переписка 1-на-1 (видимость = быть
   * в chat_channel_members). Имя у DM в БД — placeholder («—»),
   * человекочитаемое имя синтезируется UI / роутом из peer'а. */
  type: text("type", { enum: ["channel", "dm"] })
    .notNull()
    .default("channel"),
  /** Дефолтный канал команды («общий»); создаётся миграцией для existing
   * workspace'ов и при создании нового workspace. */
  isDefault: boolean("is_default").notNull().default(false),
  /** Приватный канал — видимость через chat_channel_members (Slack-style).
   * Применимо только к type='channel'; type='dm' всегда фактически
   * приватный через свою membership-таблицу. */
  isPrivate: boolean("is_private").notNull().default(false),
  /** Создатель канала. NULL после удаления юзера (ON DELETE SET NULL) — UI
   * показывает «автор удалён». */
  createdBy: integer("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
});

/** DM membership. Used only when chat_channels.type = 'dm'. Workspace
 * channels rely on workspace_members for visibility. */
export const chatChannelMembers = pgTable(
  "chat_channel_members",
  {
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.channelId, t.userId] }),
  }),
);

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => chatChannels.id, { onDelete: "cascade" }),
  /** Автор сообщения. NULL после удаления юзера (ON DELETE SET NULL) — UI
   * сохраняет историю и рендерит «удалённый пользователь». */
  authorUserId: integer("author_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Thread parent. NULL для root-сообщений канала; non-NULL — ответ в треде.
   * Только один уровень — сервер валидирует, что parent сам не имеет parent'а
   * (одноуровневые треды, как Slack). FK self-ref, ON DELETE CASCADE — hard-
   * delete root'а уносит все ответы. */
  parentMessageId: integer("parent_message_id"),
  /** Inline-quote target (Telegram/WhatsApp-style reply-with-preview). Distinct
   * from `parentMessageId` — the quoting message stays in the channel feed
   * and renders the quoted body as a banner above its own. ON DELETE SET NULL
   * so the quoting message survives a hard-delete of the original; soft
   * delete is preserved via FK and rendered as «сообщение удалено». */
  quotedMessageId: integer("quoted_message_id"),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
  /** Soft-delete. UI рендерит сообщение как «удалено», вложения зачищаются
   * физически роутом. */
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  // NOTE: чат-таблица также имеет колонку `search_vector tsvector` (GENERATED
  // ALWAYS AS to_tsvector('russian', body) STORED) с GIN-индексом — миграция
  // 0001_chat_fts. Drizzle ORM её не модель-ирует: запросы FTS идут через raw
  // sql`…` в server/routes/chat.ts. Если будешь делать db:generate под chat_
  // messages — проверь, что новая миграция не сносит search_vector / индекс.
});

/** Per-user read pointer. Bump-only (PUT /channels/:id/read валидирует
 * messageId > current). UI считает unread как `id > last_read_message_id
 * AND author != currentUser` — за рядом нужно делать ещё join на messages. */
export const chatChannelReads = pgTable(
  "chat_channel_reads",
  {
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadMessageId: integer("last_read_message_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.channelId, t.userId] }),
  }),
);

/** Реакции на сообщения. PK составной (message, user, emoji) — у одного юзера
 * не может быть двух одинаковых реакций на одно сообщение, но он может
 * поставить разные эмодзи. */
export const chatMessageReactions = pgTable(
  "chat_message_reactions",
  {
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
  }),
);

/** @mentions → users. Парсятся на сервере при POST'е сообщения; используются
 * для подсветки и (в Stage 2) для триггера уведомлений офлайн-юзерам. */
export const chatMessageMentions = pgTable(
  "chat_message_mentions",
  {
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.messageId, t.userId] }),
  }),
);

export const chatAttachments = pgTable("chat_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id")
    .notNull()
    .references(() => chatMessages.id, { onDelete: "cascade" }),
  /** Путь внутри FileStorage. Для LocalFileStorage:
   * "{workspaceId}/{yyyy-mm}/{attachmentId}_{safeName}". */
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === Web Push (Stage 4) ===
// One row per browser/device subscription. `endpoint` is the push service
// URL (FCM / Mozilla / Apple) — used both as the destination and the
// dedup key. `p256dh_key`/`auth_key` are base64-url subscription material
// from PushSubscription.getKey(). Rows are removed on HTTP 410 Gone.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dhKey: text("p256dh_key").notNull(),
  authKey: text("auth_key").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
});

// Single-row VAPID identity (id=1). Sysadmin-editable through admin UI;
// falls back to env (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT) when missing.
// `subject` is mailto: URL — required by RFC 8292 for accountability.
export const vapidSettings = pgTable("vapid_settings", {
  id: integer("id").primaryKey().default(1),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

// === Calls (Stage 5) ===
// One row per WebRTC call. `channel_id` ties to the originating chat channel
// (DM = 2 participants, regular channel = mesh up to 5). `end_reason`
// distinguishes 'completed' / 'declined' / 'missed' / 'failed' — drives the
// system-message text inserted on call end.
export const chatCalls = pgTable("chat_calls", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => chatChannels.id, { onDelete: "cascade" }),
  initiatorUserId: integer("initiator_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  callType: text("call_type", { enum: ["audio", "video"] }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
  endReason: text("end_reason", {
    enum: ["completed", "declined", "missed", "failed"],
  }),
});

// Per-user participation log for a call. Active participant = row with
// `left_at IS NULL`. PK keeps reconnects idempotent (re-join overwrites
// joined_at via INSERT … ON CONFLICT).
export const chatCallParticipants = pgTable(
  "chat_call_participants",
  {
    callId: integer("call_id")
      .notNull()
      .references(() => chatCalls.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }),
    leftAt: timestamp("left_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.callId, t.userId] }),
  }),
);

// STUN/TURN config for clients. Sysadmin-managed. `enabled` lets ops turn
// an entry off without losing the credentials. Loaded once into the
// RTCPeerConnection at call start; not hot-reloaded mid-call.
export const iceServers = pgTable("ice_servers", {
  id: serial("id").primaryKey(),
  urls: text("urls").notNull(),
  username: text("username"),
  credential: text("credential"),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
