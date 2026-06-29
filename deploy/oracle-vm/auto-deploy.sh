#!/usr/bin/env bash
# Poll origin/main and redeploy the Docker Compose app when a new commit is
# available, the last-success marker is stale, or health reports the wrong SHA.
# Intended to run from privatools-auto-deploy.service.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-6}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
STATE_FILE="${STATE_FILE:-${REPO_DIR}/.privatools-auto-deploy.sha}"

# Deploy gate. Without one, *any* commit reaching ${BRANCH} ships to prod
# within ~60s with no human approval. Modes:
#   auto   (default) deploy the latest release tag reachable from ${BRANCH};
#          fall back to ${BRANCH} HEAD until the first tag exists — so turning
#          this on changes nothing until you cut your first release tag, after
#          which only tagged commits deploy.
#   tag    only deploy a matching tag; never deploy an untagged ${BRANCH} push.
#   branch legacy: deploy ${BRANCH} HEAD every push (no gate).
DEPLOY_MODE="${DEPLOY_MODE:-auto}"
DEPLOY_TAG_GLOB="${DEPLOY_TAG_GLOB:-v*}"

# Prefer the cosign-signed image release.yml builds+pushes on each tag over a
# heavy rebuild on this 2-core VM. The deploy pulls ${DEPLOY_IMAGE_REPO}:<tag>,
# verifies its org.opencontainers.image.revision label == the tag's commit, and
# runs it with `up --no-build`. Set DEPLOY_IMAGE_REPO="" to force local builds.
DEPLOY_IMAGE_REPO="${DEPLOY_IMAGE_REPO:-ghcr.io/deadpoolrulesmarvel1-svg/privatools}"

# Optional deploy-health alerting: set DEPLOY_PING_URL to a Healthchecks.io (or
# similar) check URL. We ping it on success and ping <url>/fail on failure, so a
# stuck or failed deploy raises an alert instead of going unnoticed.
DEPLOY_PING_URL="${DEPLOY_PING_URL:-}"

ping_deploy() {  # ping_deploy ok|fail
    [[ -z "$DEPLOY_PING_URL" ]] && return 0
    local url="$DEPLOY_PING_URL"
    [[ "$1" == "fail" ]] && url="${DEPLOY_PING_URL%/}/fail"
    curl --fail --silent --max-time 8 -o /dev/null "$url" || true
}

log() {
    printf '[privatools-auto-deploy] %s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

health_reports_sha() {
    local expected_sha="$1"
    local body
    body="$(curl --fail --silent --max-time 5 "$HEALTH_URL")" || return 1
    [[ "$body" == *"\"build_sha\":\"${expected_sha}\""* ]] \
        || [[ "$body" == *"\"build_sha\": \"${expected_sha}\""* ]]
}

trap 'rc=$?; log "failed at line $LINENO with exit $rc"; ping_deploy fail; exit "$rc"' ERR

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "another deploy is already running; skipping"
    exit 0
fi

cd "$REPO_DIR"

log "fetching ${REMOTE}/${BRANCH} (deploy mode=${DEPLOY_MODE})"
git fetch --prune --tags --force "$REMOTE" "+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}"

current_sha="$(git rev-parse HEAD)"
branch_sha="$(git rev-parse "refs/remotes/${REMOTE}/${BRANCH}")"

# Latest tag matching the glob that is an ancestor of the tracked branch (so a
# tag pushed on an unmerged branch can't deploy).
latest_release_tag() {
    git tag -l "$DEPLOY_TAG_GLOB" --sort=-version:refname \
        --merged "refs/remotes/${REMOTE}/${BRANCH}" | head -n1
}

target_ref=""
case "$DEPLOY_MODE" in
    branch)
        target_ref="${REMOTE}/${BRANCH}"
        target_sha="$branch_sha"
        ;;
    tag)
        target_ref="$(latest_release_tag)"
        if [[ -z "$target_ref" ]]; then
            log "mode=tag but no tag matches ${DEPLOY_TAG_GLOB} on ${BRANCH}; nothing to deploy (push a release tag)"
            exit 0
        fi
        target_sha="$(git rev-parse "${target_ref}^{commit}")"
        ;;
    auto|*)
        target_ref="$(latest_release_tag)"
        if [[ -n "$target_ref" ]]; then
            target_sha="$(git rev-parse "${target_ref}^{commit}")"
        else
            target_ref="${REMOTE}/${BRANCH}"
            target_sha="$branch_sha"
            log "no ${DEPLOY_TAG_GLOB} tag yet; deploying ${BRANCH} HEAD (cut a release tag to enable the deploy gate)"
        fi
        ;;
