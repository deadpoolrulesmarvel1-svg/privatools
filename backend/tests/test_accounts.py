"""Accounts, sessions and per-user API keys.

The store is redirected to a throwaway directory per test, so nothing here
touches a real data volume and tests cannot see each other's users.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app import store  # noqa: E402
from backend.app.auth import accounts, passwords  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    store.reset_for_tests(tmp_path)
    yield
    store.reset_for_tests(tmp_path)


def _user(email: str = "dev@example.com", password: str = "a-long-enough-password"):
    return accounts.create_user(email, password)


# ── passwords ─────────────────────────────────────────────────────────────

def test_password_roundtrip_and_rejects_wrong():
    digest = passwords.hash_password("correct horse battery staple")
    assert passwords.verify("correct horse battery staple", digest)
    assert not passwords.verify("correct horse battery stapl", digest)


def test_password_length_is_enforced():
    with pytest.raises(passwords.PasswordError):
        passwords.hash_password("short")
    with pytest.raises(passwords.PasswordError):
        passwords.hash_password("x" * (passwords.MAX_PASSWORD_LENGTH + 1))


def test_password_hash_is_salted():
    a = passwords.hash_password("a-long-enough-password")
    b = passwords.hash_password("a-long-enough-password")
    assert a != b, "identical passwords must not produce identical hashes"


def test_verify_survives_a_corrupt_stored_hash():
    for junk in ("", "not-a-hash", "scrypt$bad$8$1$aa$bb", "bcrypt$1$2$3$aa$bb"):
        assert passwords.verify("whatever", junk) is False


# ── users ─────────────────────────────────────────────────────────────────

def test_email_is_case_insensitively_unique():
    _user("Dev@Example.com")
    with pytest.raises(accounts.EmailTaken):
        _user("dev@example.com")


def test_email_is_stored_as_entered_but_matched_case_insensitively():
    created = _user("Dev@Example.com")
    assert created.email == "Dev@Example.com"
    assert accounts.authenticate("DEV@EXAMPLE.COM", "a-long-enough-password") is not None


@pytest.mark.parametrize("bad", ["", "   ", "no-at-sign", "a@b", "a@@b.com", "x" * 300])
def test_invalid_emails_are_rejected(bad):
    with pytest.raises(accounts.AccountError):
        accounts.create_user(bad, "a-long-enough-password")


def test_authenticate_rejects_wrong_password_and_unknown_email():
    _user()
    assert accounts.authenticate("dev@example.com", "wrong-password-here") is None
    assert accounts.authenticate("nobody@example.com", "a-long-enough-password") is None


def test_password_is_not_recoverable_from_the_database():
    _user(password="a-long-enough-password")
    with store.read() as conn:
        row = dict(conn.execute("SELECT * FROM users").fetchone())
    assert "a-long-enough-password" not in row.values()
    assert row["password_hash"].startswith("scrypt$")


# ── sessions ──────────────────────────────────────────────────────────────

def test_session_resolves_then_stops_after_revoke():
    user = _user()
    token = accounts.create_session(user.id)
    assert accounts.resolve_session(token).id == user.id
    accounts.revoke_session(token)
    assert accounts.resolve_session(token) is None


def test_session_token_is_stored_only_as_a_hash():
    user = _user()
    token = accounts.create_session(user.id)
    with store.read() as conn:
        row = dict(conn.execute("SELECT * FROM sessions").fetchone())
    assert token not in row.values(), "a database leak must not yield a usable session"


def test_expired_sessions_do_not_resolve_and_are_purged():
    user = _user()
    token = accounts.create_session(user.id)
    with store.write() as conn:
        conn.execute(
            "UPDATE sessions SET expires_at = ? WHERE user_id = ?",
            ("2000-01-01T00:00:00+00:00", user.id),
        )
    assert accounts.resolve_session(token) is None
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"] == 0


def test_deleting_a_user_cascades_to_sessions_and_keys():
    user = _user()
    token = accounts.create_session(user.id)
    raw, _ = accounts.issue_api_key(user.id, "k")
    accounts.delete_user(user.id)
    assert accounts.resolve_session(token) is None
    assert accounts.resolve_key(raw) is None


# ── API keys ──────────────────────────────────────────────────────────────

def test_api_key_resolves_and_is_not_stored_in_the_clear():
    user = _user()
    raw, record = accounts.issue_api_key(user.id, "CI")
    assert accounts.resolve_key(raw).key_id == record.key_id
    with store.read() as conn:
        row = dict(conn.execute("SELECT * FROM api_keys").fetchone())
    assert raw not in row.values()


def test_revoked_key_stops_resolving_but_stays_listed():
    user = _user()
    raw, record = accounts.issue_api_key(user.id, "CI")
    assert accounts.revoke_key(user.id, record.key_id) is True
    assert accounts.resolve_key(raw) is None
    assert [k.revoked for k in accounts.list_keys(user.id)] == [True]


def test_a_user_cannot_revoke_another_users_key():
    owner = _user("owner@example.com")
    other = _user("other@example.com")
    raw, record = accounts.issue_api_key(owner.id, "CI")
    assert accounts.revoke_key(other.id, record.key_id) is False
    assert accounts.resolve_key(raw) is not None


def test_unknown_and_malformed_keys_resolve_to_nothing():
    _user()
    for junk in ("", "pk_nope", "not-a-key", "x" * 200):
        assert accounts.resolve_key(junk) is None


def test_active_key_count_is_capped_but_revoked_ones_free_a_slot():
    user = _user()
    records = [accounts.issue_api_key(user.id, f"k{i}")[1] for i in range(accounts.MAX_KEYS_PER_USER)]
    with pytest.raises(accounts.AccountError):
        accounts.issue_api_key(user.id, "one too many")
    accounts.revoke_key(user.id, records[0].key_id)
    assert accounts.issue_api_key(user.id, "now there is room")


def test_key_ids_are_distinct_across_keys():
    user = _user()
    ids = {accounts.issue_api_key(user.id, f"k{i}")[1].key_id for i in range(5)}
    assert len(ids) == 5


# ── schema ────────────────────────────────────────────────────────────────

def test_init_is_idempotent():
    store.init()
    store.init()
    with store.read() as conn:
        versions = [r["version"] for r in conn.execute("SELECT version FROM schema_version")]
    assert versions == sorted(v for v, _ in store.MIGRATIONS)
