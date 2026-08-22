"""HTTP behaviour of the account and API-key endpoints.

Covers the things that are easy to get wrong at the edge rather than in the
model: cookie flags, which errors leak information, and whether one user can
reach another's keys.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app import store  # noqa: E402
from backend.app.routes.accounts import SESSION_COOKIE  # noqa: E402

CREDS = {"email": "dev@example.com", "password": "a-long-enough-password"}


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    store.reset_for_tests(tmp_path)
    yield
    store.reset_for_tests(tmp_path)


def _register(client, **overrides):
    return client.post("/api/auth/register", json={**CREDS, **overrides})


def test_register_signs_the_user_in_and_sets_an_httponly_cookie(client):
    res = _register(client)
    assert res.status_code == 200
    assert res.json()["user"]["email"] == CREDS["email"]

    raw = res.headers.get("set-cookie", "")
    assert SESSION_COOKIE in raw
    assert "HttpOnly" in raw, "session cookie must be unreadable from script"
    assert "samesite=lax" in raw.lower()


def test_register_never_returns_the_password_or_its_hash(client):
    body = _register(client).text
    assert CREDS["password"] not in body
    assert "scrypt$" not in body


def test_duplicate_registration_is_a_conflict(client):
    _register(client)
    assert _register(client).status_code == 409


def test_short_password_is_rejected(client):
    assert _register(client, password="short").status_code == 400


def test_login_succeeds_then_me_returns_the_user(client):
    _register(client)
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json=CREDS).status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email"] == CREDS["email"]


def test_wrong_password_and_unknown_email_give_the_same_reply(client):
    _register(client)
    wrong = client.post("/api/auth/login", json={**CREDS, "password": "not-the-password"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com",
                                                   "password": "a-long-enough-password"})
    assert wrong.status_code == unknown.status_code == 401
    # A different message for each would turn this into an enumeration oracle.
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_me_requires_a_session(client):
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401


def test_logout_invalidates_the_session(client):
    _register(client)
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


def test_key_is_returned_once_and_then_only_as_metadata(client):
    _register(client)
    created = client.post("/api/keys", json={"label": "CI"})
    assert created.status_code == 200
    raw = created.json()["key"]
    assert raw.startswith("pk_")

    listed = client.get("/api/keys").json()["keys"]
    assert [k["label"] for k in listed] == ["CI"]
    assert raw not in client.get("/api/keys").text, "the raw key must never be listed again"


def test_key_endpoints_require_a_session(client):
    client.cookies.clear()
    assert client.get("/api/keys").status_code == 401
    assert client.post("/api/keys", json={"label": "x"}).status_code == 401


def test_revoking_someone_elses_key_is_a_404(client):
    _register(client)
    key_id = client.post("/api/keys", json={"label": "owner key"}).json()["record"]["key_id"]
    client.post("/api/auth/logout")

    _register(client, email="other@example.com")
    assert client.delete(f"/api/keys/{key_id}").status_code == 404


def test_revoke_marks_the_key_revoked(client):
    _register(client)
    key_id = client.post("/api/keys", json={"label": "CI"}).json()["record"]["key_id"]
    assert client.delete(f"/api/keys/{key_id}").status_code == 200
    assert client.get("/api/keys").json()["keys"][0]["revoked"] is True


def test_deleting_the_account_ends_the_session(client):
    _register(client)
    assert client.delete("/api/auth/me").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
