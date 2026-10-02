"""Global exception handlers.

These translate Python-level errors raised anywhere in the request
lifecycle into JSON responses with `detail` strings worded for the
frontend's `friendlyError()` mapper. Without this, an unhandled
``pikepdf.PasswordError`` from a service would bubble up as an opaque
500 — the user would see "Something went wrong" instead of the
"unlock first" prompt.

Wire via :func:`register_error_handlers(app)` in `main.py`.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..utils.exceptions import ToolError
from ..utils.images import image_read_error

logger = logging.getLogger("privatools.errors")

_V1_ERROR_CODES = {
    400: "invalid_request", 401: "unauthorized", 403: "forbidden",
    404: "not_found", 405: "method_not_allowed", 409: "conflict",
    410: "gone", 413: "payload_too_large", 415: "unsupported_media_type",
    422: "validation_error", 429: "rate_limited", 500: "processing_failed",
    501: "not_implemented", 503: "service_unavailable", 504: "processing_timeout",
}
_V1_SERVICE_MESSAGES = {
    "server_busy": "The API is busy. Retry shortly.",
    "admission_unavailable": "API admission is temporarily unavailable. Try again shortly.",
}
# A 5xx body names the kind of failure and nothing else, on every surface.
# The detail a service or route raised with can carry stderr, exception text
# or a server path (qpdf's stderr names the upload's temp file), so the
# handlers log it, and the request id in the body finds that log line.
_GENERIC_5XX = {
    501: "This feature is not available.",
    503: "The service is temporarily unavailable. Please try again.",
    504: "The operation timed out. Try a smaller file.",
}


def _is_v1(request: Request | None) -> bool:
    return request is not None and request.url.path.startswith("/api/v1/")


def _json(
    status: int,
    detail: str,
    *,
    request: Request | None = None,
    extra: dict[str, Any] | None = None,
    passthrough_headers: dict[str, str] | None = None,
) -> JSONResponse:
    if status >= 500:
        detail = _GENERIC_5XX.get(status, "Processing failed. Please try again.")
    body: dict[str, Any] = {"detail": detail}
    if extra:
        body.update(extra)
    if _is_v1(request):
        body.setdefault("code", _V1_ERROR_CODES.get(status, "request_failed"))
        body.setdefault("message", detail)
        request.state.v1_error_code = body["code"]
    # Headers set on the HTTPException are part of the answer, not decoration:
    # a 429 without Retry-After tells the client nothing about when to try
    # again, and a 401 without WWW-Authenticate omits the scheme.
    headers: dict[str, str] = dict(passthrough_headers or {})
    if request is not None:
        rid = getattr(request.state, "request_id", None)
        if rid:
            headers["X-Request-ID"] = rid
            body["request_id"] = rid
    return JSONResponse(status_code=status, content=body, headers=headers)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------
async def tool_error_handler(request: Request, exc: ToolError) -> JSONResponse:
    """Map our custom service exceptions onto HTTP responses."""
    # Only log full traceback for unexpected 5xx — 4xx are user-facing and
    # noisy if every "wrong password" leaves a stack trace.
    if exc.status_code >= 500:
        logger.exception("ToolError 5xx on %s: %s", request.url.path, exc.detail)
    else:
        logger.info("ToolError %d on %s: %s", exc.status_code, request.url.path, exc.detail)
    return _json(exc.status_code, exc.detail, request=request)


def _json_payload(status: int, payload: dict, *, request: Request, headers=None) -> JSONResponse:
    """Return a structured body verbatim, keeping the request id and headers."""
    body = dict(payload)
    body.setdefault("code", _V1_ERROR_CODES.get(status, "request_failed"))
    body.setdefault("message", body.get("detail", "Request failed"))
    body.setdefault("detail", body["message"])
    if _is_v1(request):
        request.state.v1_error_code = body["code"]
    rid = getattr(request.state, "request_id", None)
    if rid:
        body.setdefault("request_id", rid)
    response = JSONResponse(status_code=status, content=body)
    for name, value in (headers or {}).items():
        response.headers[name] = value
    if rid:
        response.headers["X-Request-ID"] = rid
    return response


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Preserve HTTPException semantics but propagate the request-id header."""
    # /api/v1 raises a dict detail carrying a machine-readable `code` alongside
    # the human message, so a client can branch without string-matching prose.
    # Flattening that to "Request failed" would take the contract away; it is
    # only passed through on 4xx, where the detail is author-curated, and only
    # on the versioned surface.
    if _is_v1(request) and exc.status_code == 503 and isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if code in _V1_SERVICE_MESSAGES:
            return _json_payload(
                503, {"code": code, "message": _V1_SERVICE_MESSAGES[code]},
                request=request,
                headers={k: v for k, v in (exc.headers or {}).items() if k.lower() == "retry-after"},
            )
    if (
        isinstance(exc.detail, dict)
        and exc.status_code < 500
        and _is_v1(request)
    ):
        return _json_payload(exc.status_code, exc.detail, request=request,
                             headers=getattr(exc, "headers", None))

    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    if exc.status_code == 400 and detail.startswith("Part exceeded maximum size"):
        return _json(
            413,
            "Form field is too large. Try a smaller signature or upload file.",
            request=request,
        )
    # Never echo internal exception text to clients on a 5xx. Many route
    # handlers raise HTTPException(500, detail=f"...{exc}"), which would leak
    # stack/path fragments and library internals. Log the specifics server-side
    # (route handlers already logger.exception; this captures the rest); _json
    # answers with a generic message. 4xx detail is author-curated and passes
    # through.
    if exc.status_code >= 500:
        logger.warning("%d on %s: %s", exc.status_code, request.url.path, detail)
    return _json(
        exc.status_code, detail, request=request,
        passthrough_headers=getattr(exc, "headers", None) if exc.status_code < 500 else None,
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """FastAPI request-validation errors.

    The default response is a verbose array of error objects keyed on
    `loc` — useful for debugging, awful for the frontend's
    `friendlyError()`. We collapse it into one human sentence and keep
    the original list under `errors` for developers.
    """
    errors = exc.errors()
    if _is_v1(request):
        # A known framework validation rejection is refundable. A tool may
        # independently return 422 after computing, so status alone is unsafe.
        request.state.v1_validation_rejected = True
        # Describe invalid fields without reflecting submitted content or
        # non-serializable exception objects from Pydantic's input/ctx fields.
        errors = [{k: error[k] for k in ("type", "loc", "msg") if k in error}
                  for error in errors]
    if errors:
        first = errors[0]
        loc = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query"))
        msg = first.get("msg", "Invalid value")
        if loc:
            detail = f"Invalid value for '{loc}': {msg}"
        else:
            detail = f"Invalid request: {msg}"
    else:
        detail = "Invalid request"
    return _json(422, detail, request=request, extra={"errors": errors})


async def builtin_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all that translates well-known Python exceptions to friendly responses.

    Order matters here — earlier branches win. Each branch tries to use
    wording that matches the substrings frontend `friendlyError()` looks
    for (password / encrypted / protected / too large / corrupt /
    out of range / timeout / not found).
    """
    name = type(exc).__name__
    msg = str(exc)

    # Pillow — an upload it can't read, one cut short, or one past the pixel
    # cap: the file's fault, so a 400 or 413 that says so (utils.images).
    image_error = image_read_error(exc)
    if image_error is not None:
        return _json(image_error[0], image_error[1], request=request)

    # pikepdf — password
    if name == "PasswordError":
        return _json(
            400,
            "This PDF is password-protected. Unlock it first, then try again.",
            request=request,
        )

    # pikepdf — PdfError (corrupt / malformed)
    if name == "PdfError":
        return _json(400, "This PDF appears to be corrupt or invalid.", request=request)

    # pypdf — encryption / read errors
    if name in {"DependencyError", "PdfReadError", "EmptyFileError"}:
        # Heuristic: messages mentioning encryption should land on the
        # password branch, anything else is treated as corrupt.
        if "encrypt" in msg.lower() or "password" in msg.lower():
            return _json(
                400,
                "This PDF is password-protected. Unlock it first, then try again.",
                request=request,
            )
        return _json(400, "This PDF appears to be corrupt or invalid.", request=request)

    # File system
    if isinstance(exc, FileNotFoundError):
        return _json(400, "File not provided or no longer available.", request=request)
    if isinstance(exc, PermissionError):
        logger.exception("PermissionError on %s", request.url.path)
        return _json(500, "Server can't read this PDF (permission denied).", request=request)
    if isinstance(exc, IsADirectoryError):
        return _json(400, "Expected a file but got a directory.", request=request)

    # Memory / resource caps
    if isinstance(exc, MemoryError):
        logger.error("MemoryError on %s", request.url.path)
        return _json(
            413,
            "File is too large to process on the server. Try compressing it first.",
            request=request,
        )

    # Timeout
    if isinstance(exc, TimeoutError):
        return _json(504, "The operation timed out. Try a smaller file.", request=request)

    # NotImplementedError — usually a service stub
    if isinstance(exc, NotImplementedError):
        return _json(501, "This feature isn't available yet.", request=request)

    # Subprocess / OS dependency missing (tesseract, libreoffice, etc.)
    if name in {"TesseractNotFoundError", "CalledProcessError"}:
        logger.exception("Subprocess failed on %s", request.url.path)
        return _json(
            500,
            "A processing step failed on the server. Please try again.",
            request=request,
        )

    # ValueError with a useful message — surface as 400; otherwise 500
    if isinstance(exc, ValueError) and msg:
        return _json(400, msg, request=request)

    # Unknown — log full stack, return generic 500 (don't leak internals)
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return _json(500, "Server error. Please try again.", request=request)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
def register_error_handlers(
    app: FastAPI,
    *,
    security_headers: Callable[[Request, Response], None] | None = None,
    cors_headers: Callable[[Request, Response], Awaitable[None]] | None = None,
) -> None:
    """Attach all handlers to the given FastAPI app.

    Call this exactly once during app construction. Order doesn't matter
    — FastAPI matches handlers by exception type.

    ``security_headers`` and ``cors_headers`` are applied to the catch-all's
    responses. Starlette runs that handler in ServerErrorMiddleware, which
    wraps every ``add_middleware`` layer, so neither the security-headers nor
    the CORS middleware sees them: a decompression-bomb 413 or an unhandled
    500 would go out bare, and a cross-origin page could not read it at all.
    """
    app.add_exception_handler(ToolError, tool_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    # Keep this last — it's the catch-all.
    async def final_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        response = await builtin_exception_handler(request, exc)
        if security_headers is not None:
            security_headers(request, response)
        if cors_headers is not None:
            await cors_headers(request, response)
        if getattr(request.state, "v1_activity_deferred", False):
            from ..api_v1.activity import finish
            await finish(request.scope, response.status_code)
        return response

    app.add_exception_handler(Exception, final_exception_handler)
