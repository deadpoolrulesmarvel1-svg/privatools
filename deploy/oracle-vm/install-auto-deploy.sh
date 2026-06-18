#!/usr/bin/env bash
# Install the GitHub polling auto-deploy timer on the Oracle VM.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
REPO_URL="${REPO_URL:-https://github.com/deadpoolrulesmarvel1-svg/privatools.git}"
APP_USER="${APP_USER:-ubuntu}"

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run with sudo: sudo bash deploy/oracle-vm/install-auto-deploy.sh" >&2
    exit 1
fi

if [[ ! -d "$REPO_DIR/.git" ]]; then
    echo "Missing git checkout at $REPO_DIR" >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -m 0755 "$script_dir/auto-deploy.sh" /usr/local/bin/privatools-auto-deploy
install -m 0644 "$script_dir/privatools-auto-deploy.service" /etc/systemd/system/privatools-auto-deploy.service
install -m 0644 "$script_dir/privatools-auto-deploy.timer" /etc/systemd/system/privatools-auto-deploy.timer

sudo -u "$APP_USER" git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
sudo -u "$APP_USER" git -C "$REPO_DIR" fetch --prune origin "+refs/heads/main:refs/remotes/origin/main"

systemctl daemon-reload
systemctl enable --now privatools-auto-deploy.timer
systemctl start privatools-auto-deploy.service

systemctl status privatools-auto-deploy.timer --no-pager --lines=20
systemctl status privatools-auto-deploy.service --no-pager --lines=40 || true
