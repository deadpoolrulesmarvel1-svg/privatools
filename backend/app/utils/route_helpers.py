"""Shared route helpers to avoid duplication across route files.

Two flavours of size enforcement live here:

* :func:`read_upload` buffers the whole upload into RAM. Use it for
  small payloads (single PDFs under ~50 MB).
* :func:`stream_upload_to_disk` streams to a temp file in chunks. Use
  it for anything that could realistically hit the 500 MB cap.

Both raise FastAPI's :class:`HTTPException` directly so they can be
called from route handlers without an intermediate try/except — the
global handler in `app.middleware.error_handlers` will preserve the
status and detail.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .cleanup import remove_files

# 500 MB default — matches the upload middleware cap in main.py.
MAX_SIZE = int(os.getenv("MAX_UPLOAD_MB", "500")) * 1024 * 1024


# PDF extension whitelist for quick file-name checks. Used by
# :func:`require_pdf_filename` — full PDF magic-byte validation lives in
# `validate_pdf_content`.
_PDF_EXT = ".pdf"


# Strip ASCII control characters (NUL through US, plus DEL). These cannot
# appear in a filesystem path on any platform we deploy to, but more
# importantly: when echoed into a `Content-Disposition: attachment; filename=…`
# response header they would let a malicious client inject a CR/LF and split
# the HTTP response (XSS via header injection / cache poisoning).
_CTL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")


def safe_filename(name: str | None, fallback: str = "file") -> str:
    """Sanitize an upload filename for use inside zip archives or response headers.

    Strips directory components, NUL bytes, and any other ASCII control
    characters (most importantly CR/LF, which would otherwise enable
    HTTP-response-splitting when this value is reflected in a
    ``Content-Disposition`` header). Empty / nameless uploads fall back
    to ``fallback`` so we never produce a zero-length arcname.
    """
    if not name:
        return fallback
    clean = _CTL_CHARS_RE.sub("", os.path.basename(name))
    return clean if clean else fallback


def safe_header_filename(name: str | None, fallback: str = "file") -> str:
    """Return a filename safe to drop into a ``Content-Disposition`` header.

    Same control-character stripping as :func:`safe_filename`, plus removes
    ``"`` and backslashes which would terminate or escape the quoted-string
    form Starlette emits. Use this for the ``filename=`` argument to
    :class:`FileResponse` whenever any part of the name is user-controlled
    (e.g. derived from ``UploadFile.filename``).
    """
    base = safe_filename(name, fallback)
    return base.replace('"', "").replace("\\", "")


def safe_stem(name: str | None, fallback: str = "document") -> str:
    """Return the basename without extension, stripped of control characters.

    Replaces the ad-hoc ``(file.filename or "document").rsplit(".", 1)[0]``
    pattern that appears in many routes. Critically, this strips ASCII
    control characters (CR/LF in particular) — the result is interpolated
    into ``Content-Disposition`` headers like ``f"{stem}_compressed.pdf"``
    where a CR/LF in the upload's filename would otherwise let a client
    inject arbitrary response headers.
    """
    clean = safe_filename(name, fallback)
    # rsplit so multi-dot names like ``report.tax.2024.pdf`` keep the
    # ``report.tax.2024`` stem instead of ``report``.
    stem = clean.rsplit(".", 1)[0] if "." in clean else clean
    return stem or fallback


def unique_arcname(arcname: str, seen: dict) -> str:
    """Return an arcname that doesn't collide with previously-seen entries.

    When callers upload several files with the same name (common when
    dragging copies from email/cloud), the resulting ZIP otherwise
    contains multiple entries with identical names — only one survives
    in most extractors. Suffix duplicates with an incrementing counter
    so they all land as distinct files:
        report.pdf -> report.pdf, report_2.pdf, report_3.pdf, ...
    """
    if arcname not in seen:
        seen[arcname] = 1
        return arcname
    seen[arcname] += 1
    stem, _, ext = arcname.rpartition(".")
    if stem:
        return f"{stem}_{seen[arcname]}.{ext}"
    return f"{arcname}_{seen[arcname]}"


async def read_upload(
    file: UploadFile,
    *,
    label: str = "File",
    max_bytes: int = MAX_SIZE,
) -> bytes:
    """Read and validate an uploaded file. Raises HTTPException on failure."""
    if file is None:
        raise HTTPException(status_code=400, detail=f"{label} not provided.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty.")
    if len(data) > max_bytes:
        size_mb = max_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"{label} is too large — maximum is {size_mb:.0f} MB.",
        )
    return data


async def stream_upload_to_disk(
    file: UploadFile,
    dest: Path,
    *,
    label: str = "File",
    max_bytes: int = MAX_SIZE,
    chunk_size: int = 256 * 1024,  # 256 KB chunks
) -> int:
    """Stream an uploaded file to disk in chunks instead of buffering in RAM.

    Returns the total number of bytes written. Use this instead of
    :func:`read_upload` for large files (images, videos, PDFs > 50 MB).
    """
    if file is None:
        raise HTTPException(status_code=400, detail=f"{label} not provided.")
    total = 0
    with open(dest, "wb") as f:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                # Clean up the partial file before raising.
                dest.unlink(missing_ok=True)
                size_mb = max_bytes / (1024 * 1024)
                raise HTTPException(
                    status_code=413,
                    detail=f"{label} is too large — maximum is {size_mb:.0f} MB.",
                )
            f.write(chunk)
    if total == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"{label} is empty.")
    return total


def cleanup_on_error(*paths: str | Path | None) -> None:
    """Remove temporary files on error, ignoring None paths."""
    remove_files(*[p for p in paths if p is not None])


# ---------------------------------------------------------------------------
# Lightweight validators — handy in route bodies before kicking off work.
# Each raises HTTPException so it composes with FastAPI's normal flow.
# ---------------------------------------------------------------------------
def require_pdf_filename(file: UploadFile, *, label: str | None = None) -> None:
    """Raise 400 unless the upload looks like a PDF by extension.

    Cheap front-line check — pair with :func:`validate_pdf_content` for
    magic-byte verification once the bytes are in hand.
    """
    name = (file.filename or "").lower()
    if not name.endswith(_PDF_EXT):
        display = label or (file.filename or "file")
        raise HTTPException(
            status_code=400, detail=f"{display} is not a PDF.",
        )


# Standard no-store cache headers for user file downloads. Every tool
# output is per-request and per-user — we never want a shared CDN,
# transparent proxy, or browser back/forward cache to retain it. Use
# :func:`no_store_headers` when composing a FileResponse / StreamingResponse
# from a route, e.g.:
#
#     return FileResponse(out_path, headers=no_store_headers(), ...)
_NO_STORE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    # Block historical proxies that ignore Cache-Control. Belt + suspenders.
    "Pragma": "no-cache",
    "Expires": "0",
}


def no_store_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Return a fresh dict of ``Cache-Control: no-store`` + companion headers.

    Returns a *copy* so callers can mutate without poisoning the module-level
    constant. Merge route-specific headers (e.g. ``X-Original-Size``) via the
    ``extra`` arg.
    """
    headers = dict(_NO_STORE_HEADERS)
    if extra:
        headers.update(extra)
    return headers
