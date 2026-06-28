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

from ..utils.exceptions import DependencyError, ProcessingError
from ..utils.filenames import temp_output
from .html_to_pdf_service import _validate_url, _weasyprint_url_fetcher


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
