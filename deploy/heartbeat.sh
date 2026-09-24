#!/usr/bin/env bash
# Watches the app and acts when it stops being healthy.
#
# Run every minute from cron:
#   * * * * * /opt/whatsapp-marketer/deploy/heartbeat.sh >> /var/log/wam-heartbeat.log 2>&1
#
# Restarts only after CONSEC_FAIL consecutive failures, because a single failed
# probe is usually a slow query or a deploy in progress, and restarting on one
# turns a hiccup into a dropped WhatsApp session.
set -uo pipefail
cd "$(dirname "$0")/.."

URL="${HEARTBEAT_URL:-http://127.0.0.1/api/health/deep}"
STATE="${HEARTBEAT_STATE:-/tmp/wam-heartbeat.state}"
CONSEC_FAIL="${HEARTBEAT_CONSEC_FAIL:-3}"
WEBHOOK="${HEARTBEAT_WEBHOOK:-$(grep -E '^HEARTBEAT_WEBHOOK=' .env 2>/dev/null | cut -d= -f2-)}"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

notify() {
  [ -n "$WEBHOOK" ] || return 0
  curl -fsS -m 10 -X POST "$WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"text":%s}' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    >/dev/null 2>&1 || true
}

BODY=$(curl -fsS -m 15 "$URL" 2>/dev/null)
CURL_RC=$?
FAILS=$(cat "$STATE" 2>/dev/null || echo 0)

if [ $CURL_RC -ne 0 ]; then
  FAILS=$((FAILS + 1)); echo "$FAILS" > "$STATE"
  echo "$(stamp) unreachable (fail $FAILS/$CONSEC_FAIL)"
  if [ "$FAILS" -ge "$CONSEC_FAIL" ]; then
    echo "$(stamp) restarting api after $FAILS failures"
    notify "⚠️ واتساب ماركتر: التطبيق لا يستجيب — أُعيد تشغيله تلقائياً"
    docker compose restart api >/dev/null 2>&1
    echo 0 > "$STATE"
  fi
  exit 1
fi

STATUS=$(printf '%s' "$BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","?"))' 2>/dev/null || echo "?")

case "$STATUS" in
  ok)
    [ "$FAILS" -gt 0 ] && notify "✅ واتساب ماركتر: عاد للعمل الطبيعي"
    echo 0 > "$STATE"
    echo "$(stamp) ok"
    ;;
  degraded)
    # Serving, but something wants attention. Never a reason to restart —
    # restarting an app whose only problem is an unlinked WhatsApp would drop
    # every other session with it.
    echo 0 > "$STATE"
    DETAIL=$(printf '%s' "$BODY" | python3 -c '
import json,sys
d=json.load(sys.stdin)
bad=[k for k,v in d.get("checks",{}).items() if not v.get("ok")]
print(", ".join(bad) or "?")' 2>/dev/null)
    echo "$(stamp) degraded: $DETAIL"
    # Only shout once an hour so a long-running warning does not become noise.
    MARK="/tmp/wam-degraded-$(date +%Y%m%d%H)"
    [ -f "$MARK" ] || { notify "⚠️ واتساب ماركتر: $DETAIL"; touch "$MARK"; }
    ;;
  *)
    FAILS=$((FAILS + 1)); echo "$FAILS" > "$STATE"
    echo "$(stamp) status=$STATUS (fail $FAILS/$CONSEC_FAIL)"
    if [ "$FAILS" -ge "$CONSEC_FAIL" ]; then
      notify "🔴 واتساب ماركتر: قاعدة البيانات لا تستجيب — إعادة تشغيل"
      docker compose restart api db >/dev/null 2>&1
      echo 0 > "$STATE"
    fi
    exit 1
    ;;
esac
