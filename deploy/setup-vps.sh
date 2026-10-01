#!/usr/bin/env bash
# One-time setup on a fresh Hostinger VPS (Ubuntu).
#
#   ssh root@YOUR_VPS
#   git clone <repo> /opt/whatsapp-marketer && cd /opt/whatsapp-marketer
#   bash deploy/setup-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "→ node + pnpm (the frontend is built on the host)"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable

echo "→ firewall"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  # Postgres is only reachable inside the compose network; never open 5432.
  yes | ufw enable >/dev/null 2>&1 || true
fi

if [ ! -f .env ]; then
  echo "→ generating .env"
  cp deploy/env.production.example .env
  PGP=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  SEC=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGP|" .env
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SEC|" .env
  echo "   .env created with generated secrets — add an LLM key when you have one"
fi

echo "→ heartbeat every minute"
CRON="* * * * * $(pwd)/deploy/heartbeat.sh >> /var/log/wam-heartbeat.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/heartbeat.sh' ; echo "$CRON" ) | crontab -

echo "→ nightly backup at 04:30"
BCRON="30 4 * * * cd $(pwd) && docker compose exec -T db pg_dump -U wam -d menu4u --no-owner --no-acl | gzip > deploy/backups/wam-\$(date +\%Y\%m\%d).sql.gz && find deploy/backups -name 'wam-*.sql.gz' -mtime +30 -delete"
( crontab -l 2>/dev/null | grep -v 'pg_dump -U wam' ; echo "$BCRON" ) | crontab -
mkdir -p deploy/backups

echo
echo "✅ ready. Next:"
echo "   1. edit .env if you want an LLM key"
echo "   2. ./deploy/deploy.sh"
echo "   3. point your domain at this server, then: bash deploy/setup-ssl.sh your-domain.com"
