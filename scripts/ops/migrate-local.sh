#!/bin/sh
# Apply one migration file to the local database (the wam-postgres container).
#   scripts/ops/migrate-local.sh lib/db/migrations/105_owner_report.sql
set -eu
DB="${DB:-menu4u}"
docker exec -i wam-postgres psql -v ON_ERROR_STOP=1 -q -U wam -d "$DB" < "$1"
echo "applied $1"
