import { Hono } from "hono";
import * as XLSX from "xlsx";
import {
  logisticsClusterTariffSets,
  logisticsClusterTariffs,
  refCommissions,
  refLogisticsTariffs,
  refSettings,
  refStorage,
  shops,
} from "../db/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { DB } from "../db/client";
import type { SessionUser } from "../auth/utils";
import { canManageWorkspace, requireSysadmin } from "../middleware/session";
import { loadActiveTariffRows, resolveTariffSetId } from "../settings/tariffSets";

type RefsEnv = { Variables: { user: SessionUser } };

interface ParsedRow {
  volumeFrom: number;
  fromCluster: string;
  toCluster: string;
  tariffLte300: number;
  tariffGt300: number;
}

const parseClusterXlsx = (buf: Buffer): ParsedRow[] | string => {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    return `xlsx parse: ${(e as Error).message}`;
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
    });
    if (aoa.length < 2) continue;
    const header = (aoa[0] as Array<unknown>).map((v) =>
      String(v ?? "").trim(),
    );
    const idxVol = header.findIndex((h) => /объ.м/i.test(h));
    const idxFrom = header.findIndex((h) => /кластер отправки/i.test(h));
    const idxTo = header.findIndex((h) => /кластер назначения/i.test(h));
    const idxLte = header.findIndex((h) => /до 300/i.test(h));
    const idxGt = header.findIndex((h) => /свыше 300/i.test(h));
    if (idxVol < 0 || idxFrom < 0 || idxTo < 0 || idxLte < 0 || idxGt < 0) {
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
    if (out.length > 0) return out;
  }
  return "Не нашёл лист с нужной структурой. Должны быть колонки «Объём…», «Кластер отправки», «Кластер назначения», «…до 300», «…свыше 300».";
};

/** Resolve a shopId: explicit ?shopId= or first shop in workspace. */
const resolveShopFromQuery = async (
  db: DB,
  user: SessionUser,
  explicit: string | undefined,
): Promise<number | { status: 400 | 404; error: string }> => {
  let candidate: number;
  if (explicit !== undefined && explicit !== "") {
    const n = Number(explicit);
    if (!Number.isFinite(n) || n <= 0)
      return { status: 400, error: "invalid shopId" };
    candidate = n;
  } else {
    const [first] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.workspaceId, user.workspaceId))
      .limit(1);
    if (!first) return { status: 400, error: "no shop available" };
    candidate = first.id;
  }
  const [own] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(
      and(eq(shops.id, candidate), eq(shops.workspaceId, user.workspaceId)),
    );
  if (!own) return { status: 404, error: "shop not found" };
  return candidate;
};

