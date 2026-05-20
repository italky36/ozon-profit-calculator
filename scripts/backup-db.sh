#!/usr/bin/env bash
# Daily Postgres dump for /opt/profitcontrol. Designed to be run from cron
# on the host. Pipes pg_dump из db-контейнера через gzip в файл на хосте +
# ротация старше RETENTION_DAYS дней.
#
# Defaults можно переопределить через env-vars в cron line или через
# /etc/default/profitcontrol-backup.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/profitcontrol}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/profitcontrol}"
PG_USER="${PG_USER:-app}"
PG_DB="${PG_DB:-ozon_calc}"

mkdir -p "$BACKUP_DIR"
ts=$(date +%Y%m%d-%H%M%S)
out="$BACKUP_DIR/db-$ts.sql.gz"
tmp="$out.tmp"

cd "$COMPOSE_DIR"

# -T убирает pseudo-TTY (нужен для pipe в файл).
# pg_dump в plain SQL: CREATE TABLE + COPY data. При restore:
#   gunzip < db-XXX.sql.gz | docker compose exec -T db psql -U app -d ozon_calc
docker compose exec -T db pg_dump -U "$PG_USER" "$PG_DB" \
  | gzip -9 > "$tmp"

# атомарный rename, чтобы прерванный dump не оставил полу-файл
mv "$tmp" "$out"

# ротация — удалить дампы старше N дней
find "$BACKUP_DIR" -maxdepth 1 -name "db-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

size=$(du -h "$out" | cut -f1)
echo "$(date -Iseconds) backup ok: $out ($size)"
