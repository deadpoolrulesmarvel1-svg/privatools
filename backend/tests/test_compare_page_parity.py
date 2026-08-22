"""The compare-page competitor list and the backend's static meta must agree.

`test_tool_registry_parity` covers /tool/<slug> and /tools/<slug>. Compare pages
have exactly the same failure mode and nothing was checking them:

  frontend/src/pages/ComparePage.tsx  -> the `competitors` object, which drives
                                         the /compare/:competitor route
  backend/app/seo_meta.py             -> "/compare/<slug>" keys in _STATIC_META,
                                         which `path_is_known()` uses to choose
                                         between a 200 and a hard 404
  backend/app/routes/sitemap.py       -> COMPARE_PAGES, the served sitemap
  frontend/scripts/gen-llms.mjs       -> COMPARE_PAGES, public/sitemap.xml
  frontend/vite.config.ts             -> COMPARE_SLUGS, dist/sitemap.xml
                                         (the one that actually ships)

Five hand-maintained lists of the same slugs. Three of them carry a "must stay
in sync" comment pointing at the others, which is the tell: sync-by-comment is
what this test replaces.

Add a competitor to the frontend only and the page renders in dev, gets linked
from the compare directory, and then **404s in production** — the same bug that
hit `remove-watermark`. Drift the other way means SEO metadata for a page that
renders "competitor not found".
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.routes.sitemap import COMPARE_PAGES
from app.seo_meta import _STATIC_META, path_is_known

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPARE_PAGE = REPO_ROOT / "frontend" / "src" / "pages" / "ComparePage.tsx"
GEN_LLMS = REPO_ROOT / "frontend" / "scripts" / "gen-llms.mjs"
VITE_CONFIG = REPO_ROOT / "frontend" / "vite.config.ts"

# Matches `slug: "ilovepdf",` inside the competitor records. Using the slug
# field rather than the object key avoids tripping over quoted keys like
# `"adobe-acrobat": {`, and the two are asserted to agree below.
_SLUG_RE = re.compile(r'slug:\s*"([a-z0-9][a-z0-9-]*)"')


def _frontend_compare_slugs() -> set[str]:
    if not COMPARE_PAGE.is_file():  # pragma: no cover - repo layout change
        pytest.skip("ComparePage.tsx not present")
    return set(_SLUG_RE.findall(COMPARE_PAGE.read_text(encoding="utf-8")))


def _backend_compare_slugs() -> set[str]:
    prefix = "/compare/"
    return {k[len(prefix):] for k in _STATIC_META if k.startswith(prefix)}


def test_every_compare_page_is_known_to_the_backend():
    missing = sorted(_frontend_compare_slugs() - _backend_compare_slugs())
    assert not missing, (
        "These competitors exist in ComparePage.tsx but have no "
        '"/compare/<slug>" entry in _STATIC_META, so the page returns 404 in '
        f"production:\n  {missing}"
    )


def test_no_orphaned_compare_metadata():
    orphans = sorted(_backend_compare_slugs() - _frontend_compare_slugs())
    assert not orphans, (
        "These /compare/<slug> paths have backend SEO metadata but no matching "
        "competitor in ComparePage.tsx, so they render 'not found' with a "
        f"200:\n  {orphans}"
    )


def test_compare_paths_resolve_as_known():
    for slug in sorted(_frontend_compare_slugs()):
        assert path_is_known(f"/compare/{slug}"), (
            f"/compare/{slug} is not recognised by path_is_known()"
        )


def test_unknown_competitor_is_not_treated_as_known():
    assert not path_is_known("/compare/definitely-not-a-competitor")


def test_the_two_new_competitors_are_registered():
    """TinyWow and ihatepdf.cv were added from the Aug 2026 competitor audit."""
    slugs = _frontend_compare_slugs()
    assert {"tinywow", "ihatepdf"} <= slugs
    assert {"tinywow", "ihatepdf"} <= _backend_compare_slugs()


def _gen_llms_compare_slugs() -> set[str]:
    """Pull COMPARE_PAGES out of the sitemap generator script."""
    if not GEN_LLMS.is_file():  # pragma: no cover - repo layout change
        pytest.skip("gen-llms.mjs not present")
    text = GEN_LLMS.read_text(encoding="utf-8")
    m = re.search(r"const COMPARE_PAGES\s*=\s*\[(.*?)\]", text, re.S)
    assert m, "COMPARE_PAGES array not found in gen-llms.mjs"
    return set(re.findall(r'"([a-z0-9][a-z0-9-]*)"', m.group(1)))


def test_served_sitemap_lists_exactly_the_frontend_competitors():
    assert set(COMPARE_PAGES) == _frontend_compare_slugs(), (
        "backend/app/routes/sitemap.py COMPARE_PAGES has drifted from "
        "ComparePage.tsx — the served sitemap would advertise or omit a "
        "comparison page."
    )


def test_built_sitemap_lists_exactly_the_frontend_competitors():
    assert _gen_llms_compare_slugs() == _frontend_compare_slugs(), (
        "frontend/scripts/gen-llms.mjs COMPARE_PAGES has drifted from "
        "ComparePage.tsx — the built sitemap.xml would advertise or omit a "
        "comparison page."
    )


def _vite_compare_slugs() -> set[str]:
    """Pull COMPARE_SLUGS out of the vite config that emits dist/sitemap.xml."""
    if not VITE_CONFIG.is_file():  # pragma: no cover - repo layout change
        pytest.skip("vite.config.ts not present")
    text = VITE_CONFIG.read_text(encoding="utf-8")
    m = re.search(r"const COMPARE_SLUGS\s*=\s*\[(.*?)\]", text, re.S)
    assert m, "COMPARE_SLUGS array not found in vite.config.ts"
    return set(re.findall(r'"([a-z0-9][a-z0-9-]*)"', m.group(1)))


def test_shipped_sitemap_lists_exactly_the_frontend_competitors():
    """vite.config.ts emits dist/sitemap.xml — the sitemap that actually ships."""
    assert _vite_compare_slugs() == _frontend_compare_slugs(), (
        "frontend/vite.config.ts COMPARE_SLUGS has drifted from ComparePage.tsx "
        "\u2014 the shipped dist/sitemap.xml would advertise or omit a comparison page."
    )


def test_all_five_registries_agree():
    """The whole point: one set of slugs, five places that must list it."""
    assert (
        _frontend_compare_slugs()
        == _backend_compare_slugs()
        == set(COMPARE_PAGES)
        == _gen_llms_compare_slugs()
        == _vite_compare_slugs()
    )
