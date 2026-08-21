"""CSP must allow every BYOK provider origin, or the feature dies in the browser.

CORS passing is irrelevant while CSP says no: the browser refuses the request
before it is sent. A provider added to the registry without its origin here
looks like a network fault to the user and a CORS bug to a developer.

Origins are parsed out of providers.ts rather than duplicated, so the two
cannot drift — the same failure that put two 404s into production through the
frontend/backend tool registries.

The allowlist is applied PER PATH, not globally, mirroring how
'wasm-unsafe-eval' is already scoped to the two local-AI pages. A tool that
does not use BYOK has no business being able to reach an AI provider, and
scoping it means a bug on an unrelated page cannot exfiltrate anywhere.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.main import _content_security_policy, _BYOK_PATHS

REPO_ROOT = Path(__file__).resolve().parents[2]
PROVIDERS_TS = REPO_ROOT / "frontend" / "src" / "lib" / "byok" / "providers.ts"


def _registry_origins() -> set[str]:
    text = PROVIDERS_TS.read_text(encoding="utf-8")
    return set(re.findall(r'origin:\s*"([^"]+)"', text))


def _connect_src_for(path: str) -> str:
    csp = _content_security_policy(path, "n0nce", "")
    m = re.search(r"connect-src ([^;]+);", csp)
    assert m, f"no connect-src in CSP for {path}"
    return m.group(1)


def test_providers_file_exists_and_declares_origins():
    origins = _registry_origins()
    assert origins, "parsed zero origins from providers.ts — parser or file is wrong"


@pytest.mark.parametrize("path", sorted(_BYOK_PATHS))
def test_byok_pages_allow_every_provider_origin(path: str):
    connect = _connect_src_for(path)
    missing = sorted(
        o for o in _registry_origins()
        # loopback is emitted with a port wildcard, matched separately below
        if not o.startswith("http://localhost") and o not in connect
    )
    assert not missing, (
        f"{path} is a BYOK page but its connect-src omits {missing}; the "
        "browser will block every call to them."
    )


@pytest.mark.parametrize("path", sorted(_BYOK_PATHS))
def test_byok_pages_allow_loopback_for_local_models(path: str):
    connect = _connect_src_for(path)
    assert "http://localhost:*" in connect and "http://127.0.0.1:*" in connect, (
        "Local models (Ollama, LM Studio) need loopback. It is safe: loopback "
        "is a potentially trustworthy origin, exempt from mixed-content "
        "blocking, and can only reach the user's own machine."
    )


def test_non_byok_pages_do_not_get_provider_origins():
    """Scoping is the point — an unrelated tool must not reach a provider."""
    connect = _connect_src_for("/tool/merge-pdf")
    for origin in _registry_origins():
        if origin.startswith("http://localhost"):
            continue
        assert origin not in connect, (
            f"/tool/merge-pdf can reach {origin}. BYOK origins must be scoped "
            "to pages that actually use them, so a bug on an unrelated tool "
            "cannot exfiltrate to an AI provider."
        )


def test_connect_src_is_never_a_wildcard():
    for path in ["/", "/tool/merge-pdf", *sorted(_BYOK_PATHS)]:
        connect = _connect_src_for(path)
        assert "https:" not in connect.replace("https://", ""), (
            f"{path} has a wildcard-ish connect-src. It must stay a curated "
            "allowlist: 'https:' would let any page exfiltrate to any host, "
            "which is exactly what this product promises does not happen."
        )
        assert "*" not in connect.replace("localhost:*", "").replace("127.0.0.1:*", "")
