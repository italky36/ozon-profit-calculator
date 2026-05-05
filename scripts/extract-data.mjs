import { read, utils } from "xlsx";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const SRC =
  process.env.EXTRACT_SOURCE ?? "C:/Users/admin/Downloads/Техника — копия2.xlsx";
const DB_PATH = process.env.DB_PATH ?? "data/app.db";
const MIGRATIONS_DIR = "server/db/migrations";

if (!fs.existsSync(SRC)) {
  console.error(`Excel source not found: ${SRC}`);
  console.error("Set EXTRACT_SOURCE env var to point at the spreadsheet.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const wb = read(fs.readFileSync(SRC), { type: "buffer", cellDates: false });
console.log("Sheets:", wb.SheetNames);

const sheetToObjects = (name) => {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet ${name} not found`);
  return utils.sheet_to_json(ws, { defval: null });
};

// --- commissions ---
const commissionsRaw = sheetToObjects("EXPORT_commissions");
const commissions = commissionsRaw.map((r) => ({
  key: r.key,
  category: r.category,
  productType: r.productType,
  fbo: {
    upTo100: r.fbo_upTo100,
    upTo300: r.fbo_upTo300,
    upTo1500: r.fbo_upTo1500,
    upTo5000: r.fbo_upTo5000,
    upTo10000: r.fbo_upTo10000,
    over10000: r.fbo_over10000,
  },
  fbs: {
    upTo100: r.fbs_upTo100,
    upTo300: r.fbs_upTo300,
    upTo1500: r.fbs_upTo1500,
    upTo5000: r.fbs_upTo5000,
    upTo10000: r.fbs_upTo10000,
    over10000: r.fbs_over10000,
  },
  realFbs: {
    upTo1500: r.realFbs_upTo1500,
    upTo5000: r.realFbs_upTo5000,
    upTo10000: r.realFbs_upTo10000,
    over10000: r.realFbs_over10000,
  },
}));

// --- storage --- (skip blank/header rows that lack category)
const storage = sheetToObjects("EXPORT_storage").filter(
  (r) => r.key && r.category && r.productType,
);

// --- logisticsTariffs ---
const logisticsTariffs = sheetToObjects("EXPORT_logisticsTariffs");

// --- settings (column B holds JSON strings) ---
const settingsWs = wb.Sheets["EXPORT_settings"];
if (!settingsWs) throw new Error("EXPORT_settings not found");
const settingsRows = utils.sheet_to_json(settingsWs, { header: 1, defval: null });
const settingsMap = {};
for (const row of settingsRows) {
  const key = row[0];
  const val = row[1];
  if (!key || val == null) continue;
  let parsed = val;
  if (typeof val === "string") {
    const s = val.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        parsed = JSON.parse(s);
      } catch {
        parsed = val;
      }
    }
  }
  settingsMap[key] = parsed;
}

const pickKey = (obj, ...candidates) => {
  for (const c of candidates) if (c in obj) return obj[c];
  return undefined;
};

const lists = pickKey(settingsMap, "lists.json", "lists", "Lists");
const logisticsSettings = pickKey(
  settingsMap,
  "logisticsSettings.json",
  "logisticsSettings",
);
const defaultTaxSettings = pickKey(
  settingsMap,
  "defaultTaxSettings.json",
  "defaultTaxSettings",
);

// --- open DB and apply migrations ---
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

if (!fs.existsSync(MIGRATIONS_DIR)) {
  throw new Error(
    `migrations folder missing: ${MIGRATIONS_DIR} — run "npx drizzle-kit generate" first`,
  );
}
migrate(drizzle(sqlite), { migrationsFolder: path.resolve(MIGRATIONS_DIR) });

// --- write reference tables ---
const upsertCommission = sqlite.prepare(`
  INSERT INTO ref_commissions (key, category, product_type, fbo_buckets, fbs_buckets, real_fbs_buckets)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    category = excluded.category,
    product_type = excluded.product_type,
    fbo_buckets = excluded.fbo_buckets,
    fbs_buckets = excluded.fbs_buckets,
    real_fbs_buckets = excluded.real_fbs_buckets
`);

const upsertStorage = sqlite.prepare(`
  INSERT INTO ref_storage (key, category, product_type, free_storage_days, free_storage_days_kgt, free_storage_days_kz)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    category = excluded.category,
    product_type = excluded.product_type,
    free_storage_days = excluded.free_storage_days,
    free_storage_days_kgt = excluded.free_storage_days_kgt,
    free_storage_days_kz = excluded.free_storage_days_kz
`);

const clearTariffs = sqlite.prepare("DELETE FROM ref_logistics_tariffs");
const insertTariff = sqlite.prepare(`
  INSERT INTO ref_logistics_tariffs (volume_from, volume_to, local_up_to_300, non_local_up_to_300, local_over_300, non_local_over_300)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const upsertSetting = sqlite.prepare(`
  INSERT INTO ref_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const tx = sqlite.transaction(() => {
  for (const c of commissions) {
    upsertCommission.run(
      c.key,
      c.category,
      c.productType,
      JSON.stringify(c.fbo),
      JSON.stringify(c.fbs),
      JSON.stringify(c.realFbs),
    );
  }
  for (const s of storage) {
    upsertStorage.run(
      s.key,
      s.category,
      s.productType,
      s.freeStorageDays,
      s.freeStorageDaysKgt,
      s.freeStorageDaysKz,
    );
  }
  clearTariffs.run();
  for (const t of logisticsTariffs) {
    insertTariff.run(
      t.volumeFrom,
      t.volumeTo,
      t.localUpTo300,
      t.nonLocalUpTo300,
      t.localOver300,
      t.nonLocalOver300,
    );
  }
  if (lists) upsertSetting.run("lists", JSON.stringify(lists));
  if (logisticsSettings)
    upsertSetting.run("logisticsSettings", JSON.stringify(logisticsSettings));
  if (defaultTaxSettings)
    upsertSetting.run("defaultTaxSettings", JSON.stringify(defaultTaxSettings));
});

tx();

console.log(`commissions: ${commissions.length}`);
console.log(`storage: ${storage.length}`);
console.log(`logisticsTariffs: ${logisticsTariffs.length}`);
console.log(
  "settings:",
  [lists && "lists", logisticsSettings && "logisticsSettings", defaultTaxSettings && "defaultTaxSettings"]
    .filter(Boolean)
    .join(", "),
);

sqlite.close();
console.log(`\nWrote to ${DB_PATH}.`);
