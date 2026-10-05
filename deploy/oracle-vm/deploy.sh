#!/bin/bash
# PrivaTools — Oracle VM manual deploy of origin/main, built on the VM.
#
# Production normally deploys signed release tags through the auto-deploy
# timer (auto-deploy.sh). This manual path builds main locally instead, for an
# emergency when no release image can be produced. Do not use it as a
# rollback tool: it pulls main and rebuilds. Roll back with
# `privatools-rollout --rollback` (deploy/README.md).
#
# Run it as ubuntu (not with sudo): it uses sudo itself for Docker, and runs
# the rollout as ubuntu with the docker group, like the timer does.
#
# Guarantees:
#   1. `set -euo pipefail` — a failed pull or build stops before anything
#      running is touched.
#   2. Zero downtime — privatools-rollout starts the build beside the running
#      release and moves traffic only after /readyz reports the new commit,
#      real pages serve and its job supervisor holds the queue. A build that
#      fails those checks is removed and the running release keeps serving;
#      there is nothing to roll back.
#   3. One deploy at a time — it holds the auto-deploy timer's lock.
#   4. A log line either way in ~/deploy.log.
#
# The rollout needs the nginx upstream switch installed
# (install-auto-deploy.sh). Apply this script with:
#   scp deploy/oracle-vm/deploy.sh ubuntu@140.245.15.140:/home/ubuntu/deploy.sh.new
#   ssh ubuntu@140.245.15.140 'cp ~/deploy.sh ~/deploy.sh.bak && \
#       mv ~/deploy.sh.new ~/deploy.sh && chmod +x ~/deploy.sh'

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
DEPLOY_LOG="${DEPLOY_LOG:-/home/ubuntu/deploy.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
ROLLOUT="${ROLLOUT:-/usr/local/bin/privatools-rollout}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"

log() {
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ'): $*" | tee -a "$DEPLOY_LOG"
}

# Root cannot open the timer's lock in sticky /tmp (fs.protected_regular), and
# a root run before the lock exists would create one the timer cannot open.
if [[ "$(id -u)" == 0 ]]; then
    echo "refusing to run as root: run ~/deploy.sh as ${DEPLOY_USER}" >&2
    exit 1
fi

trap 'log "Deploy FAILED at line $LINENO (exit $?)"' ERR

exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
    log "Another deploy is running; try again when it finishes"
    exit 1
fi

cd "$REPO_DIR"

# 1. Pull latest main
git pull --ff-only origin main
target_sha="$(git rev-parse HEAD)"

# 2. Build the image; nothing running changes yet
sudo env GIT_SHA="$target_sha" docker compose build privatools
image_id="$(sudo docker image inspect --format '{{.Id}}' privatools-privatools:latest)"

# 3. Replace the running release without downtime, as the deploy user with the
#    docker group (this shell holds the lock). No image prune: once the build
#    serves, the rollout removes old PrivaTools images by name and keeps the
#    replaced one for `privatools-rollout --rollback`. A local build that lost
#    its name to a newer one has no name to remove it by, so it stays.
status=0
sudo runuser -u "$DEPLOY_USER" -g "$DEPLOY_USER" -G docker -- \
    env PRIVATOOLS_DEPLOY_LOCK_HELD=1 REPO_DIR="$REPO_DIR" LOCK_FILE="$LOCK_FILE" \
    "$ROLLOUT" "$image_id" "$target_sha" || status=$?
case "$status" in
    0) log "Deploy complete (${target_sha:0:12} serves from the canonical container)" ;;
    1) log "Deploy REJECTED: ${target_sha:0:12} failed its readiness, page or job checks; the previous release kept serving" ;;
    2) log "Deploy NOT DONE: a host problem or an unmet precondition (see above); the previous release serves" ;;
    3) log "Deploy DEGRADED: ${target_sha:0:12} serves from the interim container; rerun to finish" ;;
    *) log "Deploy FAILED: rollout exit ${status}; check nginx and the containers now" ;;
esac
exit "$status"
