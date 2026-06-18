"""Temp directory management and shared filesystem helpers.

Every request lands in :data:`TEMP_DIR` (configurable via the ``TEMP_DIR``
env var) and unlinks its files immediately after the response. The
background janitor :func:`cleanup_old_files` runs from the FastAPI
lifespan to sweep stragglers — files left behind by crashed handlers,
killed workers, or `BackgroundTask` failures.

The janitor handles both flat temp files and the nested directories
that `tempfile.mkdtemp` callers (e.g. extract-archive, video tools)
leave behind.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

logger = logging.getLogger("privatools.cleanup")

# Use TEMP_DIR env var if set, otherwise fall back to a temp/ dir relative to CWD.
TEMP_DIR = Path(os.environ.get("TEMP_DIR", "temp"))

# Default max-age for janitor sweeps (10 minutes). Override via env so
# we can tighten in tests or loosen on a slow worker.
DEFAULT_MAX_AGE_SECONDS = int(os.environ.get("TEMP_MAX_AGE_SECONDS", "600"))

_JANITOR_EVENTS: deque[tuple[float, int]] = deque(maxlen=2000)
_LAST_SWEEP_AT: float | None = None


def ensure_temp_dir() -> None:
    """Create the temp directory if it does not exist."""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)


def _file_age(item: Path, now: float) -> float | None:
    try:
        return now - item.stat().st_mtime
    except OSError:
        return None


def _count_files(root: Path) -> int:
    try:
        if root.is_file() or root.is_symlink():
            return 1
        return sum(1 for item in root.rglob("*") if item.is_file() or item.is_symlink())
    except OSError:
        return 0


def _iso_utc(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _record_janitor_sweep(files_removed: int, at: float) -> None:
    global _LAST_SWEEP_AT
    _LAST_SWEEP_AT = at
    if files_removed > 0:
        _JANITOR_EVENTS.append((at, files_removed))


def _prune_janitor_events(now: float) -> None:
    cutoff = now - 24 * 60 * 60
    while _JANITOR_EVENTS and _JANITOR_EVENTS[0][0] < cutoff:
        _JANITOR_EVENTS.popleft()


def janitor_stats(now: float | None = None) -> dict[str, int | str | None]:
    """Return aggregate janitor counters for public transparency reporting."""
    current = time.time() if now is None else now
    _prune_janitor_events(current)
    hour_cutoff = current - 60 * 60
    return {
        "last_sweep_at": _iso_utc(_LAST_SWEEP_AT),
        "files_swept_last_hour": sum(count for ts, count in _JANITOR_EVENTS if ts >= hour_cutoff),
        "files_swept_last_24h": sum(count for _ts, count in _JANITOR_EVENTS),
    }


def _reset_janitor_stats_for_tests() -> None:
    global _LAST_SWEEP_AT
    _LAST_SWEEP_AT = None
    _JANITOR_EVENTS.clear()


def cleanup_old_files(max_age_seconds: int | None = None) -> tuple[int, int]:
    """Remove files (and empty subdirs) in TEMP_DIR older than the threshold.

    Returns a ``(files_removed, dirs_removed)`` tuple so callers can log
    janitor activity. Errors on individual entries are swallowed and
    logged at DEBUG — we don't want a single sticky inode to abort the
    sweep.
    """
    now = time.time()
    if not TEMP_DIR.exists():
        _record_janitor_sweep(0, now)
        return (0, 0)

    threshold = DEFAULT_MAX_AGE_SECONDS if max_age_seconds is None else max_age_seconds
    files_removed = 0
    dirs_removed = 0

    for item in TEMP_DIR.iterdir():
        age = _file_age(item, now)
        if age is None or age <= threshold:
            continue
        try:
            if item.is_file() or item.is_symlink():
                item.unlink(missing_ok=True)
                files_removed += 1
            elif item.is_dir():
                # mkdtemp() directories from archive-extract / video tools
                # — wipe the whole subtree.
                files_removed += _count_files(item)
                shutil.rmtree(item, ignore_errors=True)
                dirs_removed += 1
        except OSError as exc:
            logger.debug("janitor: failed to remove %s: %s", item, exc)

    if files_removed or dirs_removed:
        logger.info(
            "janitor: removed %d file(s) and %d dir(s) older than %ds",
            files_removed,
            dirs_removed,
            threshold,
        )
    _record_janitor_sweep(files_removed, now)
    return (files_removed, dirs_removed)


def get_temp_path(filename: str) -> Path:
    """Return a Path object for a file inside TEMP_DIR.

    Sanitises filename to prevent path-traversal attacks (e.g.
    ``../../etc/passwd``). The returned path is guaranteed to be a
    direct child of TEMP_DIR — no sub-directory escapes.
    """
    safe_name = Path(filename).name  # strips all directory components
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return TEMP_DIR / safe_name


def remove_files(*paths: str | Path) -> None:
    """Delete one or more files, ignoring errors.

    Designed for use as a Starlette ``BackgroundTask`` after a
    FileResponse — runs once the response body has been fully written.
    Also accepts directories (e.g. mkdtemp roots) and removes them
    recursively.
    """
    for p in paths:
        if p is None:  # type: ignore[unreachable]
            continue
        try:
            path = Path(p)
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        except OSError as exc:
            logger.debug("remove_files: failed to delete %s: %s", p, exc)


def validate_pdf_content(content: bytes) -> None:
    """Raise HTTPException(400) if content doesn't look like a valid PDF.

    The "%PDF-" magic check is cheap and rejects the most common
    failure mode (a wrong-extension upload, a 1-byte truncation, an
    HTML error page accidentally re-uploaded). It is NOT a full
    well-formed-PDF parser — that happens in the service layer.
    """
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")
    if content[:5] != b"%PDF-":
        raise HTTPException(
            status_code=400,
            detail="File does not appear to be a valid PDF.",
        )


# Magic-byte prefixes for the image formats we accept on routes that
# pass the bytes straight to PIL/ffmpeg. Trusting Content-Type or filename
# extension here is unsafe — both are attacker-controlled — so we check
# the first few bytes ourselves before doing any heavy work.
_IMAGE_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"\xff\xd8\xff", "JPEG"),
    (b"GIF87a", "GIF"),
    (b"GIF89a", "GIF"),
    (b"BM", "BMP"),
    (b"II*\x00", "TIFF (LE)"),
    (b"MM\x00*", "TIFF (BE)"),
    # WEBP: RIFF<size>WEBP — we check the literal prefix + the WEBP tag at
    # offset 8. Handled below in validate_image_content since it's a 2-piece
    # check rather than a single prefix.
)


def validate_image_content(content: bytes) -> None:
    """Raise HTTPException(400) if content doesn't look like a supported image.

    Cheap magic-byte check for PNG, JPEG, GIF, BMP, TIFF, WEBP. Use on
    routes that feed user bytes to PIL/ffmpeg without an extra parser —
    PIL.Image.open will already reject garbage, but with this guard the
    rejection lands as a clean 400 with a friendly message instead of
    bubbling an ``UnidentifiedImageError`` as a 500.
    """
    if not content:
        raise HTTPException(status_code=400, detail="Image is empty.")
    head = content[:16]
    for prefix, _label in _IMAGE_MAGIC:
        if head.startswith(prefix):
            return
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return
    # HEIC/HEIF: ftyp box at offset 4 — `heic`/`heix`/`mif1` brand strings.
    if len(content) >= 12 and content[4:8] == b"ftyp":
        brand = content[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"avif"):
            return
    raise HTTPException(
        status_code=400, detail="File does not appear to be a valid image.",
    )


def validate_zip_content(content: bytes) -> None:
    """Raise HTTPException(400) if content doesn't look like a ZIP archive.

    ZIP local file header is ``PK\\x03\\x04``; empty-archive marker is
    ``PK\\x05\\x06``. A spanned-archive header (``PK\\x07\\x08``) is
    technically valid but we never produce or consume those, so we reject
    them too to keep the parser surface small.
    """
    if not content:
        raise HTTPException(status_code=400, detail="Archive is empty.")
    if content[:4] not in (b"PK\x03\x04", b"PK\x05\x06"):
        raise HTTPException(
            status_code=400, detail="File does not appear to be a valid ZIP archive.",
        )


def safe_open_pdf(path: str, **kwargs):
    """Open a PDF with pikepdf, converting PasswordError to a friendly ValueError.

    Usage::

        with safe_open_pdf(input_path) as pdf:
            ...

    The global error handler maps the raised ``ValueError`` to a 400
    response with a `password` substring the frontend's
    ``friendlyError()`` recognises.
    """
    import pikepdf
    try:
        return pikepdf.open(path, **kwargs)
    except pikepdf.PasswordError as exc:
        raise ValueError(
            "This PDF is password-protected. Please unlock it first using the Unlock PDF tool."
        ) from exc
    except pikepdf.PdfError as exc:
        # Corrupt / malformed — wrap so the global handler maps to 400.
        raise ValueError("This PDF appears to be corrupt or invalid.") from exc
