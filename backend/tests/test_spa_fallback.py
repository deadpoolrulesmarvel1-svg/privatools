"""
Tests for the SPA catch-all fallback route and sitemap slug consistency.

The `client` fixture is supplied by conftest.py — it falls back to an
httpx-ASGI sync wrapper when starlette's stock TestClient can't initialise
under the locally-installed httpx version.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# SPA catch-all tests
# ---------------------------------------------------------------------------

class TestSPAFallback:
    """Verify that the SPA fallback serves index.html for frontend routes."""

    @pytest.mark.parametrize("path", [
        "/tool/merge-pdf",
        "/tool/compress-pdf",
        "/tool/split-pdf",
        "/tools/image-compressor",
        "/tools/remove-background",
        "/about",
        "/compare",
        "/compare/ilovepdf",
        "/batch",
        "/pipeline",
    ])
    def test_frontend_routes_return_200_html(self, client, path):
        """Frontend SPA routes must return 200 with HTML content."""
        resp = client.get(path)
        # If frontend/dist exists with index.html, we get 200
        # If not (CI without build), we get 404 — skip
        if resp.status_code == 404:
            pytest.skip("frontend/dist not built — skipping SPA fallback test")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")

    def test_api_routes_not_intercepted(self, client):
        """API routes must still return JSON, not index.html."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["build_sha"]
        assert data["build_sha_short"]

    def test_static_files_served_directly(self, client):
        """Real static files (e.g. robots.txt) should be served as-is."""
        resp = client.get("/robots.txt")
        if resp.status_code == 404:
            pytest.skip("frontend/dist not built — skipping static file test")
        assert resp.status_code == 200
        assert "User-agent" in resp.text

    def test_path_traversal_blocked(self, client):
        """Path traversal attempts must be rejected."""
        resp = client.get("/../../etc/passwd")
        assert resp.status_code in (400, 404)

    def test_unknown_api_route_returns_json_404(self, client):
        """A hit on /api/<nonsense> must return JSON 404, not the SPA HTML shell.

        The catch-all in main.py early-outs for `/api/*` prefixes and returns
        a proper `{"detail": "Not found", "path": ...}` JSON body so the
        frontend fetch wrapper can distinguish "endpoint missing" from "tool
        broken" without parse-erroring on an HTML response.
        """
        resp = client.get("/api/this-endpoint-does-not-exist")
        assert resp.status_code == 404
        ctype = resp.headers.get("content-type", "")
        assert "application/json" in ctype or "json" in ctype, (
            f"expected JSON 404, got content-type={ctype!r}"
        )

    def test_sitemap_is_not_spa_html(self, client):
        """/sitemap.xml must be served as XML, not the SPA fallback HTML."""
        resp = client.get("/sitemap.xml")
        assert resp.status_code == 200
        ctype = resp.headers.get("content-type", "").lower()
        # FastAPI Response with media_type="application/xml" — accept variants.
        assert "xml" in ctype, f"expected XML content-type, got {ctype!r}"
        # And the body must actually look like XML, not <!doctype html>
        body_lower = resp.text.lstrip().lower()
        assert body_lower.startswith("<?xml") or body_lower.startswith("<urlset"), (
            "sitemap body does not start with XML"
        )

    def test_blog_slug_path_falls_through_to_spa(self, client):
        """/blog/<slug> is a frontend route — must serve index.html, not 404."""
        resp = client.get("/blog/some-unknown-post")
        if resp.status_code == 404 and "json" in resp.headers.get("content-type", "").lower():
            # No dist + unknown blog slug — that's fine, SPA isn't built.
            pytest.skip("frontend/dist not built — skipping SPA fallback test")
        # 200 (known slug) or 404 (unknown slug) — both must be HTML.
        assert resp.status_code in (200, 404)
        assert "text/html" in resp.headers.get("content-type", "")


# ---------------------------------------------------------------------------
# Sitemap slug consistency tests
# ---------------------------------------------------------------------------

def _parse_sitemap_slugs() -> tuple[list[str], list[str]]:
    """Parse PDF and non-PDF slugs from the sitemap route file."""
    sitemap_file = ROOT / "backend" / "app" / "routes" / "sitemap.py"
    text = sitemap_file.read_text(encoding="utf-8")

    # Extract the PDF_TOOLS list
    pdf_match = re.search(r"PDF_TOOLS\s*=\s*\[(.*?)\]", text, re.DOTALL)
    pdf_slugs = re.findall(r'"([^"]+)"', pdf_match.group(1)) if pdf_match else []

    # Extract the NON_PDF_TOOLS list
    non_pdf_match = re.search(r"NON_PDF_TOOLS\s*=\s*\[(.*?)\]", text, re.DOTALL)
    non_pdf_slugs = re.findall(r'"([^"]+)"', non_pdf_match.group(1)) if non_pdf_match else []

    return pdf_slugs, non_pdf_slugs


def _parse_frontend_slugs(filename: str) -> set[str]:
    """Parse slugs from a frontend data file."""
    data_file = ROOT / "frontend" / "src" / "data" / filename
    text = data_file.read_text(encoding="utf-8")
    return set(re.findall(r'slug:\s*"([^"]+)"', text))


def test_sitemap_pdf_slugs_match_frontend():
    """Every PDF slug in the sitemap must exist in tools.ts."""
    sitemap_pdf, _ = _parse_sitemap_slugs()
    frontend_pdf = _parse_frontend_slugs("tools.ts")

    missing = [s for s in sitemap_pdf if s not in frontend_pdf]
    assert not missing, (
        f"Sitemap PDF slugs not found in tools.ts: {missing}"
    )


def test_sitemap_non_pdf_slugs_match_frontend():
    """Every non-PDF slug in the sitemap must exist in non-pdf-tools.ts."""
    _, sitemap_non_pdf = _parse_sitemap_slugs()
    frontend_non_pdf = _parse_frontend_slugs("non-pdf-tools.ts")

    missing = [s for s in sitemap_non_pdf if s not in frontend_non_pdf]
    assert not missing, (
        f"Sitemap non-PDF slugs not found in non-pdf-tools.ts: {missing}"
    )


def test_frontend_pdf_slugs_in_sitemap():
    """Every PDF slug in tools.ts should be in the sitemap."""
    sitemap_pdf, _ = _parse_sitemap_slugs()
    frontend_pdf = _parse_frontend_slugs("tools.ts")

    missing = [s for s in frontend_pdf if s not in sitemap_pdf]
    assert not missing, (
        f"Frontend tools.ts slugs missing from sitemap: {missing}"
    )


def test_frontend_non_pdf_slugs_in_sitemap():
    """Every non-PDF slug in non-pdf-tools.ts should be in the sitemap."""
    _, sitemap_non_pdf = _parse_sitemap_slugs()
    frontend_non_pdf = _parse_frontend_slugs("non-pdf-tools.ts")

    missing = [s for s in frontend_non_pdf if s not in sitemap_non_pdf]
    assert not missing, (
        f"Frontend non-pdf-tools.ts slugs missing from sitemap: {missing}"
    )
