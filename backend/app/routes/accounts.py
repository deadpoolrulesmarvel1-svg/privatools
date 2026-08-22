"""Account and API-key endpoints.

Accounts exist so a developer can issue and manage API keys. The tool endpoints
themselves remain usable without one.

The session cookie is `HttpOnly` (script cannot read it), `SameSite=Lax` (not
sent on cross-site POSTs) and `Secure` outside development. Combined with a
JSON-only body — a cross-origin form cannot set `application/json` without
clearing a CORS preflight — that covers CSRF without a token round-trip.

Credential endpoints are rate-limited harder than the global default: these are
the routes worth guessing at.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..auth import accounts
from ..auth import hashing_pool
from ..rate_limit import limiter

router = APIRouter()
logger = logging.getLogger(__name__)

SESSION_COOKIE = "pt_session"
CREDENTIAL_RATE_LIMIT = os.environ.get("RATE_LIMIT_CREDENTIALS", "10/minute")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _secure_cookies() -> bool:
    return os.environ.get("ENVIRONMENT", "development").lower() == "production"


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=int(accounts.SESSION_TTL.total_seconds()),
        httponly=True, samesite="lax", secure=_secure_cookies(), path="/",
    )


class Credentials(BaseModel):
    email: str = Field(max_length=accounts.MAX_EMAIL_LENGTH)
    password: str = Field(max_length=1024)


class RecoveryRequest(BaseModel):
    email: str = Field(max_length=accounts.MAX_EMAIL_LENGTH)
    recovery_code: str = Field(max_length=64)
    new_password: str = Field(max_length=1024)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


class KeyRequest(BaseModel):
    label: str = Field(default="", max_length=64)


def current_user(request: Request) -> accounts.User:
    """Dependency: the signed-in user, or 401."""
    user = accounts.resolve_session(request.cookies.get(SESSION_COOKIE, ""))
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def _public(user: accounts.User) -> dict:
    return {"id": user.id, "email": user.email, "created_at": user.created_at}


@router.post("/auth/register")
@limiter.limit(CREDENTIAL_RATE_LIMIT)
async def register(request: Request, response: Response, body: Credentials):
    try:
        accounts.normalise_email(body.email)
        accounts.validate_password(body.password)
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Hashing is 156 ms and 64 MB; run it off the event loop and under a bound.
    recovery_code = accounts.new_recovery_code()
    password_hash = await hashing_pool.hash_password(body.password)
    # Hash the normalised form: the code is verified after stripping
    # spacing, case and dashes, so it has to be stored that way too.
    recovery_hash = await hashing_pool.hash_password(
        accounts.normalise_recovery_code(recovery_code))

    try:
        user = accounts.create_user_with_hash(body.email, password_hash, recovery_hash)
    except accounts.EmailTaken as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _set_session_cookie(response, accounts.create_session(user.id))
    # Returned exactly once. There is no email to resend it to, so the UI has to
    # make the user save it before moving on.
    return {"user": _public(user), "recovery_code": recovery_code}


@router.post("/auth/login")
@limiter.limit(CREDENTIAL_RATE_LIMIT)
async def login(request: Request, response: Response, body: Credentials):
    # Per-account, because the per-IP limiter does not stop guesses for one
    # account spread across many addresses.
    locked = accounts.login_locked_until(body.email)
    if locked:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again shortly.",
            headers={"Retry-After": str(max(1, int((locked - _utcnow()).total_seconds())))},
        )

    found = accounts.credentials_for(body.email)
    # Always verify once, even with no account, so the two cases cannot be told
    # apart by response time.
    stored = found[1] if found else accounts.DUMMY_HASH
    ok = await hashing_pool.verify(body.password, stored)

    if not found or not ok:
        accounts.record_login_failure(body.email)
        # One message for both causes: a distinct "no such account" reply turns
        # this endpoint into an email-enumeration oracle.
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")

    user_id = found[0]
    accounts.clear_login_failures(body.email)
    new_hash = (
        await hashing_pool.hash_password(body.password)
        if accounts.passwords.needs_rehash(stored) else None
    )
    accounts.record_login(user_id, new_hash)

    user = accounts.get_user(user_id)
    _set_session_cookie(response, accounts.create_session(user.id))
    return {"user": _public(user)}


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        accounts.revoke_session(token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
async def me(user: accounts.User = Depends(current_user)):
    return {"user": _public(user)}


@router.delete("/auth/me")
async def delete_account(response: Response, user: accounts.User = Depends(current_user)):
    accounts.delete_user(user.id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.post("/auth/recover")
@limiter.limit(CREDENTIAL_RATE_LIMIT)
async def recover(request: Request, response: Response, body: RecoveryRequest):
    """Reset a password with the recovery code issued at signup.

    This is the only way back into an account: the product sends no email, so
    there is no reset link. A wrong code is rate-limited and answered with the
    same message as a wrong address, so this cannot be used to test which
    addresses are registered.
    """
    try:
        accounts.validate_password(body.new_password)
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    found = accounts.recovery_hash_for(body.email)
    stored = found[1] if found else accounts.DUMMY_HASH
    supplied = accounts.normalise_recovery_code(body.recovery_code)
    ok = await hashing_pool.verify(supplied, stored) if supplied else False

    if not found or not ok:
        accounts.record_login_failure(body.email)
        raise HTTPException(status_code=401, detail="That recovery code does not match.")

    # A used code is spent. Issuing a fresh one keeps the account recoverable
    # next time without another round trip.
    next_code = accounts.new_recovery_code()
    accounts.apply_recovery(
        found[0],
        await hashing_pool.hash_password(body.new_password),
        await hashing_pool.hash_password(accounts.normalise_recovery_code(next_code)),
    )
    accounts.clear_login_failures(body.email)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True, "recovery_code": next_code}


@router.post("/auth/password")
@limiter.limit(CREDENTIAL_RATE_LIMIT)
async def change_password(
    request: Request,
    body: PasswordChange,
    user: accounts.User = Depends(current_user),
):
    """Change the password of the signed-in account.

    Other sessions are dropped and this one is kept, which is what someone
    changing a password because it may have leaked actually wants.
    """
    try:
        accounts.validate_password(body.new_password)
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    found = accounts.credentials_for(user.email)
    if not found or not await hashing_pool.verify(body.current_password, found[1]):
        raise HTTPException(status_code=401, detail="Your current password is incorrect.")

    accounts.change_password(
        user.id,
        await hashing_pool.hash_password(body.new_password),
        keep_token=request.cookies.get(SESSION_COOKIE, ""),
    )
    return {"ok": True}


@router.get("/keys")
async def list_keys(user: accounts.User = Depends(current_user)):
    return {
        "keys": [
            {"key_id": k.key_id, "label": k.label, "created_at": k.created_at,
             "last_used_at": k.last_used_at, "revoked": k.revoked}
            for k in accounts.list_keys(user.id)
        ]
    }


@router.post("/keys")
async def create_key(body: KeyRequest, user: accounts.User = Depends(current_user)):
    try:
        raw, record = accounts.issue_api_key(user.id, body.label)
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # `key` is returned exactly once — it is not recoverable afterwards.
    return {
        "key": raw,
        "record": {"key_id": record.key_id, "label": record.label,
                   "created_at": record.created_at, "revoked": False},
    }


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: str, user: accounts.User = Depends(current_user)):
    if not accounts.revoke_key(user.id, key_id):
        raise HTTPException(status_code=404, detail="No such active key")
    return {"ok": True}
