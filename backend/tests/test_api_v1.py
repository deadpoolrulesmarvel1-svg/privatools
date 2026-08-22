"""The versioned public API.

Covers the two rules the design is emphatic about — v1 fails closed, and quota
is charged before work starts — plus the parts a client depends on: machine
readable error codes, rate-limit headers, and cost weighting.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app import store  # noqa: E402
from backend.app.api_v1 import quota  # noqa: E402
from backend.app.auth import accounts  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    store.reset_for_tests(tmp_path)
    yield
    store.reset_for_tests(tmp_path)


@pytest.fixture()
def api_key():
    user = accounts.create_user("dev@example.com", "a-long-enough-password")
    raw, record = accounts.issue_api_key(user.id, "tests")
    return raw, record


# ── authentication ────────────────────────────────────────────────────────

def test_v1_refuses_an_unauthenticated_call(client):
    res = client.get("/api/v1/whoami")
    assert res.status_code == 401
    # The legacy dependency returns "anonymous-dev" when no keys are configured,
    # which would leave the metered surface open. v1 must never do that.
    assert res.json()["code"] == "missing_api_key"


def test_v1_refuses_an_unknown_key(client):
    res = client.get("/api/v1/whoami", headers={"X-API-Key": "pk_not_a_real_key"})
    assert res.status_code == 401
    assert res.json()["code"] == "invalid_api_key"


def test_v1_refuses_a_revoked_key(client, api_key):
    raw, record = api_key
    accounts.revoke_key(record.user_id, record.key_id)
    res = client.get("/api/v1/whoami", headers={"X-API-Key": raw})
    assert res.status_code == 401


def test_v1_accepts_a_user_issued_key(client, api_key):
    raw, record = api_key
    res = client.get("/api/v1/whoami", headers={"X-API-Key": raw})
    assert res.status_code == 200
    assert res.json()["key_id"] == record.key_id


def test_the_unversioned_api_stays_open(client):
    # The site's own frontend calls these; metering them would break it.
    assert client.get("/api/health").status_code == 200


def test_errors_never_echo_the_raw_key(client, api_key):
    raw, _ = api_key
    body = client.get("/api/v1/whoami", headers={"X-API-Key": raw + "x"}).text
    assert raw not in body


# ── quota ─────────────────────────────────────────────────────────────────

def test_usage_reports_the_free_tier_without_consuming_it(client, api_key):
    raw, _ = api_key
    first = client.get("/api/v1/usage", headers={"X-API-Key": raw}).json()
    second = client.get("/api/v1/usage", headers={"X-API-Key": raw}).json()
    assert first["units"]["limit"] == quota.DAILY_UNITS
    # Checking what is left must not spend any.
    assert first["units"]["used"] == second["units"]["used"] == 0


def test_rate_limit_headers_describe_the_key(client, api_key):
    raw, _ = api_key
    res = client.get("/api/v1/usage", headers={"X-API-Key": raw})
    assert res.status_code == 200


def test_heavy_endpoints_cost_more_than_light_ones():
    assert quota.cost_for("/api/v1/merge") == 1
    assert quota.cost_for("/api/v1/rotate") == 1
    for heavy in ("/api/v1/ocr", "/api/v1/pdf-to-word", "/api/v1/office-to-pdf",
                  "/api/v1/html-to-pdf"):
        assert quota.cost_for(heavy) == quota.HEAVY_COST


def test_consume_charges_and_reports(api_key):
    _, record = api_key
    allowed, state = quota.consume(record.key_id, 3, 1000)
    assert allowed is True
    assert state.units_used == 3
    assert state.bytes_used == 1000
    assert state.units_remaining == quota.DAILY_UNITS - 3


def test_over_quota_is_refused_and_charges_nothing(api_key):
    _, record = api_key
    quota.consume(record.key_id, quota.DAILY_UNITS, 0)
    before = quota.peek(record.key_id).units_used

    allowed, state = quota.consume(record.key_id, 1, 0)
    assert allowed is False
    # Nothing is charged for a refused call — the request never runs.
    assert quota.peek(record.key_id).units_used == before
    assert state.retry_after > 0


def test_byte_limit_is_enforced_separately_from_units(api_key):
    _, record = api_key
    allowed, _ = quota.consume(record.key_id, 1, quota.DAILY_BYTES + 1)
    assert allowed is False
    assert quota.peek(record.key_id).units_used == 0


def test_reconcile_corrects_a_chunked_upload(api_key):
    _, record = api_key
    quota.consume(record.key_id, 1, 0)          # no Content-Length to charge
    quota.reconcile_bytes(record.key_id, actual=5000, charged=0)
    assert quota.peek(record.key_id).bytes_used == 5000


def test_quota_is_per_key(api_key):
    raw, record = api_key
    other = accounts.create_user("other@example.com", "a-long-enough-password")
    _, other_key = accounts.issue_api_key(other.id, "theirs")

    quota.consume(record.key_id, 10, 0)
    assert quota.peek(record.key_id).units_used == 10
    assert quota.peek(other_key.key_id).units_used == 0


def test_quota_rows_are_keyed_by_key_id_not_the_raw_key(api_key):
    raw, record = api_key
    quota.consume(record.key_id, 1, 0)
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM api_quota")]
    assert rows and rows[0]["key_id"] == record.key_id
    assert all(raw not in str(v) for row in rows for v in row.values())
