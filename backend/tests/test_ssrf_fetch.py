"""SSRF hardening for the URL-fetching tools (html-to-pdf, url-to-pdf).

These tools fetch attacker-supplied URLs server-side. The original code
validated only the *top-level* URL, leaving two bypasses:

  1. WeasyPrint's default ``url_fetcher`` fetched every sub-resource
     (images, CSS, ``@import``) with no validation, so an attacker page
     could reference ``http://169.254.169.254/`` (cloud metadata) or
     internal services and have them rendered into the returned PDF.
  2. The ``html_to_pdf`` urllib fallback followed HTTP redirects without
     re-validating, so ``public-host -> 302 -> http://internal`` read
     internal content back to the user.

The fix is a single redirect-validating fetch primitive used everywhere.
Every test here is network-free: blocked cases short-circuit on scheme or
literal-IP checks before any socket is opened.
"""
from __future__ import annotations

import base64
import email.message
import io

import fitz
import pytest
from fastapi import HTTPException
from PIL import Image

from backend.app.services import html_to_pdf_service as html_service
from backend.app.services import url_to_pdf_service as url_service
from backend.app.services.html_to_pdf_service import (
    _ValidatingRedirectHandler,
    _make_weasyprint_url_fetcher,
    _validating_opener,
    _weasyprint_url_fetcher as _canonical_fetcher,
    safe_url_fetch,
)

# A few addresses an SSRF guard must reject, none of which require DNS.
_METADATA_URL = "http://169.254.169.254/latest/meta-data/"
_LOOPBACK_URL = "http://127.0.0.1:8000/api/health"
_FILE_URL = "file:///etc/passwd"
# example.com's literal IP — public, so validation passes without real DNS.
_PUBLIC_IP_URL = "http://93.184.216.34/"


def _redirect(handler: _ValidatingRedirectHandler, newurl: str):
    import urllib.request

    req = urllib.request.Request("https://start.example/", method="GET")
    headers = email.message.Message()
    return handler.redirect_request(req, None, 302, "Found", headers, newurl)


class TestValidatingRedirectHandler:
    def test_blocks_redirect_to_cloud_metadata(self):
        with pytest.raises(HTTPException):
            _redirect(_ValidatingRedirectHandler(), _METADATA_URL)

    def test_blocks_redirect_to_loopback(self):
        with pytest.raises(HTTPException):
            _redirect(_ValidatingRedirectHandler(), _LOOPBACK_URL)

    def test_blocks_redirect_to_file_scheme(self):
        with pytest.raises(HTTPException):
            _redirect(_ValidatingRedirectHandler(), _FILE_URL)

    def test_allows_redirect_to_public_address(self):
        new_req = _redirect(_ValidatingRedirectHandler(), _PUBLIC_IP_URL)
        assert new_req is not None
        assert new_req.full_url == _PUBLIC_IP_URL


class TestValidatingOpener:
    def test_opener_installs_validating_redirect_handler(self):
        opener = _validating_opener()
        assert any(
            isinstance(h, _ValidatingRedirectHandler) for h in opener.handlers
        )


class TestSafeUrlFetch:
    def test_rejects_file_scheme(self):
        with pytest.raises(HTTPException):
            safe_url_fetch(_FILE_URL)

    def test_rejects_literal_private_ip(self):
        with pytest.raises(HTTPException):
            safe_url_fetch(_LOOPBACK_URL)


class TestWeasyprintSubresourceFetcher:
    """The custom fetcher is what closes the sub-resource SSRF hole."""

    def test_blocks_metadata_subresource(self):
        with pytest.raises(HTTPException):
            _canonical_fetcher(_METADATA_URL)

    def test_blocks_file_subresource(self):
        with pytest.raises(HTTPException):
            _canonical_fetcher(_FILE_URL)

    def test_shared_between_url_and_html_render_paths(self):
        # Both the url= (url_to_pdf) and string= (html_to_pdf raw HTML) render
        # paths must use the SAME validated fetcher — a regression where only
        # one path is protected is exactly the bug this guards against.
        assert url_service._make_weasyprint_url_fetcher is _make_weasyprint_url_fetcher
        with pytest.raises(HTTPException):
            _canonical_fetcher(_FILE_URL)


