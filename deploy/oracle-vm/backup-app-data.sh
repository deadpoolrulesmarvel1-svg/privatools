#!/usr/bin/env bash
# Nightly backup of the accounts database.
#
# This is the one irreplaceable thing the app holds. There is no email path:
# the recovery code issued at signup is the only way back into an account, so
# losing this file locks every user out permanently with no way to reissue.
#
# The DB lives in the app-data Docker volume, root-owned on the host, inside a
# container with a read-only root filesystem. So rather than reaching into
# /var/lib/docker, take the snapshot from inside the container into /app/temp
# (a writable volume) and copy it out. sqlite3's VACUUM INTO is WAL-safe: it
# takes a consistent snapshot without locking out the live service, which a
# plain cp of a WAL-mode database would not give us.
#
# Install: deploy/oracle-vm/install-backup.sh

set -euo pipefail

CONTAINER="${CONTAINER:-privatools-privatools-1}"
DB_IN_CONTAINER="${DB_IN_CONTAINER:-/app/data/privatools.db}"
DEST_DIR="${DEST_DIR:-/home/ubuntu/backups/privatools}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
# Optional Healthchecks.io URL, same pattern as auto-deploy.sh. A backup that
# silently stops running is worse than no backup, because you believe in it.
BACKUP_PING_URL="${BACKUP_PING_URL:-}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
TMP_IN_CONTAINER="/app/temp/backup-${STAMP}.db"
DEST="${DEST_DIR}/privatools-${STAMP}.db"

log() { printf '[privatools-backup] %s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

ping_backup() {  # ping_backup ok|fail
    [[ -z "$BACKUP_PING_URL" ]] && return 0
    local url="$BACKUP_PING_URL"
    [[ "$1" == "fail" ]] && url="${BACKUP_PING_URL%/}/fail"
    curl --fail --silent --max-time 8 -o /dev/null "$url" || true
}

cleanup() { docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER" >/dev/null 2>&1 || true; }
trap 'rc=$?; if [[ $rc -ne 0 ]]; then log "FAILED at line $LINENO (exit $rc)"; ping_backup fail; fi; cleanup' EXIT

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    log "container ${CONTAINER} is not running; nothing to back up"
    ping_backup fail
    exit 1
fi

# Day-1: the release that first ships accounts creates the DB on first signup.
# Absent is not a failure, and must not page anyone.
if ! docker exec "$CONTAINER" test -f "$DB_IN_CONTAINER" 2>/dev/null; then
    log "no accounts DB yet at ${DB_IN_CONTAINER} (nobody has signed up) — nothing to do"
    ping_backup ok
    exit 0
fi

mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

# VACUUM INTO via the stdlib rather than the sqlite3 CLI, which the slim image
# does not carry. Parameter-bound: the path is ours, but VACUUM INTO takes a
# bind and there is no reason to build the statement by hand.
docker exec "$CONTAINER" python3 -c "
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
con = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
try:
    con.execute('VACUUM INTO ?', (dst,))
finally:
    con.close()
" "$DB_IN_CONTAINER" "$TMP_IN_CONTAINER"

docker cp "${CONTAINER}:${TMP_IN_CONTAINER}" "$DEST"
chmod 600 "$DEST"

# A backup you have never opened is a hope, not a backup. Prove it is a
# readable SQLite file with the users table in it before calling this a success.
USERS=$(python3 -c "
import sqlite3, sys
con = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
try:
    print(con.execute(\"select count(*) from sqlite_master where type='table' and name='users'\").fetchone()[0])
finally:
    con.close()
" "$DEST" 2>/dev/null || echo 0)

if [[ "$USERS" != "1" ]]; then
    log "VERIFY FAILED: ${DEST} has no users table — treating as a failed backup"
    rm -f "$DEST"
    ping_backup fail
    exit 1
fi

find "$DEST_DIR" -name 'privatools-*.db' -type f -mtime "+${RETAIN_DAYS}" -delete

log "wrote ${DEST} ($(du -h "$DEST" | cut -f1)), verified, $(ls -1 "$DEST_DIR"/privatools-*.db 2>/dev/null | wc -l | tr -d ' ') kept"
ping_backup ok
