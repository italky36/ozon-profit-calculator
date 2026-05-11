import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const DB_PATH = process.env.DB_PATH ?? "data/app.db";
const MIGRATIONS_DIR = "server/db/migrations";
const FALLBACK_TAX_FILE = "src/data/defaultTaxSettings.json";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@example.com")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

if (fs.existsSync(MIGRATIONS_DIR)) {
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(MIGRATIONS_DIR) });
}

// Resolve default tax settings: prefer ref_settings (filled by extract-data),
// fall back to checked-in JSON.
let defaultTaxSettings;
const fromRefs = sqlite
  .prepare("SELECT value FROM ref_settings WHERE key = ?")
  .get("defaultTaxSettings");
if (fromRefs) {
  defaultTaxSettings = JSON.parse(fromRefs.value);
} else if (fs.existsSync(FALLBACK_TAX_FILE)) {
  defaultTaxSettings = JSON.parse(fs.readFileSync(FALLBACK_TAX_FILE, "utf8"));
} else {
  console.error("no defaultTaxSettings available — run extract-data.mjs first");
  process.exit(1);
}

const now = Date.now();

// 1. Seed first admin if users table is empty.
const userCount = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n;
let adminUserId = null;
if (userCount === 0) {
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const result = sqlite
    .prepare(
      "INSERT INTO users (email, password_hash, role, is_verified, created_at, updated_at) VALUES (?, ?, 'admin', 1, ?, ?)",
    )
    .run(ADMIN_EMAIL, passwordHash, now, now);
  adminUserId = Number(result.lastInsertRowid);
  console.log("");
  console.log("✅ First admin created:");
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log("   ⚠️  Change the password after first login!");
  console.log("");
} else {
  const existingAdmin = sqlite
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get();
  adminUserId = existingAdmin?.id ?? null;
  console.log(
    `users table has ${userCount} rows, skipping admin seed (admin id=${adminUserId ?? "none"})`,
  );
}

// 2. Seed user_settings if absent. Bind to first admin when available so the
//    legacy single-tenant row becomes the admin's personal settings (Stage 8
//    will rely on user_id being set).
const existingSettings = sqlite
  .prepare("SELECT id, user_id FROM user_settings WHERE id = 1")
  .get();
if (!existingSettings) {
  sqlite
    .prepare(
      "INSERT INTO user_settings (id, user_id, tax_settings, updated_at) VALUES (1, ?, ?, ?)",
    )
    .run(adminUserId, JSON.stringify(defaultTaxSettings), now);
  console.log("seeded user_settings");
} else if (existingSettings.user_id == null && adminUserId != null) {
  sqlite
    .prepare("UPDATE user_settings SET user_id = ?, updated_at = ? WHERE id = 1")
    .run(adminUserId, now);
  console.log(`backfilled user_settings.user_id = ${adminUserId}`);
} else {
  console.log("user_settings already present, skipping");
}

// 3. Seed reference coffee-machine product if products table is empty.
const productCount = sqlite
  .prepare("SELECT COUNT(*) as n FROM products")
  .get().n;

if (productCount === 0) {
  const insert = sqlite.prepare(`
    INSERT INTO products (
      id, article_id, product_name, category, product_type,
      is_kgt, is_kazakhstan, is_fire_hazard,
      planned_storage_days, volume_l, vat_rate, redemption_percent,
      sales_plan, logistics_mode, local_share, clusters_count,
      current_price, discount_percent, marketing_percent,
      real_fbs_delivery_cost, real_fbs_return_cost, acceptance_tariff,
      cost_price, extra_expenses_per_unit, white_purchase,
      incoming_vat_purchase, incoming_vat_rate,
      created_at, updated_at, ozon_product_id
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, NULL
    )
  `);

  insert.run(
    randomUUID(),
    "TEST-001",
    "Кофемашина (пример)",
    "Кофеварки и кофемашины",
    "Автоматическая кофемашина",
    0,
    0,
    0,
    30,
    209,
    "0.05",
    90,
    10,
    "Авто",
    0.5,
    "Считать без наценки",
    337000,
    0.345,
    0,
    500,
    250,
    "Доверительная приемка",
    87000,
    0,
    1,
    0,
    0,
    now,
    now,
  );
  console.log("seeded reference coffee-machine product");
} else {
  console.log(`products table has ${productCount} rows, skipping seed`);
}

sqlite.close();
console.log(`\nDone. DB at ${DB_PATH}.`);
