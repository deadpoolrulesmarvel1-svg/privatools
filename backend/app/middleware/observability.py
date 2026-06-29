"""Process observability: an in-flight request gauge and an RSS sampler.

Kept dependency-free (stdlib ``resource``) for the slim image. The gauge is a
plain module-level int mutated only from async middleware — inc/dec happen with
no ``await`` between the read and the write, and the event loop is
single-threaded, so the asyncio path needs no lock.

Surfaced by the janitor heartbeat (research O5/O6) so memory growth and request
saturation are visible in the logs at "tail with jq" scale.
"""
from __future__ import annotations

import resource
import sys

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_inflight = 0
_peak_inflight = 0


def inflight_count() -> int:
    """Requests currently being handled by this worker."""
    return _inflight


def peak_inflight() -> int:
    """High-water mark of concurrent requests since process start."""
    return _peak_inflight


def max_rss_mb() -> float:
    """Peak resident set size in MB.

    ``ru_maxrss`` is in kilobytes on Linux (prod) and bytes on macOS — normalize
    both to MB. This is the high-water mark, not current RSS, but it's the cheap
    portable signal for "is this worker's memory creeping up across sweeps".
    """
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    kb = rss / 1024 if sys.platform == "darwin" else rss
    return round(kb / 1024, 1)


class InFlightMiddleware(BaseHTTPMiddleware):
    """Maintain the concurrent-request gauge around every request."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        global _inflight, _peak_inflight
        _inflight += 1
        if _inflight > _peak_inflight:
            _peak_inflight = _inflight
        try:
            return await call_next(request)
        finally:
            _inflight -= 1
            if _inflight < 0:
                _inflight = 0
