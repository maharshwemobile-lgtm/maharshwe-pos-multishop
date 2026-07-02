#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_SOURCE="$ROOT_DIR/deploy/systemd/mahar-pos-backup.service"
TIMER_SOURCE="$ROOT_DIR/deploy/systemd/mahar-pos-backup.timer"

[[ -f "$SERVICE_SOURCE" ]] || { echo "Missing $SERVICE_SOURCE" >&2; exit 1; }
[[ -f "$TIMER_SOURCE" ]] || { echo "Missing $TIMER_SOURCE" >&2; exit 1; }
[[ -f "$ROOT_DIR/.env" ]] || { echo "Missing $ROOT_DIR/.env" >&2; exit 1; }

for command_name in pg_dump pg_restore systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

install -d -m 700 "${BACKUP_DIR:-/var/backups/mahar-pos/postgres}"
install -m 644 "$SERVICE_SOURCE" /etc/systemd/system/mahar-pos-backup.service
install -m 644 "$TIMER_SOURCE" /etc/systemd/system/mahar-pos-backup.timer

systemctl daemon-reload
systemctl enable --now mahar-pos-backup.timer
systemctl start mahar-pos-backup.service

systemctl --no-pager --full status mahar-pos-backup.service || true
systemctl --no-pager --full status mahar-pos-backup.timer || true
systemctl list-timers --all | grep 'mahar-pos-backup' || true

echo "Backup timer installed and first verified backup requested."
