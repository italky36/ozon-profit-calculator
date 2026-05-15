// Smoke-check 0021 migration on a test copy of the DB.
// Usage: DB_PATH=data/app.db.test node scripts/check-migration.mjs
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

const DB_PATH = process.env.DB_PATH ?? "data/app.db.test";
const sqlite = new Database(DB_PATH);
sqlite.pragma("foreign_keys = ON");

console.log(`[check] db: ${DB_PATH}`);
console.log("[check] running migrations…");
migrate(drizzle(sqlite), {
  migrationsFolder: path.resolve("server/db/migrations"),
});

const tables = [
  "users",
  "workspaces",
  "workspace_members",
  "shops",
  "shop_member",
  "shop_user_settings",
  "products",
  "finance_transactions",
  "import_runs",
];
console.log("\n[check] row counts:");
for (const t of tables) {
  try {
    const c = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
    console.log(`  ${t.padEnd(28)} ${c.n}`);
  } catch (e) {
    console.log(`  ${t}: ERR ${e.message}`);
  }
}

console.log("\n[check] per-user products distribution:");
const perUser = sqlite
  .prepare(
    `SELECT p.user_id, u.email, COUNT(*) AS n
     FROM products p JOIN users u ON u.id = p.user_id
     GROUP BY p.user_id ORDER BY n DESC`,
  )
  .all();
for (const r of perUser) console.log(`  user=${r.email} → ${r.n} rows`);

console.log("\n[check] per-user finance distribution:");
const perUserFin = sqlite
  .prepare(
    `SELECT f.user_id, u.email, COUNT(*) AS n
     FROM finance_transactions f JOIN users u ON u.id = f.user_id
     GROUP BY f.user_id ORDER BY n DESC`,
  )
  .all();
for (const r of perUserFin) console.log(`  user=${r.email} → ${r.n} rows`);

console.log("\n[check] shop_member assignment:");
const sm = sqlite
  .prepare(
    `SELECT s.id AS shop_id, s.name AS shop_name, COUNT(sm.user_id) AS members
     FROM shops s LEFT JOIN shop_member sm ON sm.shop_id = s.id
     GROUP BY s.id ORDER BY s.id`,
  )
  .all();
for (const r of sm)
  console.log(`  shop=${r.shop_id} (${r.shop_name}) → ${r.members} members`);

console.log("\n[check] sample non-owner product (manual fields zeroed):");
const sample = sqlite
  .prepare(
    `SELECT p.user_id, u.email, p.article_id, p.cost_price, p.sales_plan, p.marketing_percent, p.product_name
     FROM products p JOIN users u ON u.id = p.user_id
     WHERE p.user_id NOT IN (
       SELECT wm.user_id FROM workspace_members wm WHERE wm.role = 'owner'
     )
     LIMIT 3`,
  )
  .all();
for (const r of sample) console.log(`  ${JSON.stringify(r)}`);

sqlite.close();
console.log("\n[check] done.");
