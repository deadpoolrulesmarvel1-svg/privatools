"""The frontend and backend tool registries must list the same slugs.

Two registries describe the same set of tools:

  frontend/src/data/tools.ts          -> /tool/<slug>   (PDF tools)
  frontend/src/data/non-pdf-tools.ts  -> /tools/<slug>  (everything else)
  backend/app/seo_meta.py             -> _PDF_TOOLS / _NONPDF_TOOLS

The frontend one drives the router and the generated sitemap. The backend one
drives `path_is_known()`, which the SPA middleware uses to decide between a 200
with SEO meta and a hard 404 — deliberately, so unknown paths don't read as
Soft 404s to Google.

Nothing checked that the two agreed, and they drifted. `remove-watermark` and
`remove-image-watermark` shipped in the frontend registry and were written into
sitemap.xml, but were never added to the backend dicts. Both tool pages
returned **404 in production** while the sitemap actively advertised them to
Google — the worst version of this failure, since it invites crawls of URLs
that then 404.

Nothing else caught it: the routes worked, the UI existed, the backend
endpoints were reachable and tested, and every other tool page was fine. The
only symptom was two URLs 404ing.

Drift in the other direction matters too: a backend entry with no frontend tool
means SEO metadata for a page that cannot render.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.seo_meta import _NONPDF_TOOLS, _PDF_TOOLS, path_is_known

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DATA = REPO_ROOT / "frontend" / "src" / "data"

_SLUG_RE = re.compile(r'slug:\s*"([a-z0-9][a-z0-9-]*)"')


def _frontend_slugs(filename: str) -> set[str]:
    path = FRONTEND_DATA / filename
    if not path.is_file():  # pragma: no cover - repo layout change
        pytest.skip(f"{filename} not present")
    return set(_SLUG_RE.findall(path.read_text(encoding="utf-8")))


def test_every_pdf_tool_page_is_known_to_the_backend():
    missing = sorted(_frontend_slugs("tools.ts") - set(_PDF_TOOLS))
    assert not missing, (
        "These PDF tools exist in the frontend registry (and therefore in "
        "sitemap.xml) but are absent from _PDF_TOOLS, so /tool/<slug> returns "
        f"404 in production:\n  {missing}"
    )


def test_every_non_pdf_tool_page_is_known_to_the_backend():
    missing = sorted(_frontend_slugs("non-pdf-tools.ts") - set(_NONPDF_TOOLS))
    assert not missing, (
        "These tools exist in the frontend registry (and therefore in "
        "sitemap.xml) but are absent from _NONPDF_TOOLS, so /tools/<slug> "
        f"returns 404 in production:\n  {missing}"
    )


def test_backend_has_no_tools_the_frontend_cannot_render():
    stale_pdf = sorted(set(_PDF_TOOLS) - _frontend_slugs("tools.ts"))
    stale_np = sorted(set(_NONPDF_TOOLS) - _frontend_slugs("non-pdf-tools.ts"))
    assert not stale_pdf and not stale_np, (
        "Backend SEO metadata exists for tools with no frontend entry, so the "
        "pages cannot render:\n"
        f"  _PDF_TOOLS only: {stale_pdf}\n  _NONPDF_TOOLS only: {stale_np}"
    )


def test_path_is_known_agrees_with_the_frontend_registries():
    """The parity above only matters because path_is_known gates the 404."""
    unknown = [
        f"/tool/{s}" for s in sorted(_frontend_slugs("tools.ts"))
        if not path_is_known(f"/tool/{s}")
    ] + [
        f"/tools/{s}" for s in sorted(_frontend_slugs("non-pdf-tools.ts"))
        if not path_is_known(f"/tools/{s}")
    ]
    assert not unknown, (
        "path_is_known() returns False for these real tool pages, so the SPA "
        f"middleware serves them as 404:\n  {unknown}"
    )


@pytest.mark.parametrize("path", [
    "/tool/remove-watermark",
    "/tools/remove-image-watermark",
])
def test_the_two_tools_that_shipped_404(path: str):
    """Pinned regression: these are the pages that were live-404ing."""
    assert path_is_known(path), (
        f"{path} is not a known route. It is in the frontend registry and in "
        "sitemap.xml, so returning 404 both breaks the tool and advertises a "
        "dead URL to search engines."
    )
