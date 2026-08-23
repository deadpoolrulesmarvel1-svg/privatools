"""Verify Clerk session tokens, without asking Clerk.

Clerk signs session tokens RS256 and publishes the public keys at the
instance's JWKS endpoint. Verifying against those keys locally means a request
costs no network call and keeps working through a Clerk outage — which matters
because the alternative, asking Clerk's API about every token, would make
issuing an API key depend on Clerk being reachable at that moment.

The JWKS is fetched once and cached. Clerk rotates keys rarely and signals a
rotation by signing with a `kid` we have not seen, so the cache refreshes on an
unknown `kid` rather than on a timer — with a floor between refreshes, so a
stream of tokens carrying junk `kid`s cannot turn into a stream of outbound
requests.

Nothing here runs unless CLERK_PUBLISHABLE_KEY is set. Absent it, this module
reports Clerk as unconfigured and the caller falls back to local sessions.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

_PUBLISHABLE_KEY = os.environ.get("CLERK_PUBLISHABLE_KEY", "").strip()

# Long enough that a burst of bad tokens cannot become a burst of requests to
# Clerk, short enough that a real key rotation is picked up without a restart.
_JWKS_MIN_REFRESH_SECONDS = 300.0

# Clerk's own leeway guidance for clock skew between our host and theirs.
_LEEWAY_SECONDS = 5


class ClerkNotConfigured(RuntimeError):
    """Raised when Clerk is asked to do something without a key."""


@dataclass(frozen=True)
class ClerkIdentity:
    """The parts of a verified token this app acts on."""

    user_id: str
    session_id: str


def _fapi_origin(publishable_key: str) -> str:
    """https://<fapi-host> for a publishable key, or "" if unusable.

    Same derivation as app.main's CSP helper and for the same reason: the host
    differs per instance, so hardcoding either the development or production
    form breaks the other.
    """
    try:
        parts = publishable_key.split("_", 2)
        if len(parts) != 3 or parts[0] != "pk":
            return ""
        body = parts[2]
        host = base64.b64decode(body + "=" * (-len(body) % 4)).decode("ascii").rstrip("$")
        looks_dev = host.endswith(".clerk.accounts.dev")
        looks_prod = host.startswith("clerk.") and "accounts.dev" not in host
        if not re.fullmatch(r"[A-Za-z0-9.-]+", host) or not (looks_dev or looks_prod):
            return ""
        return f"https://{host}"
    except Exception:
        return ""


_FAPI_ORIGIN = _fapi_origin(_PUBLISHABLE_KEY)


def is_configured() -> bool:
    """Whether this deployment can verify Clerk tokens at all."""
    return bool(_FAPI_ORIGIN)


class _JwksCache:
    """PyJWKClient plus a refresh policy keyed on unseen `kid`s."""

    def __init__(self, jwks_url: str) -> None:
        self._url = jwks_url
        self._lock = threading.Lock()
        self._client: PyJWKClient | None = None
        self._last_refresh = 0.0

    def signing_key(self, token: str):
        client = self._ensure_client()
        try:
            return client.get_signing_key_from_jwt(token)
        except Exception:
            # An unrecognised kid is what a key rotation looks like from here.
            # Rebuild once, rate-limited, then let the second failure stand.
            if self._refresh():
                return self._ensure_client().get_signing_key_from_jwt(token)
            raise

    def _ensure_client(self) -> PyJWKClient:
        with self._lock:
            if self._client is None:
                self._client = PyJWKClient(self._url, cache_keys=True)
                self._last_refresh = time.monotonic()
            return self._client

    def _refresh(self) -> bool:
        with self._lock:
            if time.monotonic() - self._last_refresh < _JWKS_MIN_REFRESH_SECONDS:
                return False
            logger.info("clerk: refreshing JWKS after an unrecognised key id")
            self._client = PyJWKClient(self._url, cache_keys=True)
            self._last_refresh = time.monotonic()
            return True


_jwks = _JwksCache(f"{_FAPI_ORIGIN}/.well-known/jwks.json") if _FAPI_ORIGIN else None


def verify(token: str) -> ClerkIdentity | None:
    """The identity in a Clerk session token, or None if it is not usable.

    None rather than an exception for every rejection: an expired or forged
    token is an ordinary 401, not an error condition, and the caller treats
    them identically. The reason is logged at debug rather than returned,
    because handing a client the reason its token failed tells an attacker
    which half of the guess was right.
    """
    if _jwks is None:
        raise ClerkNotConfigured("CLERK_PUBLISHABLE_KEY is not set")
    if not token:
        return None

    try:
        signing_key = _jwks.signing_key(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            leeway=_LEEWAY_SECONDS,
            options={
                "require": ["exp", "sub"],
                "verify_exp": True,
                "verify_signature": True,
                # Clerk session tokens carry no `aud`, so requiring one would
                # reject every genuine token. `iss` is checked below instead,
                # which is the claim that actually pins them to our instance.
                "verify_aud": False,
            },
        )
    except Exception as exc:  # noqa: BLE001 — every failure is one 401
        logger.debug("clerk: token rejected (%s)", type(exc).__name__)
        return None

    # Pin to our own instance. Without this, a validly-signed token from any
    # other Clerk tenant would authenticate here, because they all chain to
    # keys served from their own JWKS — and ours is the only one we asked for,
    # but the issuer check is what makes that guarantee explicit rather than
    # incidental.
    issuer = str(claims.get("iss", ""))
    if issuer != _FAPI_ORIGIN:
        logger.warning("clerk: token issuer %r is not this instance", issuer[:120])
        return None

    subject = str(claims.get("sub", ""))
    if not subject.startswith("user_"):
        logger.debug("clerk: token subject is not a user id")
        return None

    return ClerkIdentity(user_id=subject, session_id=str(claims.get("sid", "")))


def fapi_origin() -> str:
    """Exposed for tests and for the CSP, which needs the same host."""
    return _FAPI_ORIGIN
