#!/usr/bin/env bash
# Install the accounts-database backup timer. Idempotent.
set -euo pipefail
SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

sudo install -m 0755 "${SRC}/backup-app-data.sh" /usr/local/bin/privatools-backup
sudo install -m 0644 "${SRC}/privatools-backup.service" /etc/systemd/system/
sudo install -m 0644 "${SRC}/privatools-backup.timer"   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now privatools-backup.timer

echo "installed. next run:"
systemctl list-timers privatools-backup.timer --no-pager
