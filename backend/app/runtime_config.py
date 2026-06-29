"""Runtime (per-deploy) configuration the SPA reads at startup.

The **api-subdomain split** is driven entirely from here. When
``PUBLIC_API_BASE_URL`` is set (e.g. ``https://api.privatools.me``), the backend
injects a ``<meta name="privatools:api-base">`` tag into the served
``index.html`` so the *already-built* SPA bundle sends its ``/api`` requests to
that separate origin instead of same-origin — with **no frontend rebuild**.
Empty/unset keeps everything same-origin, so local dev and the current prod are
unchanged until the flag is set.

Why a ``<meta>`` tag and not an inline ``<script>``: the page's CSP uses a
per-request ``script-src`` nonce (no ``unsafe-inline``), so an inline config
script would need nonce handling. A meta tag needs no script-src privilege and
is read once at module load by ``frontend/src/lib/api.ts``.

This module is pure and stdlib-only on purpose: it imports cleanly (and is
unit-testable) without the FastAPI app or its native dependencies.
"""

from __future__ import annotations

from html import escape as _html_escape

#: Name of the ``<meta>`` tag the SPA reads to discover its API origin. Must
#: stay in sync with ``frontend/src/lib/api.ts`` (resolveApiOrigin()).
API_BASE_META_NAME = "privatools:api-base"


def host_from_url(value: str) -> str:
    """Return the bare hostname of a URL or host string.

    Strips scheme, port, and path::

        https://api.privatools.me:443/api  ->  api.privatools.me
        api.privatools.me                  ->  api.privatools.me

    Domain/IPv4 hosts only — bracketed IPv6 literals (``[::1]:8000``) are not
    supported here (the colon split would mangle them). PUBLIC_API_BASE_URL is
    always a domain in practice, so this is sufficient.
    """
    return value.strip().split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]


def normalize_origin(api_base: str) -> str:
    """Trim whitespace and a single trailing slash from an origin string."""
    return api_base.strip().rstrip("/")


def runtime_config_meta(api_base: str) -> str:
    """The ``<meta>`` tag advertising the API origin, or ``""`` for same-origin.

    ``api_base`` is an origin like ``https://api.privatools.me`` (no ``/api``
    suffix — the SPA appends that). Returns ``""`` when blank so same-origin
    deploys inject nothing. The value is HTML-attribute escaped.
    """
    origin = normalize_origin(api_base)
    if not origin:
        return ""
    return f'<meta name="{API_BASE_META_NAME}" content="{_html_escape(origin, quote=True)}">'


def inject_runtime_config(html: str, api_base: str) -> str:
    """Insert the API-origin ``<meta>`` tag into an ``index.html`` string.

    No-op when ``api_base`` is blank. Inserts just before the (last) ``</head>``;
    if the document has no head, the tag is prepended so the SPA still finds it.
    """
    tag = runtime_config_meta(api_base)
    if not tag:
        return html
    idx = html.lower().rfind("</head>")
    if idx == -1:
        return tag + html
    return f"{html[:idx]}{tag}{html[idx:]}"