export function refsRoutes(db: DB): Hono<RefsEnv> {
  const app = new Hono<RefsEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const shopResult = await resolveShopFromQuery(
      db,
      user,
      c.req.query("shopId"),
    );

    const [commissionRows, storageRows, tariffRows, settingsRows] =
      await Promise.all([
        db.select().from(refCommissions),
        db.select().from(refStorage),
        db
          .select()
          .from(refLogisticsTariffs)
          .orderBy(asc(refLogisticsTariffs.volumeFrom)),
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
    for (const cat of commissions) {
      if (!cat.category) continue;
      if (!categories[cat.category]) categories[cat.category] = [];
      if (cat.productType && !categories[cat.category].includes(cat.productType)) {
        categories[cat.category].push(cat.productType);
      }
    }
    for (const cat of Object.keys(categories)) categories[cat].sort();

    type ClusterRow = {
      volumeFrom: number;
      fromCluster: string;
      toCluster: string;
      tariffLte300: number;
      tariffGt300: number;
    };
    let logisticsClusterTariffsRows: ClusterRow[] = [];
    let kgtClusterTariffsRows: ClusterRow[] | null = null;
    let activeTariffSetId: number | null = null;
    let activeKgtTariffSetId: number | null = null;
    if (typeof shopResult === "number") {
      logisticsClusterTariffsRows = await loadActiveTariffRows(
        db,
        shopResult,
        user.id,
        "regular",
      );
      activeTariffSetId = await resolveTariffSetId(
        db,
        shopResult,
        user.id,
        "regular",
      );
      activeKgtTariffSetId = await resolveTariffSetId(
        db,
        shopResult,
        user.id,
        "kgt",
      );
      if (activeKgtTariffSetId != null) {
        kgtClusterTariffsRows = await loadActiveTariffRows(
          db,
          shopResult,
          user.id,
          "kgt",
        );
      }
    }

    return c.json({
      commissions,
      storage,
      logisticsTariffs,
      logisticsClusterTariffs: logisticsClusterTariffsRows,
      kgtClusterTariffs: kgtClusterTariffsRows,
      logisticsSettings: settingsMap.logisticsSettings ?? {},
      lists: settingsMap.lists ?? {},
      categories,
      activeTariffSetId,
      activeKgtTariffSetId,
    });
  });

  // ── Cluster tariff sets ─────────────────────────────────────────────────
  // List sets visible to the workspace: globals + workspace-owned.
  app.get("/cluster-logistics/sets", async (c) => {
    const user = c.get("user");

    const allSets = await db
      .select()
      .from(logisticsClusterTariffSets)
      .where(
        or(
          isNull(logisticsClusterTariffSets.workspaceId),
          eq(logisticsClusterTariffSets.workspaceId, user.workspaceId),
        ),
      )
      .orderBy(desc(logisticsClusterTariffSets.uploadedAt));

    const counts = new Map<number, number>();
    if (allSets.length > 0) {
      const ids = allSets.map((s) => s.id);
      const rows = await db
        .select({ setId: logisticsClusterTariffs.setId })
        .from(logisticsClusterTariffs)
        .where(inArray(logisticsClusterTariffs.setId, ids));
      for (const r of rows) counts.set(r.setId, (counts.get(r.setId) ?? 0) + 1);
    }

    return c.json(
      allSets.map((s) => ({
        id: s.id,
        // Stage-2 compat: client still uses `shopId` to discriminate scope.
        // workspaceId NULL → "global", non-null → "shop" (workspace-owned).
        shopId: s.workspaceId,
        scope: s.workspaceId === null ? "global" : "shop",
        name: s.name,
        kind: s.kind,
        uploadedAt: s.uploadedAt.getTime(),
        rowCount: counts.get(s.id) ?? 0,
      })),
    );
  });

  // Upload a new cluster tariff set. Body: multipart with `file` (xlsx) +
  // form fields `name`, `scope` ("global" | "shop"), `shopId` (when scope=shop).
  // - scope=global requires sysadmin
  // - scope=shop  requires owner/manager of current workspace; the chosen
  //   shopId must belong to the workspace
  app.post("/cluster-logistics/sets", async (c) => {
    const user = c.get("user");
    let body: FormData;
    try {
      body = await c.req.formData();
    } catch {
      return c.json({ error: "expected multipart/form-data" }, 400);
    }
    const file = body.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing 'file' field" }, 400);
    }
    const name = String(body.get("name") ?? "").trim();
    if (!name) return c.json({ error: "name is required" }, 400);
    const scopeStr = String(body.get("scope") ?? "");
    if (scopeStr !== "global" && scopeStr !== "shop") {
      return c.json({ error: "scope must be 'global' or 'shop'" }, 400);
    }
    const kindRaw = String(body.get("kind") ?? "regular");
    if (kindRaw !== "regular" && kindRaw !== "kgt") {
      return c.json({ error: "kind must be 'regular' or 'kgt'" }, 400);
    }
    const kind: "regular" | "kgt" = kindRaw;

    let workspaceIdForSet: number | null = null;
    if (scopeStr === "global") {
      if (!user.isSysadmin) {
        return c.json(
          { error: "только sysadmin может загружать глобальные наборы" },
          403,
        );
      }
    } else {
      if (!canManageWorkspace(user.workspaceRole)) {
        return c.json(
          { error: "только owner или manager workspace'а может загружать наборы" },
          403,
        );
      }
      const raw = body.get("shopId");
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0)
        return c.json({ error: "shopId required for scope=shop" }, 400);
      const [own] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.id, n), eq(shops.workspaceId, user.workspaceId)));
      if (!own) return c.json({ error: "shop not found" }, 404);
      workspaceIdForSet = user.workspaceId;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseClusterXlsx(buf);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const now = new Date();
    const [created] = await db
      .insert(logisticsClusterTariffSets)
      .values({
        workspaceId: workspaceIdForSet,
        name,
        kind,
        uploadedAt: now,
        createdAt: now,
      })
      .returning();

    const CHUNK = 500;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed
        .slice(i, i + CHUNK)
        .map((r) => ({ ...r, setId: created.id }));
      await db.insert(logisticsClusterTariffs).values(slice);
    }

    const fromSet = new Set(parsed.map((r) => r.fromCluster));
    const toSet = new Set(parsed.map((r) => r.toCluster));
    return c.json(
      {
        id: created.id,
        shopId: created.workspaceId,
        scope: created.workspaceId === null ? "global" : "shop",
        name: created.name,
        kind: created.kind,
        uploadedAt: created.uploadedAt.getTime(),
        rowCount: parsed.length,
        fromClusters: [...fromSet].sort(),
        toClusters: [...toSet].sort(),
      },
      201,
    );
  });

  // Delete a cluster tariff set. Global → sysadmin. Workspace-owned →
  // workspace owner/manager.
  app.delete("/cluster-logistics/sets/:id", async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    const [set] = await db
      .select()
      .from(logisticsClusterTariffSets)
      .where(eq(logisticsClusterTariffSets.id, id));
    if (!set) return c.json({ error: "not found" }, 404);

    if (set.workspaceId === null) {
      if (!user.isSysadmin)
        return c.json(
          { error: "только sysadmin удаляет глобальные наборы" },
          403,
        );
    } else {
      if (set.workspaceId !== user.workspaceId)
        return c.json({ error: "forbidden" }, 403);
      if (!canManageWorkspace(user.workspaceRole))
        return c.json(
          { error: "только owner или manager удаляет наборы команды" },
          403,
        );
    }

    await db
      .delete(logisticsClusterTariffSets)
      .where(eq(logisticsClusterTariffSets.id, id));
    return c.body(null, 204);
  });

  // Stats endpoint kept for backward compat — returns counts of the resolved
  // active set for the requested shop (or workspace's first shop).
  app.get("/cluster-logistics", async (c) => {
    const user = c.get("user");
    const shopResult = await resolveShopFromQuery(
      db,
      user,
      c.req.query("shopId"),
    );
    if (typeof shopResult !== "number") {
      return c.json({ count: 0, fromClusters: [], toClusters: [] });
    }
    const rows = await loadActiveTariffRows(db, shopResult, user.id);
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

  // Legacy upload endpoint — now creates a NEW global set (sysadmin only)
  // named after the upload date. Kept for backwards compat with the old UI.
  app.post("/cluster-logistics/upload", requireSysadmin, async (c) => {
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
    const parsed = parseClusterXlsx(buf);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const now = new Date();
    const autoName = `Глобальный набор от ${now.toISOString().slice(0, 10)}`;
    const [created] = await db
      .insert(logisticsClusterTariffSets)
      .values({
        workspaceId: null,
        name: autoName,
        uploadedAt: now,
        createdAt: now,
      })
      .returning();

    const CHUNK = 500;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed
        .slice(i, i + CHUNK)
        .map((r) => ({ ...r, setId: created.id }));
      await db.insert(logisticsClusterTariffs).values(slice);
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
