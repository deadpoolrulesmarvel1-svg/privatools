#!/usr/bin/env bash
# Poll origin/main and redeploy the Docker Compose app when a new commit is
# available, the last-success marker is stale, or health reports the wrong SHA.
# Intended to run from privatools-auto-deploy.service.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
# Gate on /readyz, NOT the always-200 /api/health liveness probe. /readyz runs
# the real dependency checks (pikepdf/fitz/PIL importable, tessdata present, temp
# writable, free disk) and returns build_sha, so a container that came up with
# broken deps fails the gate (503) instead of deploying "successfully" (research
# O4). build_sha lets the same check confirm the new revision is live.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/readyz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-6}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
STATE_FILE="${STATE_FILE:-${REPO_DIR}/.privatools-auto-deploy.sha}"
# A target sha that deployed but failed its health gate and was auto-rolled-back.
# We refuse to redeploy it every cycle (thrash); cleared on the next success.
FAILED_FILE="${FAILED_FILE:-${REPO_DIR}/.privatools-auto-deploy.failed}"

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

# cosign signature verification before deploy. release.yml signs each image
# keyless (Fulcio/OIDC via GitHub Actions); the OCI revision label is
# unauthenticated, so the signature is the real trust anchor. When cosign is
# installed on the host, verification is FAIL-CLOSED. The signing identity is
# the release.yml workflow on a tag ref. (Validated against a real signed image.)
DEPLOY_COSIGN_IDENTITY_REGEXP="${DEPLOY_COSIGN_IDENTITY_REGEXP:-^https://github.com/deadpoolrulesmarvel1-svg/privatools/\\.github/workflows/release\\.yml@}"
DEPLOY_COSIGN_OIDC_ISSUER="${DEPLOY_COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

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

# If this exact target already deployed-and-failed-health and was rolled back,
# don't thrash redeploying it every 60s — stay on the rolled-back image and wait
# for a newer tag to supersede it. (If the rolled-back image is itself unhealthy
# now, fall through and retry the deploy.)
if [[ "$current_sha" == "$target_sha" && -f "$FAILED_FILE" \
      && "$(tr -d '[:space:]' < "$FAILED_FILE")" == "$target_sha" ]] \
    && curl --fail --silent --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "target ${target_sha:0:12} previously failed its health gate and was rolled back; staying on the rolled-back image (push a newer tag to retry)"
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

# Capture the image currently running so we can roll back to it if the new image
# fails its health gate below (empty on a first deploy / no running container).
prev_image="$(docker inspect --format '{{.Config.Image}}' \
    "$(docker compose ps -q 2>/dev/null | head -1)" 2>/dev/null || true)"
[[ -n "$prev_image" ]] && log "pre-deploy: currently running ${prev_image}"

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
    # Pull with a few retries + backoff. A freshly-pushed image sometimes fails
    # the first pull with a transient containerd error; a plain retry that KEEPS
    # the partially-pulled layers succeeds — which is why a manual `docker pull`
    # always worked here while auto-deploy didn't. Deliberately NO `docker image
    # prune` between attempts: pruning discards the in-progress layers, so every
    # retry restarts from zero into the same error and the pull never completes
    # (this stuck several releases until a hand `docker pull`). Keeping the layers
    # lets this cycle — and the next — resume the download.
    pulled=false
    for attempt in 1 2 3; do
        if docker pull "$image_ref" >/dev/null 2>&1; then pulled=true; break; fi
        log "pull attempt ${attempt}/3 for ${target_ref} failed; retrying in 12s (layers kept)"
        sleep 12
    done
    if ! $pulled; then
        log "pull not complete this cycle for ${target_ref}; will resume next cycle"
    fi
    img_rev="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
    if [[ "$img_rev" != "$target_sha" ]]; then
        log "signed image for ${target_ref} not ready yet (revision '${img_rev:0:12}' != ${target_sha:0:12}); will retry next cycle"
        exit 0
    fi
    # Verify the cosign signature before running the image. Fail closed when
    # cosign is installed; warn-and-proceed otherwise (so a host without cosign
    # still deploys — prod has cosign installed, so it enforces).
    if command -v cosign >/dev/null 2>&1; then
        if ! cosign verify "$image_ref" \
                --certificate-identity-regexp "$DEPLOY_COSIGN_IDENTITY_REGEXP" \
                --certificate-oidc-issuer "$DEPLOY_COSIGN_OIDC_ISSUER" >/dev/null 2>&1; then
            log "COSIGN VERIFY FAILED for ${image_ref} — refusing to deploy"
            ping_deploy fail
            exit 1
        fi
        log "cosign signature verified for ${target_ref}"
    else
        log "WARNING: cosign not installed; skipping signature verification (install cosign to enforce)"
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
        rm -f "$FAILED_FILE"
        log "deploy complete; health reports ${target_sha:0:12} after ${i}/${HEALTH_RETRIES} checks"
        ping_deploy ok
        exit 0
    fi
    sleep "$HEALTH_INTERVAL"
done

log "health check did not report ${target_sha:0:12} after $((HEALTH_RETRIES * HEALTH_INTERVAL)) seconds"
docker compose ps || true

# Automated rollback: the new image is up but never went healthy. Restore the
# image that was running before this deploy (it was healthy until now) so prod
# isn't left broken, and mark this target failed so the next cycle doesn't
# redeploy it on a loop. Only roll back to a real, different prior image.
if [[ -n "$prev_image" && "$prev_image" != "${image_ref:-}" ]]; then
    log "ROLLBACK: restoring previous image ${prev_image}"
    if PRIVATOOLS_IMAGE="$prev_image" docker compose up -d --no-build; then
        for i in $(seq 1 "$HEALTH_RETRIES"); do
            if curl --fail --silent --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
                printf '%s\n' "$target_sha" > "$FAILED_FILE"
                log "ROLLBACK successful after ${i} checks; previous image healthy. Marked ${target_sha:0:12} failed (won't redeploy until a newer tag)."
                ping_deploy fail
                exit 1
            fi
            sleep "$HEALTH_INTERVAL"
        done
        log "ROLLBACK image ALSO unhealthy — prod may be down, manual intervention required"
    else
        log "ROLLBACK: 'docker compose up' of ${prev_image} failed"
    fi
else
    log "no prior image to roll back to (first deploy or same image)"
fi
ping_deploy fail
exit 1
