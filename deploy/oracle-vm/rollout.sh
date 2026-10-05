#!/usr/bin/env bash
# Replace the running PrivaTools release without taking the site offline.
#
#   privatools-rollout IMAGE BUILD_SHA   run IMAGE, which must report BUILD_SHA
#   privatools-rollout --rollback        run the release the last rollout replaced
#
# Installed as /usr/local/bin/privatools-rollout. auto-deploy.sh calls it with
# the cosign-verified digest of a release tag; deploy.sh calls it with a local
# build. It never pulls, builds or verifies anything itself.
#
# Run it as the deploy user, never as root. The timer does; by hand:
#   sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout ...
# It refuses root, because root cannot open the deploy lock the timer owns in
# sticky /tmp (fs.protected_regular) and would leave state the timer cannot use.
#
# The steady state is one container, privatools-privatools-1 on
# 127.0.0.1:8000, exactly as before; the backup, the manual commands in
# deploy/README.md and the CI image probe all rely on that. A rollout passes
# traffic through a temporary second compose project, privatools-interim, on
# 127.0.0.1:8001:
#
#   0. Finish a switch a killed run left half done (renamed, perhaps not
#      reloaded) by re-applying the upstream; otherwise leave the shared nginx
#      alone. If the port the file names has not been ready for
#      RECONCILE_WAIT seconds, fall back only to a canonical container that
#      passes the page probe again, never to an interim that may not have
#      passed the gates. Then retire any leftover interim.
#   1. Start the interim container on the new image beside the live one. Wait
#      for /readyz to report BUILD_SHA and for the real-page probe
#      (scripts/ci/probe-image.py --running) to pass. Hand the async job queue
#      over: the old supervisor finishes its current job, the new one takes
#      the lock and must keep it, without a container restart, for a soak
#      period. Only then switch host nginx to 8001 (nginx -t, graceful reload,
#      and proof that the reload happened) and check through nginx that the
#      new build answers. Otherwise remove the interim and stop: the live
#      release never stopped serving.
#   2. Let the old container finish its in-flight requests, including those
#      nginx's retiring workers still pass to it. A container that still
#      receives requests after those workers exited is never removed.
#   3. Recreate the canonical container on the new image, gate it the same
#      way, hand the queue to it, switch nginx back to 8000, drain the interim
#      and remove it.
#   4. Only once BUILD_SHA serves from the canonical container (exit 0, also
#      after --rollback), remove old PrivaTools release images by name, never
#      forced or pruned. The newest KEEP_IMAGES, the image of every container
#      and the release recorded for --rollback stay. A failure here is logged
#      and never changes the exit status.
#
# The replaced release is recorded before anything destroys it; --rollback
# runs it again the same way, also from the degraded state below.
#
# Exit status:
#   0  BUILD_SHA serves from the canonical container
#   1  the new release was rejected (not ready, broken pages, or its job
#      supervisor could not hold the queue); the previous release serves
#   2  nothing was started, or a host problem undid the attempt (nginx, Docker,
#      memory, a job that would not finish); the previous release serves;
#      retry later
#   3  degraded: the new release serves from the interim container
#   4  nginx could not be brought to a verified state, or a container that
#      still receives requests had to be kept; act now
# -E: the ERR trap below also reports failures inside functions.
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/privatools}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-privatools}"
INTERIM_PROJECT="${INTERIM_PROJECT:-${COMPOSE_PROJECT}-interim}"
SERVICE=privatools
CANONICAL_PORT="${CANONICAL_PORT:-8000}"
INTERIM_PORT="${INTERIM_PORT:-8001}"
# Host nginx includes this file; only the root helper writes it.
UPSTREAM_FILE="${UPSTREAM_FILE:-/etc/nginx/privatools-upstream.conf}"
# The site must proxy through that upstream, or a switch would change nothing.
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/privatools}"
NGINX_SWITCH="${NGINX_SWITCH:-sudo -n /usr/local/sbin/privatools-nginx-upstream set}"
NGINX_PID_FILE="${NGINX_PID_FILE:-/run/nginx.pid}"
# Checked through nginx after each switch: the public path, not the port.
PUBLIC_READY_URL="${PUBLIC_READY_URL:-https://privatools.me/readyz}"
PUBLIC_RESOLVE="${PUBLIC_RESOLVE:-privatools.me:443:127.0.0.1}"
PROBE_SCRIPT="${PROBE_SCRIPT:-${REPO_DIR}/scripts/ci/probe-image.py}"
# The page probe asks for the public site by name, as nginx does, so a release
# whose TRUSTED_HOSTS rejects it fails the gate instead of the check through
# nginx after a switch.
PROBE_HOST="${PROBE_HOST:-privatools.me}"
PYTHON="${PYTHON:-python3}"
# The job supervisor's status, inside a container; standard library only, so
# polling it costs about 0.06 CPU-s instead of the app's 1 s of imports.
STATUS_MODULE="${STATUS_MODULE:-backend.app.job_handover}"
# Uvicorn respawns workers that die at import, so a broken release never
# exits: readiness needs a deadline, and a crash loop is caught early.
READY_TIMEOUT="${READY_TIMEOUT:-180}"
# A reload must visibly retire nginx's previous worker generation this fast.
SWITCH_VERIFY="${SWITCH_VERIFY:-10}"
# A port nginx serves counts as down only after failing /readyz for this long:
# one failure can be a busy uvicorn's 503 or a slow boot after a reboot.
RECONCILE_WAIT="${RECONCILE_WAIT:-30}"
# nginx passes a request to its upstream only after buffering the whole body,
# so an upload that began before a switch can still reach the old container
# from a retiring nginx worker. Keep the old container until that nginx
# generation has exited, or DRAIN_MAX seconds (nginx's 300 s timeouts), and
# then until no request has been in flight on it for DRAIN_QUIET seconds.
# Once that generation has exited, nothing nginx runs should reach it: a
# connection that lasts DRAIN_ROUTED_GRACE seconds means nginx still routes
# there, and the container is kept (exit 4).
DRAIN_MAX="${DRAIN_MAX:-300}"
DRAIN_EXTRA="${DRAIN_EXTRA:-120}"
DRAIN_QUIET="${DRAIN_QUIET:-3}"
DRAIN_ROUTED_GRACE="${DRAIN_ROUTED_GRACE:-5}"
# A running async job may take up to runtime_seconds (300 s) to finish.
HANDOVER_MAX="${HANDOVER_MAX:-360}"
# The new supervisor must take the queue within HANDOVER_CONFIRM seconds and
# keep it, without its container restarting, for HANDOVER_SOAK seconds.
HANDOVER_CONFIRM="${HANDOVER_CONFIRM:-30}"
HANDOVER_SOAK="${HANDOVER_SOAK:-5}"
# Only for a replaced release older than the drainable supervisor (the first
# deploy after the cut-over): how long to wait for a fully idle queue.
HANDOVER_IDLE_WAIT="${HANDOVER_IDLE_WAIT:-60}"
# Two containers share the VM during the overlap. Refuse to start the second
# one unless this much memory is available (see deploy/README.md).
MIN_AVAILABLE_MB="${MIN_AVAILABLE_MB:-1536}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
STATE_DIR="${STATE_DIR:-$REPO_DIR}"
PREVIOUS_FILE="${PREVIOUS_FILE:-${STATE_DIR}/.privatools-deploy.previous}"
RESUME_FILE="${RESUME_FILE:-${STATE_DIR}/.privatools-deploy.resume}"
RESUME_BACKOFF="${RESUME_BACKOFF:-600}"
# A switch under way: written before the helper runs, removed once nginx is
# seen to have reloaded. A run that dies in between leaves it, and the next run
# re-applies the upstream, because nginx may still route to the port the file
# no longer names. Nothing else reloads the shared nginx. It also lists the
# worker generation that switch retired, whose late requests a drain waits for.
SWITCH_FILE="${SWITCH_FILE:-${STATE_DIR}/.privatools-deploy.switching}"
LOCK_FILE="${LOCK_FILE:-/tmp/privatools-auto-deploy.lock}"
POLL="${POLL:-1}"
# Image retention after exit 0 (retain_images): how many of the newest
# PrivaTools release images to keep. The release that serves and the one
# recorded for --rollback normally rank first and second among them, so the
# default keeps one spare; either is kept when older too, as is any image a
# container uses. Below 2, or not a number, retention is skipped.
KEEP_IMAGES="${KEEP_IMAGES:-3}"
# PrivaTools' own image repositories, as Docker names them: the only ones
# retention looks at. The release repository and its fallback namespace
# (auto-deploy.sh passes both; these are its defaults), and the name a local
# build gets (docker-compose.yml). main adds the repository of the image it
# deploys, so a run by hand needs neither variable.
IMAGE_REPOS="${DEPLOY_IMAGE_REPO:-ghcr.io/ethereaglehq/privatools} ${DEPLOY_IMAGE_REPO_FALLBACK:-} privatools-privatools"

