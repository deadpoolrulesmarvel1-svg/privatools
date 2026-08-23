"""Password hashing.

``hashlib.scrypt`` rather than a dependency: it is stdlib, memory-hard, and
what a password needs. Adding passlib/argon2 would mean regenerating a
hash-pinned lockfile and taking on supply-chain surface for something already
present.

Stored format is self-describing so the parameters can be raised later without
invalidating existing hashes:

    scrypt$n$r$p$<salt-hex>$<hash-hex>

:func:`needs_rehash` reports when a stored hash was made with weaker parameters
than the current ones, so a login can transparently upgrade it.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

# ~64 MB per hash (128 * N * r). Comfortable on the 4 GB container while making
# offline cracking expensive. Raise N (not r) to increase cost later.
SCRYPT_N = 2 ** 16
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_LEN = 32

# scrypt needs maxmem raised above the default or it refuses these parameters.
_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 1024  # hashing is memory-hard; an unbounded input is a DoS


class PasswordError(ValueError):
    """The supplied password is not acceptable."""


def validate(password: str) -> None:
    """Raise :class:`PasswordError` if the password cannot be used.

    Length only. Composition rules (a digit, a symbol, a capital) push people
    toward `Password1!` and are not what makes a password strong; length is.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise PasswordError("Password is too long.")


def hash_password(password: str) -> str:
    validate(password)
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=KEY_LEN, maxmem=_MAXMEM,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify(password: str, stored: str) -> bool:
    """Constant-time check of a password against a stored hash."""
    try:
        scheme, n_s, r_s, p_s, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, AttributeError):
        return False

    try:
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt,
            n=n, r=r, p=p, dklen=len(expected), maxmem=128 * n * r * 2,
        )
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str) -> bool:
    """True when `stored` used weaker parameters than we now use."""
    try:
        scheme, n_s, r_s, p_s, _, _ = stored.split("$")
    except ValueError:
        return True
    if scheme != "scrypt":
        return True
    return (int(n_s), int(r_s), int(p_s)) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)
