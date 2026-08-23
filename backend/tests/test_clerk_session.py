"""Clerk token verification, exercised against real RS256 signatures.

Auth bugs live exactly here — in the difference between "the signature parses"
and "this token was issued by our instance, for a user, and is still valid" —
so these sign genuine tokens with a throwaway key pair rather than stubbing the
verification out. A test that mocks jwt.decode would pass no matter what this
module got wrong.

The case worth naming is cross-tenant. Every Clerk instance signs with its own
keys, so a token from a stranger's Clerk tenant is perfectly valid — just not
to us. The issuer check is the only thing standing between that token and an
authenticated request here.
"""

from __future__ import annotations

import base64
import importlib
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

FAPI_HOST = "climbing-reindeer-9195.clerk.accounts.dev"
FAPI_ORIGIN = f"https://{FAPI_HOST}"
KID = "test-key-1"


def _publishable_key(host: str = FAPI_HOST) -> str:
    return "pk_test_" + base64.b64encode(f"{host}$".encode()).decode()


@pytest.fixture(scope="module")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture()
def clerk(monkeypatch, keypair):
    """clerk_session configured for our instance, with JWKS fetching stubbed.

    Only the network is faked. Signing, parsing, signature checking, expiry and
    the issuer comparison all run for real.
    """
    private, public = keypair
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", _publishable_key())

    from app.auth import clerk_session as mod

    importlib.reload(mod)
    assert mod.is_configured(), "fixture failed to configure Clerk"

    class _StubKey:
        key = public

    monkeypatch.setattr(mod._jwks, "signing_key", lambda _token: _StubKey())
    yield mod, private
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    importlib.reload(mod)


def _token(private, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": FAPI_ORIGIN,
        "sub": "user_2abcDEF",
        "sid": "sess_123",
        "exp": now + 60,
        "iat": now,
        **overrides,
    }
    for key in [k for k, v in claims.items() if v is None]:
        del claims[key]
    return jwt.encode(claims, private, algorithm="RS256", headers={"kid": KID})


def test_a_genuine_token_is_accepted(clerk):
    mod, private = clerk
    identity = mod.verify(_token(private))
    assert identity is not None
    assert identity.user_id == "user_2abcDEF"
    assert identity.session_id == "sess_123"


def test_an_expired_token_is_rejected(clerk):
    mod, private = clerk
    now = int(time.time())
    assert mod.verify(_token(private, exp=now - 120, iat=now - 300)) is None


def test_a_token_from_another_clerk_tenant_is_rejected(clerk):
    """Correctly signed, genuinely issued — to somebody else."""
    mod, private = clerk
    other = mod.verify(_token(private, iss="https://someone-else.clerk.accounts.dev"))
    assert other is None, (
        "A token from a different Clerk instance authenticated here. Every "
        "tenant signs with its own keys, so the issuer claim is what makes "
        "this our token rather than merely a valid one."
    )


def test_a_token_signed_by_someone_else_is_rejected(clerk):
    mod, _private = clerk
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert mod.verify(_token(attacker)) is None


def test_a_token_without_a_subject_is_rejected(clerk):
    mod, private = clerk
    assert mod.verify(_token(private, sub=None)) is None


def test_a_subject_that_is_not_a_user_is_rejected(clerk):
    """Clerk ids are prefixed by type; only a user may hold API keys."""
    mod, private = clerk
    assert mod.verify(_token(private, sub="org_2abcDEF")) is None
    assert mod.verify(_token(private, sub="sess_2abcDEF")) is None


def test_garbage_is_rejected_without_raising(clerk):
    mod, _ = clerk
    for junk in ("", "not-a-token", "a.b.c", "Bearer x"):
        assert mod.verify(junk) is None


def test_none_algorithm_is_rejected(clerk):
    """The classic JWT forgery: drop the signature and claim alg=none."""
    mod, _ = clerk
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "kid": KID}).encode()).rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"iss": FAPI_ORIGIN, "sub": "user_x", "exp": int(time.time()) + 60}).encode()
    ).rstrip(b"=")
    assert mod.verify(f"{header.decode()}.{payload.decode()}.") is None


def test_unconfigured_deployments_refuse_rather_than_pretend(monkeypatch):
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    from app.auth import clerk_session as mod

    importlib.reload(mod)
    assert not mod.is_configured()
    with pytest.raises(mod.ClerkNotConfigured):
        mod.verify("anything")


def test_a_doctored_publishable_key_cannot_point_us_at_another_host(monkeypatch):
    from app.auth import clerk_session as mod

    for bad in (
        _publishable_key("evil.example.com"),
        _publishable_key("clerk.accounts.dev.evil.com"),
        "pk_test_not-base64!!",
        "",
    ):
        assert mod._fapi_origin(bad) == "", f"{bad[:24]!r} should not resolve to an origin"
    assert mod._fapi_origin(_publishable_key()) == FAPI_ORIGIN
