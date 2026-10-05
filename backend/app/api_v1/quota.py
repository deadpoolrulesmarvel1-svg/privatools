"""Atomic free API quotas and original-day, idempotent reservation receipts."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .. import store

DAILY_UNITS = int(os.environ.get("API_V1_DAILY_UNITS", "500"))
DAILY_BYTES = int(os.environ.get("API_V1_DAILY_BYTES", str(250 * 1024 * 1024)))
MAX_JOBS_PER_KEY = int(os.environ.get("API_V1_MAX_JOBS_PER_KEY", "3"))
MAX_HTTP_REQUESTS = int(os.environ.get("API_V1_MAX_HTTP_REQUESTS", "6"))
HEAVY_COST = 5
# Reviewed resource-intensive operations; exact paths avoid accidental substring costs.
HEAVY_OPERATIONS = frozenset({
    "pdf-to-image", "pdf-to-word", "ocr", "office-to-pdf", "pdf-to-text",
    "pdf-to-excel", "pdf-to-pptx", "pdf-to-pdfa", "html-to-pdf", "pdf-to-epub",
    "image-ocr", "remove-background", "url-to-pdf", "pdf-to-markdown", "pdf-to-svg",
    "pdf-to-long-image", "pdf-to-html", "pdf-to-rtf", "word-to-pdf", "excel-to-pdf",
    "pptx-to-pdf-convert", "video-to-gif", "extract-audio", "trim-media", "compress-video",
    "video-to-pdf", "video-converter", "video-resizer", "video-thumbnail", "gif-to-mp4",
    "add-subtitles", "video-merge", "audio-merge", "mute-video", "reverse-video",
    "video-speed", "audio-trim", "audio-converter", "image-upscaler",
    "hidden-text-checker", "form-creator/detect",
})
INFORMATION_OPERATIONS = frozenset({
    "usage", "whoami", "openapi.json", "operations", "developer/status",
    "pipeline/templates", "pipeline/validate", "transparency/janitor",
})
PIPELINE_STEP_COSTS = {
    "compress-pdf": 1, "repair-pdf": 1, "deskew-pdf": 1, "grayscale-pdf": 1,
    "flatten-pdf": 1, "rotate-pdf": 1, "reverse-pdf": 1, "nup": 1,
    "booklet-pdf": 1, "page-numbers": 1, "bates-numbering": 1,
    "header-footer": 1, "watermark": 1, "stamp-pdf": 1,
    "strip-metadata": 1, "delete-annotations": 1, "pdf-to-pdfa": 5,
}


def cost_for(path: str) -> int:
    operation = path.split("?", 1)[0].removeprefix("/api/v1/").strip("/")
    if operation in INFORMATION_OPERATIONS or operation.startswith("jobs/"):
        return 0
    # Pipeline's actual reservation is the sum of validated step costs.
    return HEAVY_COST if operation in HEAVY_OPERATIONS else 1


def policy() -> dict:
    return {
        "daily_units": DAILY_UNITS, "daily_bytes": DAILY_BYTES,
        "concurrent_requests_per_key": MAX_JOBS_PER_KEY,
        "global_concurrent_requests": MAX_HTTP_REQUESTS,
        "requests_per_minute": 30, "request_burst": 6,
        "bytes_definition": "Actual HTTP request-body bytes, including multipart boundaries and form fields.",
        "reset": "00:00 UTC", "pipeline_cost": "Sum of the selected step costs.",
    }


@dataclass(frozen=True)
class QuotaState:
    units_used: int
    units_limit: int
    bytes_used: int
    bytes_limit: int
    reset_at: datetime

    @property
    def units_remaining(self) -> int:
        return max(0, self.units_limit - self.units_used)

    @property
    def retry_after(self) -> int:
        return max(1, int((self.reset_at - _utcnow()).total_seconds()))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> str:
    return _utcnow().strftime("%Y%m%d")


def _midnight(day: str | None = None) -> datetime:
    return datetime.strptime(day or _today(), "%Y%m%d").replace(tzinfo=timezone.utc) + timedelta(days=1)


def ensure_schema() -> None:
    store.init()


_ensure_schema = ensure_schema


def _state(conn, key_id: str, day: str) -> QuotaState:
    row = conn.execute("SELECT units, bytes FROM api_quota WHERE key_id=? AND day=?", (key_id, day)).fetchone()
    return QuotaState(row["units"] if row else 0, DAILY_UNITS,
                      row["bytes"] if row else 0, DAILY_BYTES, _midnight(day))


def peek(key_id: str) -> QuotaState:
    ensure_schema()
    with store.read() as conn:
        return _state(conn, key_id, _today())


def _consume(conn, key_id: str, units: int, size: int, day: str):
    if units < 0 or size < 0:
        raise ValueError("Quota charges must be nonnegative")
    state = _state(conn, key_id, day)
    if state.units_used + units > DAILY_UNITS or state.bytes_used + size > DAILY_BYTES:
        return False, state
    conn.execute(
        "INSERT INTO api_quota(key_id,day,units,bytes) VALUES(?,?,?,?) "
        "ON CONFLICT(key_id,day) DO UPDATE SET units=units+excluded.units,bytes=bytes+excluded.bytes",
        (key_id, day, units, size),
    )
    return True, _state(conn, key_id, day)


def consume(key_id: str, units: int, size_bytes: int = 0):
    """Legacy direct charging facade. New processing calls use reservations."""
    ensure_schema()
    with store.write() as conn:
        return _consume(conn, key_id, units, size_bytes, _today())


def reserve_in_transaction(conn, key_id: str, units: int, size_bytes: int,
                           *, token: str | None = None, day: str | None = None, now: float | None = None):
    """Reserve inside the caller's transaction (e.g. atomic durable job acceptance).

    Call ensure_schema before opening the transaction. A supplied token may be
    retried only with the identical identity and charge. No HTTP lease is added.
    """
    token = token or secrets.token_urlsafe(24)
    existing = conn.execute("SELECT * FROM api_v1_reservations WHERE token=?", (token,)).fetchone()
    if existing:
        if (existing["key_id"], existing["units"], existing["bytes"]) != (key_id, units, size_bytes):
            raise ValueError("Reservation token already used for another charge")
        return True, _state(conn, key_id, existing["day"]), token
    day = day or _today()
    allowed, state = _consume(conn, key_id, units, size_bytes, day)
    if not allowed:
        return False, state, None
    conn.execute(
        "INSERT INTO api_v1_reservations(token,key_id,day,units,bytes,created_at) VALUES(?,?,?,?,?,?)",
        (token, key_id, day, units, size_bytes, _utcnow().timestamp() if now is None else now),
    )
    return True, state, token


def reserve(key_id: str, units: int, size_bytes: int = 0):
    ensure_schema()
    with store.write() as conn:
        return reserve_in_transaction(conn, key_id, units, size_bytes)


def refund_reservation_in_transaction(conn, token: str) -> QuotaState:
    row = conn.execute("SELECT * FROM api_v1_reservations WHERE token=?", (token,)).fetchone()
    if row is None:
        raise ValueError("Unknown reservation")
    if not row["refunded"]:
        conn.execute("UPDATE api_quota SET units=MAX(0,units-?),bytes=MAX(0,bytes-?) WHERE key_id=? AND day=?",
                     (row["units"], row["bytes"], row["key_id"], row["day"]))
        conn.execute("UPDATE api_v1_reservations SET refunded=1 WHERE token=?", (token,))
    return _state(conn, row["key_id"], row["day"])


def refund_reservation(token: str) -> QuotaState:
    ensure_schema()
    with store.write() as conn:
        return refund_reservation_in_transaction(conn, token)


def refund(key_id: str, units: int, size_bytes: int = 0, *, day: str | None = None) -> QuotaState:
    """Compatibility helper; request lifecycles must use refund_reservation."""
    ensure_schema()
    with store.write() as conn:
        bucket = day or _today()
        conn.execute("UPDATE api_quota SET units=MAX(0,units-?),bytes=MAX(0,bytes-?) WHERE key_id=? AND day=?",
                     (max(0, units), max(0, size_bytes), key_id, bucket))
        return _state(conn, key_id, bucket)


def reconcile_bytes(key_id: str, actual: int, charged: int, *, day: str | None = None) -> None:
    """Compatibility only; HTTP admission now uses the counted complete body."""
    ensure_schema()
    with store.write() as conn:
        conn.execute("INSERT INTO api_quota(key_id,day,units,bytes) VALUES(?,?,0,?) "
                     "ON CONFLICT(key_id,day) DO UPDATE SET bytes=MAX(0,bytes+excluded.bytes)",
                     (key_id, day or _today(), actual-charged))


def headers(state: QuotaState) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": str(state.units_limit),
        "X-RateLimit-Remaining": str(state.units_remaining),
        "X-RateLimit-Reset": str(int(state.reset_at.timestamp())),
        "X-Quota-Bytes-Limit": str(state.bytes_limit),
        "X-Quota-Bytes-Remaining": str(max(0, state.bytes_limit-state.bytes_used)),
    }


def cleanup_accounting(*, now: float | None = None, limit: int = 1000) -> dict[str, int]:
    """Bound each janitor pass; retain receipts/rate rows 48h and counters 7d.

    Leases and job references preserve receipts regardless of age, and a
    retained receipt preserves its original daily counter for any settlement.
    Run off the event loop. No uploaded content is stored in these tables.
    """
    from .admission import _reap
    ensure_schema()
    timestamp = _utcnow().timestamp() if now is None else now
    cutoff = timestamp - 48*60*60
    day_cutoff = (datetime.fromtimestamp(timestamp, timezone.utc)-timedelta(days=7)).strftime("%Y%m%d")
    limit = max(1, min(limit, 10000))
    with store.write() as conn:
        _reap(conn, timestamp)
        has_jobs = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_async_jobs'").fetchone()
        jobs_guard = " AND NOT EXISTS (SELECT 1 FROM api_async_jobs j WHERE j.receipt=r.token)" if has_jobs else ""
        receipts = conn.execute(
            "DELETE FROM api_v1_reservations WHERE token IN (SELECT r.token FROM api_v1_reservations r "
            "WHERE r.created_at<? AND NOT EXISTS(SELECT 1 FROM api_v1_leases l WHERE l.token=r.token)"
            + jobs_guard + " ORDER BY r.created_at LIMIT ?)", (cutoff, limit),
        ).rowcount
        buckets = conn.execute(
            "DELETE FROM api_v1_rate_buckets WHERE key_id IN (SELECT b.key_id FROM api_v1_rate_buckets b "
            "WHERE b.updated_at<? AND NOT EXISTS(SELECT 1 FROM api_v1_leases l WHERE l.key_id=b.key_id) "
            "ORDER BY b.updated_at LIMIT ?)", (cutoff, limit),
        ).rowcount
        counters = conn.execute(
            "DELETE FROM api_quota WHERE rowid IN (SELECT q.rowid FROM api_quota q WHERE q.day<? "
            "AND NOT EXISTS(SELECT 1 FROM api_v1_reservations r WHERE r.key_id=q.key_id AND r.day=q.day) "
            "ORDER BY q.day LIMIT ?)", (day_cutoff, limit),
        ).rowcount
    return {"receipts": receipts, "rate_buckets": buckets, "daily_counters": counters}
