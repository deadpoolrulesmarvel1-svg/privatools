"""P1 security hardening: prod docs gating (S5), 5xx detail sanitization (S6),
CSV-injection guard in the table extractor (D6)."""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import HTTPException

from backend.app.main import app
from backend.app.services.table_extractor_service import _csv_safe


# ─── D6: CSV injection guard ──────────────────────────────────────────────
def test_csv_safe_guards_formula_cells():
    for bad in ("=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"):
        assert _csv_safe(bad) == "'" + bad, bad


def test_csv_safe_leaves_normal_cells_untouched():
    for ok in ("hello", "123", "", "a=b", "x-y", "user@host only mid-string"):
        assert _csv_safe(ok) == ok, ok


# ─── S6: 5xx responses must not echo internal exception text ──────────────
def test_5xx_detail_is_generic(client):
    @app.get("/__boom_p1__")
    def _boom():
        raise HTTPException(status_code=500, detail="leaked /etc/secret traceback Xyz")

    r = client.get("/__boom_p1__")
    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == "Processing failed. Please try again."
    assert "secret" not in body["detail"].lower()


def test_4xx_detail_passes_through(client):
    @app.get("/__bad_p1__")
    def _bad():
        raise HTTPException(status_code=400, detail="Specific helpful 400 message")

    r = client.get("/__bad_p1__")
    assert r.status_code == 400
    assert r.json()["detail"] == "Specific helpful 400 message"


# ─── S5: docs + OpenAPI spec disabled when ENVIRONMENT=production ──────────
def test_docs_and_openapi_disabled_in_production():
    """`_is_prod` is resolved at import time, so assert the gating in a fresh
    interpreter with ENVIRONMENT=production rather than mutating the loaded app."""
    root = Path(__file__).resolve().parents[2]
    code = (
        "from backend.app.main import app;"
        "assert app.docs_url is None, ('docs', app.docs_url);"
        "assert app.redoc_url is None, ('redoc', app.redoc_url);"
        "assert app.openapi_url is None, ('openapi', app.openapi_url);"
        "print('PROD_DOCS_OK')"
    )
    env = {**os.environ, "ENVIRONMENT": "production", "PYTHONPATH": str(root)}
    r = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, env=env
    )
    assert "PROD_DOCS_OK" in r.stdout, r.stderr