esac
log "deploy target: ${target_ref} -> ${target_sha:0:12}"

deployed_sha=""
if [[ -f "$STATE_FILE" ]]; then
    deployed_sha="$(tr -d '[:space:]' < "$STATE_FILE")"
fi

if [[ "$current_sha" == "$target_sha" ]] \
    && [[ "$deployed_sha" == "$target_sha" ]] \
    && git diff --quiet \
    && git diff --cached --quiet \
    && health_reports_sha "$target_sha"; then
    log "already deployed ${target_sha:0:12}; health reports target SHA; no deploy needed"
    exit 0
fi

if [[ "$current_sha" == "$target_sha" ]] && [[ "$deployed_sha" != "$target_sha" ]]; then
    log "repo is at ${target_sha:0:12} but last successful deploy marker is ${deployed_sha:-missing}; rebuilding"
elif [[ "$current_sha" == "$target_sha" ]] && ! health_reports_sha "$target_sha"; then
    log "repo is at ${target_sha:0:12} but health does not report that SHA; rebuilding"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    log "tracked local changes detected; resetting to ${target_sha:0:12}"
fi

log "deploying ${current_sha:0:12} -> ${target_sha:0:12}"
git reset --hard "$target_sha"

# Deploy the cosign-signed GHCR image release.yml builds for a release tag —
# and WAIT for it rather than building locally. When a tag is first pushed the
# image is still building (~20 min); a local-build fallback here would win the
# race and ship an unsigned, locally-built image on every release, defeating the
# whole point. So if the signed image isn't published-and-matching yet, skip
# this cycle and retry on the next one. A local build is used ONLY for
# branch/HEAD deploys, where no release image exists by design.
if [[ "$target_ref" != "${REMOTE}/${BRANCH}" && -n "$DEPLOY_IMAGE_REPO" ]]; then
    image_ref="${DEPLOY_IMAGE_REPO}:${target_ref}"
    log "pulling signed image ${image_ref}"
    img_rev=""
    if docker pull "$image_ref" >/dev/null 2>&1; then
        img_rev="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
    fi
    if [[ "$img_rev" != "$target_sha" ]]; then
        log "signed image for ${target_ref} not ready yet (revision '${img_rev:0:12}' != ${target_sha:0:12}); will retry next cycle"
        exit 0
    fi
    log "using signed image (revision matches ${target_sha:0:12})"
    PRIVATOOLS_IMAGE="$image_ref" GIT_SHA="$target_sha" docker compose up -d --no-build
else
    log "no release tag for ${target_ref}; building locally"
    GIT_SHA="$target_sha" docker compose up -d --build
fi
docker image prune -f >/dev/null || true

for i in $(seq 1 "$HEALTH_RETRIES"); do
    if health_reports_sha "$target_sha"; then
        printf '%s\n' "$target_sha" > "$STATE_FILE"
        log "deploy complete; health reports ${target_sha:0:12} after ${i}/${HEALTH_RETRIES} checks"
        ping_deploy ok
        exit 0
    fi
    sleep "$HEALTH_INTERVAL"
done

log "health check did not report ${target_sha:0:12} after $((HEALTH_RETRIES * HEALTH_INTERVAL)) seconds"
docker compose ps || true
ping_deploy fail
exit 1