@pytest.fixture
def native_weasyprint():
    # Through the loader, which keeps Pillow refusing cut-off pictures for the
    # tests that run after this one (test_cut_off_image_policy.py).
    from backend.app.utils.weasyprint_loader import load_weasyprint

    try:
        return load_weasyprint()
    except (ImportError, OSError) as exc:
        pytest.skip(f"Native WeasyPrint libraries unavailable: {exc}")


class TestNativeWeasyprintFetcher:
    """Exercise the renderer so fallback success cannot hide fetcher API drift."""

    def test_inline_png_is_embedded(self, native_weasyprint, tmp_path, monkeypatch):
        image = io.BytesIO()
        Image.new("RGB", (8, 8), "blue").save(image, format="PNG")
        uri = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
        output = tmp_path / "inline.pdf"
        monkeypatch.setattr(html_service, "_weasyprint_ok", None)
        html_service._weasyprint_html_to_pdf(
            f'<h1>Embedded image</h1><img src="{uri}">', str(output)
        )
        with fitz.open(output) as document:
            assert "Embedded image" in document[0].get_text()
            assert document[0].get_images()

    @pytest.mark.parametrize("uri", [_FILE_URL, _LOOPBACK_URL, _METADATA_URL])
    def test_forbidden_subresources_never_open_a_connection(
        self, native_weasyprint, tmp_path, monkeypatch, uri
    ):
        def unexpected_open():
            pytest.fail("A forbidden subresource reached the network opener")

        monkeypatch.setattr(html_service, "_validating_opener", unexpected_open)
        monkeypatch.setattr(html_service, "_weasyprint_ok", None)
        output = tmp_path / "blocked.pdf"
        html_service._weasyprint_html_to_pdf(
            f'<h1>Safe document</h1><link rel="stylesheet" href="{uri}">'
            f'<img src="{uri}">', str(output)
        )
        with fitz.open(output) as document:
            assert "Safe document" in document[0].get_text()
            assert not document[0].get_images()

    def test_public_url_renders_through_validated_response(
        self, native_weasyprint, tmp_path, monkeypatch
    ):
        from backend.app.utils import cleanup

        calls = []

        def local_response(url, **kwargs):
            calls.append(url)
            return html_service._FetchResult(
                url, "text/html", "utf-8", b"<h1>Public URL document</h1>"
            )

        monkeypatch.setattr(html_service, "safe_url_fetch", local_response)
        monkeypatch.setattr(cleanup, "TEMP_DIR", tmp_path)
        output = url_service.url_to_pdf(_PUBLIC_IP_URL)
        assert calls == [_PUBLIC_IP_URL]
        with fitz.open(output) as document:
            assert "Public URL document" in document[0].get_text()

    def test_eps_image_never_reaches_ghostscript(
        self, native_weasyprint, tmp_path, monkeypatch
    ):
        from PIL import EpsImagePlugin

        def unexpected_ghostscript(*args, **kwargs):
            pytest.fail("WeasyPrint must not render an untrusted EPS image")

        # Keep Pillow's disabled-Ghostscript guard intact and observe the
        # subprocess boundary instead of replacing that guard itself.
        monkeypatch.setattr(EpsImagePlugin.subprocess, "Popen", unexpected_ghostscript)
        monkeypatch.setattr(html_service, "_weasyprint_ok", None)
        eps = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n"
        uri = "data:application/postscript;base64," + base64.b64encode(eps).decode()
        output = tmp_path / "eps.pdf"
        html_service._weasyprint_html_to_pdf(
            f'<h1>EPS is excluded</h1><img src="{uri}">', str(output)
        )
        with fitz.open(output) as document:
            assert "EPS is excluded" in document[0].get_text()
            assert not document[0].get_images()
