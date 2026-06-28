"""Shared pytest fixtures for the backend test suite.

Provides:
    - `client`: a TestClient pointed at the FastAPI app (with a fallback for
      environments where starlette's TestClient is incompatible with the
      installed httpx — this happens locally with httpx>=0.28 + starlette<0.37).
    - `sample_pdf`, `multipage_pdf`, `locked_pdf`, `jpeg_image`: tiny reusable
      assets so individual tests don't keep regenerating them.

Keeping these here means each test file stays focused on what it asserts
rather than how it builds inputs.
"""

from __future__ import annotations

import asyncio
import io
import sys
import threading
from pathlib import Path

import fitz  # PyMuPDF
import httpx
import pytest
from PIL import Image

# Ensure `backend.app.main` is importable regardless of where pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.main import app  # noqa: E402
from backend.app.rate_limit import limiter  # noqa: E402

# Tests exercise endpoints many times from a single client IP; the per-route
# rate limits would otherwise produce spurious 429s. Disable the limiter for
# the whole suite (the limits are verified by their own targeted tests).
limiter.enabled = False


# ---------------------------------------------------------------------------
# TestClient — fall back to an httpx-ASGI sync wrapper when starlette's
# TestClient can't construct an httpx.Client with the `app=` kwarg (httpx>=0.28
# removed it; older starlette still calls it).
# ---------------------------------------------------------------------------

class _ASGISyncClient:
    """Minimal httpx-style sync client backed by httpx.AsyncClient + ASGITransport.

    Only implements the surface the existing test suite uses: get/post/options
    with optional `data`, `files`, `headers`, `params`. Each call spins up a
    short-lived event loop in a worker thread, which is enough for tests that
    issue a handful of requests.
    """

    def __init__(self, app, base_url: str = "http://localhost"):
        # NOTE: base_url defaults to `http://localhost`, not `http://testserver`,
        # because `app/main.py` wraps the app in TrustedHostMiddleware with an
        # allow-list that includes `localhost` and `127.0.0.1` but not the
        # starlette TestClient's default `testserver` host. Using `localhost`
        # here keeps the test suite working without weakening prod security.
        self._app = app
        self._base_url = base_url

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        async def _go():
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(
                transport=transport, base_url=self._base_url, follow_redirects=False
            ) as client:
                return await client.request(method, url, **kwargs)

        # Always run in a fresh thread+loop to avoid clashing with any
        # already-running loop in the calling thread.
        result: dict = {}

        def runner():
            loop = asyncio.new_event_loop()
            try:
                result["response"] = loop.run_until_complete(_go())
            except BaseException as exc:  # surface to caller thread
                result["error"] = exc
            finally:
                loop.close()

        t = threading.Thread(target=runner, daemon=True)
        t.start()
        t.join()
        if "error" in result:
            raise result["error"]
        return result["response"]

    def get(self, url: str, **kw) -> httpx.Response:
        return self._request("GET", url, **kw)

    def post(self, url: str, **kw) -> httpx.Response:
        return self._request("POST", url, **kw)

    def options(self, url: str, **kw) -> httpx.Response:
        return self._request("OPTIONS", url, **kw)


def _make_test_client(app):
    """Return a working sync TestClient-like object.

    Tries starlette's TestClient first; if its httpx-compat shim is broken in
    the local env, falls back to the ASGI sync wrapper above.
    """
    try:
        from fastapi.testclient import TestClient as _StarletteTestClient
        return _StarletteTestClient(app)
    except TypeError:
        return _ASGISyncClient(app)


@pytest.fixture(scope="session")
def client():
    """Session-wide TestClient for FastAPI."""
    return _make_test_client(app)


# ---------------------------------------------------------------------------
# Tiny PDF / image fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def sample_pdf() -> bytes:
    """A 1-page text PDF, ~1 KB."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Sample page one. Hello, PrivaTools.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture(scope="session")
def multipage_pdf() -> bytes:
    """A 10-page text PDF, ~6 KB."""
    doc = fitz.open()
    for i in range(10):
        page = doc.new_page()
        page.insert_text((72, 72), f"This is page {i + 1} of ten.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture(scope="session")
def locked_pdf() -> bytes:
    """A password-protected PDF (password 'secret123')."""
    import pikepdf

    src_buf = io.BytesIO()
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Locked content", fontsize=12)
    doc.save(src_buf)
    doc.close()

    pdf = pikepdf.open(io.BytesIO(src_buf.getvalue()))
    out = io.BytesIO()
    pdf.save(
        out,
        encryption=pikepdf.Encryption(
            user="secret123", owner="secret123", R=4
        ),
    )
    return out.getvalue()


@pytest.fixture(scope="session")
def jpeg_image() -> bytes:
    """A 100x80 RGB JPEG, ~1 KB."""
    img = Image.new("RGB", (100, 80), (200, 60, 90))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()
