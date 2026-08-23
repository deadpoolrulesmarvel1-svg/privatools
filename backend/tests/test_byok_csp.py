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
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
TOOL_PAGE_TSX = FRONTEND_SRC / "pages" / "ToolPage.tsx"


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


# --- the set itself, derived rather than restated -------------------------
#
# The docstring above says a tool that does not use BYOK has no business
# reaching a provider. Asserting that needs the *actual* answer to "which
# pages use BYOK", not a second copy of _BYOK_PATHS — a copy agrees with a
# mistake. So walk the frontend: which lazily-loaded tool component can, by
# following its imports, reach lib/byok. Smart Redact sat in this set for a
# while on the strength of being an "AI page"; it runs BERT-NER in the tab and
# never calls out, which is what the walk sees and a hand-written list did not.

_IMPORT_RE = re.compile(r'from\s+"(@/[^"]+)"')


def _resolve(spec: str) -> Path | None:
    rel = spec[len("@/"):]
    for cand in (f"{rel}.tsx", f"{rel}.ts", f"{rel}/index.tsx", f"{rel}/index.ts"):
        f = FRONTEND_SRC / cand
        if f.exists():
            return f
    return None


def _reaches_byok(entry: Path) -> bool:
    """True if entry transitively imports anything under lib/byok."""
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        f = stack.pop()
        if f in seen or not f.exists():
            continue
        seen.add(f)
        if "lib/byok" in f.as_posix():
            return True
        for spec in _IMPORT_RE.findall(f.read_text(encoding="utf-8")):
            if spec.startswith("@/lib/byok"):
                return True
            nxt = _resolve(spec)
            if nxt is not None and nxt.suffix in (".ts", ".tsx"):
                stack.append(nxt)
    return False


def _slugs_that_use_byok() -> set[str]:
    """Slugs whose ToolPage component can reach a BYOK provider."""
    page = TOOL_PAGE_TSX.read_text(encoding="utf-8")

    # const LazyFooUI = lazyNamed(() => import("@/components/tool-ui/FooUI"), ...)
    modules = dict(
        re.findall(r'const\s+(\w+)\s*=\s*lazyNamed\(\s*\(\)\s*=>\s*import\("(@/[^"]+)"\)', page)
    )
    assert modules, "parsed zero lazy tool components from ToolPage.tsx — parser is stale"

    # case "slug": return <LazyFooUI />;
    cases = re.findall(r'case\s+"([a-z0-9-]+)":\s*return\s*<(\w+)\b', page)
    assert cases, "parsed zero slug->component cases from ToolPage.tsx — parser is stale"

    out: set[str] = set()
    for slug, comp in cases:
        spec = modules.get(comp)
        if not spec:
            continue
        entry = _resolve(spec)
        if entry is not None and _reaches_byok(entry):
            out.add(slug)
    return out


def test_byok_paths_match_the_pages_that_actually_use_byok():
    expected = {f"/tool/{slug}" for slug in _slugs_that_use_byok()}
    assert expected, "the walk found no BYOK page at all — it has gone blind, fix it before trusting it"

    extra = sorted(_BYOK_PATHS - expected)
    assert not extra, (
        f"{extra} can reach an AI provider but never calls one. Every page in "
        "_BYOK_PATHS is a page whose CSP permits egress to eight AI vendors; "
        "grant that only where a key is actually used."
    )

    missing = sorted(expected - _BYOK_PATHS)
    assert not missing, (
        f"{missing} use BYOK but are absent from _BYOK_PATHS, so the browser "
        "will block every provider call — a network fault to the user."
    )
