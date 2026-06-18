#!/bin/bash
# PrivaTools — Oracle VM manual deploy script.
#
# Replaces ~/deploy.sh on the VM. Adds three reliability guarantees over the
# 5-line original:
#
#   1. `set -euo pipefail` — fail fast if git pull fails, docker build fails,
#      or systemctl restart fails. The original would swallow these silently.
#   2. Health poll after restart — confirms the new container is serving the
#      commit we just pulled before declaring success. The original would log
#      "Deploy complete" even if the new container OOM'd and never came up.
#   3. Failure log entry — if anything goes wrong, deploy.log gets a FAILED
#      entry instead of nothing, so the operator can spot bad deploys from
#      `tail ~/deploy.log` without spelunking journalctl.
#
# The VM now has a systemd polling deploy path too:
#   sudo bash deploy/oracle-vm/install-auto-deploy.sh
#
# Apply this manual script with:
#   scp deploy/oracle-vm/deploy.sh ubuntu@140.245.15.140:/home/ubuntu/deploy.sh.new
#   ssh ubuntu@140.245.15.140 'cp ~/deploy.sh ~/deploy.sh.bak && \
#       mv ~/deploy.sh.new ~/deploy.sh && chmod +x ~/deploy.sh'

set -euo pipefail

REPO_DIR=/home/ubuntu/privatools
DEPLOY_LOG=/home/ubuntu/deploy.log
HEALTH_URL=http://127.0.0.1:8000/api/health
HEALTH_RETRIES=10
HEALTH_INTERVAL=6  # seconds; total wait = 60s

log() {
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ'): $*" >> "$DEPLOY_LOG"
}

health_reports_sha() {
    local expected_sha="$1"
    local body
    body="$(curl --fail --silent --max-time 5 "$HEALTH_URL")" || return 1
    [[ "$body" == *"\"build_sha\":\"${expected_sha}\""* ]] \
        || [[ "$body" == *"\"build_sha\": \"${expected_sha}\""* ]]
}

trap 'log "Deploy FAILED at line $LINENO (exit $?)"' ERR

cd "$REPO_DIR"

# 1. Pull latest main
git pull origin main
target_sha="$(git rev-parse HEAD)"

# 2. Rebuild + restart container
sudo env GIT_SHA="$target_sha" docker compose up -d --build

# 3. Clean up dangling images (best-effort)
sudo docker image prune -f || true

# 4. Wait for new container to become healthy
for i in $(seq 1 "$HEALTH_RETRIES"); do
    if health_reports_sha "$target_sha"; then
        log "Deploy complete (health reports ${target_sha:0:12} after ${i}/${HEALTH_RETRIES} attempts)"
        exit 0
    fi
    sleep "$HEALTH_INTERVAL"
done

# 5. Health check exhausted — flag failure
log "Deploy FAILED — health did not report ${target_sha:0:12} after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
exit 1
