"""Phase 3 routes: URL→PDF, PDF→Markdown, SVG→PNG, barcode, watermark, favicon, collage."""

import asyncio
import ipaddress
import logging
import re
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..services import (
    barcode_service,
    collage_service,
    favicon_service,
    image_watermark_service,
    pdf_to_markdown_service,
    svg_to_png_service,
    url_to_pdf_service,
)
from ..utils.concurrency import run_bounded
from ..utils.exceptions import ToolError
from ..utils.images import image_read_error
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from ..utils.route_helpers import (
    MAX_SIZE, cleanup_on_error, read_upload, safe_header_filename, safe_stem, stream_upload_to_disk,
)

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_COLLAGE_FILES = 25
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_FAVICON_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | {".svg"}
WATERMARK_POSITIONS = {"center", "tile", "top-left", "top-right", "bottom-left", "bottom-right"}
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


async def _read_upload(file: UploadFile, *, label: str, max_bytes: int = MAX_SIZE) -> bytes:
    return await read_upload(file, label=label, max_bytes=max_bytes)


def _cleanup_on_error(*paths: str | Path | None) -> None:
    cleanup_on_error(*paths)


def _validate_public_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    if len(url) > 2048:
        raise HTTPException(status_code=400, detail="URL is too long")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL is missing a hostname")

    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        raise HTTPException(status_code=400, detail="URL is missing a hostname")
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
        raise HTTPException(status_code=400, detail="Local/internal URLs are not allowed")

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return url

    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        raise HTTPException(status_code=400, detail="Local/internal URLs are not allowed")
    return url


