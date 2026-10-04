"""PDF to Markdown carries the per-route limit the other heavy routes carry.

Every route that runs an expensive job (Tesseract, LibreOffice, FFmpeg, a
URL fetch, a capped worker process) carries @limiter.limit(EXPENSIVE_RATE_LIMIT),
five requests a minute from one address (rate_limit.py). The Hidden Text
Checker, whose worker PDF to Markdown's was modelled on, has it; PDF to
Markdown, whose worker may use 60 s of CPU and 90 s in all, had none (#328
review, N7). The suite turns the limiter off (conftest.py); this test turns it
on for itself and resets its counts on both sides.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.rate_limit import EXPENSIVE_RATE_LIMIT, limiter


@pytest.fixture
def limited_client(monkeypatch):
    limiter.reset()
    monkeypatch.setattr(limiter, "enabled", True)
    yield TestClient(main.app, raise_server_exceptions=False)
    limiter.reset()


@pytest.mark.parametrize("route", ["/api/pdf-to-markdown", "/api/hidden-text-checker"])
def test_a_capped_worker_route_answers_429_past_the_expensive_limit(limited_client, route):
    allowed = int(EXPENSIVE_RATE_LIMIT.split("/")[0])
    # A refusal before any work still counts, as it does on every limited route.
    statuses = [
        limited_client.post(route, files={"file": ("notes.txt", b"not a PDF", "text/plain")}).status_code
        for _ in range(allowed + 1)
    ]
    assert statuses[:allowed] == [400] * allowed
    assert statuses[allowed] == 429
