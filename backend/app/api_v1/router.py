"""The versioned public surface.

Rather than re-declaring 130-odd handlers, v1 mounts the *same* routers the
unversioned API uses, under `/api/v1` and behind the auth and quota
dependencies. One handler, two surfaces: a fix to a tool reaches both, and the
two cannot drift.

The unversioned `/api/*` routes stay exactly as they are — open, unmetered, and
documented as unstable — because the site's own frontend calls them.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from ..auth import accounts
from . import quota
from .deps import enforce_quota, require_v1_key

logger = logging.getLogger(__name__)

meta_router = APIRouter(tags=["v1 · meta"])


@meta_router.get("/usage", summary="Your current free-tier usage")
async def usage(key: accounts.KeyRecord = Depends(require_v1_key)):
    """What this key has spent today, and when it resets.

    Deliberately outside the quota dependency: checking your remaining quota
    must not consume any.
    """
    state = quota.peek(key.key_id)
    return {
        "key_id": key.key_id,
        "label": key.label,
        "units": {"used": state.units_used, "limit": state.units_limit,
                  "remaining": state.units_remaining},
        "bytes": {"used": state.bytes_used, "limit": state.bytes_limit},
        "resets_at": state.reset_at.isoformat(),
    }


@meta_router.get("/whoami", summary="Confirm a key works")
async def whoami(key: accounts.KeyRecord = Depends(require_v1_key)):
    return {"key_id": key.key_id, "label": key.label, "created_at": key.created_at}


def mount(app, routers: list) -> int:
    """Mount every tool router under /api/v1 with auth and quota applied."""
    app.include_router(meta_router, prefix="/api/v1")
    mounted = 0
    for router in routers:
        app.include_router(
            router,
            prefix="/api/v1",
            dependencies=[Depends(enforce_quota)],
            tags=["v1 · tools"],
        )
        mounted += 1
    logger.info("api_v1: mounted %d routers under /api/v1", mounted)
    return mounted


async def attach_quota_headers(request: Request, call_next):
    """Report the key's standing on every v1 reply.

    A client should not have to call /usage to discover it is nearly out.
    """
    response = await call_next(request)
    state = getattr(request.state, "v1_quota", None)
    if state is not None:
        for name, value in quota.headers(state).items():
            response.headers[name] = value
    return response