# ─── URL → PDF ────────────────────────────────────────────
@router.post("/url-to-pdf")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def url_to_pdf(request: Request, url: str = Form(...)):
    """Convert a public URL to PDF."""
    safe_url = _validate_public_url(url)
    out = None
    try:
        out = await asyncio.to_thread(url_to_pdf_service.url_to_pdf, safe_url)
        cleanup = BackgroundTask(remove_files, out)
        return FileResponse(out, filename="webpage.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(out)
        raise
    except Exception as e:
        _cleanup_on_error(out)
        logger.exception("url-to-pdf error")
        raise HTTPException(status_code=500, detail="Failed to convert URL to PDF")


# ─── PDF → Markdown ───────────────────────────────────────
@router.post("/pdf-to-markdown")
async def pdf_to_markdown(
    file: UploadFile = File(...),
    page_markers: bool = Form(True),
    remove_headers_footers: bool = Form(True),
    chunk: Literal["none", "headings", "size"] = Form("none"),
    chunk_size: int = Form(pdf_to_markdown_service.CHUNK_DEFAULT, ge=pdf_to_markdown_service.CHUNK_MIN,
                           le=pdf_to_markdown_service.CHUNK_MAX),
    chunk_output: Literal["zip", "single"] = Form("zip"),
):
    """Convert a PDF to Markdown: headings, paragraphs, lists, tables, code,
    links and picture placeholders, in reading order across columns.

    ``page_markers`` puts ``<!-- page N -->`` before each page;
    ``remove_headers_footers`` drops lines repeated at the top or bottom of
    most pages. ``chunk`` splits the Markdown at headings or at about
    ``chunk_size`` characters, into a ZIP of .md files or, with
    ``chunk_output=single``, one file with ``<!-- chunk N of M -->`` between
    the parts. The X-Markdown-Report header says what was found, and which
    pages had no text layer. The limits are in pdf_to_markdown_service.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    opts = pdf_to_markdown_service.options(
        page_markers=page_markers, remove_headers_footers=remove_headers_footers,
        chunk=chunk, chunk_size=chunk_size, chunk_output=chunk_output,
    )

    ensure_temp_dir()
    path = get_temp_path(f"pdf2md_{uuid.uuid4().hex}.pdf")
    out = None
    try:
        await stream_upload_to_disk(file, path, label="PDF", validate=validate_pdf_content)
        # A wait for the bounded worker process, which is stopped after its
        # time limit; the heavy pool keeps the waits bounded too.
        out, report = await run_bounded(pdf_to_markdown_service.convert, str(path), opts)
    except HTTPException:
        raise
    except ValueError as exc:
        # Password-protected, unreadable, or no pages.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ToolError:
        # Too many pages or too much memory (413), nothing to convert or too
        # much work (422), too slow (504) or failed (500): the global handler
        # gives each its status and message.
        raise
    except Exception as exc:
        logger.exception("pdf-to-markdown error")
        raise HTTPException(status_code=500, detail="Conversion failed") from exc
    finally:
        remove_files(str(path))

    stem = safe_stem(file.filename, "document")
    zipped = pdf_to_markdown_service.is_zip(opts)
    name = safe_header_filename(f"{stem}_chunks.zip" if zipped else f"{stem}.md", "document.md")
    # The Markdown is the document's own text: never store it anywhere.
    headers = {"X-Markdown-Report": pdf_to_markdown_service.report_header(report), "Cache-Control": "no-store"}
    return FileResponse(out, filename=name, headers=headers, background=BackgroundTask(remove_files, out),
                        media_type="application/zip" if zipped else "text/markdown; charset=utf-8")


# ─── SVG → PNG ────────────────────────────────────────────
@router.post("/svg-to-png")
async def svg_to_png(
    file: UploadFile = File(...),
    scale: float = Form(2.0, ge=0.1, le=8.0),
):
    if not file.filename or not file.filename.lower().endswith(".svg"):
        raise HTTPException(status_code=400, detail="Please upload an SVG file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="SVG file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.svg")
        temp.write_bytes(content)
        out = await asyncio.to_thread(svg_to_png_service.svg_to_png, str(temp), scale=scale)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="converted.png", media_type="image/png", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("svg-to-png error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── Barcode Generator ───────────────────────────────────
@router.post("/generate-barcode")
async def generate_barcode(
    data: str = Form(...),
    barcode_type: str = Form("code128"),
):
    clean_data = (data or "").strip()
    if not clean_data:
        raise HTTPException(status_code=400, detail="Barcode data is required")
    if len(clean_data) > 200:
        raise HTTPException(status_code=400, detail="Barcode data must be 200 characters or fewer")

    clean_type = (barcode_type or "").strip().lower()
    if clean_type not in barcode_service.BARCODE_TYPES:
        allowed = ", ".join(sorted(barcode_service.BARCODE_TYPES.keys()))
        raise HTTPException(status_code=400, detail=f"barcode_type must be one of: {allowed}")

    # Common format constraints for numeric barcode families.
    if clean_type in {"ean13", "isbn13"} and not re.fullmatch(r"\d{12,13}", clean_data):
        raise HTTPException(status_code=400, detail=f"{clean_type} requires 12 or 13 digits")
    if clean_type == "ean8" and not re.fullmatch(r"\d{7,8}", clean_data):
        raise HTTPException(status_code=400, detail="ean8 requires 7 or 8 digits")
    if clean_type == "upca" and not re.fullmatch(r"\d{11,12}", clean_data):
        raise HTTPException(status_code=400, detail="upca requires 11 or 12 digits")
    if clean_type == "code39" and not re.fullmatch(r"[A-Z0-9\-. $/+%]+", clean_data):
        raise HTTPException(
            status_code=400,
            detail="code39 allows uppercase A-Z, digits, spaces, and - . $ / + % only",
        )

    out = None
    try:
        out = await asyncio.to_thread(barcode_service.generate_barcode, clean_data, clean_type)
        cleanup = BackgroundTask(remove_files, out)
        return FileResponse(out, filename="barcode.png", media_type="image/png", background=cleanup)
    except ValueError as exc:
        _cleanup_on_error(out)
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        _cleanup_on_error(out)
        raise
    except Exception as e:
        _cleanup_on_error(out)
        logger.exception("barcode error")
        raise HTTPException(status_code=500, detail="Barcode generation failed")


# ─── Image Watermark ──────────────────────────────────────
@router.post("/image-watermark")
async def image_watermark(
    file: UploadFile = File(...),
    text: str = Form("WATERMARK"),
    opacity: int = Form(80, ge=0, le=100),
    position: str = Form("center"),
    font_size: int = Form(40, ge=8, le=300),
):
    fname = file.filename or ""
    suffix = Path(fname).suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Please upload an image")
    if position not in WATERMARK_POSITIONS:
        raise HTTPException(status_code=400, detail=f"position must be one of: {', '.join(sorted(WATERMARK_POSITIONS))}")
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Watermark text is required")
    if len(clean_text) > 120:
        raise HTTPException(status_code=400, detail="Watermark text must be 120 characters or fewer")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Image file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        temp.write_bytes(content)

        # The service expects PIL alpha channel range (0-255).
        alpha = int(round((opacity / 100) * 255))
        out = await asyncio.to_thread(image_watermark_service.add_watermark, str(temp), clean_text, alpha, position, font_size)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="watermarked.png", media_type="image/png", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except ToolError:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        if (image_error := image_read_error(e)) is not None:
            raise HTTPException(status_code=image_error[0], detail=image_error[1]) from e
        logger.exception("watermark error")
        raise HTTPException(status_code=500, detail="Watermark failed")


# ─── Favicon Generator ───────────────────────────────────
@router.post("/generate-favicon")
async def generate_favicon(file: UploadFile = File(...)):
    fname = file.filename or ""
    suffix = Path(fname).suffix.lower()
    if suffix not in ALLOWED_FAVICON_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Please upload an image")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Image file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        temp.write_bytes(content)
        out = await asyncio.to_thread(favicon_service.generate_favicon, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="favicon.ico", media_type="image/x-icon", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except ToolError:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        if (image_error := image_read_error(e)) is not None:
            raise HTTPException(status_code=image_error[0], detail=image_error[1]) from e
        logger.exception("favicon error")
        raise HTTPException(status_code=500, detail="Favicon generation failed")


# ─── Collage Maker ────────────────────────────────────────
@router.post("/make-collage")
async def make_collage(
    files: list[UploadFile] = File(...),
    columns: int = Form(3, ge=1, le=10),
    spacing: int = Form(10, ge=0, le=200),
    bg_color: str = Form("#ffffff"),
):
    if not files or len(files) < 2:
        raise HTTPException(status_code=400, detail="Please upload at least 2 images")
    if len(files) > MAX_COLLAGE_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_COLLAGE_FILES} images")
    if not HEX_COLOR_RE.fullmatch((bg_color or "").strip()):
        raise HTTPException(status_code=400, detail="bg_color must be a hex color like #ffffff")

    ensure_temp_dir()
    temp_paths: list[Path] = []
    out = None
    try:
        for upload in files:
            suffix = Path(upload.filename or "").suffix.lower()
            if suffix not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(status_code=400, detail="Only JPG, PNG, WebP, and BMP images are supported")

            content = await _read_upload(upload, label=f"Image '{upload.filename or 'unknown'}'")
            temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
            temp.write_bytes(content)
            temp_paths.append(temp)

        out = await asyncio.to_thread(collage_service.make_collage, [str(p) for p in temp_paths], columns, spacing, bg_color.strip())
        all_temps = [str(p) for p in temp_paths] + [out]
        cleanup = BackgroundTask(remove_files, *all_temps)
        return FileResponse(out, filename="collage.jpg", media_type="image/jpeg", background=cleanup)
    except ValueError as exc:
        _cleanup_on_error(*temp_paths, out)
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        _cleanup_on_error(*temp_paths, out)
        raise
    except Exception as e:
        _cleanup_on_error(*temp_paths, out)
        logger.exception("collage error")
        raise HTTPException(status_code=500, detail="Collage creation failed")
