import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { refSettings } from "../db/schema";
import type { DB } from "../db/client";
import type { TaxSettings } from "../../src/types";

const FALLBACK_FILE = "src/data/defaultTaxSettings.json";

let fileCache: TaxSettings | null = null;

const readFromFile = (): TaxSettings | null => {
  if (fileCache) return fileCache;
  try {
    const abs = path.resolve(process.cwd(), FALLBACK_FILE);
    if (!fs.existsSync(abs)) return null;
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as TaxSettings;
    fileCache = parsed;
    return parsed;
  } catch {
    return null;
  }
};

/** Read default TaxSettings from ref_settings (filled by extract-data.mjs);
 * fall back to the checked-in JSON; finally — minimal hard-coded defaults
 * (used in test envs that skip extract-data). */
export function readDefaultTaxSettings(db: DB): TaxSettings {
  const row = db
    .select()
    .from(refSettings)
    .where(eq(refSettings.key, "defaultTaxSettings"))
    .get();
  if (row && row.value && typeof row.value === "object") {
    return row.value as TaxSettings;
  }
  const fromFile = readFromFile();
  if (fromFile) return fromFile;
  return {
    damageRate: 0.01,
    taxSystem: "УСН Доходы минус расходы",
    usnIncomeRate: 0.06,
    usnIncomeMinusRate: 0.07,
    ausnIncomeRate: 0.08,
    ausnIncomeMinusRate: 0.2,
    osnoOooRate: 0.25,
    osnoIpAnnualIncome: 2400000,
    npdRate: 0.04,
    partyExtraExpenses: 100,
  };
}
