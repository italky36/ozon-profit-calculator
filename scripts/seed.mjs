import fs from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:dev_password_change_me@localhost:5433/ozon_calc";
const DATA_DIR = "src/data";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@example.com")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

function readJson(name) {
  const file = `${DATA_DIR}/${name}`;
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : null;
}

// 0. Заполнить ref_* таблицы из src/data/*.json если они пусты.
//    Эти JSON-снапшоты лежат в репо и копируются в Docker-образ. Они же
//    используются acceptance-тестом `__tests__/calc.test.ts`. Полный
//    источник правды — Excel-выгрузка через scripts/extract-data.mjs,
//    но на проде Excel-файла нет, и без ref_* калькулятор показывает
//    предупреждение «не нашли в таблице». Идемпотентно: если в таблице
//    уже что-то есть, не трогаем (значит extract-data уже отработал
//    или sysadmin загрузил вручную).
async function seedIfEmpty(table, label, rowsLoader, insertOne) {
  const cnt = Number(
    (await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n,
  );
  if (cnt > 0) {
    console.log(`${label}: уже заполнено (${cnt} строк) — пропускаем`);
    return;
  }
  const rows = rowsLoader();
  if (!rows || rows.length === 0) {
    console.log(`${label}: JSON-файл отсутствует или пуст — пропускаем`);
    return;
  }
  for (const r of rows) {
    await insertOne(r);
  }
  console.log(`${label}: засеяно ${rows.length} строк из JSON`);
}

await seedIfEmpty("ref_commissions", "ref_commissions", () => readJson("commissions.json"), async (c) => {
  await client.query(
    `INSERT INTO ref_commissions (key, category, product_type, fbo_buckets, fbs_buckets, real_fbs_buckets)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.key, c.category, c.productType, JSON.stringify(c.fbo), JSON.stringify(c.fbs), JSON.stringify(c.realFbs)],
  );
});
await seedIfEmpty("ref_storage", "ref_storage", () => readJson("storage.json"), async (s) => {
  await client.query(
    `INSERT INTO ref_storage (key, category, product_type, free_storage_days, free_storage_days_kgt, free_storage_days_kz)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.key, s.category, s.productType, s.freeStorageDays, s.freeStorageDaysKgt, s.freeStorageDaysKz],
  );
});
await seedIfEmpty("ref_logistics_tariffs", "ref_logistics_tariffs", () => readJson("logisticsTariffs.json"), async (t) => {
  await client.query(
    `INSERT INTO ref_logistics_tariffs (volume_from, volume_to, local_up_to_300, non_local_up_to_300, local_over_300, non_local_over_300)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [t.volumeFrom, t.volumeTo, t.localUpTo300, t.nonLocalUpTo300, t.localOver300, t.nonLocalOver300],
  );
});

// ref_settings: lists / logisticsSettings / defaultTaxSettings — три ключа.
const settingsSeeds = [
  ["lists", readJson("lists.json")],
  ["logisticsSettings", readJson("logisticsSettings.json")],
  ["defaultTaxSettings", readJson("defaultTaxSettings.json")],
];
for (const [key, value] of settingsSeeds) {
  if (!value) continue;
  await client.query(
    `INSERT INTO ref_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, JSON.stringify(value)],
  );
}

let defaultTaxSettings;
const fromRefs = (
  await client.query("SELECT value FROM ref_settings WHERE key = $1", [
    "defaultTaxSettings",
  ])
).rows[0];
if (fromRefs) {
  defaultTaxSettings = fromRefs.value; // jsonb already parsed
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

// 3. Seed ICE servers from TURN_* env vars (TURN+STUN для WebRTC-звонков).
//    Идемпотентно: если в ice_servers уже что-то есть — не трогаем (значит
//    sysadmin уже редактировал через /api/admin/ice). Иначе кладём три записи:
//    TURN udp/tcp + публичный Google STUN как fallback.
const iceCount = Number(
  (await client.query("SELECT COUNT(*) AS n FROM ice_servers")).rows[0].n,
);
const turnIp = process.env.TURN_EXTERNAL_IP;
const turnUser = process.env.TURN_USERNAME;
const turnPass = process.env.TURN_PASSWORD;
if (iceCount === 0 && turnIp && turnUser && turnPass) {
  const entries = [
    [`turn:${turnIp}:3478?transport=udp`, turnUser, turnPass, 0],
    [`turn:${turnIp}:3478?transport=tcp`, turnUser, turnPass, 1],
    ["stun:stun.l.google.com:19302", null, null, 99],
  ];
  for (const [urls, user, cred, sortOrder] of entries) {
    await client.query(
      `INSERT INTO ice_servers (urls, username, credential, enabled, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, $5, $5)`,
      [urls, user, cred, sortOrder, now],
    );
  }
  console.log(`seeded ${entries.length} ICE servers (turn://${turnIp})`);
} else if (iceCount === 0) {
  console.log(
    "ice_servers empty + no TURN_* env — звонки пойдут только через Google STUN fallback",
  );
}

await client.end();
console.log(`\nDone. PG at ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}.`);
