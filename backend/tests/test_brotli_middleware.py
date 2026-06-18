import asyncio

import brotli

from backend.app.middleware.brotli import BrotliMiddleware


def _run_app(app, *, accept_encoding: bytes = b"br"):
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"accept-encoding", accept_encoding)],
    }
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(app(scope, receive, send))
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())
    return messages


def _headers(start_message):
    return {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in start_message["headers"]}


def test_brotli_compresses_text_responses():
    body = b"<html>" + (b"privacy-first " * 80) + b"</html>"

    async def app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"text/html; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body, "more_body": False})

    messages = _run_app(BrotliMiddleware(app, minimum_size=50))
    headers = _headers(messages[0])

    assert headers["content-encoding"] == "br"
    assert headers["vary"] == "Accept-Encoding"
    assert brotli.decompress(messages[1]["body"]) == body


def test_brotli_skips_binary_responses():
    body = b"%PDF-1.7" + (b"x" * 1000)

    async def app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/pdf"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body, "more_body": False})

    messages = _run_app(BrotliMiddleware(app, minimum_size=50))
    headers = _headers(messages[0])

    assert "content-encoding" not in headers
    assert messages[1]["body"] == body
