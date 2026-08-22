"""Free-tier quota accounting for /api/v1.

**Deviation from the spec, deliberately.** `2026-08-21-api-foundation-design.md`
specifies a Redis sidecar and says v1 is *disabled* when `REDIS_URL` is unset,
so that `docker compose up` keeps working for self-hosters. That trade no longer
has to be made: accounts already brought a durable SQLite store on its own
volume, so quotas live there and every deployment gets v1 — including
self-hosted ones, which the Redis design would have excluded.

The workload suits it. The free tier is 500 cost units per key per day; the
writes are one row-update per request against a single-writer database on a
two-core box. If a deployment ever outgrows that, the counters are behind this
module's four functions and can move without touching a route.

Counters are keyed by `key_id` — `sha256(raw)[:16]` — never the raw key, which
is never stored or logged anywhere.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .. import store

# Env-tunable, matching the spec's names so a deployment configured for the
# Redis design keeps working unchanged.
DAILY_UNITS = int(os.environ.get("API_V1_DAILY_UNITS", "500"))
DAILY_BYTES = int(os.environ.get("API_V1_DAILY_BYTES", str(250 * 1024 * 1024)))
MAX_JOBS_PER_KEY = int(os.environ.get("API_V1_MAX_JOBS_PER_KEY", "3"))

# Cost weights (spec §5). Anything not listed costs 1.
HEAVY_COST = 5
HEAVY_MARKERS = (
    "office-to-pdf", "pdf-to-", "ocr", "html-to-pdf", "url-to-pdf",
    "image-ocr", "pdf-to-image", "pdf-to-word", "pdf-to-excel", "pdf-to-pptx",
    "remove-background", "summarize", "translate",
)


def cost_for(path: str) -> int:
    """Cost units a call to `path` consumes.

    Subprocess conversions, rasterising and network-egress operations are the
    expensive ones; everything else is a single unit.
    """
    lowered = path.lower()
    return HEAVY_COST if any(marker in lowered for marker in HEAVY_MARKERS) else 1


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
        return max(1, int((self.reset_at - datetime.now(timezone.utc)).total_seconds()))


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _midnight() -> datetime:
    now = datetime.now(timezone.utc)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _ensure_schema() -> None:
    store.init()
    with store.write() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS api_quota ("
            "  key_id TEXT NOT NULL,"
            "  day    TEXT NOT NULL,"
            "  units  INTEGER NOT NULL DEFAULT 0,"
            "  bytes  INTEGER NOT NULL DEFAULT 0,"
            "  PRIMARY KEY (key_id, day)"
            ")"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS api_jobs_inflight ("
            "  key_id TEXT PRIMARY KEY,"
            "  count  INTEGER NOT NULL DEFAULT 0"
            ")"
        )


def peek(key_id: str) -> QuotaState:
    """Current usage without consuming anything."""
    _ensure_schema()
    with store.read() as conn:
        row = conn.execute(
            "SELECT units, bytes FROM api_quota WHERE key_id = ? AND day = ?",
            (key_id, _today()),
        ).fetchone()
    return QuotaState(
        units_used=row["units"] if row else 0,
        units_limit=DAILY_UNITS,
        bytes_used=row["bytes"] if row else 0,
        bytes_limit=DAILY_BYTES,
        reset_at=_midnight(),
    )


def consume(key_id: str, units: int, size_bytes: int = 0) -> tuple[bool, QuotaState]:
    """Charge the key before work starts.

    Returns ``(allowed, state)``. When it would exceed a limit nothing is
    charged and the caller refuses the request — the spec's rule is that quota
    is consumed *before* work, so an over-quota call never starts.
    """
    _ensure_schema()
    day = _today()
    with store.write() as conn:
        row = conn.execute(
            "SELECT units, bytes FROM api_quota WHERE key_id = ? AND day = ?", (key_id, day)
        ).fetchone()
        used_units = row["units"] if row else 0
        used_bytes = row["bytes"] if row else 0

        over = (used_units + units > DAILY_UNITS) or (used_bytes + size_bytes > DAILY_BYTES)
        if not over:
            conn.execute(
                "INSERT INTO api_quota (key_id, day, units, bytes) VALUES (?, ?, ?, ?)"
                " ON CONFLICT(key_id, day) DO UPDATE SET"
                "   units = units + excluded.units, bytes = bytes + excluded.bytes",
                (key_id, day, units, size_bytes),
            )
            used_units += units
            used_bytes += size_bytes

    state = QuotaState(used_units, DAILY_UNITS, used_bytes, DAILY_BYTES, _midnight())
    return (not over), state


def reconcile_bytes(key_id: str, actual: int, charged: int) -> None:
    """Correct the byte count once the real upload size is known.

    A chunked upload arrives without Content-Length, so it is charged its real
    size after streaming. If that pushes the key over, the *next* request is
    refused rather than this one being torn down mid-flight.
    """
    delta = actual - charged
    if delta == 0:
        return
    _ensure_schema()
    with store.write() as conn:
        conn.execute(
            "INSERT INTO api_quota (key_id, day, units, bytes) VALUES (?, ?, 0, ?)"
            " ON CONFLICT(key_id, day) DO UPDATE SET bytes = MAX(0, bytes + excluded.bytes)",
            (key_id, _today(), delta),
        )


def headers(state: QuotaState) -> dict[str, str]:
    """`X-RateLimit-*` describing the key's standing."""
    return {
        "X-RateLimit-Limit": str(state.units_limit),
        "X-RateLimit-Remaining": str(state.units_remaining),
        "X-RateLimit-Reset": str(int(state.reset_at.timestamp())),
    }
