#!/usr/bin/env bash
# Poll origin/main and redeploy the Docker Compose app when a new commit is
# available, the last-success marker is stale, or health reports the wrong SHA.
# Intended to run from privatools-auto-deploy.service.
#
# This script chooses and verifies the release (tag, signature, digest,
# revision). privatools-rollout (rollout.sh) then replaces the running
# container with zero downtime: the new release starts beside the old one and
# receives traffic only after it is ready and serves real pages. A release
# that fails never replaces anything, so there is nothing to roll back; it is
# marked failed so it is not retried every minute.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
# Gate on /readyz, NOT the always-200 /api/health liveness probe. /readyz runs
# the real dependency checks (pikepdf/fitz/PIL importable, tessdata present, temp
# writable, free disk) and returns build_sha, so a container that came up with
# broken deps fails the gate (503) instead of deploying "successfully" (research
# O4). build_sha lets the same check confirm the new revision is live. This
# is the canonical container; the rollout gates the new one on the same check
# (plus a real-page probe) before it takes any traffic.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/readyz}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
STATE_FILE="${STATE_FILE:-${REPO_DIR}/.privatools-auto-deploy.sha}"
# A target sha whose release failed its readiness or page checks and so never
# replaced the running one. We refuse to retry it every cycle (thrash);
# cleared on the next success.
FAILED_FILE="${FAILED_FILE:-${REPO_DIR}/.privatools-auto-deploy.failed}"
# A target sha whose last attempt did not finish and was not the release's
# fault: a host problem (rollout exit 2: nginx, Docker, memory, a job that would
# not finish), the degraded state (3) or something needing a human (4). It is
# retried, but only after DEPLOY_RETRY_BACKOFF seconds: each attempt pulls,
# verifies and may boot a container on a shared VM.
RETRY_FILE="${RETRY_FILE:-${REPO_DIR}/.privatools-auto-deploy.retry}"
DEPLOY_RETRY_BACKOFF="${DEPLOY_RETRY_BACKOFF:-600}"

# Deploy gate. Without one, *any* commit reaching ${BRANCH} ships to prod
# within ~60s with no human approval. Modes:
#   auto   legacy: deploy the latest release tag reachable from ${BRANCH};
#          fall back to ${BRANCH} HEAD until the first tag exists — so turning
#          this on changes nothing until you cut your first release tag, after
#          which only tagged commits deploy.
#   tag    (default) only matching tags; never deploy an untagged branch push.
#   branch legacy: deploy ${BRANCH} HEAD every push (no gate).
DEPLOY_MODE="${DEPLOY_MODE:-tag}"
DEPLOY_TAG_GLOB="${DEPLOY_TAG_GLOB:-v*}"

# Prefer the cosign-signed image release.yml builds+pushes on each tag over a
# heavy rebuild on this 2-core VM. The deploy pulls ${DEPLOY_IMAGE_REPO}:<tag>,
# verifies its org.opencontainers.image.revision label == the tag's commit, and
# runs it with `up --no-build`. Set DEPLOY_IMAGE_REPO="" to force local builds.
DEPLOY_IMAGE_REPO="${DEPLOY_IMAGE_REPO:-ghcr.io/ethereaglehq/privatools}"

# Second namespace to try when the primary pull fails outright.
#
# Renaming the GitHub account moves the GHCR namespace with it and leaves NO
# redirect behind, so the configured repo starts 404ing the moment the rename
# lands. The site stays up — the running container is unaffected — but every
# subsequent release fails to pull and the deploy quietly stalls, which is the
# worst shape of failure: nothing is broken enough to notice.
#
# Listing both namespaces means the rename needs no coordinated deploy window.
# Set to "" to disable the fallback.
# Empty now that the 2026-09-06 rename has settled and the primary points at
# the current namespace — the old one no longer resolves, so retrying it would
# only add ~36s to a genuine outage. The mechanism stays for the next rename.
DEPLOY_IMAGE_REPO_FALLBACK="${DEPLOY_IMAGE_REPO_FALLBACK:-}"

# Optional deploy-health alerting: set DEPLOY_PING_URL to a Healthchecks.io (or
# similar) check URL. We ping it on success and ping <url>/fail on failure, so a
# stuck or failed deploy raises an alert instead of going unnoticed.
DEPLOY_PING_URL="${DEPLOY_PING_URL:-}"

# The zero-downtime replacement, installed beside this script.
ROLLOUT="${ROLLOUT:-/usr/local/bin/privatools-rollout}"

