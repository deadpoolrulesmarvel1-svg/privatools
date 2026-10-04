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


# Where a PDF's first object must start: the first chunk a streaming route
# hands validate_pdf_content (route_helpers.stream_upload_to_disk).
_FIRST_OBJECT_WINDOW = 256 * 1024


def validate_pdf_content(content: bytes, filename: str | None = None) -> None:
    """Raise HTTPException(400) if content doesn't look like a valid PDF.

    Cheap magic sniff before any heavy work. Per ISO 32000 the "%PDF-"
    header may be preceded by up to 1024 bytes of preamble — and real
    files use that allowance (government-issued PDFs, some scanner and
    signer outputs), so checking only content[:5] rejected perfectly
    valid documents. Search the window a conforming reader searches.
    It is NOT a full well-formed-PDF parser — that happens in the
    service layer.

    A PDF is made of numbered objects ("1 0 obj"), the first of them right
    after the header, so a file whose header is followed by no "obj" at all
    is not one any library can open: a download that stopped within its first
    object, or bytes that only start like a PDF. Such files reached the
    parsers, which fail in ways most routes did not expect (pikepdf answers a
    file of just "%PDF-1.7\\n" with OSError 22; MuPDF says "no objects found"),
    and 62 routes answered them with a 500. A route that streams the
    upload passes only its first chunk (256 KB), which holds that first
    object in any PDF. The object is looked for in that window on every
    route, so a route that holds the whole upload decides the same way and
    never scans hundreds of megabytes that hold no object.
    """
    label = f"“{filename}”" if filename else "File"
    if not content:
        raise HTTPException(status_code=400, detail=f"{label} is empty.")
    header = content.find(b"%PDF-", 0, 1024)
    if header < 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{label} does not appear to be a PDF. If it downloaded "
                "incompletely, re-download it; if it has a different "
                "extension, convert it to PDF first."
            ),
        )
    if content.find(b"obj", header + 5, _FIRST_OBJECT_WINDOW) < 0:
        from .exceptions import PdfCorruptError

        raise HTTPException(
            status_code=400,
            detail=(f"{label} appears to be corrupt or invalid." if filename
                    else PdfCorruptError.default_detail),
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


_DAMAGED_PDF = (
    "This PDF is damaged, most likely cut short by an interrupted download. "
    "Download it again, or fix it with Repair PDF, then try again."
)


def _rebuilt_by_qpdf(source: str | bytes) -> bytes | None:
    """The PDF as qpdf rebuilds it, or None if qpdf cannot read it either.

    References to objects the file lost become null, and pages whose page
    object was lost are left out. A page whose object survived but whose
    content was cut short is kept with what qpdf could read of it, which can
    be nothing: a blank page where MuPDF's own repair may still have shown part
    of it. Streams are copied as they are, never decoded, and the XMP metadata
    is left alone (pikepdf's version update fails on a broken /Metadata).

    qpdf is given the file with an end-of-file line after it. Its
    reconstruction drops the object a file ends with when nothing follows that
    object's "endobj" ("EOF after endobj"), so a file cut right after a
    complete object lost that object as well: in one, the content of its last
    surviving page, which came out blank where MuPDF drew it. The copy that
    carries the line is a temporary file, not memory, since an upload can be
    500 MB. qpdf maps it (pikepdf falls back to reading it as a stream if it
    cannot): reading a 50 MB file as a stream takes 2.4 s, mapped 0.2 s. The
    copy is this call's own and never truncated while mapped.
    """
    import io
    import uuid

    import pikepdf

    ensure_temp_dir()
    ended = get_temp_path(f"rebuild_{uuid.uuid4().hex}.pdf")
    try:
        with open(ended, "wb") as f:
            if isinstance(source, (bytes, bytearray)):
                f.write(source)
            else:
                with open(source, "rb") as original:
                    shutil.copyfileobj(original, f)
            f.write(b"\n%%EOF\n")
        out = io.BytesIO()
        with pikepdf.open(ended, access_mode=pikepdf.AccessMode.mmap) as pdf:
            pdf.save(out, fix_metadata_version=False, stream_decode_level=pikepdf.StreamDecodeLevel.none)
        return out.getvalue()
    except (pikepdf.PdfError, OSError, ValueError, RuntimeError):
        return None
    finally:
        remove_files(ended)


def open_pdf_document(source: str | bytes):
    """Open a PDF with PyMuPDF, or raise the error its visitor should see.

    PyMuPDF opens a PDF that needs a password without complaint and fails only
    when a page is read, with "document closed or encrypted". Routes that
    turn every unexpected exception into a 500 answered that as a server
    fault, so the visitor saw "Processing failed. Please try again." and tried
    again. This raises PdfEncryptedError for such a file, and PdfCorruptError
    for one PyMuPDF cannot read or that has no page it can read; the global
    handler answers both with a 400 that says what to do. A PDF with only an
    owner password (restrictions, nothing needed to open it) opens as before.
    Takes a path or the bytes.
    """
    import fitz  # PyMuPDF

    from .exceptions import PdfCorruptError, PdfEncryptedError, ValidationError

    try:
        if isinstance(source, (bytes, bytearray)):
            doc = fitz.open(stream=source, filetype="pdf")
        else:
            doc = fitz.open(source)
    except fitz.FileDataError as exc:
        raise PdfCorruptError() from exc
    if doc.needs_pass:
        doc.close()
        raise PdfEncryptedError()
    try:
        pages = len(doc)
    except _library_errors() as exc:
        # A page tree MuPDF cannot count ("Invalid number of pages"), as in a
        # file cut short after its page list but before the pages it names.
        repaired = doc.is_repaired
        doc.close()
        raise PdfCorruptError(_DAMAGED_PDF if repaired else None) from exc
    if pages == 0:
        repaired = doc.is_repaired
        doc.close()
        if repaired:
            raise PdfCorruptError(_DAMAGED_PDF)
        raise ValidationError("This PDF has no pages.")
    return doc


def _library_errors() -> tuple[type[BaseException], ...]:
    """What PyMuPDF raises for damage it meets while working on a file: its own
    RuntimeError and ValueError, and MuPDF's errors, which reach Python as they
    are, outside both ("invalid key in dict", "truncated object", "corrupt
    object stream" and the rest of mupdf.FzErrorBase)."""
    import fitz  # PyMuPDF

    return (RuntimeError, ValueError, fitz.mupdf.FzErrorBase)


def process_pdf(source: str | bytes, work, *, rebuild: bool = True):
    """Return work(doc) for the PDF at `source` (a path or the bytes), opened
    with open_pdf_document and closed afterwards. For tools that copy pages.

    A PDF cut short, as by an interrupted download, opens repaired: MuPDF finds
    the objects that survived and draws each page with what it still has. But
    it keeps the references to the objects that were lost: PyMuPDF refuses to
    copy a page that has one ("source object number out of range"), and a page
    whose own object was lost, but which the page tree still lists, is shown
    blank and fails with "bad xref" when anything of it, such as its /Rotate,
    is read. So when work fails on a repaired file with an error from the
    library (_library_errors), qpdf rebuilds the file, dropping those
    references and such pages, and work runs once more on the rebuilt copy. A
    file qpdf cannot rebuild, that has no page left, or that fails again is
    refused as damaged (400). A ToolError, such as a render budget refusal, is
    an answer, not damage: it is never retried.

    `rebuild=False` is for tools that change pages in place and find them by
    number, such as E-Sign and Stamp PDF: the rebuild leaves out the pages
    whose object was lost, so every later page would move up and the change
    could land on a page the visitor did not choose. For them, work that fails
    on a repaired file is refused as damaged at once, and the visitor can
    repair the file and see its pages before choosing one.

    Nothing is checked in advance, so an intact file costs nothing extra. An
    earlier version scanned every object for such references first: that cost
    time in proportion to the highest object number, which a 346-byte file can
    set to 8 million (71 s), and its pattern went quadratic on a long run of
    digits (a 40 KB upload held a worker for 23 s).
    """
    from .exceptions import PdfCorruptError, ValidationError

    library_errors = _library_errors()
    doc = open_pdf_document(source)
    try:
        return work(doc)
    except library_errors as exc:
        if not doc.is_repaired:
            raise
        failure = exc  # damage MuPDF's repair left behind: one more run on qpdf's rebuild
    finally:
        doc.close()
    if not rebuild:
        raise PdfCorruptError(_DAMAGED_PDF) from failure
    rebuilt = _rebuilt_by_qpdf(source)
    if rebuilt is None:
        raise PdfCorruptError(_DAMAGED_PDF) from failure
    try:
        doc = open_pdf_document(rebuilt)
    except ValidationError as exc:  # no page survived
        raise PdfCorruptError(_DAMAGED_PDF) from exc
    try:
        return work(doc)
    except library_errors as exc:  # the rebuild did not help
        raise PdfCorruptError(_DAMAGED_PDF) from exc
    finally:
        doc.close()