COMPOSE_FILE_PATH="${REPO_DIR}/docker-compose.yml"
INTERIM_FILE_PATH="${REPO_DIR}/deploy/oracle-vm/compose.interim.yml"

data_volume=""
temp_volume=""
jobs_enabled=false
retired_workers=()

log() {
    printf '[privatools-rollout] %s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# Invoked indirectly by the ERR trap below. The main phases run in `||`
# context, where bash suspends errexit and this trap, so every step there
# checks its own result.
# shellcheck disable=SC2329
on_error() {
    log "unexpected failure at line $2 (exit $1); the next run reconciles from the nginx upstream"
}
trap 'on_error "$?" "$LINENO"' ERR

now() { date +%s; }

mark_resume() {  # the canonical container failed: back off before retrying it
    touch "$RESUME_FILE" 2>/dev/null || log "WARNING: cannot write ${RESUME_FILE}; the next run will not back off"
}

canonical_compose() {
    PRIVATOOLS_HOST_PORT="$CANONICAL_PORT" \
        docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE_PATH" "$@"
}

interim_compose() {
    PRIVATOOLS_HOST_PORT="$INTERIM_PORT" PRIVATOOLS_DATA_VOLUME="$data_volume" \
        PRIVATOOLS_TEMP_VOLUME="$temp_volume" \
        docker compose -p "$INTERIM_PROJECT" -f "$COMPOSE_FILE_PATH" -f "$INTERIM_FILE_PATH" "$@"
}

container_of() {  # container_of PROJECT -> its service container, running or not
    docker ps -aq --filter "label=com.docker.compose.project=$1" \
        --filter "label=com.docker.compose.service=${SERVICE}" \
        --filter "label=com.docker.compose.oneoff=False" 2>/dev/null | head -n1 || true
}

image_of() { docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true; }

sha_of() {  # the PRIVATOOLS_BUILD_SHA a container was started with; nothing else is read
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null \
        | sed -n 's/^PRIVATOOLS_BUILD_SHA=//p' | head -n1 || true
}

mount_of() {  # mount_of CONTAINER DESTINATION -> named volume mounted there
    docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}" "$1" 2>/dev/null || true
}

image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }

container_state() {  # CONTAINER -> "true|false RESTARTS", or "gone"; nothing when Docker could not say
    local out
    [[ -n "${1:-}" ]] || { echo gone; return 0; }
    if out="$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$1" 2>&1)"; then
        printf '%s\n' "$out"
    elif [[ "$out" == *"No such"* ]]; then
        echo gone
    fi
    return 0
}

settled_state() {  # container_state, asked again while the Docker CLI fails: one error proves nothing
    local state attempt
    for attempt in 1 2 3; do
        state="$(container_state "${1:-}")"
        if [[ -n "$state" ]]; then
            printf '%s\n' "$state"
            return 0
        fi
        (( attempt < 3 )) && sleep "$POLL"
    done
    return 0
}

is_running() { [[ "$(settled_state "${1:-}")" == true* ]]; }

restarts_of() {  # CONTAINER -> its restart count, or "unknown" when Docker could not say
    local state
    state="$(settled_state "$1")"
    case "$state" in
        true\ *|false\ *) printf '%s\n' "${state#* }" ;;
        *) echo unknown ;;
    esac
}

readyz_sha() {  # readyz_sha URL [CURL_ARGS...] -> build_sha when the body says ready
    local body
    body="$(curl --fail --silent --max-time 5 "$@" 2>/dev/null)" || return 1
    [[ "$body" == *'"status":"ready"'* || "$body" == *'"status": "ready"'* ]] || return 1
    sed -n 's/.*"build_sha": *"\([^"]*\)".*/\1/p' <<<"$body"
}

ready_sha() { readyz_sha "http://127.0.0.1:$1/readyz" || true; }

serves() {  # serves PORT SHA
    [[ -n "$2" && "$(ready_sha "$1")" == "$2" ]]
}

public_serves() {  # public_serves SHA: nginx forwards to a ready release reporting SHA
    local -a resolve=()
    local attempt
    [[ -n "$PUBLIC_RESOLVE" ]] && resolve=(--resolve "$PUBLIC_RESOLVE")
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if [[ "$(readyz_sha "$PUBLIC_READY_URL" "${resolve[@]}" || true)" == "$1" ]]; then
            return 0
        fi
        sleep "$POLL"
    done
    log "nginx does not forward to a ready ${1:0:12} (${PUBLIC_READY_URL}, attempt ${attempt})"
    return 1
}

live_port() {
    sed -n 's/^[[:space:]]*server[[:space:]]\{1,\}127\.0\.0\.1:\([0-9]\{1,\}\)[[:space:];].*/\1/p' \
        "$UPSTREAM_FILE" 2>/dev/null | head -n1 || true
}

wait_ready() {  # wait_ready CONTAINER PORT SHA
    local container="$1" port="$2" sha="$3" deadline status restarts
    deadline=$(( $(now) + READY_TIMEOUT ))
    while (( $(now) < deadline )); do
        serves "$port" "$sha" && return 0
        read -r status restarts <<<"$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$container" 2>/dev/null || echo missing 0)"
        if [[ "$status" == exited || "$status" == dead || "$status" == missing ]] || (( restarts > 0 )); then
            log "container ${container:0:12} gave up before it was ready (${status}, ${restarts} restarts)"
            return 1
        fi
        sleep "$POLL"
    done
    log "container ${container:0:12} did not report ${sha:0:12} ready within ${READY_TIMEOUT}s"
    return 1
}

page_probe() {  # page_probe CONTAINER PORT SHA: real pages, not only /readyz
    log "probing real pages on 127.0.0.1:$2 as ${PROBE_HOST}"
    # Older probes ignore the variable and send Host: 127.0.0.1, as before.
    PRIVATOOLS_PROBE_HOST="$PROBE_HOST" \
        "$PYTHON" "$PROBE_SCRIPT" --running "$1" --url "http://127.0.0.1:$2" --sha "$3" 2>&1 | sed 's/^/    /'
}

serving_within() {  # serving_within PORT SECONDS: /readyz answered ready at least once in that time
    local deadline
    deadline=$(( $(now) + $2 ))
    while :; do
        [[ -n "$(ready_sha "$1")" ]] && return 0
        (( $(now) >= deadline )) && return 1
        sleep "$POLL"
    done
}

show_logs() {
    docker logs --tail 60 "$1" 2>&1 | sed 's/^/    /' || true
}

# ── nginx ────────────────────────────────────────────────────────────────────

nginx_workers() {  # PIDs of nginx's current worker generation (not those already retiring)
    local master
    master="$(cat "$NGINX_PID_FILE" 2>/dev/null || true)"
    [[ "$master" =~ ^[0-9]+$ ]] || return 0
    ps -o pid=,args= --ppid "$master" 2>/dev/null \
        | awk 'NF == 4 && $2 == "nginx:" && $3 == "worker" && $4 == "process" { print $1 }' || true
}

