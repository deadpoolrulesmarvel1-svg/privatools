"""Shared rate-limiter instance for per-route decorators.

`app.main` builds the FastAPI app, registers the exception handler, and
sets the default global limit. Routes that want a stricter per-route cap
(`@limiter.limit("5/minute")` on expensive jobs like OCR / URL→PDF /
LibreOffice conversions) import :data:`limiter` from this module rather
than from `app.main` — that would create a circular import, because
`app.main` imports every route module at startup.

The limit string is env-configurable so tests / staging can relax it
without code changes. ``RATE_LIMIT`` is the default applied to every
route; ``RATE_LIMIT_EXPENSIVE`` is the cap stamped on individual
heavy-job routes via :data:`EXPENSIVE_RATE_LIMIT`.
"""

from __future__ import annotations

import os

from starlette.requests import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _client_ip(request: Request) -> str:
    """Rate-limit key that resists X-Forwarded-For spoofing.

    nginx sets ``X-Forwarded-For`` via ``proxy_add_x_forwarded_for``, which
    APPENDS the real peer as the LAST entry. We key on the RIGHTMOST entry —
    the value the trusted proxy added — so a client that PREpends spoofed
    entries can't rotate the key to evade the per-route cap or pin a victim's
    bucket. (``get_remote_address`` keys on ``request.client.host``, which
    under uvicorn ``--forwarded-allow-ips '*'`` would be the client-controlled
    leftmost XFF value — the spoof this avoids.) Falls back to the socket peer
    when there is no XFF (direct / local).
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        last = xff.split(",")[-1].strip()
        if last:
            return last
    return get_remote_address(request)


# NOTE: ``default_limits`` is only enforced by SlowAPIMiddleware, which we
# deliberately do NOT install (see app.main). So this is a fallback for any
# future middleware install, not a live global cap — today only routes with an
# explicit ``@limiter.limit(...)`` decorator are throttled. Cheap routes rely
# on the upload-size, request-timeout, and concurrency caps; every EXPENSIVE
# route (Tesseract / LibreOffice / ffmpeg / URL fetch / pipeline) MUST carry
# ``@limiter.limit(EXPENSIVE_RATE_LIMIT)``.
_DEFAULT_RATE = os.environ.get("RATE_LIMIT", "30/minute")

# Stricter cap for routes that touch expensive resources (Tesseract,
# LibreOffice, ffmpeg, headless browsers). 5/min per-IP is plenty for any
# legitimate user — a real human won't OCR 6 PDFs in 60s, but an abusive
# script trying to wedge the worker pool absolutely will.
EXPENSIVE_RATE_LIMIT = os.environ.get("RATE_LIMIT_EXPENSIVE", "5/minute")

limiter = Limiter(key_func=_client_ip, default_limits=[_DEFAULT_RATE])

__all__ = ["limiter", "EXPENSIVE_RATE_LIMIT"]
