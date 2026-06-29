"""SSRF / LFI guard for cairosvg SVG rasterization.

cairosvg's *default* ``url_fetcher`` resolves ``<image href>``, ``<use>``, and
CSS ``url()`` references via urllib for ``file://``, ``http(s)://`` and ``data:``
with **no restriction**. So an uploaded SVG containing
``<image href="file:///etc/passwd">`` or ``href="http://169.254.169.254/...">``
would have those resources fetched and rasterized into the PNG/PDF the attacker
downloads — arbitrary local-file disclosure plus SSRF to internal/metadata
endpoints. The HTML/URL-to-PDF tools already guard exactly this for WeasyPrint
(``_weasyprint_url_fetcher``); this mirrors that deny-by-default stance for
cairosvg so the SVG path can't bypass it.

Policy: allow only inline ``data:`` URIs (decoded in-memory — no file or network
access); block ``file://``, ``http(s)://``, and every other external reference.
Pure-vector SVGs (icons/logos/diagrams) never trigger the fetcher at all.

Pure stdlib — no cairosvg import — so it's importable and unit-testable without
the native cairo/pango libs.
"""

from __future__ import annotations

import base64
from urllib.parse import unquote_to_bytes


def block_external_refs(url: str, resource_type: str | None = None) -> dict:
    """cairosvg ``url_fetcher`` that permits only inline ``data:`` URIs.

    cairosvg calls this as ``fetcher(url, resource_type)`` and expects a dict
    with a ``"string"`` (content bytes) and optional ``"mime_type"``. We decode
    ``data:`` URIs ourselves (in-memory) and raise for anything else, so no
    ``file://`` or network reference is ever fetched.
    """
    if not isinstance(url, str) or not url.startswith("data:"):
        raise ValueError(f"external SVG reference blocked: {url!r}")

    meta, _, payload = url[len("data:") :].partition(",")
    if meta.endswith(";base64"):
        content = base64.b64decode(payload)
        mime = meta[: -len(";base64")]
    else:
        content = unquote_to_bytes(payload)
        mime = meta
    return {"string": content, "mime_type": (mime.split(";")[0] or "text/plain")}
