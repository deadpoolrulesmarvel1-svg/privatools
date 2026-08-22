"""Auth and quota dependencies for /api/v1.

Two rules the spec is emphatic about, both enforced here:

* **v1 fails closed.** The legacy helper returns "anonymous-dev" when no keys
  are configured, which leaves those routes public. v1 401s instead — the moment
  free keys are issued, the worst case stops being "someone DoSes us" and
  becomes "someone runs a free compute farm on our VM".
* **Raw keys never leave the request.** Everything downstream — quotas, logs,
  metrics, errors — uses `key_id`, which is `sha256(raw)[:16]`.

Errors carry a machine-readable `code` alongside the human `detail`, so a client
can branch without string-matching prose.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from ..auth import accounts
from . import quota

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _error(status: int, code: str, detail: str, headers: dict | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": detail}, headers=headers)


async def require_v1_key(api_key: str | None = Security(api_key_header)) -> accounts.KeyRecord:
    """Resolve a user-issued API key, or refuse.

    Unlike the legacy dependency there is no open path: an unauthenticated call
    to v1 is always a 401.
    """
    if not api_key:
        raise _error(401, "missing_api_key",
                     "Send your key in the X-API-Key header. Create one at /account.",
                     {"WWW-Authenticate": "ApiKey"})

    record = accounts.resolve_key(api_key)
    if record is None:
        raise _error(401, "invalid_api_key",
                     "That key is not recognised, or it has been revoked.",
                     {"WWW-Authenticate": "ApiKey"})

    accounts.touch_key(record.key_id)
    return record


async def enforce_quota(
    request: Request,
    key: accounts.KeyRecord = Depends(require_v1_key),
) -> accounts.KeyRecord:
    """Charge the free-tier quota before the handler runs.

    Consuming up front is what stops an over-quota request from starting work at
    all; the alternative charges for compute already spent.
    """
    units = quota.cost_for(request.url.path)
    declared = request.headers.get("content-length")
    size = int(declared) if declared and declared.isdigit() else 0

    allowed, state = quota.consume(key.key_id, units, size)
    if not allowed:
        raise _error(
            429, "quota_exceeded",
            f"Daily free-tier limit reached. It resets at {state.reset_at:%Y-%m-%d %H:%M} UTC.",
            {**quota.headers(state), "Retry-After": str(state.retry_after)},
        )

    # Read by the response middleware so every v1 reply reports the standing.
    request.state.v1_key_id = key.key_id
    request.state.v1_quota = state
    request.state.v1_charged_bytes = size
    return key
