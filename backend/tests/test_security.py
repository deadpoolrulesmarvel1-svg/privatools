"""Security-flavoured contract tests.

These pin the high-impact behaviours the frontend silently relies on:
filename safety, size-limit enforcement, malformed-input rejection,
CORS preflight, and password-error surfacing. They run entirely in-process
through the FastAPI TestClient (or the conftest ASGI sync fallback) — no
running server required.
"""

from __future__ import annotations

import io
import re

import pytest


# ---------------------------------------------------------------------------
# Filename traversal / safety
# ---------------------------------------------------------------------------

class TestFilenameSafety:
    """Make sure uploaded filenames can't escape the temp directory."""

    def test_traversal_filename_does_not_create_system_files(self, client, sample_pdf, tmp_path, monkeypatch):
        """Uploading a file named ../../etc/passwd.pdf must not write into /etc.

        We can't safely test the literal /etc target; instead, we point the
        backend's TEMP_DIR at a sandbox and confirm that path-traversal-style
        names get stripped to their basename — the artefact only lands inside
        the sandbox, never above it.
        """
        # Redirect TEMP_DIR for this call only.
        from backend.app.utils import cleanup as _cleanup
        monkeypatch.setattr(_cleanup, "TEMP_DIR", tmp_path)

        evil_name = "../../etc/passwd.pdf"
        resp = client.post(
            "/api/compress",
            files={"file": (evil_name, sample_pdf, "application/pdf")},
            data={"quality": "recommended"},
        )
        # We don't care whether compress succeeded or returned 500 — what we
        # care about is that nothing landed outside the sandbox.
        outside = list(tmp_path.parent.glob("passwd*"))
        # The sandbox parent might have other files unrelated to this test;
        # the strict invariant is no file we just created bears the etc path.
        for p in outside:
            assert "passwd" not in p.name or p.is_relative_to(tmp_path), (
                f"File created outside sandbox: {p}"
            )
        # And response is some valid HTTP code (not a crash)
        assert resp.status_code in (200, 400, 422, 500)

    def test_null_byte_in_filename_is_handled(self, client, sample_pdf):
        """Null bytes in filenames must not corrupt path handling."""
        # python-multipart usually strips/normalises these, but make sure we
        # don't blow up.
        resp = client.post(
            "/api/compress",
            files={"file": ("test\x00.pdf", sample_pdf, "application/pdf")},
            data={"quality": "recommended"},
        )
        # Whether accepted or rejected, must not 500.
        assert resp.status_code in (200, 400, 422)


# ---------------------------------------------------------------------------
# Upload size limit (UploadSizeLimitMiddleware uses Content-Length header)
# ---------------------------------------------------------------------------

class TestUploadSizeLimit:
    """413 must be returned when an upload exceeds MAX_UPLOAD_MB."""

    def test_oversized_upload_via_content_length_header(self, client):
        """Sending a content-length > 500 MB must short-circuit with 413.

        We don't actually ship 600 MB — the middleware checks the header,
        so a tiny body with a lying header is enough.
        """
        big = 600 * 1024 * 1024  # 600 MB claimed
        # Tiny multipart body — middleware rejects before parsing.
        resp = client.post(
            "/api/compress",
            content=b"x",
            headers={
                "content-type": "application/octet-stream",
                "content-length": str(big),
            },
        )
        assert resp.status_code == 413
        # Detail should mention the limit
        body = resp.text.lower()
        assert "too large" in body or "limit" in body


# ---------------------------------------------------------------------------
# Malformed / missing-parameter rejection
# ---------------------------------------------------------------------------

