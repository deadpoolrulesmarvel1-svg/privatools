"""Cross-origin answers for the site's own pages.

The site's pages run on https://privatools.me and call https://api.privatools.me
(deploy/api-subdomain-split.md), so every answer they read is a cross-origin
one. A browser hands such a page an answer only if it carries
Access-Control-Allow-Origin for the page's origin, and then only the
CORS-safelisted response headers (Content-Type, Content-Length and a few
others) plus those named in Access-Control-Expose-Headers. Any other header
reads as null on the page, and the page carries on without it.
"""

from __future__ import annotations

from collections.abc import Sequence

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import Message, Send

# Response headers the site's pages read from the API, and no others.
# backend/tests/test_cors_exposed_headers.py holds this list to what
# frontend/src reads, both ways.
SITE_EXPOSED_HEADERS = [
    "Content-Disposition",   # the server's file name for a download
    "X-Request-ID",          # the id in a failure's error report
    "X-Compressed-Size",     # Compress: each file's size afterwards
    "X-Target-Met",          # Compress: whether a target size was reached
    "X-Equations-Left-Out",  # Word to PDF: how many Word equations the PDF leaves out
    "X-Redaction-Report",    # Redact: what was removed, page by page
    "X-Redact-Hits",         # Smart Redact: how many matches were covered
    "X-Highlight-Hits",      # Highlight: how many matches were marked
    "X-Bates-Manifest",      # Bates Numbering: each file's number range
    "X-Bates-Removed",       # Remove Bates Numbers: how many were removed
    "X-Bates-Remaining",     # Remove Bates Numbers: how many were found but are still in the file
    "X-Bates-Elsewhere",     # Remove Bates Numbers: matches for the prefix left elsewhere in the file
    "X-Markdown-Report",     # PDF to Markdown: what was found, and pages without a text layer
]


class CORSMiddleware(StarletteCORSMiddleware):
    """Starlette's CORS layer, except that an answer to an origin it does not
    allow carries no CORS header at all.

    Starlette sends such an origin the list of exposed headers anyway. A
    browser ignores it without an Access-Control-Allow-Origin, but an answer
    the page may not read should not describe what it would have exposed.
    Preflights are unchanged."""

    async def send(self, message: Message, send: Send, request_headers: Headers) -> None:
        if message["type"] == "http.response.start" and not self.is_allowed_origin(origin=request_headers["origin"]):
            await send(message)
            return
        await super().send(message, send, request_headers)


async def add_cors_headers(request: Request, response: Response, layers: Sequence[StarletteCORSMiddleware]) -> None:
    """Give an answer made outside the CORS layers the headers they add.

    Starlette runs the catch-all exception handler in ServerErrorMiddleware,
    outside every add_middleware layer, so its answers (an unhandled 500, or
    the 413 a decompression bomb maps to) would carry no CORS header, and the
    page would read them as a network failure. `layers` are built with the
    same classes and options as the ones in the stack, innermost first; each
    adds its headers exactly as it does to an answer that passes through it.
    """
    if "origin" not in request.headers:
        return
    message: Message = {"type": "http.response.start", "status": response.status_code, "headers": list(response.raw_headers)}

    async def keep(_message: Message) -> None:
        return None

    for layer in layers:
        await layer.send(message, keep, request.headers)
    # In place: the response's `headers` view shares this list.
    response.raw_headers[:] = message["headers"]
