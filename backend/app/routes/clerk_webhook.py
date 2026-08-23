"""Clerk webhooks — currently one event, and it is not optional.

Clerk owns the identity; the API keys and their quota live here. Nothing links
the two at rest, so deleting an account in Clerk leaves this side untouched:
the keys stay valid, keep authenticating, and keep spending quota, for an
account that no longer exists. The account page offers a delete button, so this
is reachable by design rather than by accident.

Verification is Svix's scheme, which Clerk uses: an HMAC-SHA256 over
"{id}.{timestamp}.{body}" with a base64 secret, compared in constant time,
inside a timestamp window so a captured request cannot be replayed later. Done
with hmac and hashlib rather than pulling in the svix package — it is thirty
lines and the alternative is another dependency in the image for one endpoint.

Unconfigured means unmounted: with no CLERK_WEBHOOK_SECRET the route rejects
everything rather than accepting unverified calls.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time

from fastapi import APIRouter, HTTPException, Request

from ..auth import accounts

router = APIRouter()
logger = logging.getLogger(__name__)

_SECRET = os.environ.get("CLERK_WEBHOOK_SECRET", "").strip()

# Svix's own default. Wide enough for clock skew and a retry, narrow enough
# that a captured request stops being useful quickly.
_TOLERANCE_SECONDS = 5 * 60


def _secret_bytes() -> bytes | None:
    """The signing key, decoded. Clerk gives it as `whsec_<base64>`."""
    if not _SECRET:
        return None
    raw = _SECRET.split("_", 1)[1] if _SECRET.startswith("whsec_") else _SECRET
    try:
        return base64.b64decode(raw)
    except Exception:
        logger.error("clerk webhook: CLERK_WEBHOOK_SECRET is not valid base64")
        return None


def _signature_ok(secret: bytes, msg_id: str, timestamp: str, body: bytes, header: str) -> bool:
    """Whether any signature in the header matches.

    The header carries a space-separated list — Svix sends more than one during
    a secret rotation — so every candidate is checked and compared in constant
    time. Aborting on the first mismatch would leak which one matched by timing.
    """
    signed = b"%s.%s.%s" % (msg_id.encode(), timestamp.encode(), body)
    expected = hmac.new(secret, signed, hashlib.sha256).digest()

    matched = False
    for candidate in header.split():
        # Entries look like "v1,<base64 signature>".
        _, _, encoded = candidate.partition(",")
        try:
            given = base64.b64decode(encoded)
        except Exception:
            continue
        matched |= hmac.compare_digest(expected, given)
    return matched


def _timestamp_ok(timestamp: str) -> bool:
    try:
        sent = int(timestamp)
    except ValueError:
        return False
    return abs(time.time() - sent) <= _TOLERANCE_SECONDS


@router.post("/clerk/webhook")
async def clerk_webhook(request: Request):
    secret = _secret_bytes()
    if secret is None:
        # Not "ignore quietly": an unverifiable webhook that returns 200 looks
        # healthy in Clerk's dashboard while doing nothing at all.
        raise HTTPException(status_code=503, detail="Webhooks are not configured")

    msg_id = request.headers.get("svix-id", "")
    timestamp = request.headers.get("svix-timestamp", "")
    signature = request.headers.get("svix-signature", "")
    if not (msg_id and timestamp and signature):
        raise HTTPException(status_code=400, detail="Missing signature headers")

    if not _timestamp_ok(timestamp):
        raise HTTPException(status_code=400, detail="Timestamp outside tolerance")

    body = await request.body()
    if not _signature_ok(secret, msg_id, timestamp, body, signature):
        logger.warning("clerk webhook: signature did not verify (id=%s)", msg_id[:40])
        raise HTTPException(status_code=401, detail="Bad signature")

    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Body is not JSON") from exc

    kind = str(event.get("type", ""))
    user_id = str((event.get("data") or {}).get("id", ""))

    if kind == "user.deleted":
        if not user_id:
            raise HTTPException(status_code=400, detail="user.deleted without an id")
        accounts.delete_user(user_id)
        logger.info("clerk webhook: removed local data for deleted user %s", user_id)
        return {"ok": True, "handled": kind}

    # Everything else is acknowledged rather than refused. Clerk retries on a
    # non-2xx, so 400-ing an event we simply do not act on would turn every
    # unrelated event into a retry loop.
    logger.debug("clerk webhook: ignoring %s", kind or "<no type>")
    return {"ok": True, "handled": None}
