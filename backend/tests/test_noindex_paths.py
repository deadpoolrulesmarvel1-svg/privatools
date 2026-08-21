"""Pages that are real (HTTP 200) but must never be indexed.

Until /my-stuff, every path was either a known page (indexed) or unknown
(noindex + 404). /my-stuff is the first page that genuinely exists but should
stay out of search results: it is a per-device management screen with no
content value, and surfacing it in results would be confusing at best.
"""

from app.seo_meta import NOINDEX_PATHS, inject_seo, path_is_known


def _html() -> str:
    return (
        "<html><head><title>x</title>"
        '<meta name="description" content="x">'
        '<meta name="robots" content="index,follow">'
        '<link rel="canonical" href="https://privatools.me/">'
        "</head><body></body></html>"
    )


def test_my_stuff_is_a_known_path():
    """Known => the SPA middleware serves 200, not a soft-404."""
    assert path_is_known("/my-stuff") is True


def test_my_stuff_is_marked_noindex():
    assert "/my-stuff" in NOINDEX_PATHS
    out = inject_seo(_html(), "/my-stuff")
    assert 'name="robots" content="noindex,nofollow"' in out


def test_my_stuff_has_no_canonical():
    """Google advises against pairing noindex with a self-canonical."""
    out = inject_seo(_html(), "/my-stuff")
    assert 'rel="canonical"' not in out


def test_ordinary_pages_stay_indexable():
    out = inject_seo(_html(), "/privacy")
    assert "noindex" not in out
    assert 'rel="canonical"' in out


def test_my_stuff_still_gets_a_title():
    out = inject_seo(_html(), "/my-stuff")
    assert "<title>" in out
    assert "x</title>" not in out


def test_noindex_paths_are_absent_from_the_sitemap():
    """A noindex page listed in the sitemap is a self-contradiction."""
    from app.routes.sitemap import _build_sitemap_xml

    xml = _build_sitemap_xml("2026-08-21").decode("utf-8")
    for path in NOINDEX_PATHS:
        assert f"{path}</loc>" not in xml
