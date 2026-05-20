import fs from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:dev_password_change_me@localhost:5433/ozon_calc";
const FALLBACK_TAX_FILE = "src/data/defaultTaxSettings.json";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@example.com")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

let defaultTaxSettings;
const fromRefs = (
  await client.query("SELECT value FROM ref_settings WHERE key = $1", [
    "defaultTaxSettings",
  ])
).rows[0];
if (fromRefs) {
  defaultTaxSettings = fromRefs.value; // jsonb already parsed
} else if (fs.existsSync(FALLBACK_TAX_FILE)) {
  defaultTaxSettings = JSON.parse(fs.readFileSync(FALLBACK_TAX_FILE, "utf8"));
} else {
  console.error("no defaultTaxSettings available — run extract-data first");
  process.exit(1);
}

const now = new Date();

// 1. Seed first sysadmin + their workspace if users table is empty.
const userCount = Number(
  (await client.query("SELECT COUNT(*) AS n FROM users")).rows[0].n,
);
let adminUserId = null;
let adminWorkspaceId = null;

if (userCount === 0) {
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const result = await client.query(
    `INSERT INTO users (email, password_hash, is_sysadmin, is_verified, created_at, updated_at)
     VALUES ($1, $2, true, true, $3, $3) RETURNING id`,
    [ADMIN_EMAIL, passwordHash, now],
  );
  adminUserId = result.rows[0].id;

  const prefix = ADMIN_EMAIL.split("@")[0];
  const slug = `${prefix.replace(/\./g, "-").toLowerCase()}-${adminUserId}`;
  const wsResult = await client.query(
    `INSERT INTO workspaces (name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, $3) RETURNING id`,
    [`Workspace ${prefix}`, slug, now],
  );
  adminWorkspaceId = wsResult.rows[0].id;
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at)
     VALUES ($1, $2, 'owner', 'active', $3)`,
    [adminWorkspaceId, adminUserId, now],
  );

  console.log("");
  console.log("✅ First sysadmin created:");
  console.log(`   Email:     ${ADMIN_EMAIL}`);
  console.log(`   Password:  ${ADMIN_PASSWORD}`);
  console.log(`   Workspace: «Workspace ${prefix}» (slug: ${slug})`);
  console.log("   ⚠️  Change the password after first login!");
  console.log("");
} else {
  const existingAdmin = (
    await client.query(
      "SELECT id FROM users WHERE is_sysadmin = true ORDER BY id LIMIT 1",
    )
  ).rows[0];
  adminUserId = existingAdmin?.id ?? null;
  if (adminUserId != null) {
    const existingMember = (
      await client.query(
        "SELECT workspace_id FROM workspace_members WHERE user_id = $1",
        [adminUserId],
      )
    ).rows[0];
    adminWorkspaceId = existingMember?.workspace_id ?? null;
  }
  console.log(
    `users table has ${userCount} rows, skipping admin seed (admin id=${adminUserId ?? "none"}, workspace=${adminWorkspaceId ?? "none"})`,
  );
}

// 2. Seed default shop + user_settings for the admin if absent.
if (adminUserId != null && adminWorkspaceId != null) {
  const existingShop = (
    await client.query("SELECT id FROM shops WHERE workspace_id = $1 LIMIT 1", [
      adminWorkspaceId,
    ])
  ).rows[0];
  let adminShopId = existingShop?.id ?? null;

  if (!adminShopId) {
    const result = await client.query(
      `INSERT INTO shops (
        workspace_id, name, short_name, color, tax_settings,
        auto_refresh_enabled, auto_refresh_interval_min,
        created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, false, 30, $5, $5) RETURNING id`,
      [
        adminWorkspaceId,
        "Мой магазин",
        "M1",
        JSON.stringify(defaultTaxSettings),
        now,
      ],
    );
    adminShopId = result.rows[0].id;
    console.log("seeded default shop M1 for admin");
  }

  // Owner gets shop_member assignment so they can see their own shop.
  await client.query(
    `INSERT INTO shop_member (shop_id, user_id, created_at, created_by)
     VALUES ($1, $2, $3, $2) ON CONFLICT DO NOTHING`,
    [adminShopId, adminUserId, now],
  );

  const existingSettings = (
    await client.query(
      "SELECT id FROM user_settings WHERE user_id = $1",
      [adminUserId],
    )
  ).rows[0];
  if (!existingSettings) {
    await client.query(
      "INSERT INTO user_settings (user_id, active_shop_id, updated_at) VALUES ($1, $2, $3)",
      [adminUserId, adminShopId, now],
    );
    console.log("seeded user_settings");
  } else {
    await client.query(
      `UPDATE user_settings SET active_shop_id = COALESCE(active_shop_id, $1),
       updated_at = $2 WHERE user_id = $3`,
      [adminShopId, now, adminUserId],
    );
  }
}

await client.end();
console.log(`\nDone. PG at ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}.`);
