from __future__ import annotations

import os
import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

API_KEY_HEADER = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)


def _configured_keys() -> list[str]:
    raw = os.environ.get("PRIVATOOLS_API_KEYS", "")
    return [key.strip() for key in raw.split(",") if key.strip()]


async def require_api_key(api_key: str | None = Security(api_key_header)) -> str:
    """Require an API key only when the deployment has configured keys.

    Local/dev installs stay usable out of the box. Production can set
    PRIVATOOLS_API_KEYS to a comma-separated allowlist and every route using
    this dependency immediately becomes key-gated.
    """
    keys = _configured_keys()
    if not keys:
        return "anonymous-dev"
    if api_key and any(secrets.compare_digest(api_key, key) for key in keys):
        return "api-key"
    raise HTTPException(
        status_code=401,
        detail=f"Missing or invalid {API_KEY_HEADER}",
        headers={"WWW-Authenticate": "ApiKey"},
    )

