/** Метрики для админки sysadmin'а. Чистые функции без Hono — роутер
 *  использует их в server/routes/admin.ts. */
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

export interface DbMetrics {
  databaseSize: number;
  databaseSizePretty: string;
  topTables: Array<{ name: string; sizeBytes: number; sizePretty: string }>;
  activeConnections: number;
  maxConnections: number;
}

export interface SystemMetrics {
  loadAvg: { "1m": number; "5m": number; "15m": number };
  cpuCount: number;
  memTotalBytes: number;
  memFreeBytes: number;
  memUsedBytes: number;
  memUsedPercent: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedBytes: number;
  diskUsedPercent: number;
  diskPath: string;
  systemUptimeSec: number;
  processUptimeSec: number;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  mtime: string;
}

export interface BackupsMetrics {
  files: BackupFile[];
  totalSizeBytes: number;
  lastBackupAt: string | null;
  lastBackupAgeHours: number | null;
  backupDir: string;
  configured: boolean;
}

export async function getDbMetrics(db: DB): Promise<DbMetrics> {
  // Один round-trip — три простых запроса. Drizzle execute возвращает .rows.
  const sizeRes = await db.execute<{ size: string; pretty: string }>(sql`
    SELECT pg_database_size(current_database())::text AS size,
           pg_size_pretty(pg_database_size(current_database())) AS pretty
  `);
  const topRes = await db.execute<{
    name: string;
    size: string;
    pretty: string;
  }>(sql`
    SELECT relname AS name,
           pg_total_relation_size(relid)::text AS size,
           pg_size_pretty(pg_total_relation_size(relid)) AS pretty
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 5
  `);
  const connRes = await db.execute<{ active: string; max: string }>(sql`
    SELECT (SELECT count(*)::text FROM pg_stat_activity WHERE state IS NOT NULL) AS active,
           current_setting('max_connections') AS max
  `);

  return {
    databaseSize: Number(sizeRes.rows[0]?.size ?? 0),
    databaseSizePretty: sizeRes.rows[0]?.pretty ?? "0 bytes",
    topTables: topRes.rows.map((r) => ({
      name: r.name,
      sizeBytes: Number(r.size),
      sizePretty: r.pretty,
    })),
    activeConnections: Number(connRes.rows[0]?.active ?? 0),
    maxConnections: Number(connRes.rows[0]?.max ?? 0),
  };
}

const DISK_PROBE_PATH = process.env.BACKUP_DIR_IN_CONTAINER ?? "/srv/backups";

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const [l1, l5, l15] = os.loadavg();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;

  // statfs смонтированной точки с хоста (через bind-mount /var/backups).
  // Fallback на корень контейнера, если mount отсутствует — disk-метрика всё
  // равно вернётся, просто покажет overlay2 контейнера.
  let diskPath = DISK_PROBE_PATH;
  let stat: Awaited<ReturnType<typeof fs.statfs>>;
  try {
    stat = await fs.statfs(diskPath);
  } catch {
    diskPath = "/";
    stat = await fs.statfs(diskPath);
  }
  const diskTotal = stat.blocks * stat.bsize;
  const diskFree = stat.bavail * stat.bsize;
  const diskUsed = diskTotal - diskFree;

  return {
    loadAvg: { "1m": l1, "5m": l5, "15m": l15 },
    cpuCount: os.cpus().length,
    memTotalBytes: memTotal,
    memFreeBytes: memFree,
    memUsedBytes: memUsed,
    memUsedPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
    diskTotalBytes: diskTotal,
    diskFreeBytes: diskFree,
    diskUsedBytes: diskUsed,
    diskUsedPercent: diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0,
    diskPath,
    systemUptimeSec: os.uptime(),
    processUptimeSec: process.uptime(),
  };
}

const BACKUP_DIR = process.env.BACKUP_DIR_IN_CONTAINER ?? "/srv/backups";
const BACKUP_NAME_RE = /^db-\d{8}-\d{6}\.sql\.gz$/;

export async function getBackupsMetrics(): Promise<BackupsMetrics> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUP_DIR);
  } catch {
    return {
      files: [],
      totalSizeBytes: 0,
      lastBackupAt: null,
      lastBackupAgeHours: null,
      backupDir: BACKUP_DIR,
      configured: false,
    };
  }

  const valid = entries.filter((n) => BACKUP_NAME_RE.test(n));
  const stats = await Promise.all(
    valid.map(async (name) => {
      const st = await fs.stat(path.join(BACKUP_DIR, name));
      return { name, sizeBytes: st.size, mtime: st.mtime };
    }),
  );
  stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const total = stats.reduce((s, f) => s + f.sizeBytes, 0);
  const last = stats[0];

  return {
    files: stats.map((f) => ({
      name: f.name,
      sizeBytes: f.sizeBytes,
      mtime: f.mtime.toISOString(),
    })),
    totalSizeBytes: total,
    lastBackupAt: last?.mtime.toISOString() ?? null,
    lastBackupAgeHours: last
      ? (Date.now() - last.mtime.getTime()) / 1000 / 3600
      : null,
    backupDir: BACKUP_DIR,
    configured: true,
  };
}

/** Resolve filename against the backup directory after validating it as
 *  whitelist-shape `db-YYYYMMDD-HHMMSS.sql.gz`. Returns null если имя не
 *  валидно или файла нет — роут отдаёт 404. */
export async function resolveBackupPath(
  filename: string,
): Promise<{ fullPath: string; sizeBytes: number } | null> {
  if (!BACKUP_NAME_RE.test(filename)) return null;
  const full = path.join(BACKUP_DIR, filename);
  // path.join + регэксп уже исключают `..` / абсолютные пути, но проверим
  // итоговый prefix как defence-in-depth.
  if (!full.startsWith(BACKUP_DIR + path.sep) && full !== BACKUP_DIR) {
    return null;
  }
  try {
    const st = await fs.stat(full);
    if (!st.isFile()) return null;
    return { fullPath: full, sizeBytes: st.size };
  } catch {
    return null;
  }
}
