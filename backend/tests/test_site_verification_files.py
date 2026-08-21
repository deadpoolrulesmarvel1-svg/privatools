"""Search-engine verification files must be served byte-exact.

Google requires `google<token>.html` to contain exactly:

    google-site-verification: google<token>.html

The catch-all static handler treated every `.html` file as an SPA document and
ran it through the CSP-nonce and runtime-config injectors. A verification token
file has no `</head>`, so `inject_runtime_config` fell back to PREPENDING its
tag, producing:

    <meta name="privatools:api-base" content="https://api.privatools.me">google-site-verification: ...

Google rejected that and revoked the property, which is why Search Console
started reporting "you don't have access to this property".

The bug was dormant until `PUBLIC_API_BASE_URL` was set — before the
api-subdomain split was activated the injector was a no-op, so verification had
worked fine. Enabling that flag silently broke it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.runtime_config import inject_runtime_config

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC = REPO_ROOT / "frontend" / "public"

API_BASE = "https://api.privatools.me"


def _verification_files() -> list[Path]:
    if not PUBLIC.is_dir():
        return []
    return [
        p for p in PUBLIC.iterdir()
        if p.is_file()
        and (p.name.startswith(("google", "yandex", "baidu_verify", "BingSiteAuth")))
    ]


def test_a_verification_file_exists():
    assert _verification_files(), "no search-engine verification file in frontend/public"


@pytest.mark.parametrize("path", _verification_files(), ids=lambda p: p.name)
def test_verification_file_is_not_mangled_by_runtime_config(path: Path):
    """The injector must leave a token file exactly as-is."""
    original = path.read_text("utf-8")
    assert inject_runtime_config(original, API_BASE) == original, (
        f"{path.name} was modified — search engines require it byte-exact"
    )


def test_injector_still_works_on_the_real_spa_shell():
    """The fix must not break the thing the injector exists for."""
    shell = "<!doctype html><html><head><title>x</title></head><body></body></html>"
    out = inject_runtime_config(shell, API_BASE)
    assert 'content="https://api.privatools.me"' in out
    assert out.index("privatools:api-base") < out.index("</head>")


def test_injector_is_a_noop_without_a_configured_api_base():
    shell = "<!doctype html><html><head></head><body></body></html>"
    assert inject_runtime_config(shell, "") == shell


def test_google_token_file_content_shape():
    """Google's file is a single line naming itself — assert we ship that."""
    google = [p for p in _verification_files() if p.name.startswith("google")]
    assert google, "no Google verification file"
    for path in google:
        body = path.read_text("utf-8").strip()
        assert body == f"google-site-verification: {path.name}", (
            f"{path.name} content is {body!r}; Google expects "
            f"'google-site-verification: {path.name}'"
        )
