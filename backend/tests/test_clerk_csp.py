"""Clerk's origins must reach the account pages and nowhere else.

Clerk needs more of the policy than anything else in this app: its SDK is
script-src, its API is connect-src, its bot check is a Cloudflare Turnstile
iframe (frame-src, which did not exist here before), and its avatars are
img-src. That is a real widening, so it is bounded two ways — to the account
pages, and to hosts Clerk controls.

The wildcard deserves a note. test_byok_csp asserts connect-src is never a
wildcard, and `https://*.protect.clerk.com` is one. That guard exists to keep
`https:` — meaning any host on the internet — out of the policy; a wildcard
bounded to one vendor's domain is still an allowlist, and Clerk documents it
as required. The distinction is enforced below rather than left to a comment.

It also matters that these tests run with Clerk *configured*. The suite's
default environment has no publishable key, so every Clerk branch is skipped
and a test that forgot to set one would pass while proving nothing.
"""

from __future__ import annotations

import base64
import importlib
import os
import re

import pytest

FAPI_HOST = "climbing-reindeer-9195.clerk.accounts.dev"


def _pk(host: str = FAPI_HOST) -> str:
    return "pk_test_" + base64.b64encode(f"{host}$".encode()).decode()


@pytest.fixture()
def csp(monkeypatch):
    """_content_security_policy with Clerk switched on."""
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", _pk())
    import app.main as main

    importlib.reload(main)
    assert main._CLERK_FAPI_ORIGIN, "fixture failed to configure Clerk"
    yield main._content_security_policy
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    importlib.reload(main)


def _directive(policy: str, name: str) -> str:
    m = re.search(rf"(?:^|;\s*){name} ([^;]+)", policy)
    return m.group(1) if m else ""


def _sources(policy: str, name: str) -> list[str]:
    """A directive as its source tokens.

    Membership rather than substring on purpose: `"https://img.clerk.com" in
    directive` is also satisfied by `https://img.clerk.com.evil.com`, which is
    exactly the sort of thing these tests exist to catch. CodeQL flags the
    substring form as incomplete URL sanitization and it is right to.
    """
    return _directive(policy, name).split()


ACCOUNT_PATHS = ["/account", "/account/keys", "/account/"]
NON_ACCOUNT_PATHS = ["/", "/tool/merge-pdf", "/tool/summarize-pdf", "/about", "/accounts-payable"]


@pytest.mark.parametrize("path", ACCOUNT_PATHS)
def test_account_pages_can_reach_clerk(path: str, csp):
    policy = csp(path, "n0nce", "")
    assert f"https://{FAPI_HOST}" in _sources(policy, "script-src")
    assert f"https://{FAPI_HOST}" in _sources(policy, "connect-src")
    assert "https://img.clerk.com" in _sources(policy, "img-src")
    assert "https://challenges.cloudflare.com" in _sources(policy, "frame-src"), (
        "Clerk's bot check renders a Cloudflare Turnstile iframe; without "
        "frame-src it falls back to default-src 'self' and the check is blocked."
    )


@pytest.mark.parametrize("path", NON_ACCOUNT_PATHS)
def test_everything_else_never_sees_clerk(path: str, csp):
    """Including /accounts-payable — the prefix check must not match by accident."""
    policy = csp(path, "n0nce", "")
    for directive in ("script-src", "connect-src", "img-src", "frame-src"):
        value = _directive(policy, directive)
        assert "clerk" not in value, (
            f"{path} has Clerk in {directive} ({value!r}). Identity origins belong "
            "to the account pages; a bug on a tool page must not become a route out."
        )
        assert "cloudflare" not in value


@pytest.mark.parametrize("path", ACCOUNT_PATHS + NON_ACCOUNT_PATHS)
def test_no_scheme_wide_wildcard_anywhere(path: str, csp):
    """`https:` would allow any host. A vendor-bounded wildcard is still a list."""
    policy = csp(path, "n0nce", "")
    for directive in ("script-src", "connect-src", "img-src", "frame-src", "default-src"):
        value = _directive(policy, directive)
        assert not re.search(r"(?:^|\s)https:(?:\s|$)", value), (
            f"{path} has a scheme-wide wildcard in {directive}: {value!r}"
        )
        for token in value.split():
            if "*" not in token:
                continue
            # Loopback is exempt and always has been: a port wildcard on
            # 127.0.0.1/localhost can only reach the user's own machine, which
            # is the point of the local-model (Ollama, LM Studio) support.
            if token.startswith(("http://localhost:", "http://127.0.0.1:")):
                continue
            assert re.fullmatch(r"https://\*\.[a-z0-9.-]+\.[a-z]{2,}(?::\*)?", token), (
                f"{path} has an unbounded wildcard {token!r} in {directive}. Only a "
                "'*.vendor.tld' form is acceptable — it is still an allowlist."
            )


def test_a_doctored_key_cannot_inject_an_origin(monkeypatch):
    """The FAPI host comes from a key, so it is attacker-shaped input if the key is."""
    import app.main as main

    for bad in ("pk_test_" + base64.b64encode(b"evil.example.com$").decode(),
                "pk_test_" + base64.b64encode(b"clerk.accounts.dev.evil.com$").decode(),
                "pk_test_not-base64!!", "", "garbage"):
        assert main._clerk_fapi_origin(bad) == "", f"{bad!r} should not yield an origin"

    assert main._clerk_fapi_origin(_pk()) == f"https://{FAPI_HOST}"