alive_workers() {  # alive_workers PID...: those still nginx workers (a reused PID is not)
    local pid
    for pid in "$@"; do
        [[ "$(ps -o args= -p "$pid" 2>/dev/null || true)" == "nginx: worker process"* ]] && printf '%s\n' "$pid"
    done
    return 0
}

generation_retiring() {  # PID...: every one has exited or is shutting down
    local pid
    for pid in "$@"; do
        [[ "$(ps -o args= -p "$pid" 2>/dev/null || true)" == "nginx: worker process" ]] && return 1
    done
    return 0
}

switch_to() {  # switch_to PORT: the helper, then proof that nginx reloaded
    local -a command
    local deadline
    read -ra command <<<"$NGINX_SWITCH"
    mapfile -t retired_workers < <(nginx_workers)
    # Recorded first, so a run that dies from here on is repaired by the next
    # one (SWITCH_FILE). Kept on every failure below: nginx may not match.
    # Workers an earlier unfinished switch retired stay listed while they live.
    local -a earlier=()
    if [[ -f "$SWITCH_FILE" ]]; then
        local rest=""
        read -r _ rest < "$SWITCH_FILE" || true
        read -ra earlier <<<"$rest"
        mapfile -t earlier < <(alive_workers "${earlier[@]}")
    fi
    if ! printf '%s %s\n' "$1" "${retired_workers[*]} ${earlier[*]}" > "$SWITCH_FILE" 2>/dev/null; then
        log "cannot record the switch in ${SWITCH_FILE}; not switching nginx"
        return 1
    fi
    log "switching nginx to 127.0.0.1:$1"
    if ! "${command[@]}" "$1"; then
        log "nginx switch to $1 failed; the helper kept the previous upstream"
        return 1
    fi
    if [[ "$(live_port)" != "$1" ]]; then
        log "the upstream file does not name port $1 after the switch"
        return 1
    fi
    if (( ${#retired_workers[@]} == 0 )); then
        log "note: nginx's worker processes are not visible (${NGINX_PID_FILE}); the reload is unverified"
        rm -f "$SWITCH_FILE"
        return 0
    fi
    deadline=$(( $(now) + SWITCH_VERIFY ))
    until generation_retiring "${retired_workers[@]}"; do
        if (( $(now) >= deadline )); then
            log "nginx did not reload: its workers from before the switch still take requests"
            return 1
        fi
        sleep "$POLL"
    done
    rm -f "$SWITCH_FILE"
}

reconcile_nginx() {  # reconcile_nginx LIVE: nginx serves a port that passed the gates; 0, 2 or 4
    local live="$1" pending=false rest=""
    local -a interrupted=()
    retired_workers=()
    if [[ -f "$SWITCH_FILE" ]]; then
        pending=true
        # "PORT PID...": the workers the interrupted switch retired.
        read -r _ rest < "$SWITCH_FILE" || true
        read -ra interrupted <<<"${rest:-}"
    fi
    if serving_within "$live" "$RECONCILE_WAIT"; then
        # nginx is reloaded only to finish a switch a killed run left half done
        # (renamed but maybe not reloaded); otherwise the file is what it serves.
        $pending || return 0
        log "a previous switch to ${live} was not seen to take effect; re-applying the upstream"
        if switch_to "$live"; then
            mapfile -t -O "${#retired_workers[@]}" retired_workers < <(alive_workers "${interrupted[@]}")
            return 0
        fi
        log "could not re-apply the upstream (${live}); nginx may not match its file; retry later"
        return 2
    fi
    # The port the file names has not answered ready for RECONCILE_WAIT seconds.
    # Only the canonical slot is a fallback: it only ever runs an image that
    # passed the gates, and it must pass the page probe again now. An interim
    # the file does not name may never have passed them (a run killed in
    # phase 1), so it never gets traffic here.
    if [[ "$live" == "$INTERIM_PORT" ]]; then
        local canonical sha
        canonical="$(container_of "$COMPOSE_PROJECT")"
        sha="$(ready_sha "$CANONICAL_PORT")"
        if [[ -n "$sha" && -n "$canonical" ]] && page_probe "$canonical" "$CANONICAL_PORT" "$sha"; then
            log "the upstream names the interim container, not ready for ${RECONCILE_WAIT}s; switching to the canonical container, which serves"
            switch_to "$CANONICAL_PORT" && return 0
            log "CRITICAL: could not switch nginx to ${CANONICAL_PORT}, the only port that serves"
            return 4
        fi
    elif [[ -n "$(ready_sha "$INTERIM_PORT")" ]]; then
        log "CRITICAL: the canonical container has not been ready for ${RECONCILE_WAIT}s; the interim container never passed this run's gates, so it gets no traffic; a gated release will replace both"
        return 0
    fi
    log "CRITICAL: nothing that passed the gates is ready; continuing, since a ready release would fix this"
    return 0
}

# ── draining ─────────────────────────────────────────────────────────────────

connections() {  # client connections open to the app in CONTAINER (loopback, i.e. its own healthcheck, excluded)
    { docker exec "$1" cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true; } | awk '
        $4 == "01" {
            split($2, here, ":"); split($3, peer, ":")
            if (here[2] == "1F40" && peer[1] != "0100007F" \
                && peer[1] != "00000000000000000000000001000000" \
                && peer[1] != "0000000000000000FFFF00000100007F") n++
        }
        END { print n + 0 }'
}

drain_http() {  # drain_http CONTAINER RETIRED_NGINX_PID...: 0 drained, 4 nginx still routes to it
    local container="$1" tracked start elapsed busy old quiet_since="" routed_since=""
    shift
    # Only the workers this deploy retired, never other sites' reloads: their
    # generations never send requests here, and some live for hours.
    tracked=$#
    start="$(now)"
    while :; do
        elapsed=$(( $(now) - start ))
        # Workers first: a connection counted after they were seen gone is
        # not one of theirs.
        old="$(alive_workers "$@" | wc -l)"
        busy="$(connections "$container")"
        if (( busy == 0 )); then
            quiet_since="${quiet_since:-$(now)}"
            routed_since=""
        else
            quiet_since=""
        fi
        if (( tracked > 0 && old == 0 )); then
            # The retired generation has exited, and the reload was verified:
            # nothing nginx still runs should reach this container.
            if (( busy > 0 )); then
                routed_since="${routed_since:-$(now)}"
                if (( $(now) - routed_since >= DRAIN_ROUTED_GRACE )); then
                    log "CRITICAL: ${container:0:12} still receives requests after nginx's retired workers exited, so nginx still routes to it; keeping it"
                    return 4
                fi
            elif (( $(now) - quiet_since >= DRAIN_QUIET )); then
                log "${container:0:12} drained after ${elapsed}s"
                return 0
            fi
        elif [[ -n "$quiet_since" ]] && (( $(now) - quiet_since >= DRAIN_QUIET )) \
            && (( tracked == 0 || elapsed >= DRAIN_MAX )); then
            log "${container:0:12} drained after ${elapsed}s (${old} of the nginx workers it retired still open, held by other connections)"
            return 0
        elif (( elapsed >= DRAIN_MAX + DRAIN_EXTRA )); then
            if (( tracked > 0 )); then
                log "WARNING: ${busy} requests of nginx's retired workers still open on ${container:0:12} after ${elapsed}s; retiring it anyway"
                return 0
            fi
            log "CRITICAL: ${container:0:12} still receives requests after ${elapsed}s and nginx's workers cannot be seen; keeping it"
            return 4
        fi
        sleep "$POLL"
    done
}

# ── async job handover (see backend/app/api_v1/jobs/worker.py) ────────────────

worker_view() {  # CONTAINER -> "ENABLED ROLE PASSIVE ALIVE RUNNING QUEUED"; fails for older releases
    local json
    [[ -n "${1:-}" ]] || return 1
    json="$(docker exec "$1" python -m "$STATUS_MODULE" --status 2>/dev/null)" || return 1
    "$PYTHON" -c '
import json, sys
state = json.loads(sys.argv[1])
local = state.get("local") or {}
count = lambda name: -1 if state.get(name) is None else state[name]
flag = lambda value: "true" if value else "false"
print(flag(state.get("enabled")), local.get("role") or "none", flag(local.get("passive")),
      flag(local.get("alive")), count("running_jobs"), count("queued_jobs"))
' "$json" 2>/dev/null
}

worker_view_retry() {  # worker_view, asked again while it fails (3 tries): one Docker error proves nothing
    local attempt view
    for attempt in 1 2 3; do
        if view="$(worker_view "$1")"; then
            printf '%s\n' "$view"
            return 0
        fi
        (( attempt < 3 )) && sleep "$POLL"
    done
    return 1
}

detect_jobs() {  # detect_jobs CONTAINER...: are async jobs enabled in this deployment?
    local container view
    for container in "$@"; do
        if view="$(worker_view_retry "$container")"; then
            [[ "${view%% *}" == true ]] && jobs_enabled=true || jobs_enabled=false
            return 0
        fi
    done
    jobs_enabled=false
}

predates_handover() {  # CONTAINER: running, but no status command however often asked (v2.6.1)
    is_running "$1" && ! worker_view_retry "$1" >/dev/null
}

signal_if() {  # signal_if CONTAINER SIGNAL drainable|passive: 0 when sent
    local view role passive alive
    view="$(worker_view_retry "$1")" || return 1
    read -r _ role passive alive _ _ <<<"$view"
    # A supervisor writes its state (alive) only after installing its handlers.
    [[ "$alive" == true ]] || return 1
    case "$3" in
        drainable) [[ "$role" == active || "$role" == draining ]] || return 1 ;;
        # A supervisor still finishing its job after SIGUSR1 reports
        # "draining"; resuming it then keeps the lock where it is.
        passive) [[ "$passive" == true || "$role" == draining ]] || return 1 ;;
    esac
    docker kill --signal "$2" "$1" >/dev/null 2>&1
}

release_queue() {  # release_queue FROM: drain FROM's supervisor until it holds no job lock; 1 after HANDOVER_MAX
    local from="$1" deadline view role alive state asked=false
    deadline=$(( $(now) + HANDOVER_MAX ))
    while (( $(now) < deadline )); do
        if view="$(worker_view "$from")"; then
            read -r _ role _ alive _ _ <<<"$view"
            [[ "$role" == active || "$role" == draining ]] || return 0
            # Asked once it can take the signal; again if the first attempt failed.
            if ! $asked && [[ "$alive" == true ]] && docker kill --signal SIGUSR1 "$from" >/dev/null 2>&1; then
                asked=true
                log "asked the job supervisor in ${from:0:12} to finish its current job and hand over the queue"
            fi
        else
            # Stopped or gone holds nothing. A failed Docker call proves
            # nothing: ask again.
            state="$(container_state "$from")"
            [[ "$state" == gone || "$state" == false\ * ]] && return 0
        fi
        sleep "$POLL"
    done
    return 1
}

# Why confirm_active last failed: "restart" (its container restarted or
# stopped, taking its web server with it), "inactive" (it answered, but did
# not hold the queue) or "unknown" (Docker never let it answer).
confirm_failure=""

confirm_active() {  # confirm_active TO BASELINE_RESTARTS: holds the queue, keeps it, no restart
    local to="$1" baseline="$2" deadline limit soak_until="" state running restarts view role passive alive
    local answered=false
    deadline=$(( $(now) + HANDOVER_CONFIRM ))
    confirm_failure=""
    while :; do
        # Every failed Docker call is asked again until the deadline; only an
        # answer can fail the supervisor.
        state="$(container_state "$to")"
        if [[ -n "$state" ]]; then
            read -r running restarts <<<"$state"
            if [[ "$state" == gone || "$running" != true || "$restarts" != "$baseline" ]]; then
                confirm_failure=restart
                log "the job supervisor of ${to:0:12} failed: its container restarted or stopped"
                return 1
            fi
            if view="$(worker_view "$to")"; then
                answered=true
                read -r _ role passive alive _ _ <<<"$view"
                if [[ "$role" == active && "$alive" == true ]]; then
                    soak_until="${soak_until:-$(( $(now) + HANDOVER_SOAK ))}"
                    if (( $(now) >= soak_until )); then
                        log "the job supervisor in ${to:0:12} holds the queue"
                        return 0
                    fi
                elif [[ -n "$soak_until" ]]; then
                    confirm_failure=inactive
                    log "the job supervisor of ${to:0:12} lost the queue within ${HANDOVER_SOAK}s"
                    return 1
                elif [[ "$passive" == true && "$alive" == true ]]; then
                    # It is meant to take the queue: resume it, in case the
                    # first SIGUSR2 was lost to a failed Docker call.
                    docker kill --signal SIGUSR2 "$to" >/dev/null 2>&1 || true
                fi
            fi
        fi
        # The deadline is for taking the queue; a soak under way gets its own.
        limit=$deadline
        [[ -n "$soak_until" ]] && limit=$(( soak_until + HANDOVER_CONFIRM ))
        if (( $(now) >= limit )); then
            if [[ -n "$soak_until" ]] || ! $answered; then
                confirm_failure=unknown
                log "Docker did not let ${to:0:12}'s job supervisor be confirmed within ${HANDOVER_CONFIRM}s"
            else
                confirm_failure=inactive
                log "the job supervisor of ${to:0:12} did not take the queue within ${HANDOVER_CONFIRM}s"
            fi
            return 1
        fi
        sleep "$POLL"
    done
}

handover() {  # handover FROM TO BASELINE: 0 done, 1 TO cannot hold the queue, 2 FROM would not let go or Docker could not tell
    local from="$1" to="$2" baseline="$3"
    $jobs_enabled || return 0
    if is_running "$from" && ! release_queue "$from"; then
        log "the job supervisor in ${from:0:12} still runs a job after ${HANDOVER_MAX}s"
        return 2
    fi
    # A drained supervisor retakes the lock only once resumed.
    signal_if "$to" SIGUSR2 passive || true
    confirm_active "$to" "$baseline" && return 0
    [[ "$confirm_failure" == unknown ]] && return 2
    return 1
}

give_back() {  # give_back FROM TO: after a failed handover, TO's supervisor resumes the queue
    $jobs_enabled || return 0
    if is_running "$1" && ! release_queue "$1"; then
        log "WARNING: ${1:0:12} still runs a job; stopping it requeues that job once"
    fi
    if is_running "$2" && signal_if "$2" SIGUSR2 passive; then
        log "resumed the job supervisor in ${2:0:12}"
    fi
}

stop_when_idle() {  # stop_when_idle FROM TO: FROM's supervisor predates handover and cannot drain; 1 if it would not stop
    local from="$1" to="$2" deadline idle_until view running queued attempt
    $jobs_enabled && is_running "$from" || return 0
    deadline=$(( $(now) + HANDOVER_MAX ))
    idle_until=$(( $(now) + HANDOVER_IDLE_WAIT ))
    while (( $(now) < deadline )); do
        # It claims queued jobs until it stops. With nothing queued or running
        # it has nothing to claim; after HANDOVER_IDLE_WAIT "nothing running"
        # will do. A job claimed in the instant before SIGTERM is retried once.
        if view="$(worker_view "$to")"; then
            read -r _ _ _ _ running queued <<<"$view"
            if [[ "$running" == 0 && ( "$queued" == 0 || $(now) -ge $idle_until ) ]]; then
                break
            fi
        fi
        sleep "$POLL"
    done
    # Its supervisor must really be gone, or the new one can never take the lock.
    for attempt in 1 2; do
        docker stop --time 45 "$from" >/dev/null 2>&1 || true
        if ! is_running "$from"; then
            log "stopped ${from:0:12}, whose job supervisor predates handover (${running:-?} running, ${queued:-?} queued)"
            return 0
        fi
    done
    log "${from:0:12} would not stop, and its job supervisor still holds the queue"
    return 1
}

# ── the interim container ─────────────────────────────────────────────────────

discard_interim() {  # remove it at once: it never served, or no longer serves
    local interim
    interim="$(container_of "$INTERIM_PROJECT")"
    [[ -n "$interim" ]] || return 0
    log "removing the interim container ${interim:0:12}"
    interim_compose down --timeout 10 >/dev/null 2>&1 || docker rm -f "$interim" >/dev/null 2>&1 || true
}

retire_interim() {  # retire_interim SUCCESSOR [RETIRED_NGINX_PID...]: 0 removed, 4 kept (still routed)
    local interim successor="$1"
    shift
    interim="$(container_of "$INTERIM_PROJECT")"
    [[ -n "$interim" ]] || return 0
    detect_jobs "$interim" "$successor"
    give_back "$interim" "$successor"
    drain_http "$interim" "$@" || return $?
    log "removing the interim container ${interim:0:12}"
    interim_compose down --timeout 45 >/dev/null 2>&1 || docker rm -f "$interim" >/dev/null 2>&1 || true
}

record_replaced() {  # record_replaced IMAGE SHA of the release about to be destroyed
    [[ -n "$1" ]] || return 0
    if printf '%s %s\n' "$1" "${2:-unknown}" > "${PREVIOUS_FILE}.new" 2>/dev/null \
        && mv -f "${PREVIOUS_FILE}.new" "$PREVIOUS_FILE" 2>/dev/null; then
        log "recorded ${2:0:12} (${1}) as the release to roll back to"
        return 0
    fi
    rm -f "${PREVIOUS_FILE}.new" 2>/dev/null || true
    log "cannot record the release being replaced in ${PREVIOUS_FILE}; keeping it instead of destroying it"
    return 1
}

# ── undoing ──────────────────────────────────────────────────────────────────

undo_switch() {  # undo_switch CANONICAL INTERIM: traffic and queue back to CANONICAL; 2 or 4
    local canonical="$1" interim="$2" status=0
    if ! switch_to "$CANONICAL_PORT"; then
        log "CRITICAL: could not point nginx back at the previous release"
        return 4
    fi
    local -a retired=("${retired_workers[@]}")
    give_back "$interim" "$canonical"
    drain_http "$interim" "${retired[@]}" || status=$?
    (( status == 0 )) || return "$status"
    discard_interim
    log "the attempt was undone; the previous release serves; retry later"
    return 2
}

recover_to_old() {  # recover_to_old CANONICAL INTERIM OLD_SHA: the new supervisor died after the switch
    local canonical="$1" interim="$2" old_sha="$3" status=0
    log "the new release's job supervisor failed after the switch; returning traffic to ${canonical:0:12}"
    if ! serves "$CANONICAL_PORT" "$old_sha" || ! switch_to "$CANONICAL_PORT"; then
        log "CRITICAL: the previous release cannot take traffic back; the new one keeps it"
        return 4
    fi
    local -a retired=("${retired_workers[@]}")
    drain_http "$interim" "${retired[@]}" || status=$?
    (( status == 0 )) || return "$status"
    discard_interim        # first, so its supervisor cannot take the lock again
    if signal_if "$canonical" SIGUSR2 passive; then log "resumed the job supervisor in ${canonical:0:12}"; fi
    if [[ "$confirm_failure" == unknown ]]; then
        log "Docker could not confirm the new release's job supervisor; the previous release serves; retry later"
        return 2
    fi
    log "REJECTED: the new release's job supervisor could not hold the queue; the previous release serves"
    return 1
}

recover_legacy() {  # recover_legacy CANONICAL INTERIM OLD_SHA: the same after the cut-over deploy
    local canonical="$1" interim="$2" old_sha="$3"
    log "the new release's job supervisor failed; restarting the previous release, which was stopped for it"
    # The candidate goes first so its supervisor cannot keep taking the lock
    # from the older supervisor, which gives up after 30 s. Its web server
    # already fails with its supervisor, so this adds no outage.
    interim_compose stop --timeout 10 >/dev/null 2>&1 || true
    docker start "$canonical" >/dev/null 2>&1 || true
    if ! wait_ready "$canonical" "$CANONICAL_PORT" "$old_sha" || ! switch_to "$CANONICAL_PORT"; then
        log "CRITICAL: the previous release did not come back; bring one up by hand (deploy/README.md, Rollback)"
        return 4
    fi
    discard_interim
    log "REJECTED: the new release's job supervisor could not hold the queue; the previous release serves"
    return 1
}

legacy_handover() {  # legacy_handover CANONICAL INTERIM BASELINE OLD_IMAGE OLD_SHA: after the switch and drain; 0, or the run's exit status
    local canonical="$1" interim="$2" baseline="$3" old_image="$4" old_sha="$5"
    if ! stop_when_idle "$canonical" "$interim"; then
        undo_switch "$canonical" "$interim"
        return $?
    fi
    confirm_active "$interim" "$baseline" && return 0
    show_logs "$interim"
    if [[ "$confirm_failure" == restart ]]; then
        # Its web server went down with its supervisor: bring the old release back.
        recover_legacy "$canonical" "$interim" "$old_sha"
        return $?
    fi
    # Its web server is up and serves. Stopping it to start the old release
    # would be an outage; the old one is only stopped, and recorded for
    # --rollback. The next run retries the queue.
    record_replaced "$old_image" "$old_sha" || log "WARNING: the rollback record is stale"
    mark_resume
    log "DEGRADED: ${interim:0:12} serves, but its job supervisor has not confirmed the queue; the next run retries"
    return 3
}

# ── phases ───────────────────────────────────────────────────────────────────

move_to_canonical() {  # move_to_canonical IMAGE SHA INTERIM: phase 2; 0, 3 or 4
    local image="$1" sha="$2" interim="$3" canonical="" attempt baseline interim_image interim_sha status=0
    local -a recreate=()
    interim_image="$(image_of "$interim")"
    interim_sha="$(sha_of "$interim")"
    for attempt in 1 2; do
        log "starting the canonical container on ${image} for ${sha:0:12} (attempt ${attempt})"
        if PRIVATOOLS_IMAGE="$image" GIT_SHA="$sha" canonical_compose up -d --no-build --pull never "${recreate[@]}" "$SERVICE"; then
            canonical="$(container_of "$COMPOSE_PROJECT")"
            if wait_ready "$canonical" "$CANONICAL_PORT" "$sha" && page_probe "$canonical" "$CANONICAL_PORT" "$sha"; then
                break
            fi
            show_logs "$canonical"
        fi
        canonical=""
        recreate=(--force-recreate)
    done
    if [[ -z "$canonical" ]]; then
        canonical_compose stop --timeout 10 "$SERVICE" >/dev/null 2>&1 || true
        mark_resume
        log "DEGRADED: the canonical container did not come up; ${interim_sha:0:12} keeps serving from the interim container"
        return 3
    fi

    baseline="$(restarts_of "$canonical")"
    detect_jobs "$canonical" "$interim"
    if [[ "$baseline" == unknown ]]; then
        status=2                    # Docker could not report it: as good as a failed handover
    else
        handover "$interim" "$canonical" "$baseline" || status=$?
    fi
    if (( status != 0 )); then
        canonical_compose stop --timeout 10 "$SERVICE" >/dev/null 2>&1 || true
        give_back "$canonical" "$interim"
        mark_resume
        log "DEGRADED: the canonical container's job supervisor could not take the queue; the interim keeps serving"
        return 3
    fi
    if ! switch_to "$CANONICAL_PORT" || ! public_serves "$sha"; then
        if ! switch_to "$INTERIM_PORT"; then
            log "CRITICAL: nginx points at neither container in a verified way"
            return 4
        fi
        give_back "$canonical" "$interim"
        canonical_compose stop --timeout 10 "$SERVICE" >/dev/null 2>&1 || true
        mark_resume
        log "DEGRADED: nginx could not be moved back to the canonical container; the interim keeps serving"
        return 3
    fi
    log "traffic is back on the canonical container"
    local -a retired=("${retired_workers[@]}")
    drain_http "$interim" "${retired[@]}" || return $?
    if [[ "$interim_image" != "$(image_id "$image")" ]]; then
        # A rollback from the degraded state replaces the interim's release.
        record_replaced "$interim_image" "$interim_sha" || log "WARNING: the rollback record is stale"
    fi
    log "removing the interim container ${interim:0:12}"
    interim_compose down --timeout 45 >/dev/null 2>&1 || docker rm -f "$interim" >/dev/null 2>&1 || true
    rm -f "$RESUME_FILE"
}

resume_from_interim() {  # resume_from_interim IMAGE SHA ROLLBACK: nginx points at the interim
    local image="$1" sha="$2" rollback="$3" interim interim_image interim_sha canonical c_image c_sha baseline status=0
    interim="$(container_of "$INTERIM_PROJECT")"
    interim_image="$(image_of "$interim")"
    interim_sha="$(sha_of "$interim")"
    if ! $rollback && [[ -f "$RESUME_FILE" ]] \
        && (( $(now) - $(stat -c %Y "$RESUME_FILE" 2>/dev/null || echo 0) < RESUME_BACKOFF )); then
        log "degraded: ${interim_sha:0:12} serves from the interim container; the canonical container failed less than ${RESUME_BACKOFF}s ago"
        return 3
    fi
    if ! $rollback; then
        image="$interim_image"
        sha="$interim_sha"
    fi
    log "resuming: ${interim_sha:0:12} serves from the interim container; moving ${sha:0:12} into the canonical one"
    canonical="$(container_of "$COMPOSE_PROJECT")"
    if is_running "$canonical"; then
        # A run that died after its switch left the replaced container up,
        # possibly mid-request or mid-job: retire it as carefully as phase 2 would.
        c_image="$(image_of "$canonical")"
        c_sha="$(sha_of "$canonical")"
        detect_jobs "$interim" "$canonical"
        baseline="$(restarts_of "$interim")"
        if [[ "$baseline" == unknown ]]; then
            mark_resume
            log "degraded: Docker could not report the interim container's state; retry later"
            return 3
        fi
        if $jobs_enabled && predates_handover "$canonical"; then
            # A cut-over run died after its switch: the pre-handover release
            # still holds the queue, and only stops once idle.
            drain_http "$canonical" "${retired_workers[@]}" || return $?
            legacy_handover "$canonical" "$interim" "$baseline" "$c_image" "$c_sha" || return $?
        else
            handover "$canonical" "$interim" "$baseline" || status=$?
            if (( status != 0 )); then
                give_back "$interim" "$canonical"
                mark_resume
                log "degraded: the queue could not be handed to the interim container yet"
                return 3
            fi
            drain_http "$canonical" "${retired_workers[@]}" || return $?
        fi
        if [[ "$c_image" != "$interim_image" ]] && ! record_replaced "$c_image" "$c_sha"; then
            mark_resume
            return 3
        fi
    elif ! enough_memory; then
        # Nothing is running in the canonical slot, so moving back starts a
        # second container beside the interim.
        if $rollback; then
            return 2
        fi
        mark_resume
        return 3
    fi
    move_to_canonical "$image" "$sha" "$interim"
}

enough_memory() {  # memory for one more container beside those running
    local available
    available="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' "$MEMINFO" 2>/dev/null || true)"
    if [[ -z "$available" ]] || (( available < MIN_AVAILABLE_MB )); then
        log "refusing to start a second container: ${available:-unknown} MB available, ${MIN_AVAILABLE_MB} MB required"
        return 1
    fi
    log "${available} MB available for the overlap"
}

enough_capacity() {
    enough_memory || return 1
    if (exec 3<>"/dev/tcp/127.0.0.1/${INTERIM_PORT}") 2>/dev/null; then
        log "refusing: something already listens on 127.0.0.1:${INTERIM_PORT}"
        return 1
    fi
}

deploy_release() {  # deploy_release IMAGE SHA: phase 1, then phase 2
    local image="$1" sha="$2" container old_image="" old_sha="" canonical="" interim baseline legacy=false status=0
    # The container being replaced is recorded even if it is not running; only
    # a running one is drained and has a job queue to hand over.
    container="$(container_of "$COMPOSE_PROJECT")"
    if [[ -n "$container" ]]; then
        old_image="$(image_of "$container")"
        old_sha="$(sha_of "$container")"
        if [[ "$old_sha" == "$sha" && -n "$old_image" && "$old_image" == "$(image_id "$image")" ]] \
            && serves "$CANONICAL_PORT" "$sha"; then
            log "${sha:0:12} already serves from the canonical container on that image"
            return 0
        fi
        if is_running "$container"; then
            canonical="$container"
        else
            log "the canonical container ${container:0:12} is not running; nothing to drain"
        fi
    fi
    enough_capacity || return 2

    log "phase 1: starting ${sha:0:12} in the interim container on 127.0.0.1:${INTERIM_PORT}"
    if ! PRIVATOOLS_IMAGE="$image" GIT_SHA="$sha" interim_compose up -d --no-build --pull never "$SERVICE"; then
        log "the interim container could not be started (a host or Docker problem); retry later"
        discard_interim
        return 2
    fi
    interim="$(container_of "$INTERIM_PROJECT")"
    if ! wait_ready "$interim" "$INTERIM_PORT" "$sha"; then
        show_logs "$interim"
        log "REJECTED: ${sha:0:12} never became ready; the previous release keeps serving"
        discard_interim
        return 1
    fi
    if ! page_probe "$interim" "$INTERIM_PORT" "$sha"; then
        show_logs "$interim"
        log "REJECTED: ${sha:0:12} is ready but failed the real-page probe; the previous release keeps serving"
        discard_interim
        return 1
    fi

    baseline="$(restarts_of "$interim")"
    if [[ "$baseline" == unknown ]]; then
        log "Docker could not report the interim container's state; the previous release keeps serving; retry later"
        discard_interim
        return 2
    fi
    detect_jobs "$interim"
    if $jobs_enabled && [[ -n "$canonical" ]] && predates_handover "$canonical"; then
        legacy=true
        log "the job supervisor in ${canonical:0:12} predates handover: it stops, once idle, after the switch"
    elif $jobs_enabled; then
        handover "$canonical" "$interim" "$baseline" || status=$?
        if (( status != 0 )); then
            show_logs "$interim"
            discard_interim           # first, so a broken supervisor cannot take the lock again
            if [[ -n "$canonical" ]] && signal_if "$canonical" SIGUSR2 passive; then
                log "resumed the job supervisor in ${canonical:0:12}"
            fi
            if (( status == 1 )); then
                log "REJECTED: ${sha:0:12}'s job supervisor could not hold the queue; the previous release keeps serving"
                return 1
            fi
            log "the queue was not handed over; the previous release keeps serving; retry later"
            return 2
        fi
    fi

    if ! switch_to "$INTERIM_PORT" || ! public_serves "$sha"; then
        undo_switch "$canonical" "$interim"
        return $?
    fi
    log "phase 1 done: ${sha:0:12} serves from the interim container"
    if [[ -n "$canonical" ]]; then
        drain_http "$canonical" "${retired_workers[@]}" || return $?
    fi
    if $legacy; then
        legacy_handover "$canonical" "$interim" "$baseline" "$old_image" "$old_sha" || return $?
    elif $jobs_enabled && ! confirm_active "$interim" "$baseline"; then
        # Before anything is destroyed: the new supervisor still holds the
        # queue and its container never restarted.
        show_logs "$interim"
        if [[ -n "$canonical" ]]; then
            recover_to_old "$canonical" "$interim" "$old_sha"
            return $?
        fi
        if [[ "$confirm_failure" == restart ]]; then
            log "CRITICAL: the new release's job supervisor failed and there is no previous release to return to"
            return 4
        fi
        [[ -z "$container" ]] || record_replaced "$old_image" "$old_sha" || log "WARNING: the rollback record is stale"
        mark_resume
        log "DEGRADED: ${sha:0:12} serves from the interim container, but its job supervisor has not confirmed the queue; the next run retries"
        return 3
    fi
    if [[ -n "$container" ]] && ! record_replaced "$old_image" "$old_sha"; then
        mark_resume
        log "degraded: ${sha:0:12} serves from the interim container"
        return 3
    fi

    log "phase 2: moving ${sha:0:12} to the canonical container"
    move_to_canonical "$image" "$sha" "$interim" || return $?
    log "done: ${sha:0:12} serves from the canonical container"
}

# ── image retention ──────────────────────────────────────────────────────────
#
# Each deploy pulls a release image of about 3.4 GB and nothing else removes
# one: production's disk once filled with fifty. Only an image named in
# IMAGE_REPOS is a candidate, and one also named in any other repository
# stays. It is removed by name (repo:tag, or repo@digest where that repository
# has no tag left), never forced, so Docker itself refuses the last name of an
# image a container uses, running or stopped. Nothing is pruned: a prune would
# also take the rollback image once its tag had moved, and other projects'
# images. Everything is read before anything is removed, and a question
# Docker does not answer keeps every image.

repo_of() {  # repo_of REFERENCE -> its repository; nothing for an image ID
    local name="${1%%@*}"
    if [[ -z "$name" || "$name" == sha256:* || "$name" =~ ^[0-9a-f]{12,64}$ ]]; then
        return 0
    fi
    if [[ "${name##*/}" == *:* ]]; then
        name="${name%:*}"          # the tag; a registry's port comes before a slash
    fi
    printf '%s\n' "$name"
}

human_size() {  # human_size BYTES -> e.g. "3.4 GB"
    if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
        awk -v b="$1" 'BEGIN { if (b >= 1e9) printf "%.1f GB\n", b / 1e9; else printf "%.0f MB\n", b / 1e6 }'
    else
        echo "size unknown"
    fi
}

image_gone() {  # image_gone IMAGE: Docker answered that it has no such image
    [[ "$(docker image inspect -f '{{.Id}}' "$1" 2>&1 >/dev/null)" == *"No such image"* ]]
}

remove_image() {  # remove_image ID NAME...: each name, never forced; 0 once Docker confirms ID is gone
    local id="$1" name out
    shift
    for name in "$@"; do
        if ! out="$(docker image rm "$name" 2>&1)"; then
            printf '    could not remove %s: %s\n' "$name" "${out//$'\n'/ }"
            return 1
        fi
    done
    image_gone "$id" && return 0
    printf '    %s: Docker did not confirm it is gone after its names were removed\n' "$id"
    return 1
}

retain_images() {  # after exit 0 only; whatever fails keeps images and leaves the exit status alone
    local -a repos=() listed=() filters=() ids=() order=() tags=() digests=() names=() reasons=()
    local -A own=() known=() created=() bytes=() shown=() removable=() foreign=() unknown_age=() newest=() in_use=()
    local keep repo id when size tag_list digest_list tag_repos ref epoch stamps="" container used out
    local recorded="" rollback="" described=0 rank=0 kept=0 removed=0 failed=0 freed=0 line why reason

    if [[ ! "$KEEP_IMAGES" =~ ^[0-9]{1,6}$ ]] || (( 10#$KEEP_IMAGES < 2 )); then
        log "image retention skipped: KEEP_IMAGES=${KEEP_IMAGES} is not a number of 2 or more; every image is kept"
        return 0
    fi
    keep=$(( 10#$KEEP_IMAGES ))
    read -ra repos <<<"$IMAGE_REPOS"
    for repo in "${repos[@]}"; do
        if [[ -z "${own[$repo]:-}" ]]; then
            own[$repo]=1
            listed+=("$repo")
            filters+=(--filter "reference=${repo}")
        fi
    done

    # Every image named in those repositories. Docker may list an image once
    # per name; only templates are read, never the table meant for people.
    if ! out="$(docker image ls --no-trunc --format '{{.ID}}' "${filters[@]}")"; then
        log "image retention skipped: Docker could not list the images of ${listed[*]}; every image is kept"
        return 0
    fi
    while read -r id; do
        [[ -n "$id" && -z "${known[$id]:-}" ]] || continue
        if [[ ! "$id" =~ ^sha256:[[:alnum:]]+$ ]]; then
            log "image retention skipped: Docker listed '${id}', which is no image ID; every image is kept"
            return 0
        fi
        known[$id]=1
        ids+=("$id")
    done <<<"$out"
    if (( ${#ids[@]} == 0 )); then
        log "image retention: no images of ${listed[*]} on this host; kept 0, removed 0"
        return 0
    fi

    # Each one's names in every repository, its age and its size. .ID, not
    # .Id: only Go field names keep the template on the CLI's typed struct. A
    # JSON name falls back to raw JSON, where join may reject the name lists
    # (Docker 29.8's accepts them).
    if ! out="$(docker image inspect -f '{{.ID}}|{{.Created}}|{{.Size}}|{{join .RepoTags " "}}|{{join .RepoDigests " "}}' "${ids[@]}")"; then
        log "image retention skipped: Docker could not describe those images; every image is kept"
        return 0
    fi
    while IFS='|' read -r id when size tag_list digest_list; do
        [[ -n "$id" ]] || continue
        if [[ -z "${known[$id]:-}" ]]; then
            log "image retention skipped: Docker described ${id}, which it had not listed; every image is kept"
            return 0
        fi
        described=$(( described + 1 ))
        read -ra tags <<<"$tag_list"
        read -ra digests <<<"$digest_list"
        created[$id]="$when"
        bytes[$id]="$size"
        shown[$id]="${tags[*]:-${digests[*]:-}}"
        names=()
        tag_repos=" "
        for ref in "${tags[@]}"; do
            repo="$(repo_of "$ref")"
            [[ -n "$repo" && -n "${own[$repo]:-}" ]] || foreign[$id]="${foreign[$id]:-$ref}"
            tag_repos+="${repo} "
            names+=("$ref")
        done
        for ref in "${digests[@]}"; do
            repo="$(repo_of "$ref")"
            [[ -n "$repo" && -n "${own[$repo]:-}" ]] || foreign[$id]="${foreign[$id]:-$ref}"
            # Docker drops a repository's digests with the last tag there.
            [[ "$tag_repos" == *" ${repo} "* ]] || names+=("$ref")
        done
        removable[$id]="${names[*]}"
        if [[ "$when" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T && "$when" != 0001-* ]] \
            && epoch="$(date -u -d "$when" +%s 2>/dev/null)"; then
            stamps+="${epoch} ${id}"$'\n'
        else
            unknown_age[$id]=1
        fi
    done <<<"$out"
    if (( described != ${#ids[@]} )); then
        log "image retention skipped: Docker described ${described} of the ${#ids[@]} images it listed; every image is kept"
        return 0
    fi

    # In use: the image of every container, running or not, in any project.
    if ! out="$(docker ps -aq --no-trunc)"; then
        log "image retention skipped: Docker could not list the containers; every image is kept"
        return 0
    fi
    while read -r container; do
        [[ -n "$container" ]] || continue
        if used="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" && [[ -n "$used" ]]; then
            in_use[$used]=1
        elif [[ "$(docker inspect -f '{{.Image}}' "$container" 2>&1 >/dev/null)" != *[Nn]"o such"* ]]; then
            # Removed since it was listed ("No such object", or "no such object"
            # from Docker 29), it holds nothing; any other failure proves nothing.
            log "image retention skipped: Docker could not say which image container ${container:0:12} uses; every image is kept"
            return 0
        fi
    done <<<"$out"

    # The release recorded for --rollback, by image ID.
    if [[ -e "$PREVIOUS_FILE" ]] && ! recorded="$(awk 'NR == 1 { print $1; exit }' "$PREVIOUS_FILE")"; then
        log "image retention skipped: cannot read ${PREVIOUS_FILE}; every image is kept"
        return 0
    fi
    if [[ -n "$recorded" ]]; then
        if rollback="$(docker image inspect -f '{{.Id}}' "$recorded" 2>/dev/null)" && [[ -n "$rollback" ]]; then
            :
        elif image_gone "$recorded"; then
            log "note: ${recorded}, recorded for --rollback, is no longer on this host"
            rollback=""
        else
            log "image retention skipped: Docker could not resolve ${recorded}, recorded for --rollback; every image is kept"
            return 0
        fi
    fi

    # Newest first; an image whose age Docker does not give is kept, last.
    while read -r _ id; do
        [[ -n "$id" ]] || continue
        order+=("$id")
        rank=$(( rank + 1 ))
        (( rank > keep )) || newest[$id]=1
    done < <(printf '%s' "$stamps" | sort -k1,1nr -k2,2)
    for id in "${ids[@]}"; do
        [[ -z "${unknown_age[$id]:-}" ]] || order+=("$id")
    done

    log "image retention: ${#order[@]} images of ${listed[*]}; keeping the newest ${keep}, every container's image and the release recorded for --rollback"
    for id in "${order[@]}"; do
        reasons=()
        [[ -z "${newest[$id]:-}" ]] || reasons+=("newest ${keep}")
        [[ -z "${in_use[$id]:-}" ]] || reasons+=("in use")
        [[ "$id" != "$rollback" ]] || reasons+=("recorded for --rollback")
        [[ -z "${foreign[$id]:-}" ]] || reasons+=("also named ${foreign[$id]}")
        [[ -z "${unknown_age[$id]:-}" ]] || reasons+=("creation time unknown")
        [[ -n "${removable[$id]:-}" ]] || reasons+=("no name to remove it by")
        line="$(printf '%-12.12s  %s  %s  %s' "${id#sha256:}" "${shown[$id]:-?}" "${created[$id]:0:10}" "$(human_size "${bytes[$id]:-}")")"
        if (( ${#reasons[@]} > 0 )); then
            why=""
            for reason in "${reasons[@]}"; do
                why+="${why:+; }${reason}"
            done
            printf '    kept     %s  (%s)\n' "$line" "$why"
            kept=$(( kept + 1 ))
            continue
        fi
        read -ra names <<<"${removable[$id]}"
        if remove_image "$id" "${names[@]}"; then
            printf '    removed  %s\n' "$line"
            removed=$(( removed + 1 ))
            size="${bytes[$id]:-}"
            [[ ! "$size" =~ ^[0-9]+$ ]] || freed=$(( freed + size ))
        else
            printf '    kept     %s  (Docker did not remove it)\n' "$line"
            failed=$(( failed + 1 ))
        fi
    done
    out="image retention: kept $(( kept + failed ))"
    (( failed == 0 )) || out+=" (${failed} that Docker did not remove)"
    out+=", removed ${removed}"
    (( removed == 0 )) || out+=" ($(human_size "$freed") as listed; layers a kept image shares stay on disk)"
    log "$out"
}

main() {
    local image sha live deployed_repo rollback=false status=0
    if [[ "$(id -u)" == 0 ]]; then
        log "refusing to run as root: run as the deploy user, e.g. sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout ..."
        exit 2
    fi
    case "${1:-}" in
        --rollback)
            if [[ ! -s "$PREVIOUS_FILE" ]]; then
                log "no previous release recorded in ${PREVIOUS_FILE}"
                exit 2
            fi
            read -r image sha < "$PREVIOUS_FILE"
            rollback=true
            log "rolling back to ${image} (${sha:0:12})"
            ;;
        ""|-*)
            log "usage: $0 IMAGE BUILD_SHA | --rollback"
            exit 2
            ;;
        *)
            image="$1"
            sha="${2:-}"
            [[ -n "$sha" ]] || { log "usage: $0 IMAGE BUILD_SHA | --rollback"; exit 2; }
            ;;
    esac
    # The repository of the image deployed is PrivaTools' own too when it is
    # named for PrivaTools: a run by hand has none of auto-deploy.sh's
    # variables. Never another, which other projects' images may share
    # (nothing for an image ID).
    deployed_repo="$(repo_of "$image")"
    case "$deployed_repo" in
        privatools | */privatools | privatools-privatools) IMAGE_REPOS+=" ${deployed_repo}" ;;
    esac

    if [[ "${PRIVATOOLS_DEPLOY_LOCK_HELD:-}" != 1 ]]; then
        exec 9>>"$LOCK_FILE"
        if ! flock -n 9; then
            log "another deploy is running"
            exit 2
        fi
    fi

    live="$(live_port)"
    if [[ -z "$live" ]]; then
        log "no PrivaTools upstream in ${UPSTREAM_FILE}: install the nginx switch first (deploy/README.md)"
        exit 2
    fi
    if ! grep -q 'proxy_pass http://privatools_app;' "$NGINX_SITE" 2>/dev/null \
        || grep -q 'proxy_pass http://127\.0\.0\.1:' "$NGINX_SITE" 2>/dev/null; then
        log "${NGINX_SITE} does not proxy only through the privatools_app upstream yet (deploy/README.md)"
        exit 2
    fi
    if [[ ! -f "$INTERIM_FILE_PATH" ]] || ! grep -q 'PRIVATOOLS_HOST_PORT' "$COMPOSE_FILE_PATH"; then
        log "the checkout in ${REPO_DIR} predates zero-downtime deploys"
        exit 2
    fi
    if [[ "$live" != "$CANONICAL_PORT" && "$live" != "$INTERIM_PORT" ]]; then
        log "the upstream names port ${live}, neither ${CANONICAL_PORT} nor ${INTERIM_PORT}"
        exit 2
    fi
    cd "$REPO_DIR"

    # The interim mounts exactly what the live container mounts.
    local reference
    reference="$(container_of "$COMPOSE_PROJECT")"
    [[ -n "$reference" ]] || reference="$(container_of "$INTERIM_PROJECT")"
    if [[ -n "$reference" ]]; then
        data_volume="$(mount_of "$reference" /app/data)"
        temp_volume="$(mount_of "$reference" /app/temp)"
    fi
    data_volume="${data_volume:-${COMPOSE_PROJECT}_app-data}"
    temp_volume="${temp_volume:-${COMPOSE_PROJECT}_app-temp}"

    reconcile_nginx "$live" || exit $?
    live="$(live_port)"
    if [[ "$live" == "$INTERIM_PORT" ]]; then
        resume_from_interim "$image" "$sha" "$rollback" || exit $?
    elif [[ -n "$(container_of "$INTERIM_PROJECT")" ]]; then
        log "a previous run left an interim container behind; retiring it"
        retire_interim "$(container_of "$COMPOSE_PROJECT")" "${retired_workers[@]}" || exit $?
    fi
    deploy_release "$image" "$sha" || status=$?
    if (( status == 0 )); then
        # Only in the steady state, and best effort: in a subshell, so nothing
        # it does can change the exit status the timer acts on.
        ( retain_images ) || log "WARNING: image retention stopped (exit $?); the images it had not removed are kept"
    fi
    exit "$status"
}

main "$@"