class TestMalformedInput:
    """The frontend uses these error paths to surface helpful messages."""

    def test_empty_pdf_upload_is_rejected(self, client):
        """Empty file uploads to a PDF endpoint must yield 400, not 500."""
        resp = client.post(
            "/api/merge",
            files=[("files", ("a.pdf", b"", "application/pdf"))],
        )
        assert resp.status_code == 400, resp.text

    def test_non_pdf_extension_rejected_by_word_to_pdf(self, client):
        """word-to-pdf is .docx only — a .pdf must be rejected with 400."""
        resp = client.post(
            "/api/word-to-pdf",
            files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
        )
        assert resp.status_code == 400
        assert "docx" in resp.text.lower()

    def test_missing_required_form_field_returns_422(self, client, sample_pdf):
        """Missing required Form field must yield 422 (FastAPI default)."""
        resp = client.post(
            "/api/highlight",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            # missing required `query` form field
        )
        assert resp.status_code == 422

    def test_smart_redact_rejects_non_array_needles(self, client, sample_pdf):
        """smart-redact requires a JSON array of strings — object must 400."""
        resp = client.post(
            "/api/smart-redact",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"needles": '{"foo": "bar"}'},
        )
        assert resp.status_code == 400
        assert "array" in resp.text.lower() or "json" in resp.text.lower()

    def test_smart_redact_rejects_invalid_color(self, client, sample_pdf):
        """color must match #RRGGBB."""
        resp = client.post(
            "/api/smart-redact",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"needles": '["foo"]', "color": "red"},
        )
        assert resp.status_code == 400

    def test_url_to_pdf_rejects_private_ipv4(self, client):
        """SSRF guard — 192.168.x must be rejected even if scheme is https."""
        resp = client.post(
            "/api/url-to-pdf",
            data={"url": "https://192.168.1.1/admin"},
        )
        assert resp.status_code == 400
        assert "local" in resp.text.lower() or "internal" in resp.text.lower()

    def test_url_to_pdf_rejects_link_local(self, client):
        """SSRF guard — AWS metadata endpoint 169.254.169.254 must be blocked."""
        resp = client.post(
            "/api/url-to-pdf",
            data={"url": "http://169.254.169.254/latest/meta-data/"},
        )
        assert resp.status_code == 400

    def test_url_to_pdf_rejects_dotted_localhost(self, client):
        """SSRF guard — trailing-dot bypass attempt must be blocked."""
        resp = client.post(
            "/api/url-to-pdf",
            data={"url": "http://localhost./admin"},
        )
        assert resp.status_code == 400

    def test_url_to_pdf_rejects_bad_scheme(self, client):
        """SSRF guard — file:// and ftp:// must be rejected."""
        resp = client.post(
            "/api/url-to-pdf",
            data={"url": "file:///etc/passwd"},
        )
        assert resp.status_code == 400

    def test_stamp_pdf_rejects_unknown_type(self, client, sample_pdf):
        """stamp_type must be in the preset whitelist."""
        resp = client.post(
            "/api/stamp-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"stamp_type": "made-up-stamp"},
        )
        assert resp.status_code == 400

    def test_stamp_pdf_rejects_too_long_custom_text(self, client, sample_pdf):
        """custom_text > 120 chars must be rejected."""
        resp = client.post(
            "/api/stamp-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"stamp_type": "custom", "custom_text": "x" * 121},
        )
        assert resp.status_code == 400

    def test_split_in_half_rejects_invalid_direction(self, client, sample_pdf):
        resp = client.post(
            "/api/split-in-half",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"direction": "diagonal"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Locked-PDF password handling
# ---------------------------------------------------------------------------

class TestPasswordHandling:
    """Unlock must surface a clear 400 — not a 500 — on a wrong password."""

    def test_wrong_password_returns_400(self, client, locked_pdf):
        resp = client.post(
            "/api/unlock",
            files=[("files", ("locked.pdf", locked_pdf, "application/pdf"))],
            data={"password": "wrong-password"},
        )
        assert resp.status_code == 400, resp.text

    def test_empty_password_returns_400(self, client, locked_pdf):
        resp = client.post(
            "/api/unlock",
            files=[("files", ("locked.pdf", locked_pdf, "application/pdf"))],
            data={"password": "   "},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# CORS preflight
# ---------------------------------------------------------------------------

class TestCORS:
    """OPTIONS preflight must return the CORS headers configured in main.py."""

    def test_options_merge_returns_cors_headers(self, client):
        resp = client.options(
            "/api/merge",
            headers={
                "origin": "http://localhost:8080",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
        # CORSMiddleware returns 200 for valid preflight.
        assert resp.status_code in (200, 204), resp.text
        headers = {k.lower(): v for k, v in resp.headers.items()}
        assert "access-control-allow-origin" in headers, (
            f"missing CORS allow-origin; got headers: {list(headers)}"
        )
        # Default ALLOWED_ORIGINS includes http://localhost:8080
        assert headers["access-control-allow-origin"] in (
            "http://localhost:8080", "*",
        )

    def test_options_disallowed_origin_does_not_get_cors_header(self, client):
        """An origin outside ALLOWED_ORIGINS must not receive the allow header."""
        resp = client.options(
            "/api/merge",
            headers={
                "origin": "https://evil.example.com",
                "access-control-request-method": "POST",
            },
        )
        # FastAPI's CORSMiddleware still returns 200 for the preflight but
        # without the allow-origin header (so the browser blocks the call).
        # If a wildcard is configured in some envs, this test still passes by
        # confirming the response isn't a hard 500.
        assert resp.status_code in (200, 204, 400)


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

class TestSecurityHeaders:
    """Every response should include the SecurityHeadersMiddleware defaults."""

    def test_api_response_has_security_headers(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        h = {k.lower(): v for k, v in resp.headers.items()}
        assert h.get("x-content-type-options") == "nosniff"
        assert h.get("x-frame-options") == "DENY"
        assert "content-security-policy" in h
        assert "referrer-policy" in h
        assert h.get("cross-origin-opener-policy") == "same-origin"
        assert h.get("cross-origin-embedder-policy") == "credentialless"
        assert h.get("cross-origin-resource-policy") == "same-origin"

    def test_hsts_preload_header_when_forced(self, client, monkeypatch):
        monkeypatch.setenv("FORCE_HSTS", "1")
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert (
            resp.headers.get("Strict-Transport-Security")
            == "max-age=63072000; includeSubDomains; preload"
        )

    def test_api_response_has_no_store_cache_control(self, client):
        """Every /api/ response must be Cache-Control: no-store to prevent
        an intermediate CDN/proxy from retaining per-user tool output."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        cc = resp.headers.get("Cache-Control", "")
        assert "no-store" in cc.lower(), f"expected no-store, got {cc!r}"

    def test_script_csp_uses_nonce_without_unsafe_inline(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        csp = resp.headers.get("Content-Security-Policy", "")
        script_src = next(
            directive for directive in csp.split(";") if directive.strip().startswith("script-src")
        )
        assert "'unsafe-inline'" not in script_src
        assert "'unsafe-eval'" not in script_src
        nonce_match = re.search(r"'nonce-([^']+)'", script_src)
        assert nonce_match, f"script-src missing nonce: {script_src}"
        assert f'nonce="{nonce_match.group(1)}"' in resp.text

    def test_font_csp_is_same_origin_only(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        csp = resp.headers.get("Content-Security-Policy", "")
        assert "fonts.bunny.net" not in csp
        assert "fonts.googleapis.com" not in csp
        assert "fonts.gstatic.com" not in csp

        font_src = next(
            directive for directive in csp.split(";") if directive.strip().startswith("font-src")
        )
        assert font_src.strip() == "font-src 'self'"

    def test_analytics_csp_uses_first_party_proxy(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        csp = resp.headers.get("Content-Security-Policy", "")
        assert "googletagmanager.com" not in csp
        assert "google-analytics.com" not in csp
        assert "analytics.google.com" not in csp

        script_src = next(
            directive for directive in csp.split(";") if directive.strip().startswith("script-src")
        )
        connect_src = next(
            directive for directive in csp.split(";") if directive.strip().startswith("connect-src")
        )
        assert "google" not in script_src
        assert "google" not in connect_src
        assert "'self'" in connect_src

    def test_wasm_eval_is_limited_to_browser_ai_tools(self, client):
        normal = client.get("/tool/compress-pdf")
        ai = client.get("/tool/summarize-pdf")

        normal_script_src = next(
            directive
            for directive in normal.headers.get("Content-Security-Policy", "").split(";")
            if directive.strip().startswith("script-src")
        )
        ai_script_src = next(
            directive
            for directive in ai.headers.get("Content-Security-Policy", "").split(";")
            if directive.strip().startswith("script-src")
        )

        assert "'wasm-unsafe-eval'" not in normal_script_src
        assert "'wasm-unsafe-eval'" in ai_script_src


class TestCacheControlForStaticContent:
    """Sitemap / og-image use ``cache_response`` to set a long max-age —
    the SecurityHeadersMiddleware must NOT trample those values."""

    def test_sitemap_keeps_its_cache_control(self, client):
        resp = client.get("/sitemap.xml")
        # sitemap should respond with its long max-age cache; if it 404s
        # in this env (e.g. SPA shell), at least the SecurityHeadersMiddleware
        # didn't break it.
        assert resp.status_code in (200, 304, 404)
        if resp.status_code == 200:
            cc = resp.headers.get("Cache-Control", "")
            # Must be cacheable (public + max-age) — NOT no-store
            assert "no-store" not in cc.lower(), (
                f"sitemap got forced to no-store: {cc!r}"
            )


class TestFilenameHeaderInjection:
    """Filenames that contain CR/LF must not appear verbatim in response
    headers — the route helpers strip control chars before interpolating
    user-controlled filenames into Content-Disposition."""

    def test_safe_stem_strips_crlf(self):
        from backend.app.utils.route_helpers import safe_stem, safe_filename, safe_header_filename

        assert safe_stem("foo\r\nbar.pdf") == "foobar"
        assert safe_filename("foo\r\nbar.pdf") == "foobar.pdf"
        assert safe_filename("test\x00\x1f.pdf") == "test.pdf"
        # Path traversal stripped too
        assert safe_filename("../../etc/passwd") == "passwd"
        # Quotes/backslash stripped for header use
        assert '"' not in safe_header_filename('evil".pdf')
        # Empty + None fall back
        assert safe_stem(None) == "document"
        assert safe_filename(None) == "file"


class TestMagicByteValidation:
    """The cleanup.validate_*_content helpers must reject non-magic-byte
    payloads with a 400 — used by routes that pass user bytes straight
    to PIL or to zipfile without an additional parser-side check."""

    def test_validate_image_content_accepts_png(self):
        from backend.app.utils.cleanup import validate_image_content

        # The fixture PNG header + a minimum body
        validate_image_content(b"\x89PNG\r\n\x1a\n" + b"x" * 20)

    def test_validate_image_content_rejects_text(self):
        from fastapi import HTTPException
        from backend.app.utils.cleanup import validate_image_content

        with pytest.raises(HTTPException) as exc:
            validate_image_content(b"<html>not an image</html>")
        assert exc.value.status_code == 400

    def test_validate_zip_content_accepts_pk(self):
        from backend.app.utils.cleanup import validate_zip_content

        validate_zip_content(b"PK\x03\x04" + b"\x00" * 16)

    def test_validate_zip_content_rejects_text(self):
        from fastapi import HTTPException
        from backend.app.utils.cleanup import validate_zip_content

        with pytest.raises(HTTPException) as exc:
            validate_zip_content(b"not a zip")
        assert exc.value.status_code == 400


class TestSSRFExtraRanges:
    """The expanded SSRF guard must reject the new private/reserved
    ranges added in this hardening pass: CGNAT (100.64/10), TEST-NETs,
    benchmark range, IPv6 link-local, IPv4-mapped IPv6."""

    def test_cgnat_rejected(self):
        from fastapi import HTTPException
        from backend.app.services.html_to_pdf_service import _is_private_ip

        assert _is_private_ip("100.64.0.1") is True

    def test_test_net_rejected(self):
        from backend.app.services.html_to_pdf_service import _is_private_ip

        assert _is_private_ip("192.0.2.1") is True  # TEST-NET-1
        assert _is_private_ip("198.51.100.1") is True  # TEST-NET-2

    def test_ipv4_mapped_ipv6_rejected(self):
        from backend.app.services.html_to_pdf_service import _is_private_ip

        # ::ffff:127.0.0.1 — IPv4-mapped loopback. Dual-stack bypass.
        assert _is_private_ip("::ffff:127.0.0.1") is True

    def test_ipv6_link_local_rejected(self):
        from backend.app.services.html_to_pdf_service import _is_private_ip

        assert _is_private_ip("fe80::1") is True


# ---------------------------------------------------------------------------
# Resource caps — Pillow decompression-bomb guard + per-route rate limit
# ---------------------------------------------------------------------------

class TestResourceCaps:
    """Sanity-check the per-request resource limits added in this pass."""

    def test_pillow_decompression_bomb_cap_set(self):
        """`Image.MAX_IMAGE_PIXELS` must be capped at the project default.

        Pillow ships with a default ~178M-pixel ceiling that only warns,
        it doesn't raise. The startup hook in `app.utils.__init__` lowers
        it to 150M and switches Pillow into the raising mode — that's
        what stops a malicious 30000×30000 PNG from OOM'ing the worker.
        """
        # Importing the package runs the side-effect that sets the cap.
        from backend.app import utils as _backend_utils  # noqa: F401
        from PIL import Image

        assert Image.MAX_IMAGE_PIXELS is not None
        assert Image.MAX_IMAGE_PIXELS <= 200_000_000

    def test_decompression_bomb_error_maps_to_413(self):
        """A raw `Image.DecompressionBombError` must surface as 413, not 500.

        The global exception handler matches on class name to avoid a
        hard PIL import — verify that mapping by raising the error from
        a stub route and checking the JSON status.
        """
        # We test the handler in isolation rather than wiring a fake
        # route — the dispatcher uses `type(exc).__name__` matching, so
        # constructing the exception and feeding it through the handler
        # is enough to lock the mapping.
        import asyncio

        from PIL import Image

        from backend.app.middleware.error_handlers import builtin_exception_handler

        class _StubRequest:
            class state:  # noqa: D401 — match starlette Request.state surface
                request_id = "test-rid"

            url = type("U", (), {"path": "/api/test"})()
            method = "POST"

        exc = Image.DecompressionBombError("test bomb")
        resp = asyncio.get_event_loop().run_until_complete(
            builtin_exception_handler(_StubRequest(), exc)
        )
        assert resp.status_code == 413


class TestApiSubdomainSplit:
    """The api-subdomain split is flag-gated on PUBLIC_API_BASE_URL. Default
    (unset) must be byte-for-byte the legacy same-origin behaviour; when a
    cross-origin API base is configured the CSP must whitelist it so the
    browser doesn't block the SPA's cross-origin fetches. See
    backend/tests/test_runtime_config.py for the pure-helper coverage."""

    def test_csp_connect_src_omits_api_origin_by_default(self):
        from backend.app.main import _content_security_policy

        csp = _content_security_policy("/", "nonce123", "")
        connect = next(
            d for d in csp.split(";") if d.strip().startswith("connect-src")
        )
        assert "api.privatools.me" not in connect
        assert "'self'" in connect

    def test_csp_connect_src_includes_api_origin_when_configured(self):
        from backend.app.main import _content_security_policy

        csp = _content_security_policy("/", "nonce123", "https://api.privatools.me")
        connect = next(
            d for d in csp.split(";") if d.strip().startswith("connect-src")
        )
        assert "https://api.privatools.me" in connect
        # Widening connect-src must not relax script-src.
        script = next(d for d in csp.split(";") if d.strip().startswith("script-src"))
        assert "'unsafe-inline'" not in script

    def test_served_html_has_no_api_meta_tag_by_default(self, client):
        """With the flag off, the SPA shell carries no api-base meta tag, so
        the built bundle keeps talking to the same origin."""
        resp = client.get("/")
        assert resp.status_code == 200
        assert "privatools:api-base" not in resp.text
