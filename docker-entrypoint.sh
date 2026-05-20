#!/bin/sh
# Entrypoint for the app container.
# 1. Wait for Postgres to accept connections.
# 2. Sync dist/ to the shared static volumes so Caddy serves the latest build.
# 3. Run db:seed (idempotent — no-op if users table already populated).
# 4. exec the main command (tsx server/index.ts).
set -eu

echo "[entrypoint] waiting for postgres at ${DATABASE_URL%%\?*}…"
until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] postgres ready"

if [ -d /srv/main ]; then
  echo "[entrypoint] syncing main SPA → /srv/main"
  rm -rf /srv/main/* /srv/main/.[!.]* 2>/dev/null || true
  # dist/ contains both the main SPA and a sysadmin subdir — copy only the
  # main bits (everything except dist/sysadmin) to /srv/main.
  for entry in /app/dist/*; do
    name=$(basename "$entry")
    [ "$name" = "sysadmin" ] && continue
    cp -R "$entry" /srv/main/
  done
fi

if [ -d /srv/sysadmin ] && [ -d /app/dist/sysadmin ]; then
  echo "[entrypoint] syncing sysadmin SPA → /srv/sysadmin"
  rm -rf /srv/sysadmin/* /srv/sysadmin/.[!.]* 2>/dev/null || true
  cp -R /app/dist/sysadmin/* /srv/sysadmin/
fi

echo "[entrypoint] applying migrations"
npx tsx scripts/migrate.mts

echo "[entrypoint] running db:seed (idempotent)"
node scripts/seed.mjs

echo "[entrypoint] exec: $*"
exec "$@"
