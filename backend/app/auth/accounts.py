"""User accounts, sessions and per-user API keys.

Accounts exist to issue and manage API keys. Tool endpoints stay usable with no
account — see ``docs`` and the privacy policy for what that means for the
product's claims.

Three secrets are handled here and none is stored in the clear:

* **Passwords** — scrypt, via :mod:`.passwords`.
* **Session tokens** — only ``sha256(token)`` is stored. A database leak cannot
  be replayed as a login.
* **API keys** — the raw key is shown exactly once, at creation. Stored are
  ``key_id`` (a public handle safe for logs, quotas and metrics) and a hash of
  the secret. This matches the interface the API foundation spec defined:
  ``resolve_key(raw) -> KeyRecord``.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .. import store
from . import passwords

logger = logging.getLogger(__name__)

SESSION_TTL = timedelta(days=30)
SESSION_TOKEN_BYTES = 32
API_KEY_BYTES = 24
API_KEY_PREFIX = "pk_"
MAX_KEYS_PER_USER = 10
MAX_EMAIL_LENGTH = 254  # RFC 5321

# Deliberately permissive: the only authority on whether an address works is
# whether mail reaches it. A strict pattern rejects valid addresses.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

# Verifying against this when no user matches keeps registered and unregistered
# addresses indistinguishable by response time.
DUMMY_HASH = passwords.hash_password("timing-equalisation-placeholder")


class AccountError(ValueError):
    """A request that cannot be satisfied, with a user-safe message."""


class EmailTaken(AccountError):
    pass


@dataclass(frozen=True)
class User:
    id: str
    email: str
    created_at: str


@dataclass(frozen=True)
class KeyRecord:
    """The shape the API foundation's quota layer expects."""
    key_id: str
    user_id: str
    label: str
    created_at: str
    last_used_at: str | None
    revoked: bool


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha256(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalise_email(email: str) -> str:
    cleaned = (email or "").strip()
    if len(cleaned) > MAX_EMAIL_LENGTH or not _EMAIL_RE.match(cleaned):
        raise AccountError("Enter a valid email address.")
    return cleaned


def _row_to_user(row: sqlite3.Row) -> User:
    return User(id=row["id"], email=row["email"], created_at=row["created_at"])


# ── users ─────────────────────────────────────────────────────────────────

def validate_password(password: str) -> None:
    """Check a password before anything expensive happens to it."""
    try:
        passwords.validate(password)
    except passwords.PasswordError as exc:
        # One error type for all bad user input — a PasswordError escaping to a
        # route becomes a 500 instead of a 400.
        raise AccountError(str(exc)) from exc


def create_user_with_hash(email: str, password_hash: str, recovery_hash: str) -> User:
    """Store a new account. Hashing happens in the caller, off the event loop.

    Split from `create_user` because scrypt takes 156 ms and 64 MB: doing it
    inline in an async route stalled the worker for every other request,
    including file tools. See auth/hashing_pool.
    """
    store.init()
    address = normalise_email(email)
    user_id = uuid.uuid4().hex
    created = _now()
    try:
        with store.write() as conn:
            conn.execute(
                "INSERT INTO users (id, email, email_lower, password_hash, created_at, recovery_hash)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, address, address.lower(), password_hash, created, recovery_hash),
            )
    except sqlite3.IntegrityError as exc:
        raise EmailTaken("An account with that email already exists.") from exc
    logger.info("accounts: created user %s", user_id)
    return User(id=user_id, email=address, created_at=created)


def credentials_for(email: str) -> tuple[str, str] | None:
    """`(user_id, password_hash)` for an address, or None."""
    store.init()
    try:
        address = normalise_email(email)
    except AccountError:
        return None
    with store.read() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE email_lower = ?", (address.lower(),)
        ).fetchone()
    return (row["id"], row["password_hash"]) if row else None


def record_login(user_id: str, new_hash: str | None = None) -> None:
    store.init()
    with store.write() as conn:
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), user_id))
        if new_hash:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))


def create_user(email: str, password: str) -> User:
    """Synchronous convenience wrapper. Routes use the async path instead."""
    validate_password(password)
    user = create_user_with_hash(
        email, passwords.hash_password(password), passwords.hash_password(normalise_recovery_code(new_recovery_code())),
    )
    return user


