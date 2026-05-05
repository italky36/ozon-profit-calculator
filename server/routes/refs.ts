import { Hono } from "hono";
import {
  refCommissions,
  refStorage,
  refLogisticsTariffs,
  refSettings,
} from "../db/schema";
import { asc } from "drizzle-orm";
import type { DB } from "../db/client";

export function refsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const [commissionRows, storageRows, tariffRows, settingsRows] =
      await Promise.all([
        db.select().from(refCommissions),
        db.select().from(refStorage),
        db.select().from(refLogisticsTariffs).orderBy(asc(refLogisticsTariffs.volumeFrom)),
        db.select().from(refSettings),
      ]);

    const commissions = commissionRows.map((r) => ({
      key: r.key,
      category: r.category,
      productType: r.productType,
      fbo: r.fboBuckets,
      fbs: r.fbsBuckets,
      realFbs: r.realFbsBuckets,
    }));

    const storage = storageRows.map((r) => ({
      key: r.key,
      category: r.category,
      productType: r.productType,
      freeStorageDays: r.freeStorageDays,
      freeStorageDaysKgt: r.freeStorageDaysKgt,
      freeStorageDaysKz: r.freeStorageDaysKz,
    }));

    const logisticsTariffs = tariffRows.map((r) => ({
      volumeFrom: r.volumeFrom,
      volumeTo: r.volumeTo,
      localUpTo300: r.localUpTo300,
      nonLocalUpTo300: r.nonLocalUpTo300,
      localOver300: r.localOver300,
      nonLocalOver300: r.nonLocalOver300,
    }));

    const settingsMap: Record<string, unknown> = {};
    for (const row of settingsRows) settingsMap[row.key] = row.value;

    const categories: Record<string, string[]> = {};
    for (const c of commissions) {
      if (!c.category) continue;
      if (!categories[c.category]) categories[c.category] = [];
      if (c.productType && !categories[c.category].includes(c.productType)) {
        categories[c.category].push(c.productType);
      }
    }
    for (const cat of Object.keys(categories)) categories[cat].sort();

    return c.json({
      commissions,
      storage,
      logisticsTariffs,
      logisticsSettings: settingsMap.logisticsSettings ?? {},
      lists: settingsMap.lists ?? {},
      categories,
    });
  });

  return app;
}
