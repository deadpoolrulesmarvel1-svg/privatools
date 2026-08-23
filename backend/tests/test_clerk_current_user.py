"""With Clerk configured, the session cookie must stop working.

Falling back to the cookie when a bearer token is absent would be the obvious
thing to write and the wrong thing to ship: a deployment that believes it has
moved to Clerk would still be reachable through the auth path it thinks it
retired, and every account that existed before the migration would still be a
way in. So Clerk, once configured, is the only thing consulted.

The mirror case matters too — a deployment with no Clerk key must keep using
cookies exactly as before, because that is what self-hosting relies on.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi import HTTPException


class _Req:
    """Only the two things current_user reads."""

    def __init__(self, *, bearer: str = "", cookie: str = ""):
        self.headers = {"authorization": f"Bearer {bearer}"} if bearer else {}
        self.cookies = {"pt_session": cookie} if cookie else {}


@pytest.fixture()
def routes_with_clerk(monkeypatch):
    import base64

    monkeypatch.setenv(
        "CLERK_PUBLISHABLE_KEY",
        "pk_test_" + base64.b64encode(b"climbing-reindeer-9195.clerk.accounts.dev$").decode(),
    )
    from app.auth import clerk_session
    from app.routes import accounts as routes

    importlib.reload(clerk_session)
    importlib.reload(routes)
    yield routes, clerk_session
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    importlib.reload(clerk_session)
    importlib.reload(routes)


def test_a_verified_token_identifies_the_user(routes_with_clerk, monkeypatch):
    routes, clerk_session = routes_with_clerk
    monkeypatch.setattr(
        routes.clerk_session,
        "verify",
        lambda _t: clerk_session.ClerkIdentity(user_id="user_abc", session_id="sess_1"),
    )
    user = routes.current_user(_Req(bearer="good-token"))
    assert user.id == "user_abc", (
        "The Clerk user id must be what api_keys is keyed on — both tables hold "
        "a text id and never cared where it came from, which is why no local "
        "row has to exist for a key to have an owner."
    )


def test_no_token_is_a_401(routes_with_clerk, monkeypatch):
    routes, _ = routes_with_clerk
    monkeypatch.setattr(routes.clerk_session, "verify", lambda _t: None)
    with pytest.raises(HTTPException) as exc:
        routes.current_user(_Req())
    assert exc.value.status_code == 401


def test_the_old_session_cookie_no_longer_gets_in(routes_with_clerk, monkeypatch):
    """The point of the whole exercise."""
    routes, _ = routes_with_clerk
    monkeypatch.setattr(routes.clerk_session, "verify", lambda _t: None)

    def _should_not_run(_token):
        raise AssertionError(
            "current_user consulted the local session store while Clerk was "
            "configured. The retired auth path must not stay reachable."
        )

    monkeypatch.setattr(routes.accounts, "resolve_session", _should_not_run)
    with pytest.raises(HTTPException) as exc:
        routes.current_user(_Req(cookie="a-previously-valid-session"))
    assert exc.value.status_code == 401


def test_without_clerk_the_cookie_still_works(monkeypatch):
    """Self-hosting depends on this half."""
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    from app.auth import accounts as auth_accounts
    from app.auth import clerk_session
    from app.routes import accounts as routes

    importlib.reload(clerk_session)
    importlib.reload(routes)
    assert not routes.clerk_session.is_configured()

    monkeypatch.setattr(
        routes.accounts,
        "resolve_session",
        lambda token: auth_accounts.User(id="local_1", email="a@b.test", created_at="2026-01-01")
        if token == "valid"
        else None,
    )
    assert routes.current_user(_Req(cookie="valid")).id == "local_1"
    with pytest.raises(HTTPException):
        routes.current_user(_Req(cookie="wrong"))
