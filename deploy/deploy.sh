#!/usr/bin/env bash
# Build, migrate and restart on the VPS.
#
#   ./deploy/deploy.sh          # build, migrate, restart
#   ./deploy/deploy.sh --pull   # git pull first
#
# Migrations run before the new container serves traffic, and a backup is taken
# before they run — a failed migration on the only copy of the data is how a
# deployment becomes an outage.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "missing .env — copy deploy/env.production.example"; exit 1; }

if [ "${1:-}" = "--pull" ]; then
  echo "→ pulling"
  git pull --ff-only
fi

echo "→ building frontend"
corepack pnpm install --frozen-lockfile=false
corepack pnpm --filter @workspace/whatsapp-blast run build
rm -rf deploy/www && mkdir -p deploy/www
cp -r artifacts/whatsapp-blast/dist/public/. deploy/www/

echo "→ starting database"
docker compose up -d db
until docker compose exec -T db pg_isready -U "${POSTGRES_USER:-wam}" >/dev/null 2>&1; do sleep 1; done

# Only meaningful once there is data to lose; harmless on a fresh install.
if docker compose exec -T db psql -U "${POSTGRES_USER:-wam}" -d "${POSTGRES_DB:-menu4u}" -tAc \
     "select 1 from information_schema.tables where table_name='users'" 2>/dev/null | grep -q 1; then
  echo "→ backup before migrating"
  mkdir -p deploy/backups
  docker compose exec -T db pg_dump -U "${POSTGRES_USER:-wam}" -d "${POSTGRES_DB:-menu4u}" \
    --no-owner --no-acl | gzip > "deploy/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
fi

# A fresh database gets the whole schema at once (000_base.sql, a schema-only
# dump of a fully migrated database), and every migration is recorded as done
# — replaying Flow Hub's history on it does not work, 001 assumes its tables
# already exist. After that each numbered migration runs once, recorded in
# schema_migrations. A database from before that table existed runs them all
# once more; they were written to be re-runnable for exactly that.
PSQL="docker compose exec -T db psql -v ON_ERROR_STOP=1 -U ${POSTGRES_USER:-wam} -d ${POSTGRES_DB:-menu4u}"
fresh=1
$PSQL -tAc "select 1 from information_schema.tables where table_name='users'" 2>/dev/null | grep -q 1 && fresh=0
$PSQL -qc "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())" >/dev/null
if [ "$fresh" = 1 ]; then
  echo "→ fresh database: base schema"
  $PSQL < lib/db/migrations/000_base.sql >/dev/null
  # Flow Hub's history (001–099) is already in the base and cannot be
  # replayed. Menu For You's own (100+) is re-runnable and seeds the starting
  # plans, so it runs below like on any other deploy.
  for f in lib/db/migrations/0[0-9][0-9]_*.sql; do
    $PSQL -qc "insert into schema_migrations (name) values ('$(basename "$f")') on conflict do nothing" >/dev/null
  done
fi
echo "→ migrations"
for f in lib/db/migrations/[0-9][0-9][0-9]_*.sql; do
  n="$(basename "$f")"
  [ "$n" = "000_base.sql" ] && continue
  $PSQL -tAc "select 1 from schema_migrations where name = '$n'" | grep -q 1 && continue
  echo "   $n"
  $PSQL < "$f" >/dev/null
  $PSQL -qc "insert into schema_migrations (name) values ('$n')" >/dev/null
done

echo "→ building and restarting the app"
docker compose build api
docker compose up -d --no-deps api web

echo "→ waiting for health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/api/healthz >/dev/null 2>&1; then
    echo "✅ deployed and healthy"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "❌ did not come up healthy — last 40 lines:" >&2
docker compose logs --tail 40 api >&2
exit 1
