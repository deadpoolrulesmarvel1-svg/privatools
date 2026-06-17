#!/usr/bin/env bash
# Poll origin/main and redeploy the Docker Compose app only when a new commit
# is available. Intended to run from privatools-auto-deploy.service.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-6}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
STATE_FILE="${STATE_FILE:-${REPO_DIR}/.privatools-auto-deploy.sha}"

log() {
    printf '[privatools-auto-deploy] %s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

health_ok() {
    curl --fail --silent --max-time 5 "$HEALTH_URL" >/dev/null
}

trap 'rc=$?; log "failed at line $LINENO with exit $rc"; exit "$rc"' ERR

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "another deploy is already running; skipping"
    exit 0
fi

cd "$REPO_DIR"

log "fetching ${REMOTE}/${BRANCH}"
git fetch --prune "$REMOTE" "+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}"

current_sha="$(git rev-parse HEAD)"
target_sha="$(git rev-parse "refs/remotes/${REMOTE}/${BRANCH}")"
deployed_sha=""
if [[ -f "$STATE_FILE" ]]; then
    deployed_sha="$(tr -d '[:space:]' < "$STATE_FILE")"
fi

if [[ "$current_sha" == "$target_sha" ]] \
    && [[ "$deployed_sha" == "$target_sha" ]] \
    && git diff --quiet \
    && git diff --cached --quiet \
    && health_ok; then
    log "already deployed ${target_sha:0:12}; health OK; no deploy needed"
    exit 0
fi

if [[ "$current_sha" == "$target_sha" ]] && [[ "$deployed_sha" != "$target_sha" ]]; then
    log "repo is at ${target_sha:0:12} but last successful deploy marker is ${deployed_sha:-missing}; rebuilding"
elif [[ "$current_sha" == "$target_sha" ]] && ! health_ok; then
    log "repo is at ${target_sha:0:12} but health check failed; rebuilding"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    log "tracked local changes detected; resetting to ${target_sha:0:12}"
fi

log "deploying ${current_sha:0:12} -> ${target_sha:0:12}"
git reset --hard "$target_sha"

docker compose up -d --build
docker image prune -f >/dev/null || true

for i in $(seq 1 "$HEALTH_RETRIES"); do
    if health_ok; then
        printf '%s\n' "$target_sha" > "$STATE_FILE"
        log "deploy complete; health OK after ${i}/${HEALTH_RETRIES} checks"
        exit 0
    fi
    sleep "$HEALTH_INTERVAL"
done

log "health check failed after $((HEALTH_RETRIES * HEALTH_INTERVAL)) seconds"
docker compose ps || true
exit 1