def authenticate(email: str, password: str) -> User | None:
    """Return the user when the credentials match, else ``None``.

    Always performs one password verification, so a missing account and a wrong
    password take the same time and cannot be told apart.
    """
    store.init()
    try:
        address = normalise_email(email)
    except AccountError:
        passwords.verify(password, DUMMY_HASH)
        return None

    with store.read() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email_lower = ?", (address.lower(),)
        ).fetchone()

    if row is None:
        passwords.verify(password, DUMMY_HASH)
        return None
    if not passwords.verify(password, row["password_hash"]):
        return None

    updates: list[tuple[str, str]] = [("last_login_at", _now())]
    if passwords.needs_rehash(row["password_hash"]):
        updates.append(("password_hash", passwords.hash_password(password)))
    with store.write() as conn:
        for column, value in updates:
            conn.execute(f"UPDATE users SET {column} = ? WHERE id = ?", (value, row["id"]))
    return _row_to_user(row)


def get_user(user_id: str) -> User | None:
    store.init()
    with store.read() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None


def delete_user(user_id: str) -> None:
    """Remove the account. Sessions and keys cascade."""
    store.init()
    with store.write() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    logger.info("accounts: deleted user %s", user_id)


# ── sessions ──────────────────────────────────────────────────────────────

def create_session(user_id: str) -> str:
    """Issue a session token. Only its hash is stored; this is the only copy."""
    store.init()
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    now = datetime.now(timezone.utc)
    with store.write() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (
                _sha256(token), user_id,
                now.isoformat(timespec="seconds"),
                (now + SESSION_TTL).isoformat(timespec="seconds"),
            ),
        )
    return token


def resolve_session(token: str) -> User | None:
    if not token:
        return None
    store.init()
    with store.read() as conn:
        row = conn.execute(
            "SELECT s.expires_at, u.* FROM sessions s"
            " JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash = ?",
            (_sha256(token),),
        ).fetchone()
    if row is None:
        return None
    if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
        revoke_session(token)
        return None
    return _row_to_user(row)


def revoke_session(token: str) -> None:
    store.init()
    with store.write() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha256(token),))


def revoke_all_sessions(user_id: str) -> int:
    store.init()
    with store.write() as conn:
        cur = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return cur.rowcount


def purge_expired_sessions() -> int:
    """Drop expired rows. Called by the cleanup janitor."""
    store.init()
    with store.write() as conn:
        cur = conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?",
            (datetime.now(timezone.utc).isoformat(timespec="seconds"),),
        )
        return cur.rowcount


# ── API keys ──────────────────────────────────────────────────────────────

def issue_api_key(user_id: str, label: str) -> tuple[str, KeyRecord]:
    """Create a key. Returns ``(raw_key, record)`` — the raw key is never
    retrievable again."""
    store.init()
    clean_label = (label or "").strip()[:64] or "Untitled key"
    with store.read() as conn:
        live = conn.execute(
            "SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL",
            (user_id,),
        ).fetchone()["n"]
    if live >= MAX_KEYS_PER_USER:
        raise AccountError(
            f"You can have at most {MAX_KEYS_PER_USER} active keys. Revoke one first."
        )

    raw = API_KEY_PREFIX + secrets.token_urlsafe(API_KEY_BYTES)
    key_id = _sha256(raw)[:16]      # the public handle, per the API spec
    created = _now()
    with store.write() as conn:
        conn.execute(
            "INSERT INTO api_keys (key_id, key_hash, user_id, label, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (key_id, _sha256(raw), user_id, clean_label, created),
        )
    return raw, KeyRecord(key_id, user_id, clean_label, created, None, False)


def resolve_key(raw: str) -> KeyRecord | None:
    """Look up a raw API key. The interface the API foundation spec named."""
    if not raw:
        return None
    store.init()
    digest = _sha256(raw)
    with store.read() as conn:
        row = conn.execute(
            "SELECT * FROM api_keys WHERE key_id = ?", (digest[:16],)
        ).fetchone()
    if row is None or not hmac.compare_digest(row["key_hash"], digest):
        return None
    if row["revoked_at"] is not None:
        return None
    return KeyRecord(
        key_id=row["key_id"], user_id=row["user_id"], label=row["label"],
        created_at=row["created_at"], last_used_at=row["last_used_at"], revoked=False,
    )


def touch_key(key_id: str) -> None:
    store.init()
    with store.write() as conn:
        conn.execute("UPDATE api_keys SET last_used_at = ? WHERE key_id = ?", (_now(), key_id))