# cosign signature verification before deploy. release.yml signs each image
# keyless (Fulcio/OIDC via GitHub Actions); the OCI revision label is
# unauthenticated, so the signature is the real trust anchor. When cosign is
# unavailable on the host, deployment is refused. The signing identity is
# the release.yml workflow on a tag ref. (Validated against a real signed image.)
# Only the current repository's release workflow on a version tag is trusted.
# A future repository rename requires a reviewed identity update.
DEPLOY_COSIGN_IDENTITY_REGEXP="${DEPLOY_COSIGN_IDENTITY_REGEXP:-^https://github\\.com/ethereaglehq/privatools/\\.github/workflows/release\\.yml@refs/tags/v[^/]+$}"
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

# Invoked indirectly by the ERR trap below.
# shellcheck disable=SC2329
on_error() {
    local status="$1" line="$2"
    log "failed at line ${line} with exit ${status}"
    ping_deploy fail
    exit "$status"
}
trap 'on_error "$?" "$LINENO"' ERR

# Run as the deploy user only. Root cannot open the lock the timer owns in
# sticky /tmp (fs.protected_regular=2 on Ubuntu), and a root run before the
# lock exists would create one the timer can no longer open.
if [[ "$(id -u)" == 0 ]]; then
    log "refusing to run as root: start privatools-auto-deploy.service, or run as ubuntu"
    exit 1
fi

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
    auto)
        target_ref="$(latest_release_tag)"
        if [[ -n "$target_ref" ]]; then
            target_sha="$(git rev-parse "${target_ref}^{commit}")"
        else
            target_ref="${REMOTE}/${BRANCH}"
            target_sha="$branch_sha"
            log "no ${DEPLOY_TAG_GLOB} tag yet; deploying ${BRANCH} HEAD (cut a release tag to enable the deploy gate)"
        fi
        ;;
    *)
        log "invalid DEPLOY_MODE; expected tag, auto, or branch"
        exit 1
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

# If this exact target already failed its readiness or page checks, don't
# thrash retrying it every 60s: the previous release kept serving, so stay on
# it and wait for a newer tag to supersede it. (If the running release is
# itself unhealthy now, fall through and retry the deploy.)
if [[ "$current_sha" == "$target_sha" && -f "$FAILED_FILE" \
      && "$(tr -d '[:space:]' < "$FAILED_FILE")" == "$target_sha" ]] \
    && curl --fail --silent --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "target ${target_sha:0:12} previously failed its readiness or page checks; the previous release keeps serving (push a newer tag to retry)"
    exit 0
fi

# The last attempt at this target did not finish: retry it, but not yet.
if [[ -f "$RETRY_FILE" && "$(tr -d '[:space:]' < "$RETRY_FILE")" == "$target_sha" ]] \
    && (( $(date +%s) - $(stat -c %Y "$RETRY_FILE") < DEPLOY_RETRY_BACKOFF )); then
    log "the last attempt at ${target_sha:0:12} did not finish (see its log); backing off for up to ${DEPLOY_RETRY_BACKOFF}s before retrying"
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
    if ! $pulled && [[ -n "$DEPLOY_IMAGE_REPO_FALLBACK" ]]; then
        # Distinguishes "GHCR is briefly unhappy" (the retries above) from "this
        # namespace no longer exists" (an account rename). Only reached once the
        # primary has genuinely given up, so it costs nothing in the normal case.
        fallback_ref="${DEPLOY_IMAGE_REPO_FALLBACK}:${target_ref}"
        log "primary repo did not yield ${target_ref}; trying ${fallback_ref}"
        for attempt in 1 2 3; do
            if docker pull "$fallback_ref" >/dev/null 2>&1; then
                pulled=true
                image_ref="$fallback_ref"
                log "pulled from fallback namespace ${DEPLOY_IMAGE_REPO_FALLBACK}"
                break
            fi
            log "fallback pull attempt ${attempt}/3 for ${target_ref} failed; retrying in 12s (layers kept)"
            sleep 12
        done
    fi
    if ! $pulled; then
        log "pull not complete this cycle for ${target_ref}; will resume next cycle"
    fi
    img_rev="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
    if [[ "$img_rev" != "$target_sha" ]]; then
        log "signed image for ${target_ref} not ready yet (revision '${img_rev:0:12}' != ${target_sha:0:12}); will retry next cycle"
        exit 0
    fi
    # Pin verification AND execution to the pulled digest, not a mutable tag.
    # No signature tool means no release; do not silently run an unsigned image.
    image_digest="$(docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}')"
    if [[ ! "$image_digest" =~ @sha256:[a-f0-9]{64}$ ]]; then
        log "no immutable image digest found; refusing to deploy"
        exit 1
    fi
    if command -v cosign >/dev/null 2>&1; then
        if ! cosign verify "$image_digest" \
                --certificate-identity-regexp "$DEPLOY_COSIGN_IDENTITY_REGEXP" \
                --certificate-oidc-issuer "$DEPLOY_COSIGN_OIDC_ISSUER" >/dev/null 2>&1; then
            log "COSIGN VERIFY FAILED for ${image_ref} — refusing to deploy"
            ping_deploy fail
            exit 1
        fi
        log "cosign signature verified for ${target_ref}"
    else
        log "cosign is required for release verification; refusing to deploy"
        exit 1
    fi
    image_ref="$image_digest"
    log "using signed image (revision matches ${target_sha:0:12})"
