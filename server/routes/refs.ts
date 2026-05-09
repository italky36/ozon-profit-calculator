import { Hono } from "hono";
import * as XLSX from "xlsx";
import {
  refCommissions,
  refStorage,
  refLogisticsTariffs,
  refLogisticsClusterTariffs,
  refSettings,
} from "../db/schema";
import { asc } from "drizzle-orm";
import type { DB } from "../db/client";

export function refsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const [commissionRows, storageRows, tariffRows, settingsRows, clusterRows] =
      await Promise.all([
        db.select().from(refCommissions),
        db.select().from(refStorage),
        db.select().from(refLogisticsTariffs).orderBy(asc(refLogisticsTariffs.volumeFrom)),
        db.select().from(refSettings),
        db
          .select()
          .from(refLogisticsClusterTariffs)
          .orderBy(asc(refLogisticsClusterTariffs.volumeFrom)),
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

    const logisticsClusterTariffs = clusterRows.map((r) => ({
      volumeFrom: r.volumeFrom,
      fromCluster: r.fromCluster,
      toCluster: r.toCluster,
      tariffLte300: r.tariffLte300,
      tariffGt300: r.tariffGt300,
    }));

    return c.json({
      commissions,
      storage,
      logisticsTariffs,
      logisticsClusterTariffs,
      logisticsSettings: settingsMap.logisticsSettings ?? {},
      lists: settingsMap.lists ?? {},
      categories,
    });
  });

  // ── Per-cluster-pair logistics matrix ───────────────────────────────────
  // GET stats: количество тарифов + список уникальных кластеров.
  app.get("/cluster-logistics", async (c) => {
    const rows = await db.select().from(refLogisticsClusterTariffs);
    const fromSet = new Set<string>();
    const toSet = new Set<string>();
    for (const r of rows) {
      fromSet.add(r.fromCluster);
      toSet.add(r.toCluster);
    }
    return c.json({
      count: rows.length,
      fromClusters: [...fromSet].sort(),
      toClusters: [...toSet].sort(),
    });
  });

  // POST upload: принимает .xlsx, парсит, заменяет таблицу.
  app.post("/cluster-logistics/upload", async (c) => {
    let body: FormData;
    try {
      body = await c.req.formData();
    } catch {
      return c.json({ error: "expected multipart/form-data with 'file'" }, 400);
    }
    const file = body.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing 'file' field" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch (e) {
      return c.json({ error: `xlsx parse: ${(e as Error).message}` }, 400);
    }

    // Найти лист с нужной структурой (Объём + Кластер отправки + Кластер
    // назначения + 2 тарифа). Имя листа может меняться; ориентируемся по
    // заголовкам.
    interface ParsedRow {
      volumeFrom: number;
      fromCluster: string;
      toCluster: string;
      tariffLte300: number;
      tariffGt300: number;
    }
    let parsed: ParsedRow[] | null = null;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
      });
      if (aoa.length < 2) continue;
      const header = (aoa[0] as Array<unknown>).map((v) => String(v ?? "").trim());
      const idxVol = header.findIndex((h) => /объ.м/i.test(h));
      const idxFrom = header.findIndex((h) => /кластер отправки/i.test(h));
      const idxTo = header.findIndex((h) => /кластер назначения/i.test(h));
      const idxLte = header.findIndex((h) => /до 300/i.test(h));
      const idxGt = header.findIndex((h) => /свыше 300/i.test(h));
      if (
        idxVol < 0 ||
        idxFrom < 0 ||
        idxTo < 0 ||
        idxLte < 0 ||
        idxGt < 0
      ) {
        continue;
      }
      const out: ParsedRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i] as Array<unknown>;
        const vol = Number(row[idxVol]);
        const from = String(row[idxFrom] ?? "").trim();
        const to = String(row[idxTo] ?? "").trim();
        const tLte = Number(row[idxLte]);
        const tGt = Number(row[idxGt]);
        if (
          !Number.isFinite(vol) ||
          !from ||
          !to ||
          !Number.isFinite(tLte) ||
          !Number.isFinite(tGt)
        ) {
          continue;
        }
        out.push({
          volumeFrom: vol,
          fromCluster: from,
          toCluster: to,
          tariffLte300: tLte,
          tariffGt300: tGt,
        });
      }
      if (out.length > 0) {
        parsed = out;
        break;
      }
    }

    if (!parsed) {
      return c.json(
        {
          error:
            "Не нашёл лист с нужной структурой. Должны быть колонки «Объём…», «Кластер отправки», «Кластер назначения», «…до 300», «…свыше 300».",
        },
        400,
      );
    }

    // Заменяем таблицу целиком: сначала truncate, потом batch-insert.
    await db.delete(refLogisticsClusterTariffs);
    const CHUNK = 500;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed.slice(i, i + CHUNK);
      await db.insert(refLogisticsClusterTariffs).values(slice);
    }

    const fromSet = new Set(parsed.map((r) => r.fromCluster));
    const toSet = new Set(parsed.map((r) => r.toCluster));
    return c.json({
      inserted: parsed.length,
      fromClusters: [...fromSet].sort(),
      toClusters: [...toSet].sort(),
    });
  });

  return app;
}
