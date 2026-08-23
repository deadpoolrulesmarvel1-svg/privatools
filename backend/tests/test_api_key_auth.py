"""Tests for the optional API-key gate (require_api_key).

Covers the paths the audit flagged untested: open-by-default when no keys are
configured, the multi-key allowlist, wrong/missing-key 401s, and the non-ASCII
key path (which must be a clean 401, not a TypeError → 500).
"""

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.auth.api_key import require_api_key


def _call(api_key):
    return asyncio.run(require_api_key(api_key=api_key))


class TestApiKeyAuth:
    def test_open_when_no_keys_configured(self, monkeypatch):
        monkeypatch.delenv("PRIVATOOLS_API_KEYS", raising=False)
        assert _call(None) == "anonymous-dev"
        assert _call("anything") == "anonymous-dev"

    def test_valid_key_in_allowlist_passes(self, monkeypatch):
        monkeypatch.setenv("PRIVATOOLS_API_KEYS", "k1, k2 , k3")
        assert _call("k2") == "api-key"  # second entry, with surrounding spaces

    def test_wrong_key_is_401(self, monkeypatch):
        monkeypatch.setenv("PRIVATOOLS_API_KEYS", "k1,k2")
        with pytest.raises(HTTPException) as ei:
            _call("nope")
        assert ei.value.status_code == 401

    def test_missing_key_is_401(self, monkeypatch):
        monkeypatch.setenv("PRIVATOOLS_API_KEYS", "k1")
        with pytest.raises(HTTPException) as ei:
            _call(None)
        assert ei.value.status_code == 401

    def test_non_ascii_key_is_401_not_500(self, monkeypatch):
        # secrets.compare_digest raises TypeError on a non-ASCII str; the code
        # encodes to UTF-8 bytes first so this surfaces as a clean 401, not a 500.
        monkeypatch.setenv("PRIVATOOLS_API_KEYS", "k1")
        with pytest.raises(HTTPException) as ei:
            _call("kéy-with-ünicode-✓")
        assert ei.value.status_code == 401


def test_issuing_a_user_key_does_not_close_the_unversioned_surface(client, tmp_path):
    """The site's own frontend calls /api/*; those routes stay open.

    An earlier version gated them on "has any user issued a key yet", which
    meant the first developer account 401'd the public pipeline endpoint for
    every visitor. Metering and fail-closed behaviour live on /api/v1.
    """
    from backend.app import store
    from backend.app.auth import accounts

    store.reset_for_tests(tmp_path)
    user = accounts.create_user("gate@example.com", "a-long-enough-password")
    accounts.issue_api_key(user.id, "any key at all")

    assert client.get("/api/health").status_code == 200
    # v1 is unaffected — it refuses without a key either way.
    assert client.get("/api/v1/whoami").status_code == 401
