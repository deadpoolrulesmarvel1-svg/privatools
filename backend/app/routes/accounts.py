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

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..auth import accounts
from ..rate_limit import limiter

router = APIRouter()
logger = logging.getLogger(__name__)

SESSION_COOKIE = "pt_session"
CREDENTIAL_RATE_LIMIT = os.environ.get("RATE_LIMIT_CREDENTIALS", "10/minute")


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
        user = accounts.create_user(body.email, body.password)
    except accounts.EmailTaken as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except accounts.AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_session_cookie(response, accounts.create_session(user.id))
    return {"user": _public(user)}


@router.post("/auth/login")
@limiter.limit(CREDENTIAL_RATE_LIMIT)
async def login(request: Request, response: Response, body: Credentials):
    user = accounts.authenticate(body.email, body.password)
    if user is None:
        # One message for both causes: a distinct "no such account" reply turns
        # this endpoint into an email-enumeration oracle.
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
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
