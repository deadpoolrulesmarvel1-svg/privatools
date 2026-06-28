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

import email.message

import pytest
from fastapi import HTTPException

from backend.app.services.html_to_pdf_service import (
    _ValidatingRedirectHandler,
    _validating_opener,
    _weasyprint_url_fetcher as _canonical_fetcher,
    safe_url_fetch,
)
from backend.app.services.url_to_pdf_service import _weasyprint_url_fetcher

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
            _weasyprint_url_fetcher(_METADATA_URL)

    def test_blocks_file_subresource(self):
        with pytest.raises(HTTPException):
            _weasyprint_url_fetcher(_FILE_URL)

    def test_shared_between_url_and_html_render_paths(self):
        # Both the url= (url_to_pdf) and string= (html_to_pdf raw HTML) render
        # paths must use the SAME validated fetcher — a regression where only
        # one path is protected is exactly the bug this guards against.
        assert _weasyprint_url_fetcher is _canonical_fetcher
        with pytest.raises(HTTPException):
            _canonical_fetcher(_FILE_URL)
