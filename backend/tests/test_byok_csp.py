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
NON_PDF_PAGE_TSX = FRONTEND_SRC / "pages" / "NonPdfToolPage.tsx"


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
        # Scoped subdomain wildcards on a single named vendor are allowed —
        # Hugging Face redirects model weights to region-varying CDN hosts, so
        # an exact list would break for users outside one region. What must
        # never appear is a *scheme* wildcard ("https:") or a bare "*", which
        # would let any page reach any host.
        residual = (
            connect.replace("localhost:*", "")
            .replace("127.0.0.1:*", "")
            .replace("https://*.hf.co", "")
        )
        assert "*" not in residual, (
            f"{path} connect-src carries an unscoped wildcard: {connect}"
        )


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


def _slugs_that_use_byok(page_file: Path = TOOL_PAGE_TSX) -> set[str]:
    """Slugs whose tool component on the given page can reach a BYOK provider."""
    page = page_file.read_text(encoding="utf-8")

    # const LazyFooUI = lazyNamed(() => import("@/components/tool-ui/FooUI"), ...)
    modules = dict(
        re.findall(r'const\s+(\w+)\s*=\s*lazyNamed\(\s*\(\)\s*=>\s*import\("(@/[^"]+)"\)', page)
    )
    assert modules, f"parsed zero lazy tool components from {page_file.name} — parser is stale"

    # case "slug": return <LazyFooUI />;
    cases = re.findall(r'case\s+"([a-z0-9-]+)":\s*return\s*<(\w+)\b', page)
    assert cases, f"parsed zero slug->component cases from {page_file.name} — parser is stale"

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
    # PDF tools live at /tool/<slug>, non-PDF at /tools/<slug> — walk both
    # pages, or the set is blind to half the catalogue (image OCR and audio
    # transcription were the first non-PDF BYOK pages).
    expected = {f"/tool/{slug}" for slug in _slugs_that_use_byok(TOOL_PAGE_TSX)} | {
        f"/tools/{slug}" for slug in _slugs_that_use_byok(NON_PDF_PAGE_TSX)
    }
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


# ---------------------------------------------------------------------------
# Clerk's origins are scoped to /account, and the skin must therefore reach the
# account page by that PATH. It once linked to `#/account`, a hash — which the
# browser never sends to a server, so the page was served the homepage's or a
# tool's policy, neither of which names Clerk, and clerk-js was blocked. The
# symptom was "Failed to load Clerk JS" for every visitor who clicked Sign in,
# while a direct visit to /account worked, which is what made it hard to see.
# ---------------------------------------------------------------------------

SKIN_TSX = FRONTEND_SRC / "skins" / "daylight" / "SkinApp.tsx"


def test_account_is_linked_by_path_not_hash():
    """No `href="#/account"` anywhere in the skin."""
    text = SKIN_TSX.read_text(encoding="utf-8")
    offenders = re.findall(r'href=\{?"#/account[^"]*"', text)
    assert not offenders, (
        "The account page must be reached by a real path so it gets the CSP "
        f"that permits clerk-js; found hash links: {offenders}"
    )


def test_only_account_path_carries_clerk_origins(monkeypatch):
    """/account gets Clerk's hosts; the homepage and tool pages do not."""
    import app.main as main

    if not main._CLERK_FAPI_ORIGIN:
        monkeypatch.setattr(main, "_CLERK_FAPI_ORIGIN", "https://clerk.example.com")

    origin = main._CLERK_FAPI_ORIGIN
    account = main._content_security_policy("/account", "n0nce", "")
    assert origin in account, "clerk-js cannot load on the page that needs it"

    for path in ("/", "/tools", "/tool/merge-pdf"):
        csp = main._content_security_policy(path, "n0nce", "")
        assert origin not in csp, (
            f"{path} should not be able to reach the identity provider; if the "
            "skin now needs it there, the account route regressed to a hash"
        )