def list_keys(user_id: str) -> list[KeyRecord]:
    store.init()
    with store.read() as conn:
        rows = conn.execute(
            "SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [
        KeyRecord(r["key_id"], r["user_id"], r["label"], r["created_at"],
                  r["last_used_at"], r["revoked_at"] is not None)
        for r in rows
    ]


def revoke_key(user_id: str, key_id: str) -> bool:
    store.init()
    with store.write() as conn:
        cur = conn.execute(
            "UPDATE api_keys SET revoked_at = ?"
            " WHERE key_id = ? AND user_id = ? AND revoked_at IS NULL",
            (_now(), key_id, user_id),
        )
        return cur.rowcount > 0

# ── recovery codes ────────────────────────────────────────────────────────
#
# There is no email to send a reset link to — the product does not send email
# at all, and adding an SMTP dependency to support one flow is the wrong trade.
# A recovery code, shown once at signup, is the way back in. It is a secret, so
# only its hash is stored, exactly like a password.

RECOVERY_GROUPS = 4
RECOVERY_GROUP_LEN = 5
# No I, O, 0 or 1: this gets written down and typed back, and those are the
# characters people get wrong.
RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_recovery_code() -> str:
    groups = [
        "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(RECOVERY_GROUP_LEN))
        for _ in range(RECOVERY_GROUPS)
    ]
    return "-".join(groups)


def normalise_recovery_code(raw: str) -> str:
    """Accept it however it was typed — spacing, case and dashes vary."""
    return "".join(ch for ch in (raw or "").upper() if ch in RECOVERY_ALPHABET)


def recovery_hash_for(email: str) -> tuple[str, str] | None:
    """`(user_id, recovery_hash)` for an address, or None."""
    store.init()
    try:
        address = normalise_email(email)
    except AccountError:
        return None
    with store.read() as conn:
        row = conn.execute(
            "SELECT id, recovery_hash FROM users WHERE email_lower = ?", (address.lower(),)
        ).fetchone()
    if row is None or not row["recovery_hash"]:
        return None
    return (row["id"], row["recovery_hash"])


def apply_recovery(user_id: str, password_hash: str, recovery_hash: str) -> None:
    """Set a new password and a fresh recovery code, and end every session.

    Ending sessions matters: if the account was reached because the old password
    leaked, whoever had it must not keep a live session.
    """
    store.init()
    with store.write() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, recovery_hash = ?, recovery_used_at = ?"
            " WHERE id = ?",
            (password_hash, recovery_hash, _now(), user_id),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    logger.info("accounts: recovery applied for user %s", user_id)


def change_password(user_id: str, password_hash: str, keep_token: str | None = None) -> None:
    """Set a new password and drop other sessions, keeping the current one."""
    store.init()
    with store.write() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        if keep_token:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, _sha256(keep_token)),
            )
        else:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


# ── login throttling ──────────────────────────────────────────────────────
#
# The per-IP limiter does not stop someone spreading guesses for one account
# across many addresses, which is exactly how credential stuffing works.

MAX_FAILURES = 8
LOCKOUT = timedelta(minutes=15)


def login_locked_until(email: str) -> datetime | None:
    store.init()
    try:
        address = normalise_email(email).lower()
    except AccountError:
        return None
    with store.read() as conn:
        row = conn.execute(
            "SELECT locked_until FROM login_attempts WHERE email_lower = ?", (address,)
        ).fetchone()
    if not row or not row["locked_until"]:
        return None
    until = datetime.fromisoformat(row["locked_until"])
    return until if until > datetime.now(timezone.utc) else None


def record_login_failure(email: str) -> None:
    store.init()
    try:
        address = normalise_email(email).lower()
    except AccountError:
        return
    with store.write() as conn:
        row = conn.execute(
            "SELECT failures FROM login_attempts WHERE email_lower = ?", (address,)
        ).fetchone()
        failures = (row["failures"] if row else 0) + 1
        locked = (
            (datetime.now(timezone.utc) + LOCKOUT).isoformat(timespec="seconds")
            if failures >= MAX_FAILURES else None
        )
        conn.execute(
            "INSERT INTO login_attempts (email_lower, failures, locked_until) VALUES (?, ?, ?)"
            " ON CONFLICT(email_lower) DO UPDATE SET failures = ?, locked_until = ?",
            (address, failures, locked, failures, locked),
        )


def clear_login_failures(email: str) -> None:
    store.init()
    try:
        address = normalise_email(email).lower()
    except AccountError:
        return
    with store.write() as conn:
        conn.execute("DELETE FROM login_attempts WHERE email_lower = ?", (address,))
