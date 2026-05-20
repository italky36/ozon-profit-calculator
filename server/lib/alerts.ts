/** Email-алерты sysadmin'у при превышении порогов. Дёргается setInterval'ом
 *  каждые ALERT_INTERVAL_MS из server/index.ts. Дедуп in-memory: одна и та же
 *  проблема не более одного письма в ALERT_DEDUP_MS. После рестарта state
 *  забывается — в худшем случае получим лишнее письмо, это приемлемо. */
import { getEmailClient, describeEmailSource } from "../email/client";
import { getSystemMetrics, getBackupsMetrics } from "./metrics";

export const ALERT_INTERVAL_MS = 5 * 60 * 1000; // 5 минут
export const ALERT_DEDUP_MS = 60 * 60 * 1000; // 1 час
const DISK_THRESHOLD_PCT = 90;
const RAM_THRESHOLD_PCT = 90;
const BACKUP_STALE_HOURS = 25;

type AlertKey = "disk" | "ram" | "backup-stale" | "backup-missing";

const lastSent = new Map<AlertKey, number>();

interface Alert {
  key: AlertKey;
  subject: string;
  body: string;
}

async function collectAlerts(): Promise<Alert[]> {
  const out: Alert[] = [];
  const sys = await getSystemMetrics();
  if (sys.diskUsedPercent >= DISK_THRESHOLD_PCT) {
    out.push({
      key: "disk",
      subject: `[profitcontrol] Disk ${sys.diskUsedPercent.toFixed(0)}% полный`,
      body: `Диск ${sys.diskPath}: занято ${sys.diskUsedPercent.toFixed(1)}% (${humanBytes(
        sys.diskUsedBytes,
      )} из ${humanBytes(sys.diskTotalBytes)}). Свободно: ${humanBytes(sys.diskFreeBytes)}.`,
    });
  }
  if (sys.memUsedPercent >= RAM_THRESHOLD_PCT) {
    out.push({
      key: "ram",
      subject: `[profitcontrol] RAM ${sys.memUsedPercent.toFixed(0)}%`,
      body: `RAM: занято ${sys.memUsedPercent.toFixed(1)}% (${humanBytes(
        sys.memUsedBytes,
      )} из ${humanBytes(sys.memTotalBytes)}).`,
    });
  }

  const bkp = await getBackupsMetrics();
  if (!bkp.configured || bkp.files.length === 0) {
    out.push({
      key: "backup-missing",
      subject: `[profitcontrol] Бэкапы Postgres отсутствуют`,
      body: bkp.configured
        ? `Бэкап-папка ${bkp.backupDir} пуста — cron не отработал или путь неверный.`
        : `Бэкап-папка ${bkp.backupDir} не смонтирована в контейнер app.`,
    });
  } else if (
    bkp.lastBackupAgeHours != null &&
    bkp.lastBackupAgeHours > BACKUP_STALE_HOURS
  ) {
    out.push({
      key: "backup-stale",
      subject: `[profitcontrol] Последний бэкап ${bkp.lastBackupAgeHours.toFixed(0)} ч назад`,
      body: `Последний бэкап Postgres был ${bkp.lastBackupAgeHours.toFixed(
        1,
      )} ч назад (порог: ${BACKUP_STALE_HOURS} ч). Файл: ${bkp.files[0]?.name ?? "—"}.`,
    });
  }
  return out;
}

function humanBytes(n: number): string {
  if (n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

export async function runAlertChecks(now = Date.now()): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  // If SMTP не настроен — describeEmailSource() === "console". Письма
  // полетят в stdout, что хуже чем ничего, поэтому продолжаем.
  const alerts = await collectAlerts();
  if (alerts.length === 0) return;

  const client = await getEmailClient();
  const source = await describeEmailSource();
  for (const a of alerts) {
    const last = lastSent.get(a.key) ?? 0;
    if (now - last < ALERT_DEDUP_MS) continue;
    lastSent.set(a.key, now);
    const sourceTag = source === "console" ? " (SMTP не настроен — лог)" : "";
    try {
      await client.send({
        to: adminEmail,
        subject: a.subject + sourceTag,
        html: `<p>${escapeHtml(a.body)}</p><hr><p style="color:#94a3b8;font-size:12px">profitcontrol monitoring</p>`,
        text: a.body,
      });
    } catch (e) {
      console.error("[alerts] send failed:", (e as Error).message);
      // Не обновляем lastSent на error'е — retry на следующем тике.
      lastSent.set(a.key, 0);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Для тестов: сбросить state дедупликации. */
export function resetAlertState(): void {
  lastSent.clear();
}
