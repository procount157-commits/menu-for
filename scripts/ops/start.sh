#!/bin/bash
# Starts the whole application. Run by launchd at login, and usable by hand.
#
# Everything here is ordered around one failure: the API server exits
# immediately if DATABASE_URL is unreachable, and at login Docker Desktop is
# usually still starting. launchd would then restart the server in a tight
# loop, give up, and the application would appear broken with no obvious
# reason. So this waits for the database rather than racing it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── 1. Docker ────────────────────────────────────────────────────
# Desktop can take a minute after login. Start it if it is not up.
if ! docker info >/dev/null 2>&1; then
  log "Docker غير جاهز — أُشغّله"
  open -ga Docker 2>/dev/null || true
  for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi
if ! docker info >/dev/null 2>&1; then
  log "تعذّر تشغيل Docker بعد دقيقتين — أتوقف"
  exit 1
fi

# ── 2. Postgres ──────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -qx wam-postgres; then
  log "أُشغّل قاعدة البيانات"
  docker start wam-postgres >/dev/null 2>&1 || {
    log "حاوية wam-postgres غير موجودة"; exit 1;
  }
fi
for i in $(seq 1 45); do
  docker exec wam-postgres pg_isready -U wam -d whatsapp_marketer >/dev/null 2>&1 && break
  sleep 2
done
if ! docker exec wam-postgres pg_isready -U wam -d whatsapp_marketer >/dev/null 2>&1; then
  log "قاعدة البيانات لا تستجيب — أتوقف"
  exit 1
fi
log "قاعدة البيانات جاهزة"

# ── 3. The server ────────────────────────────────────────────────
# Built output rather than a dev server: it needs no watcher and survives on
# its own. Exec so launchd supervises node directly and KeepAlive works.
if [ ! -f artifacts/api-server/dist/index.mjs ]; then
  log "لا يوجد بناء — أبني الآن"
  pnpm run build >/dev/null 2>&1 || { log "فشل البناء"; exit 1; }
fi

# ── 4. Sleep ─────────────────────────────────────────────────────
# This Mac is set to sleep after one minute idle, on battery and on power
# alike, and it did so 206 times in two days. Every sleep kills every WhatsApp
# socket. caffeinate holds an idle-sleep assertion for as long as the server
# runs (-i), and a system-sleep one while on AC power (-s). It cannot stop a
# lid-close sleep on battery; nothing short of `sudo pmset` can, and that is
# the owner's call.
log "أُشغّل السيرفر"
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i -s node --env-file-if-exists=.env --enable-source-maps artifacts/api-server/dist/index.mjs
fi
exec node --env-file-if-exists=.env --enable-source-maps artifacts/api-server/dist/index.mjs
