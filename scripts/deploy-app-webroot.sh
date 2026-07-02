#!/usr/bin/env bash
set -euo pipefail

WEBROOT="${WEBROOT:-/var/www/app.maharshwe.shop}"
BACKUP_DIR="${BACKUP_DIR:-/opt/maharshwe/backups}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/health}"
PM2_APP_NAME="${PM2_APP_NAME:-maharshwe-pos-api}"
RESTART_API="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --webroot)
      WEBROOT="$2"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --api-health-url)
      API_HEALTH_URL="$2"
      shift 2
      ;;
    --pm2-app)
      PM2_APP_NAME="$2"
      shift 2
      ;;
    --restart-api)
      RESTART_API="true"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d dist ]]; then
  echo "STOP: dist folder not found. Run npm run build first." >&2
  exit 1
fi

if [[ ! -f dist/index.html ]]; then
  echo "STOP: dist/index.html not found. Build output is incomplete." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/app-webroot-before-root-sync-$TS.tar.gz"

echo "WEBROOT=$WEBROOT"
echo "BACKUP=$BACKUP_FILE"

if [[ -d "$WEBROOT" ]]; then
  tar -czf "$BACKUP_FILE" -C "$(dirname "$WEBROOT")" "$(basename "$WEBROOT")"
else
  mkdir -p "$WEBROOT"
fi

mkdir -p "$WEBROOT"
rsync -a --delete dist/ "$WEBROOT"/

if id -u www-data >/dev/null 2>&1; then
  chown -R www-data:www-data "$WEBROOT"
fi

nginx -t
systemctl reload nginx

if [[ "$RESTART_API" == "true" ]]; then
  pm2 restart "$PM2_APP_NAME" --update-env
  sleep 3
fi

curl -fsS "$API_HEALTH_URL" >/dev/null

echo "Deploy complete"
echo "Backup saved: $BACKUP_FILE"
