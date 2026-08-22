from __future__ import annotations

import logging
import os
import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

API_KEY_HEADER = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)

logger = logging.getLogger(__name__)


def _configured_keys() -> list[str]:
    raw = os.environ.get("PRIVATOOLS_API_KEYS", "")
    return [key.strip() for key in raw.split(",") if key.strip()]


async def require_api_key(api_key: str | None = Security(api_key_header)) -> str:
    """Resolve the caller's API key to an identity string.

    Two sources, checked in order:

    1. **User-issued keys** in the database. This is the seam the API
       foundation spec named — ``resolve_key(raw) -> KeyRecord`` — so quota and
       metering code downstream keys off ``key_id`` and does not care where the
       key came from.
    2. **Statically configured keys** from ``PRIVATOOLS_API_KEYS``. Retained so
       an operator can gate a deployment without creating an account, and so
       existing installs keep working.

    A deployment with neither configured stays open, which is what keeps local
    and self-hosted installs usable out of the box.
    """
    if api_key:
        # Imported lazily: the tool routes that depend on this must not pay for
        # database import at module load, and self-hosters without a data
        # volume should never touch the store at all.
        from . import accounts

        try:
            record = accounts.resolve_key(api_key)
        except Exception:  # a broken store must not lock everyone out
            logger.exception("api_key: store lookup failed; falling back to env keys")
            record = None
        if record is not None:
            accounts.touch_key(record.key_id)
            return f"key:{record.key_id}"

    keys = _configured_keys()
    if not keys:
        # No user keys matched and no static allowlist: open deployment.
        from . import accounts

        try:
            has_any = accounts.any_keys_issued()
        except Exception:
            has_any = False
        if not has_any:
            return "anonymous-dev"
    elif api_key:
        # Compare as UTF-8 bytes: secrets.compare_digest raises TypeError on a
        # non-ASCII str, which would surface as an uncaught 500 instead of 401.
        candidate = api_key.encode("utf-8")
        if any(secrets.compare_digest(candidate, key.encode("utf-8")) for key in keys):
            return "api-key"

    raise HTTPException(
        status_code=401,
        detail=f"Missing or invalid {API_KEY_HEADER}",
        headers={"WWW-Authenticate": "ApiKey"},
    )
