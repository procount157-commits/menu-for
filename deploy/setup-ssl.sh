#!/usr/bin/env bash
# Issue a Let's Encrypt certificate and switch nginx to HTTPS.
#   bash deploy/setup-ssl.sh your-domain.com you@example.com
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:?usage: setup-ssl.sh <domain> [email]}"
EMAIL="${2:-admin@$DOMAIN}"

mkdir -p deploy/certbot/www deploy/certbot/conf
docker run --rm \
  -v "$(pwd)/deploy/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/deploy/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive

sed -i "s|YOUR_DOMAIN|$DOMAIN|g" deploy/nginx.conf
# Uncomment the redirect and the TLS server block.
sed -i 's|^# location / { return 301|location / { return 301|' deploy/nginx.conf
sed -i '/^# server {$/,/^# }$/s|^# ||' deploy/nginx.conf
docker compose restart web

# Renewal: certbot only rewrites files, so nginx just needs a nudge afterwards.
CRON="0 3 * * 1 cd $(pwd) && docker run --rm -v \$(pwd)/deploy/certbot/conf:/etc/letsencrypt -v \$(pwd)/deploy/certbot/www:/var/www/certbot certbot/certbot renew --quiet && docker compose restart web"
( crontab -l 2>/dev/null | grep -v 'certbot/certbot renew' ; echo "$CRON" ) | crontab -

echo "✅ https://$DOMAIN"