else
    log "no release tag for ${target_ref}; building locally"
    if ! GIT_SHA="$target_sha" docker compose build privatools; then
        log "local build failed; the running release is untouched"
        ping_deploy fail
        exit 1
    fi
    # The name compose tags the build with; pin the rollout to its image ID.
    image_ref="$(docker image inspect --format '{{.Id}}' "${PRIVATOOLS_IMAGE:-privatools-privatools:latest}")"
fi

# Zero-downtime replacement. Once the release serves (exit 0), the rollout
# also removes old PrivaTools images, by name and only in the repositories
# passed here (deploy/README.md, Image retention). It keeps the newest
# KEEP_IMAGES (default 3), every container's image and the replaced release
# recorded for `privatools-rollout --rollback`, by image ID. Nothing prunes: a
# prune could delete the only usable rollback image once its tag has moved.
rollout_status=0
PRIVATOOLS_DEPLOY_LOCK_HELD=1 REPO_DIR="$REPO_DIR" LOCK_FILE="$LOCK_FILE" \
    DEPLOY_IMAGE_REPO="$DEPLOY_IMAGE_REPO" DEPLOY_IMAGE_REPO_FALLBACK="$DEPLOY_IMAGE_REPO_FALLBACK" \
    "$ROLLOUT" "$image_ref" "$target_sha" || rollout_status=$?
case "$rollout_status" in
    0)
        printf '%s\n' "$target_sha" > "$STATE_FILE"
        rm -f "$FAILED_FILE" "$RETRY_FILE"
        log "deploy complete; ${target_sha:0:12} serves from the canonical container"
        ping_deploy ok
        # IndexNow: tell Bing-fed indexes (Copilot, DuckDuckGo, Yandex) the
        # moment new URLs go live — a deploy is exactly when the sitemap
        # changes. Best-effort; never blocks the deploy result.
        curl -fsS --max-time 10 "https://api.indexnow.org/indexnow?url=https%3A%2F%2Fprivatools.me%2Fsitemap.xml&key=63a1ed0533fa44ea9b51efd7a6e34bd1" >/dev/null 2>&1 || true
        exit 0
        ;;
    1)
        # The release itself was at fault (not ready, broken pages, or a job
        # supervisor that cannot hold the queue) and never replaced the
        # running one. Do not retry it every cycle; a newer tag supersedes it.
        printf '%s\n' "$target_sha" > "$FAILED_FILE"
        log "REJECTED: ${target_sha:0:12} failed its readiness, page or job checks; the previous release kept serving. Marked failed (push a newer tag to retry)."
        ;;
    2)
        # A host problem, not the release: retry after a backoff.
        printf '%s\n' "$target_sha" > "$RETRY_FILE"
        log "the rollout hit a host problem or refused to start (see above); the previous release serves; retrying after ${DEPLOY_RETRY_BACKOFF}s"
        ;;
    3)
        printf '%s\n' "$target_sha" > "$RETRY_FILE"
        log "DEGRADED: ${target_sha:0:12} serves from the interim container; retrying the canonical container after ${DEPLOY_RETRY_BACKOFF}s"
        ;;
    *)
        printf '%s\n' "$target_sha" > "$RETRY_FILE"
        log "CRITICAL: rollout exited ${rollout_status}; check nginx and the containers now (next attempt after ${DEPLOY_RETRY_BACKOFF}s)"
        ;;
esac
ping_deploy fail
exit 1
