import fs from "node:fs";
import path from "node:path";
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
let adminWorkspaceId = null;
if (userCount === 0) {
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const result = sqlite
    .prepare(
      "INSERT INTO users (email, password_hash, role, is_sysadmin, is_verified, created_at, updated_at) VALUES (?, ?, 'admin', 1, 1, ?, ?)",
    )
    .run(ADMIN_EMAIL, passwordHash, now, now);
  adminUserId = Number(result.lastInsertRowid);

  // Personal workspace для админа (Stage 1: один user = один workspace через
  // UNIQUE на workspace_members.user_id).
  const prefix = ADMIN_EMAIL.split("@")[0];
  const slug = `${prefix.replace(/\./g, "-").toLowerCase()}-${adminUserId}`;
  const wsResult = sqlite
    .prepare(
      "INSERT INTO workspaces (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(`Workspace ${prefix}`, slug, now, now);
  adminWorkspaceId = Number(wsResult.lastInsertRowid);
  sqlite
    .prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)",
    )
    .run(adminWorkspaceId, adminUserId, now);

  console.log("");
  console.log("✅ First admin created:");
  console.log(`   Email:     ${ADMIN_EMAIL}`);
  console.log(`   Password:  ${ADMIN_PASSWORD}`);
  console.log(`   Workspace: «Workspace ${prefix}» (slug: ${slug})`);
  console.log("   ⚠️  Change the password after first login!");
  console.log("");
} else {
  const existingAdmin = sqlite
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get();
  adminUserId = existingAdmin?.id ?? null;
  if (adminUserId != null) {
    const existingMember = sqlite
      .prepare(
        "SELECT workspace_id FROM workspace_members WHERE user_id = ?",
      )
      .get(adminUserId);
    adminWorkspaceId = existingMember?.workspace_id ?? null;
  }
  console.log(
    `users table has ${userCount} rows, skipping admin seed (admin id=${adminUserId ?? "none"}, workspace=${adminWorkspaceId ?? "none"})`,
  );
}

// 2. Seed default shop + user_settings for the admin if absent.
//    Each user gets a default shop "Мой магазин" (code M1) with default tax
//    settings; the same logic runs at registration via auth.verifyEmail.
if (adminUserId != null) {
  const existingShop = sqlite
    .prepare("SELECT id FROM shops WHERE user_id = ? LIMIT 1")
    .get(adminUserId);
  let adminShopId = existingShop?.id ?? null;

  if (!adminShopId) {
    const result = sqlite
      .prepare(
        `INSERT INTO shops (
          user_id, workspace_id, name, short_name, color, tax_settings,
          auto_refresh_enabled, auto_refresh_interval_min,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 0, 30, ?, ?)`,
      )
      .run(
        adminUserId,
        adminWorkspaceId,
        "Мой магазин",
        "M1",
        JSON.stringify(defaultTaxSettings),
        now,
        now,
      );
    adminShopId = Number(result.lastInsertRowid);
    console.log("seeded default shop M1 for admin");
  }

  const existingSettings = sqlite
    .prepare("SELECT id FROM user_settings WHERE user_id = ?")
    .get(adminUserId);
  if (!existingSettings) {
    sqlite
      .prepare(
        "INSERT INTO user_settings (user_id, active_shop_id, updated_at) VALUES (?, ?, ?)",
      )
      .run(adminUserId, adminShopId, now);
    console.log("seeded user_settings");
  } else {
    sqlite
      .prepare(
        "UPDATE user_settings SET active_shop_id = COALESCE(active_shop_id, ?), updated_at = ? WHERE user_id = ?",
      )
      .run(adminShopId, now, adminUserId);
  }
}

sqlite.close();
console.log(`\nDone. DB at ${DB_PATH}.`);
