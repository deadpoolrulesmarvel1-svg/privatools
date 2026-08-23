"""The webhook that stops deleted accounts leaving live API keys behind.

Clerk owns the identity, the keys live here, and nothing links them at rest.
Delete an account in Clerk without this and the keys keep authenticating and
keep spending quota for a user who no longer exists — reachable from the
account page's own delete button, so not a hypothetical.

Signatures are checked for real: the tests compute Svix HMACs the same way a
genuine delivery would, so a change that weakened the comparison would fail
here rather than passing against a stub.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import importlib
import json
import time

import pytest
from fastapi import HTTPException

SECRET_RAW = b"0123456789abcdef0123456789abcdef"
SECRET_ENV = "whsec_" + base64.b64encode(SECRET_RAW).decode()


def _sign(msg_id: str, timestamp: str, body: bytes, secret: bytes = SECRET_RAW) -> str:
    mac = hmac.new(secret, b"%s.%s.%s" % (msg_id.encode(), timestamp.encode(), body), hashlib.sha256)
    return "v1," + base64.b64encode(mac.digest()).decode()


class _Req:
    def __init__(self, body: bytes, headers: dict[str, str]):
        self._body = body
        self.headers = headers

    async def body(self) -> bytes:
        return self._body


def _delivery(event: dict, *, secret: bytes = SECRET_RAW, skew: int = 0, sig: str | None = None):
    body = json.dumps(event).encode()
    msg_id = "msg_2abc"
    ts = str(int(time.time()) + skew)
    return _Req(
        body,
        {
            "svix-id": msg_id,
            "svix-timestamp": ts,
            "svix-signature": sig if sig is not None else _sign(msg_id, ts, body, secret),
        },
    )


@pytest.fixture()
def hook(monkeypatch):
    monkeypatch.setenv("CLERK_WEBHOOK_SECRET", SECRET_ENV)
    from app.routes import clerk_webhook as mod

    importlib.reload(mod)
    deleted: list[str] = []
    monkeypatch.setattr(mod.accounts, "delete_user", lambda uid: deleted.append(uid))
    yield mod, deleted
    monkeypatch.delenv("CLERK_WEBHOOK_SECRET", raising=False)
    importlib.reload(mod)


def _call(mod, request):
    """asyncio.run rather than pytest-asyncio — the convention the rest of the
    suite already uses, and one fewer dev dependency for four coroutines."""
    return asyncio.run(mod.clerk_webhook(request))


def test_a_genuine_user_deleted_removes_the_local_data(hook):
    mod, deleted = hook
    res = _call(mod, _delivery({"type": "user.deleted", "data": {"id": "user_2abc"}}))
    assert res["handled"] == "user.deleted"
    assert deleted == ["user_2abc"], (
        "The keys survive an account deletion unless this fires. That is the "
        "entire reason the endpoint exists."
    )


def test_a_forged_signature_is_refused(hook):
    mod, deleted = hook
    bad = _delivery({"type": "user.deleted", "data": {"id": "user_2abc"}}, secret=b"wrong-secret-wrong-secret-32byte")
    with pytest.raises(HTTPException) as exc:
        _call(mod, bad)
    assert exc.value.status_code == 401
    assert deleted == []


def test_a_replayed_delivery_is_refused(hook):
    """Correctly signed, but captured and sent back much later."""
    mod, deleted = hook
    stale = _delivery({"type": "user.deleted", "data": {"id": "user_2abc"}}, skew=-3600)
    with pytest.raises(HTTPException) as exc:
        _call(mod, stale)
    assert exc.value.status_code == 400
    assert deleted == []


def test_a_tampered_body_is_refused(hook):
    """The signature covers the body, so swapping the user id must invalidate it."""
    mod, deleted = hook
    req = _delivery({"type": "user.deleted", "data": {"id": "user_victim"}})
    req._body = json.dumps({"type": "user.deleted", "data": {"id": "user_someone_else"}}).encode()
    with pytest.raises(HTTPException) as exc:
        _call(mod, req)
    assert exc.value.status_code == 401
    assert deleted == []


def test_missing_headers_are_refused(hook):
    mod, _ = hook
    with pytest.raises(HTTPException) as exc:
        _call(mod, _Req(b"{}", {}))
    assert exc.value.status_code == 400


def test_multiple_signatures_are_accepted_during_a_rotation(hook):
    """Svix sends every valid signature while a secret is being rotated."""
    mod, deleted = hook
    body = json.dumps({"type": "user.deleted", "data": {"id": "user_2abc"}}).encode()
    msg_id, ts = "msg_2abc", str(int(time.time()))
    old = _sign(msg_id, ts, body, b"an-older-secret-an-older-secret1")
    new = _sign(msg_id, ts, body)
    req = _Req(body, {"svix-id": msg_id, "svix-timestamp": ts, "svix-signature": f"{old} {new}"})
    assert (_call(mod, req))["handled"] == "user.deleted"
    assert deleted == ["user_2abc"]


def test_other_events_are_acknowledged_not_refused(hook):
    """Clerk retries on a non-2xx, so refusing what we ignore is a retry loop."""
    mod, deleted = hook
    res = _call(mod, _delivery({"type": "session.created", "data": {"id": "sess_1"}}))
    assert res == {"ok": True, "handled": None}
    assert deleted == []


def test_without_a_secret_nothing_is_accepted(monkeypatch):
    """An unverifiable webhook returning 200 looks healthy while doing nothing."""
    monkeypatch.delenv("CLERK_WEBHOOK_SECRET", raising=False)
    from app.routes import clerk_webhook as mod

    importlib.reload(mod)
    with pytest.raises(HTTPException) as exc:
        _call(mod, _delivery({"type": "user.deleted", "data": {"id": "user_2abc"}}))
    assert exc.value.status_code == 503
