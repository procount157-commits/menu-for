#!/bin/sh
# Dump the database to a timestamped, compressed file and prune old ones.
#
# After the Replit deployment was deleted this database became the only copy of
# everything: accounts, contacts, campaign history, and the WhatsApp auth state
# — losing which means re-pairing and losing chat history a second time. It
# lives in an anonymous Docker volume, so `docker system prune --volumes` or a
# Docker Desktop reset would take it with no warning.
#
# Usage:  sh scripts/ops/backup-db.sh [destination-dir]
set -eu

CONTAINER="${WAM_PG_CONTAINER:-wam-postgres}"
DB="${WAM_PG_DB:-whatsapp_marketer}"
USER_NAME="${WAM_PG_USER:-wam}"
DEST="${1:-${WAM_BACKUP_DIR:-$HOME/Documents/whatsapp-marketer-backups}}"
KEEP_DAYS="${WAM_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/wam-$STAMP.sql.gz"

if ! docker exec "$CONTAINER" pg_isready -U "$USER_NAME" >/dev/null 2>&1; then
  echo "backup FAILED: container '$CONTAINER' is not accepting connections" >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump -U "$USER_NAME" -d "$DB" --no-owner --no-acl | gzip > "$OUT"

# A dump that cannot be read is not a backup. Check it decompresses and ends
# the way pg_dump ends a complete dump.
if ! gzip -t "$OUT" 2>/dev/null; then
  echo "backup FAILED: $OUT is not valid gzip" >&2; rm -f "$OUT"; exit 1
fi
if ! gzip -dc "$OUT" | tail -5 | grep -q "PostgreSQL database dump complete"; then
  echo "backup FAILED: $OUT is truncated" >&2; rm -f "$OUT"; exit 1
fi

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "backup ok: $OUT (${SIZE} bytes)"

# Keep the last KEEP_DAYS days.
find "$DEST" -name 'wam-*.sql.gz' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "backups on disk: $(ls -1 "$DEST"/wam-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
