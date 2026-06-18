"""Small ASGI Brotli middleware for cacheable text responses.

Nginx Brotli modules are not available on every Ubuntu/nginx package set we
deploy to, so the app handles dynamic HTML compression itself when the client
advertises ``Accept-Encoding: br``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import brotli

ASGIApp = Callable[[dict[str, Any], Callable[[], Awaitable[dict[str, Any]]], Callable[[dict[str, Any]], Awaitable[None]]], Awaitable[None]]


_COMPRESSIBLE_TYPES = (
    "application/javascript",
    "application/json",
    "application/manifest+json",
    "application/xml",
    "image/svg+xml",
    "text/",
)


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str:
    lname = name.lower()
    for key, value in headers:
        if key.lower() == lname:
            return value.decode("latin-1")
    return ""


def _set_header(headers: list[tuple[bytes, bytes]], name: bytes, value: str) -> list[tuple[bytes, bytes]]:
    lname = name.lower()
    next_headers = [(key, val) for key, val in headers if key.lower() != lname]
    next_headers.append((name, value.encode("latin-1")))
    return next_headers


def _remove_header(headers: list[tuple[bytes, bytes]], name: bytes) -> list[tuple[bytes, bytes]]:
    lname = name.lower()
    return [(key, val) for key, val in headers if key.lower() != lname]


def _add_vary_accept_encoding(headers: list[tuple[bytes, bytes]]) -> list[tuple[bytes, bytes]]:
    vary = _header_value(headers, b"vary")
    values = [part.strip() for part in vary.split(",") if part.strip()]
    if not any(value.lower() == "accept-encoding" for value in values):
        values.append("Accept-Encoding")
    return _set_header(headers, b"vary", ", ".join(values))


class BrotliMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int = 500,
        maximum_size: int = 2 * 1024 * 1024,
        quality: int = 5,
    ) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.maximum_size = maximum_size
        self.quality = quality

    async def __call__(self, scope: dict[str, Any], receive: Callable[[], Awaitable[dict[str, Any]]], send: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_headers = scope.get("headers") or []
        accepts = _header_value(request_headers, b"accept-encoding").lower()
        if "br" not in accepts:
            await self.app(scope, receive, send)
            return

        method = (scope.get("method") or "").upper()
        if method == "HEAD":
            await self.app(scope, receive, send)
            return

        start_message: dict[str, Any] | None = None
        body_parts: list[bytes] = []
        buffered_size = 0
        passthrough = False
        started = False

        async def send_passthrough(message: dict[str, Any]) -> None:
            nonlocal started
            if not started:
                if start_message is not None:
                    await send(start_message)
                started = True
            await send(message)

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal start_message, buffered_size, passthrough

            if message["type"] == "http.response.start":
                start_message = message
                return

            if message["type"] != "http.response.body" or start_message is None:
                await send(message)
                return

            if passthrough:
                await send_passthrough(message)
                return

            chunk = message.get("body", b"")
            if chunk:
                body_parts.append(chunk)
                buffered_size += len(chunk)

            more_body = message.get("more_body", False)
            if buffered_size > self.maximum_size:
                passthrough = True
                await send_passthrough({"type": "http.response.body", "body": b"".join(body_parts), "more_body": more_body})
                return

            if more_body:
                return

            await self._send_final(start_message, b"".join(body_parts), send)

        await self.app(scope, receive, send_wrapper)

    async def _send_final(self, start_message: dict[str, Any], body: bytes, send: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        status = int(start_message.get("status", 200))
        headers = list(start_message.get("headers") or [])
        content_type = _header_value(headers, b"content-type").split(";", 1)[0].strip().lower()
        already_encoded = bool(_header_value(headers, b"content-encoding"))
        compressible = content_type.startswith(_COMPRESSIBLE_TYPES[-1]) or content_type in _COMPRESSIBLE_TYPES[:-1]

        if (
            already_encoded
            or status < 200
            or status in {204, 304}
            or len(body) < self.minimum_size
            or not compressible
        ):
            await send(start_message)
            await send({"type": "http.response.body", "body": body, "more_body": False})
            return

        compressed = brotli.compress(body, quality=self.quality)
        headers = _remove_header(headers, b"content-length")
        headers = _set_header(headers, b"content-encoding", "br")
        headers = _set_header(headers, b"content-length", str(len(compressed)))
        headers = _add_vary_accept_encoding(headers)
        start_message = {**start_message, "headers": headers}
        await send(start_message)
        await send({"type": "http.response.body", "body": compressed, "more_body": False})
