"""Convert a public URL to PDF using WeasyPrint.

WeasyPrint will happily follow file://, http:// to private IPs, and
gopher://-style URLs out of the box, which makes it a textbook SSRF
foot-gun on a multi-tenant server. We validate the URL here (same
ruleset as html_to_pdf_service._validate_url) before WeasyPrint sees
it, then hand WeasyPrint the original URL.

This module previously delegated SSRF validation to the html_to_pdf
service. That worked, but meant a regression here would silently
remove protection. Validation now lives in both places.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..utils.exceptions import DependencyError, ProcessingError
from ..utils.filenames import temp_output
from .html_to_pdf_service import _validate_url, safe_url_fetch

# Per-resource cap for WeasyPrint sub-resources (images / CSS / fonts).
# Larger than the 5 MB HTML cap because a single hero image can legitimately
# be a few MB, but still bounded so a malicious page can't exhaust the worker.
_MAX_SUBRESOURCE_BYTES = 25 * 1024 * 1024


def _weasyprint_url_fetcher(url: str, timeout: int = 15, ssl_context=None):
    """A WeasyPrint ``url_fetcher`` that blocks SSRF on every sub-resource.

    WeasyPrint fetches the page AND every referenced resource (images, CSS,
    ``@import``, fonts). Its default fetcher happily honours ``file://`` and
    private IPs, so an attacker page could pull cloud-metadata or internal
    services into the rendered PDF. We route all network fetches through
    :func:`safe_url_fetch` (SSRF-validated, redirect-safe), allow inline
    ``data:`` URIs through (no egress), and refuse every other scheme.
    """
    scheme = url.split(":", 1)[0].lower()
    if scheme in ("http", "https"):
        result = safe_url_fetch(url, max_bytes=_MAX_SUBRESOURCE_BYTES, timeout=timeout)
        return {
            "string": result.body,
            "mime_type": result.content_type or None,
            "encoding": result.encoding,
            "redirected_url": result.final_url,
        }
    if scheme == "data":
        try:
            from weasyprint.urls import default_url_fetcher
        except ImportError:  # pragma: no cover - older/newer weasyprint layout
            from weasyprint import default_url_fetcher
        return default_url_fetcher(url, timeout=timeout, ssl_context=ssl_context)
    raise HTTPException(status_code=400, detail=f"Blocked URL scheme: {scheme or 'unknown'}")


def url_to_pdf(url: str) -> str:
    """Fetch `url`, render it to PDF, and return the temp-file path.

    WeasyPrint is imported lazily so the server can still boot on hosts
    that don't have the system gobject/pango/cairo libraries available.
    """
    _validate_url(url)  # raises 400 HTTPException on private / file:// / etc.

    output_path = temp_output("webpage", "pdf")

    try:
        from weasyprint import HTML
    except ImportError as exc:
        raise DependencyError(
            "WeasyPrint is not available on this server. "
            "Install system dependencies: gobject, pango, cairo."
        ) from exc

    try:
        # Every resource WeasyPrint fetches (the page + sub-resources +
        # redirects) goes through our SSRF-validating fetcher.
        HTML(url=url, url_fetcher=_weasyprint_url_fetcher).write_pdf(str(output_path))
    except Exception as exc:
        # WeasyPrint surfaces a wide variety of errors (DNS, TLS, HTTP, parse).
        # Collapse them into a single ProcessingError so the user gets a
        # sane message instead of an internal traceback.
        raise ProcessingError(f"Could not fetch or render '{url}': {exc}") from exc

    return str(output_path)
