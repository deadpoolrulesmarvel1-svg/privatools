"""Observability hardening: uvicorn log routing (O3), in-flight gauge (O5),
RSS sampler used by the janitor heartbeat (O6)."""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.middleware import observability as obs
from backend.app.middleware.observability import (
    InFlightMiddleware,
    inflight_count,
    max_rss_mb,
    peak_inflight,
)
from backend.app.utils.logging import route_uvicorn_logging


# ─── O3: uvicorn loggers routed through root ──────────────────────────────
def test_route_uvicorn_logging_clears_handlers_and_propagates():
    le = logging.getLogger("uvicorn.error")
    le.handlers = [logging.StreamHandler()]
    le.propagate = False

    route_uvicorn_logging()

    assert le.handlers == []
    assert le.propagate is True
    assert logging.getLogger("uvicorn.access").level == logging.WARNING


# ─── O6: RSS sampler ──────────────────────────────────────────────────────
def test_max_rss_mb_is_positive():
    assert max_rss_mb() > 0


# ─── O5: in-flight gauge ──────────────────────────────────────────────────
def test_inflight_gauge_tracks_concurrency():
    obs._inflight = 0
    obs._peak_inflight = 0
    mw = InFlightMiddleware(app=None)
    seen = {}

    async def call_next(_request):
        seen["during"] = inflight_count()
        return "resp"

    result = asyncio.run(mw.dispatch(None, call_next))

    assert result == "resp"
    assert seen["during"] == 1
    assert inflight_count() == 0  # decremented in finally
    assert peak_inflight() >= 1


def test_inflight_gauge_decrements_on_exception():
    obs._inflight = 0
    mw = InFlightMiddleware(app=None)

    async def boom(_request):
        raise RuntimeError("handler blew up")

    try:
        asyncio.run(mw.dispatch(None, boom))
    except RuntimeError:
        pass

    assert inflight_count() == 0
