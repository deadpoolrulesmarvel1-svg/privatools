"""Short SQLite transactions and filesystem lifecycle for durable jobs.

Job commits use FULL synchronization even though the rest of the application
uses NORMAL. Acknowledging a queue entry must follow durable file storage.
"""
from __future__ import annotations

import hashlib
import fcntl
import json
import os
import re
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from ... import job_handover, store
from ...utils.exceptions import PdfCorruptError, PdfEncryptedError
from .. import quota
from . import config
from .adapters import ADAPTERS

ACTIVE = ("queued", "running")
TERMINAL = ("succeeded", "failed", "canceled", "expired")
# A job whose input the PDF libraries cannot read fails with one of these
# codes and the words a synchronous call gets in its 400 for that file
# (utils.pdf_errors). Every other failure says FAILED_MESSAGE.
REFUSALS = {
    "job_input_damaged": PdfCorruptError.default_detail,
    "job_input_password_protected": PdfEncryptedError.default_detail,
}
FAILED_MESSAGE = "The job could not be completed."


class JobError(Exception):
    def __init__(self, status: int, code: str, message: str, retry: int | None = None):
        self.status, self.code, self.message, self.retry = status, code, message, retry
        super().__init__(message)


@contextmanager
def connection(*, write: bool = False):
    conn = sqlite3.connect(store.DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=FULL")
    try:
        if write:
            conn.execute("BEGIN IMMEDIATE")
        yield conn
        if conn.in_transaction:
            conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def init_schema() -> None:
    store.init()
    quota.ensure_schema()
    config.root().mkdir(parents=True, exist_ok=True, mode=0o700)
    with connection(write=True) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS api_async_jobs (
            id TEXT PRIMARY KEY, key_id TEXT NOT NULL, user_id TEXT NOT NULL,
            idempotency_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
            operation TEXT NOT NULL, options TEXT NOT NULL, inputs TEXT NOT NULL,
            state TEXT NOT NULL, created REAL NOT NULL, deadline REAL NOT NULL,
            started REAL, completed REAL, expires REAL, attempts INTEGER NOT NULL DEFAULT 0,
            claim TEXT, lease_until REAL, receipt TEXT, reserved_bytes INTEGER NOT NULL,
            result_bytes INTEGER NOT NULL DEFAULT 0, error_code TEXT,
            UNIQUE(key_id, idempotency_hash))""")
        conn.execute("CREATE INDEX IF NOT EXISTS api_async_jobs_queue ON api_async_jobs(state, created)")
        conn.execute("""CREATE TABLE IF NOT EXISTS api_async_ingest (
            id TEXT PRIMARY KEY, key_id TEXT NOT NULL, user_id TEXT NOT NULL,
            reserved_bytes INTEGER NOT NULL, expires REAL NOT NULL, replay_of TEXT)""")
        if "replay_of" not in {row[1] for row in conn.execute("PRAGMA table_info(api_async_ingest)")}:
            conn.execute("ALTER TABLE api_async_ingest ADD COLUMN replay_of TEXT")
        conn.execute("""CREATE TABLE IF NOT EXISTS api_async_worker (
            id INTEGER PRIMARY KEY CHECK(id=1), heartbeat REAL NOT NULL,
            build_sha TEXT NOT NULL, accepting INTEGER NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS api_async_submit_window (
            key_id TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)""")


def job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise JobError(404, "job_not_found", "Job not found.")
    return config.root() / job_id


def _alive_key(conn, key_id: str, user_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM api_keys WHERE key_id=? AND user_id=? AND revoked_at IS NULL",
        (key_id, user_id),
    ).fetchone() is not None


def heartbeat(*, accepting: bool = True, now: float | None = None) -> None:
    with connection(write=True) as conn:
        conn.execute("INSERT INTO api_async_worker VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                     "heartbeat=excluded.heartbeat, build_sha=excluded.build_sha, accepting=excluded.accepting",
                     (now or time.time(), config.build_sha(), int(accepting)))


def local_worker(now: float | None = None, *, queue_served: bool = False) -> dict | None:
    """This container's own supervisor, if it runs this build and counts as ready.

    During a deploy the new container's supervisor waits as a standby while the
    old one finishes its current job and hands over the lock, so the heartbeat
    row still names the old build. Queued jobs are durable, and this build's
    supervisor claims them once it holds the lock, so accepting work here is
    safe. While another supervisor serves the queue (queue_served) a standby
    stays ready; otherwise it counts for at most queue_seconds
    (job_handover.ready_state).
    """
    return job_handover.ready_state(now, queue_served=queue_served)


def heartbeat_age(now: float | None = None) -> float | None:
    """Seconds since any supervisor last wrote the shared heartbeat, or None."""
    with connection() as conn:
        row = conn.execute("SELECT heartbeat FROM api_async_worker WHERE id=1").fetchone()
    return None if row is None else (now or time.time()) - row["heartbeat"]


def capability() -> dict:
    result = {"enabled": config.enabled(), "available": False, "operations": [],
              "result_retention_seconds": config.LIMITS.result_seconds}
    if not result["enabled"]:
        return result
    try:
        with connection() as conn:
            row = conn.execute("SELECT * FROM api_async_worker WHERE id=1").fetchone()
        now = time.time()
        served = job_handover.queue_served(row, now)
        result["available"] = served and row["build_sha"] == config.build_sha()
        if not result["available"]:
            result["available"] = local_worker(now, queue_served=served) is not None
        if result["available"]:
            result["operations"] = list(ADAPTERS)
    except (sqlite3.Error, OSError):
        pass
    return result


def require_available() -> None:
    if not capability()["available"]:
        raise JobError(503, "jobs_unavailable", "Asynchronous processing is temporarily unavailable.", 30)


def begin_ingest(key_id: str, user_id: str, idempotency: str | None = None) -> str:
    available = capability()["available"]
    limits = config.LIMITS
    identifier = uuid.uuid4().hex
    now = time.time()
    with connection(write=True) as conn:
        if not _alive_key(conn, key_id, user_id):
            raise JobError(401, "invalid_api_key", "API key is no longer active.")
        previous = conn.execute("SELECT id FROM api_async_jobs WHERE key_id=? AND idempotency_hash=?",
                                (key_id,hashlib.sha256(idempotency.encode()).hexdigest())).fetchone() if idempotency else None
        if not available and not previous:
            raise JobError(503,"jobs_unavailable","Asynchronous processing is temporarily unavailable.",30)
        # One bounded replay upload is allowed even when this key's execution
        # queue is full. It reserves input space but can never become new work.
        reservation = limits.input_bytes if previous else limits.reservation_bytes
        if shutil.disk_usage(config.root()).free < reservation+limits.disk_headroom:
            raise JobError(503,"job_storage_full","Temporary processing storage is full.",30)
        bucket = int(now // 60)
        rate = conn.execute("SELECT bucket,count FROM api_async_submit_window WHERE key_id=?", (key_id,)).fetchone()
        if rate and rate["bucket"] == bucket and rate["count"] >= limits.submissions_per_minute:
            raise JobError(429, "job_rate_limited", "Too many job submissions.", max(1, 60-int(now % 60)))
        used = conn.execute("SELECT COALESCE(SUM(reserved_bytes),0) FROM api_async_jobs").fetchone()[0]
        used += conn.execute("SELECT COALESCE(SUM(reserved_bytes),0) FROM api_async_ingest").fetchone()[0]
        # Include all promised future writes, not only bytes already visible
        # to disk_usage. Conservatively double-counting retained files is safe.
        if shutil.disk_usage(config.root()).free < used+reservation+limits.disk_headroom:
            raise JobError(503,"job_storage_full","Temporary processing storage is full.",30)
        if used + reservation > limits.storage_bytes:
            raise JobError(429, "job_queue_full", "The processing queue is full. Retry later.", 30)
        # Ingest also counts toward admission so simultaneous uploads cannot
        # each observe the same free per-key or global slot.
        for column, identity, cap in (("key_id", key_id, limits.per_key), ("user_id", user_id, limits.per_account)):
            count = conn.execute(f"SELECT COUNT(*) FROM api_async_ingest WHERE {column}=?", (identity,)).fetchone()[0]
            if not previous:
                count += conn.execute(f"SELECT COUNT(*) FROM api_async_jobs WHERE {column}=? AND state IN ('queued','running')", (identity,)).fetchone()[0]
            if count >= (1 if previous and column=="key_id" else cap):
                raise JobError(429, "job_admission_limit", "Too many outstanding jobs for this identity.", 10)
        count = conn.execute("SELECT COUNT(*) FROM api_async_ingest").fetchone()[0]
        if not previous:
            count += conn.execute("SELECT COUNT(*) FROM api_async_jobs WHERE state IN ('queued','running')").fetchone()[0]
        if count >= limits.max_pending:
            raise JobError(429, "job_queue_full", "The processing queue is full. Retry later.", 30)
        conn.execute("INSERT INTO api_async_ingest VALUES(?,?,?,?,?,?)", (identifier,key_id,user_id,reservation,now+limits.upload_seconds,previous["id"] if previous else None))
        conn.execute("INSERT INTO api_async_submit_window VALUES(?,?,1) ON CONFLICT(key_id) DO UPDATE SET "
                     "bucket=excluded.bucket,count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END", (key_id, bucket))
    try:
        (job_dir(identifier) / "inputs").mkdir(parents=True, mode=0o700)
    except BaseException:
        abandon_ingest(identifier)
        raise
    return identifier


def abandon_ingest(identifier: str) -> None:
    # Never remove a directory already accepted under this ID.
    with connection(write=True) as conn:
        if conn.execute("SELECT 1 FROM api_async_jobs WHERE id=?", (identifier,)).fetchone():
            return
        conn.execute("DELETE FROM api_async_ingest WHERE id=?", (identifier,))
    shutil.rmtree(job_dir(identifier), ignore_errors=True)


def fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def accept(identifier: str, key_id: str, user_id: str, idempotency: str,
           operation: str, options: dict, inputs: list[dict], body_bytes: int) -> tuple[dict, object, bool]:
    """Inputs have been fsynced. The quota receipt and ready job commit together."""
    encoded = json.dumps({"operation": operation, "options": options, "inputs": inputs}, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
    idempotency_hash = hashlib.sha256(idempotency.encode()).hexdigest()
    now = time.time()
    with connection(write=True) as conn:
        if not _alive_key(conn, key_id, user_id):
            raise JobError(401, "invalid_api_key", "API key is no longer active.")
        previous = conn.execute("SELECT * FROM api_async_jobs WHERE key_id=? AND idempotency_hash=?", (key_id, idempotency_hash)).fetchone()
        if previous:
            if previous["fingerprint"] != fingerprint:
                raise JobError(409, "idempotency_conflict", "This Idempotency-Key was already used for different job inputs.")
            return dict(previous), None, True
        ingest = conn.execute("SELECT * FROM api_async_ingest WHERE id=? AND key_id=?", (identifier, key_id)).fetchone()
        if not ingest or ingest["expires"] <= now:
            raise JobError(408, "job_upload_expired", "The upload reservation expired. Retry the upload.")
        if ingest["replay_of"]:
            raise JobError(410,"idempotency_expired","The original job's idempotency record has expired. Use a new Idempotency-Key.")
        allowed, state, receipt = quota.reserve_in_transaction(conn, key_id, quota.cost_for("/api/v1/"+operation), body_bytes)
        if not allowed:
            raise JobError(429, "quota_exceeded", "Daily free API allowance reached.", state.retry_after)
        conn.execute("""INSERT INTO api_async_jobs
            (id,key_id,user_id,idempotency_hash,fingerprint,operation,options,inputs,state,created,deadline,receipt,reserved_bytes)
            VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?,?)""",
            (identifier,key_id,user_id,idempotency_hash,fingerprint,operation,json.dumps(options),json.dumps(inputs),now,
             now+config.LIMITS.queue_seconds,receipt,ingest["reserved_bytes"]))
        conn.execute("DELETE FROM api_async_ingest WHERE id=?", (identifier,))
        row = conn.execute("SELECT * FROM api_async_jobs WHERE id=?", (identifier,)).fetchone()
    return dict(row), state, False


def lookup(identifier: str, key_id: str) -> dict:
    job_dir(identifier)
    with connection() as conn:
        row = conn.execute("SELECT * FROM api_async_jobs WHERE id=? AND key_id=?", (identifier,key_id)).fetchone()
    if not row:
        raise JobError(404, "job_not_found", "Job not found.")
    result = dict(row)
    if result["state"] == "succeeded" and result["expires"] <= time.time():
        result["state"] = "expired"
    return result


def public(row: dict) -> dict:
    def iso(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat() if value is not None else None
    adapter = ADAPTERS[row["operation"]]
    return {"id": row["id"], "operation": row["operation"], "state": row["state"],
            "created_at": iso(row["created"]), "started_at": iso(row["started"]),
            "completed_at": iso(row["completed"]), "expires_at": iso(row["expires"]),
            "attempts": row["attempts"],
            "error": {"code": row["error_code"], "message": REFUSALS.get(row["error_code"], FAILED_MESSAGE)} if row["error_code"] else None,
            "status_url": "/api/v1/jobs/"+row["id"],
            "result": {"url": "/api/v1/jobs/"+row["id"]+"/result", "bytes": row["result_bytes"],
                       "media_type": adapter.media_type, "filename": adapter.filename} if row["state"] == "succeeded" else None}


def delete(identifier: str, key_id: str) -> dict:
    with connection(write=True) as conn:
        row = conn.execute("SELECT * FROM api_async_jobs WHERE id=? AND key_id=?", (identifier,key_id)).fetchone()
        if not row:
            raise JobError(404, "job_not_found", "Job not found.")
        conn.execute("UPDATE api_async_jobs SET state='canceled',completed=COALESCE(completed,?),expires=NULL WHERE id=?", (time.time(),identifier))
        running = bool(row["claim"])
    if not running:
        purge_files(identifier)
    return {"id": identifier, "state": "canceled", "deletion_pending": running}


def purge_files(identifier: str) -> None:
    shutil.rmtree(job_dir(identifier), ignore_errors=True)
    if not job_dir(identifier).exists():
        with connection(write=True) as conn:
            conn.execute("UPDATE api_async_jobs SET reserved_bytes=0,result_bytes=0 WHERE id=? AND claim IS NULL AND state NOT IN ('queued','running')", (identifier,))


def clear_scratch(identifier: str) -> bool:
    """Idempotent after terminal commit, including concurrent DELETE."""
    directory = job_dir(identifier)
    try:
        for child in directory.iterdir():
            if child.name != "result":
                if child.is_dir():
                    shutil.rmtree(child,ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
        return not any(child.name != "result" for child in directory.iterdir())
    except FileNotFoundError:
        return True


def claim() -> dict | None:
    now = time.time()
    with connection(write=True) as conn:
        if conn.execute("SELECT 1 FROM api_async_jobs WHERE state='running' AND lease_until>?", (now,)).fetchone():
            return None
        # Least-recently-served account, then key, then FIFO; creating more keys
        # cannot jump ahead of another account's waiting work.
        row = conn.execute("""SELECT j.* FROM api_async_jobs j JOIN api_keys k ON k.key_id=j.key_id
            WHERE j.state='queued' AND j.deadline>? AND j.attempts<? AND k.revoked_at IS NULL
            ORDER BY COALESCE((SELECT MAX(s.started) FROM api_async_jobs s WHERE s.user_id=j.user_id),0),
                     COALESCE((SELECT MAX(s.started) FROM api_async_jobs s WHERE s.key_id=j.key_id),0),j.created LIMIT 1""", (now,config.LIMITS.attempts)).fetchone()
        if not row:
            return None
        token = uuid.uuid4().hex
        conn.execute("UPDATE api_async_jobs SET state='running',started=?,attempts=attempts+1,claim=?,lease_until=? WHERE id=?", (now,token,now+config.LIMITS.lease_seconds,row["id"]))
        return dict(conn.execute("SELECT * FROM api_async_jobs WHERE id=?", (row["id"],)).fetchone())


def renew(identifier: str, token: str) -> bool:
    with connection(write=True) as conn:
        row = conn.execute("SELECT * FROM api_async_jobs WHERE id=? AND claim=?", (identifier,token)).fetchone()
        if not row or row["state"] != "running" or not _alive_key(conn,row["key_id"],row["user_id"]):
            return False
        conn.execute("UPDATE api_async_jobs SET lease_until=? WHERE id=? AND claim=?", (time.time()+config.LIMITS.lease_seconds,identifier,token))
        return True


def finish(identifier: str, token: str, *, output: Path | None = None, error: str | None = None) -> bool:
    now = time.time()
    with connection(write=True) as conn:
        row = conn.execute("SELECT * FROM api_async_jobs WHERE id=? AND claim=?", (identifier,token)).fetchone()
        if not row:
            return False
        if row["state"] != "running" or not _alive_key(conn,row["key_id"],row["user_id"]):
            conn.execute("UPDATE api_async_jobs SET state='canceled',completed=?,claim=NULL,lease_until=NULL WHERE id=?", (now,identifier))
            return False
        size = 0
        if output is not None:
            scratch = (job_dir(identifier) / token).resolve()
            resolved = output.resolve()
            if output.is_symlink() or not resolved.is_relative_to(scratch) or not resolved.is_file():
                raise JobError(500,"invalid_job_result","Invalid result artifact.")
            size = resolved.stat().st_size
            if size > config.LIMITS.result_bytes:
                error, output = "job_output_too_large", None
                size = 0
            else:
                with resolved.open("rb") as f:
                    os.fsync(f.fileno())
                os.replace(resolved, job_dir(identifier)/"result")
                fsync_dir(job_dir(identifier))
        state = "succeeded" if output is not None else "failed"
        conn.execute("UPDATE api_async_jobs SET state=?,completed=?,expires=?,result_bytes=?,error_code=?,claim=NULL,lease_until=NULL WHERE id=? AND claim=?",
                     (state,now,now+config.LIMITS.result_seconds if state=="succeeded" else None,size,error,identifier,token))
    # Only the published artifact is retained; inputs and scratch never await TTL.
    scratch_removed = clear_scratch(identifier)
    with connection(write=True) as conn:
        if scratch_removed:
            conn.execute("UPDATE api_async_jobs SET reserved_bytes=? WHERE id=? AND claim IS NULL", (size if state=="succeeded" else 0,identifier))
    return True


def recover_and_sweep() -> None:
    """Worker-only: called under the singleton lock, never by web janitors."""
    now = time.time()
    purge = []
    retries = []
    with connection(write=True) as conn:
        for row in conn.execute("SELECT * FROM api_async_jobs").fetchall():
            identifier = row["id"]
            revoked = not _alive_key(conn,row["key_id"],row["user_id"])
            if row["claim"] and (row["lease_until"] or 0) > now:
                continue
            if row["state"] == "running" and not revoked and row["attempts"] < config.LIMITS.attempts and row["deadline"] > now:
                conn.execute("UPDATE api_async_jobs SET state='queued',claim=NULL,lease_until=NULL WHERE id=?", (identifier,))
                retries.append(identifier)
                continue
            code = None
            state = row["state"]
            if revoked:
                state, code = "canceled", "key_revoked"
            elif state in ACTIVE and (row["deadline"] <= now or state == "running" or row["attempts"]>=config.LIMITS.attempts):
                state, code = "failed", "job_interrupted" if row["attempts"] else "job_queue_expired"
            elif state == "succeeded" and row["expires"] <= now:
                state = "expired"
            if state in TERMINAL:
                conn.execute("UPDATE api_async_jobs SET state=?,error_code=COALESCE(?,error_code),claim=NULL,lease_until=NULL,completed=COALESCE(completed,?) WHERE id=?", (state,code,now,identifier))
                if state != "succeeded":
                    purge.append(identifier)
        ingests = [r[0] for r in conn.execute("SELECT id FROM api_async_ingest WHERE expires<=?", (now,))]
        conn.execute("DELETE FROM api_async_ingest WHERE expires<=?", (now,))
        conn.execute("DELETE FROM api_async_submit_window WHERE bucket<?", (int(now//60)-2,))
    for identifier in purge:
        purge_files(identifier)
    for identifier in retries:
        # The singleton supervisor owns recovery, so no new attempt can start
        # until old scratch and any pre-commit result artifact are removed.
        directory = job_dir(identifier)
        try:
            for child in directory.iterdir():
                if child.name != "inputs":
                    shutil.rmtree(child,ignore_errors=True) if child.is_dir() else child.unlink(missing_ok=True)
        except FileNotFoundError:
            pass
    for identifier in ingests:
        shutil.rmtree(job_dir(identifier),ignore_errors=True)
    # Reconcile files left by a crash before insertion or after publication.
    with connection() as conn:
        known = {r[0] for r in conn.execute("SELECT id FROM api_async_jobs UNION SELECT id FROM api_async_ingest")}
        completed = [dict(r) for r in conn.execute("SELECT * FROM api_async_jobs WHERE state='succeeded' AND claim IS NULL")]
    for row in completed:
        if clear_scratch(row["id"]):
            with connection(write=True) as conn:
                conn.execute("UPDATE api_async_jobs SET reserved_bytes=result_bytes WHERE id=? AND state='succeeded' AND claim IS NULL", (row["id"],))
    for directory in config.root().iterdir():
        if directory.is_dir() and re.fullmatch(r"[a-f0-9]{32}",directory.name) and directory.name not in known and now-directory.stat().st_mtime>config.LIMITS.upload_seconds:
            shutil.rmtree(directory,ignore_errors=True)
    with connection(write=True) as conn:
        conn.execute("DELETE FROM api_async_jobs WHERE state IN ('failed','canceled','expired') AND reserved_bytes=0 AND completed<?", (now-config.LIMITS.tombstone_seconds,))


def _retire_abandoned_claims(now: float) -> None:
    """Retire terminal orphan work only while owning the supervisor's lock.

    Expired heartbeats/leases do not prove that a process has stopped. The
    singleton file lock does: a live supervisor holds it for its entire life.
    Hold the lock through file deletion so a replacement cannot start between
    the ownership check and cleanup. Unexpired recoverable work is left alone.
    """
    try:
        lock = (config.root()/"worker.lock").open("a")
    except FileNotFoundError:
        return
    with lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return
        purge = []
        with connection(write=True) as conn:
            rows = conn.execute("SELECT * FROM api_async_jobs WHERE claim IS NOT NULL").fetchall()
            for row in rows:
                state,code = row["state"],None
                if not _alive_key(conn,row["key_id"],row["user_id"]):
                    state,code = "canceled","key_revoked"
                elif state in ("canceled","failed","expired"):
                    pass
                elif row["deadline"]<=now:
                    state,code = "failed","job_deadline_expired"
                else:
                    continue
                conn.execute("UPDATE api_async_jobs SET state=?,error_code=COALESCE(?,error_code),"
                             "completed=COALESCE(completed,?),claim=NULL,lease_until=NULL WHERE id=?",
                             (state,code,now,row["id"]))
                purge.append(row["id"])
        for identifier in purge:
            purge_files(identifier)


def maintenance() -> None:
    """Web-janitor-safe retention sweep, also when submissions are disabled.

    Live supervisor claims are never released. Without a supervisor, terminal
    or deadline-expired orphan claims can be retired under its singleton lock.
    Unexpired retryable work is still recovered only by the worker.
    """
    now = time.time()
    try:
        _retire_abandoned_claims(now)
        with connection(write=True) as conn:
            conn.execute("UPDATE api_async_jobs SET state='expired' WHERE state='succeeded' AND expires<=? AND claim IS NULL", (now,))
            conn.execute("UPDATE api_async_jobs SET state='failed',error_code='job_queue_expired',completed=? "
                         "WHERE state='queued' AND deadline<=? AND claim IS NULL", (now,now))
            conn.execute("UPDATE api_async_jobs SET state='failed',error_code='job_interrupted',completed=? "
                         "WHERE state='queued' AND attempts>=? AND claim IS NULL", (now,config.LIMITS.attempts))
            expired = [r[0] for r in conn.execute("SELECT id FROM api_async_jobs WHERE state IN ('failed','canceled','expired') AND claim IS NULL")]
            ingests = [r[0] for r in conn.execute("SELECT id FROM api_async_ingest WHERE expires<=?", (now,))]
            completed = [r[0] for r in conn.execute("SELECT id FROM api_async_jobs WHERE state='succeeded' AND claim IS NULL")]
            conn.execute("DELETE FROM api_async_ingest WHERE expires<=?", (now,))
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return
        raise
    for identifier in expired:
        purge_files(identifier)
    for identifier in ingests:
        shutil.rmtree(job_dir(identifier),ignore_errors=True)
    for identifier in completed:
        if clear_scratch(identifier):
            with connection(write=True) as conn:
                conn.execute("UPDATE api_async_jobs SET reserved_bytes=result_bytes WHERE id=? AND state='succeeded' AND claim IS NULL",(identifier,))
    with connection(write=True) as conn:
        conn.execute("DELETE FROM api_async_jobs WHERE state IN ('failed','canceled','expired') AND reserved_bytes=0 AND completed<?", (now-config.LIMITS.tombstone_seconds,))
        conn.execute("DELETE FROM api_async_submit_window WHERE bucket<?", (int(now//60)-2,))
        known = {r[0] for r in conn.execute("SELECT id FROM api_async_jobs UNION SELECT id FROM api_async_ingest")}
    for directory in config.root().iterdir() if config.root().exists() else []:
        if directory.is_dir() and re.fullmatch(r"[a-f0-9]{32}",directory.name) and directory.name not in known and now-directory.stat().st_mtime>config.LIMITS.upload_seconds:
            shutil.rmtree(directory,ignore_errors=True)
