import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  Download,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Save,
  Server,
} from "lucide-react";
import { api } from "../../api";
import { Section, Stat, StatusPill, Td, Th } from "../atoms";

interface Props {
  narrow: boolean;
}

type DbMetrics = Awaited<ReturnType<typeof api.admin.getDbMetrics>>;
type SystemMetrics = Awaited<ReturnType<typeof api.admin.getSystemMetrics>>;
type BackupsMetrics = Awaited<ReturnType<typeof api.admin.getBackupsMetrics>>;

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

function fmtPercent(n: number): string {
  return `${n.toFixed(0)}%`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

function fmtAgeHours(h: number): string {
  if (h < 1) return `${Math.floor(h * 60)} мин назад`;
  if (h < 24) return `${h.toFixed(1)} ч назад`;
  return `${Math.floor(h / 24)} д назад`;
}

function fmtMtime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function percentTone(p: number): "ok" | "warn" | "bad" {
  if (p >= 90) return "bad";
  if (p >= 75) return "warn";
  return "ok";
}

function ageHoursTone(h: number | null): "ok" | "warn" | "bad" {
  if (h == null) return "bad";
  if (h > 48) return "bad";
  if (h > 25) return "warn";
  return "ok";
}

export default function MetricsSection({ narrow }: Props) {
  const [db, setDb] = useState<DbMetrics | null>(null);
  const [sys, setSys] = useState<SystemMetrics | null>(null);
  const [backups, setBackups] = useState<BackupsMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [d, s, b] = await Promise.all([
        api.admin.getDbMetrics(),
        api.admin.getSystemMetrics(),
        api.admin.getBackupsMetrics(),
      ]);
      setDb(d);
      setSys(s);
      setBackups(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() обновляет локальный state — канонический «синк с external source».
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !db && !sys && !backups) {
    return <p className="muted">Загрузка метрик…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div
          className="card"
          style={{ borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" }}
        >
          Ошибка загрузки: {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "#fff",
            cursor: loading ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>

      {sys && (
        <Section icon={<Server size={15} />} title="Сервер">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: narrow
                ? "1fr 1fr"
                : "repeat(4, minmax(0, 1fr))",
              gap: 10,
              padding: 16,
            }}
          >
            <Stat
              label="CPU load (1m)"
              value={`${sys.loadAvg["1m"].toFixed(2)} / ${sys.cpuCount}`}
              icon={<Cpu size={16} />}
              accent={{ bg: "#eff6ff", fg: "#2563eb" }}
            />
            <Stat
              label="RAM"
              value={
                <span>
                  {fmtPercent(sys.memUsedPercent)}{" "}
                  <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>
                    {fmtBytes(sys.memUsedBytes)} / {fmtBytes(sys.memTotalBytes)}
                  </span>
                </span>
              }
              icon={<MemoryStick size={16} />}
              accent={{ bg: "#f0fdf4", fg: "#16a34a" }}
            />
            <Stat
              label="Диск"
              value={
                <span>
                  {fmtPercent(sys.diskUsedPercent)}{" "}
                  <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>
                    {fmtBytes(sys.diskFreeBytes)} свободно
                  </span>
                </span>
              }
              icon={<HardDrive size={16} />}
              accent={{ bg: "#fef3c7", fg: "#ca8a04" }}
            />
            <Stat
              label="Uptime"
              value={fmtUptime(sys.systemUptimeSec)}
              icon={<Activity size={16} />}
              accent={{ bg: "#f3e8ff", fg: "#9333ea" }}
            />
          </div>
          <div
            style={{
              padding: "0 18px 14px",
              fontSize: 11.5,
              color: "var(--muted)",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span>Disk-mount: {sys.diskPath}</span>
            <span>
              Load 5m/15m: {sys.loadAvg["5m"].toFixed(2)} /{" "}
              {sys.loadAvg["15m"].toFixed(2)}
            </span>
            <span>Process uptime: {fmtUptime(sys.processUptimeSec)}</span>
            <StatusPill tone={percentTone(sys.memUsedPercent)}>
              RAM {fmtPercent(sys.memUsedPercent)}
            </StatusPill>
            <StatusPill tone={percentTone(sys.diskUsedPercent)}>
              Disk {fmtPercent(sys.diskUsedPercent)}
            </StatusPill>
          </div>
        </Section>
      )}

      {db && (
        <Section icon={<Database size={15} />} title="База данных">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(2, 1fr)",
              gap: 10,
              padding: 16,
            }}
          >
            <Stat
              label="Размер БД"
              value={db.databaseSizePretty}
              icon={<Database size={16} />}
              accent={{ bg: "#eef2ff", fg: "#4f46e5" }}
            />
            <Stat
              label="Connections"
              value={`${db.activeConnections} / ${db.maxConnections}`}
              icon={<Activity size={16} />}
              accent={{ bg: "#ecfeff", fg: "#0891b2" }}
            />
          </div>
          <div style={{ padding: "0 0 8px" }}>
            <div
              style={{
                padding: "8px 18px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Топ-5 таблиц по размеру
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Таблица</Th>
                  <Th align="right">Размер</Th>
                </tr>
              </thead>
              <tbody>
                {db.topTables.map((t) => (
                  <tr key={t.name}>
                    <Td>
                      <code style={{ fontSize: 12 }}>{t.name}</code>
                    </Td>
                    <Td align="right">{t.sizePretty}</Td>
                  </tr>
                ))}
                {db.topTables.length === 0 && (
                  <tr>
                    <Td>
                      <span className="muted">Нет данных</span>
                    </Td>
                    <Td align="right">—</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {backups && (
        <Section
          icon={<Save size={15} />}
          title="Бэкапы Postgres"
          headerRight={
            backups.lastBackupAgeHours != null ? (
              <StatusPill tone={ageHoursTone(backups.lastBackupAgeHours)}>
                Последний: {fmtAgeHours(backups.lastBackupAgeHours)}
              </StatusPill>
            ) : (
              <StatusPill tone="bad">Нет бэкапов</StatusPill>
            )
          }
        >
          <div
            style={{
              padding: "10px 18px",
              fontSize: 12,
              color: "var(--muted)",
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <span>
              Папка: <code>{backups.backupDir}</code>
            </span>
            <span>Файлов: {backups.files.length}</span>
            <span>Суммарно: {fmtBytes(backups.totalSizeBytes)}</span>
            {!backups.configured && (
              <span style={{ color: "#b91c1c" }}>
                Бэкап-папка не смонтирована — проверь docker-compose.yml
              </span>
            )}
          </div>
          {backups.files.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Файл</Th>
                  <Th>Создан</Th>
                  <Th align="right">Размер</Th>
                  <Th align="right" width={120}>
                    Действие
                  </Th>
                </tr>
              </thead>
              <tbody>
                {backups.files.map((f) => (
                  <tr key={f.name}>
                    <Td>
                      <code style={{ fontSize: 12 }}>{f.name}</code>
                    </Td>
                    <Td>{fmtMtime(f.mtime)}</Td>
                    <Td align="right">{fmtBytes(f.sizeBytes)}</Td>
                    <Td align="right">
                      <a
                        href={api.admin.backupDownloadUrl(f.name)}
                        download={f.name}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "5px 10px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "#fff",
                          color: "#0f172a",
                          textDecoration: "none",
                        }}
                      >
                        <Download size={12} />
                        Скачать
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: "14px 18px", color: "var(--muted)", fontSize: 13 }}>
              {backups.configured
                ? "Бэкапов пока нет — cron создаст первый по расписанию (03:00)."
                : "Дамп-папка не доступна изнутри контейнера."}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
