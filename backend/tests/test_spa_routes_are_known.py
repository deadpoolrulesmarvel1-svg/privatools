"""Every static route the SPA router declares must be a known path.

The SPA middleware answers an unknown path with HTTP 404 so Google does not
flag /tool/nonexistent-slug as a Soft 404. That is right, but it means any
route the frontend adds and the backend has not been told about is served as a
404: React Router still renders it, so the page *looks* fine, and the only
symptoms are the status code, a flash of "Page Not Found" in the tab title,
and crawlers being told the page does not exist.

That shipped. /account, /account/keys, /my-stuff/vault, /status and /support
all 404'd in production — Account and Vault while sitting in the main nav —
because the backend kept its own hand-written tuple of top-level routes and
nobody updated it. CLAUDE.md already warns that page slugs live in several
hand-maintained lists; this makes one of them checkable instead.

Parsed from App.tsx rather than duplicated, because a second copy of the list
is the bug.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.seo_meta import path_is_known

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_TSX = REPO_ROOT / "frontend" / "src" / "App.tsx"


def _declared_static_routes() -> list[str]:
    """Static <Route path="..."> values from the SPA router.

    Skips the catch-all and any route with a :param — those are covered by the
    prefix branches in path_is_known (/tool/, /blog/, ...), which resolve
    against the real registries and are tested elsewhere.
    """
    text = APP_TSX.read_text(encoding="utf-8")
    found = re.findall(r'<Route\s+[^>]*?path="([^"]+)"', text)
    assert found, "parsed no <Route path=...> out of App.tsx — the parser is stale"
    return sorted({p for p in found if "*" not in p and ":" not in p})


@pytest.mark.parametrize("route", _declared_static_routes())
def test_declared_spa_route_is_known_to_the_backend(route: str):
    assert path_is_known(route), (
        f'App.tsx declares <Route path="{route}"> but path_is_known() says no, '
        "so the backend serves it as HTTP 404 with the SPA shell. The page will "
        "render once React Router takes over, which is exactly why this is easy "
        "to miss — add it to _TOP_LEVEL_SPA_ROUTES in seo_meta.py."
    )


def test_unknown_paths_still_404():
    """The guard above must not be satisfied by making everything known."""
    for bogus in ("/definitely-not-a-route", "/tool/no-such-tool", "/blog/no-such-post"):
        assert not path_is_known(bogus), f"{bogus} should not be a known path"
