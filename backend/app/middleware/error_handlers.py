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
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..utils.exceptions import ToolError

logger = logging.getLogger("privatools.errors")


def _json(
    status: int,
    detail: str,
    *,
    request: Request | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"detail": detail}
    if extra:
        body.update(extra)
    headers: dict[str, str] = {}
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


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Preserve HTTPException semantics but propagate the request-id header."""
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    if exc.status_code == 400 and detail.startswith("Part exceeded maximum size"):
        return _json(
            413,
            "Form field is too large. Try a smaller signature or upload file.",
            request=request,
        )
    return _json(exc.status_code, detail, request=request)


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

    # Pillow — image too large (decompression bomb guard tripped).
    # Translate to a friendly 413 so the user sees "image too large" rather
    # than a generic 500. Match on class name to avoid a hard PIL import here.
    if name == "DecompressionBombError":
        return _json(
            413,
            "Image is too large to process safely. Try a smaller image.",
            request=request,
        )

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
def register_error_handlers(app: FastAPI) -> None:
    """Attach all handlers to the given FastAPI app.

    Call this exactly once during app construction. Order doesn't matter
    — FastAPI matches handlers by exception type.
    """
    app.add_exception_handler(ToolError, tool_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    # Keep this last — it's the catch-all.
    app.add_exception_handler(Exception, builtin_exception_handler)
