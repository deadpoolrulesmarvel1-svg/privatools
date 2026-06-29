"""Phase 6 tools: Batch PDF Compress, Image Upscaler, Audio Converter, PDF Page Counter."""

import asyncio
import io
import os
import subprocess
import tempfile
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from starlette.background import BackgroundTask

from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..utils.route_helpers import read_upload, safe_filename, cleanup_on_error
from ..utils.concurrency import run_bounded

router = APIRouter()

_pool = ThreadPoolExecutor(max_workers=4)


def _temp_path(suffix: str) -> Path:
    return Path(tempfile.gettempdir()) / f"pt_{uuid.uuid4().hex}{suffix}"


def _compress_single_pdf(pdf_bytes: bytes, level: str) -> bytes:
    """Compress a single PDF. Returns compressed bytes."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out = io.BytesIO()
    # Rebuild with garbage collection and deflation
    gc_level = 4 if level == "extreme" else 3 if level == "balanced" else 2
    doc.save(out, garbage=gc_level, deflate=True, clean=True)
    doc.close()
    return out.getvalue()


def _compress_batch_to_zip(pdf_data, level: str) -> str:
    """Compress every PDF (via the shared pool) and write the result ZIP.

    Runs entirely off the event loop — the previous version iterated
    `as_completed` on the loop thread, stalling every concurrent request on
    that worker for the whole 50-file batch (research C2).
    """
    zip_path = _temp_path(".zip")
    results = []  # (index, name, compressed_bytes)
    futures = {
        _pool.submit(_compress_single_pdf, data, level): (i, name)
        for i, (name, data) in enumerate(pdf_data)
    }
    for future in as_completed(futures):
        i, name = futures[future]
        try:
            results.append((i, name, future.result()))
        except Exception as exc:
            raise HTTPException(500, f"Failed to compress {name}: {str(exc)}")
    results.sort(key=lambda t: t[0])  # preserve upload order
    seen: dict[str, int] = {}
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for _, name, compressed in results:
            stem = Path(name).stem
            entry_base = f"{stem}_compressed.pdf"
            if entry_base in seen:
                seen[entry_base] += 1
                entry_name = f"{stem}_compressed_{seen[entry_base]}.pdf"
            else:
                seen[entry_base] = 1
                entry_name = entry_base
            zf.writestr(entry_name, compressed)
    return str(zip_path)


@router.post("/batch-compress-pdf")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def batch_compress_pdf(
    request: Request,
    files: list[UploadFile] = File(...),
    level: str = Form("balanced"),
):
    """Compress multiple PDFs in parallel and return a ZIP."""
    if not files or len(files) < 1:
        raise HTTPException(400, "Upload at least one PDF file")
    if len(files) > 50:
        raise HTTPException(400, "Maximum 50 files per batch")
    if level not in ("light", "balanced", "extreme"):
        level = "balanced"

    # Read all uploads
    pdf_data = []
    for f in files:
        data = await read_upload(f, label=f.filename or "PDF")
        if not data[:5].startswith(b"%PDF"):
            raise HTTPException(400, f"{f.filename} is not a valid PDF")
        pdf_data.append((safe_filename(f.filename, "document.pdf"), data))

    # Compress all files (shared pool) + write the ZIP off the event loop, so a
    # batch can't freeze every other request on this worker (research C2).
    zip_path = await run_bounded(_compress_batch_to_zip, pdf_data, level)

    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename="compressed_pdfs.zip",
        background=BackgroundTask(os.unlink, str(zip_path)),
    )


@router.post("/image-upscaler")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def image_upscaler(
    request: Request,
    file: UploadFile = File(...),
    scale: int = Form(2),
):
    """Upscale an image by 2x or 4x using high-quality Lanczos resampling."""
    if scale not in (2, 4):
        scale = 2

    data = await read_upload(file, label="Image")
    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(400, "Invalid image file")

    orig_format = img.format or "PNG"
    new_w = img.width * scale
    new_h = img.height * scale

    # Sanity check — don't create images over 100MP. (img.width/height read the
    # header only; the heavy decode happens on .resize() below, which we
    # offload.)
    if new_w * new_h > 100_000_000:
        raise HTTPException(400, f"Upscaled image would be {new_w}x{new_h} — too large. Use a smaller scale or image.")

    save_format = orig_format if orig_format in ("JPEG", "PNG", "WEBP") else "PNG"
    save_kwargs = {"quality": 95} if save_format == "JPEG" else {}
    ext = save_format.lower()
    if ext == "jpeg":
        ext = "jpg"
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(save_format, "image/png")
    out_path = _temp_path(f".{ext}")

    # LANCZOS upscale to tens of millions of pixels is one of the heaviest PIL
    # ops — run it (and the save) off the event loop so it can't freeze every
    # other concurrent request on the 2-core VM.
    def _work() -> None:
        upscaled = img.resize((new_w, new_h), Image.LANCZOS)
        upscaled.save(str(out_path), format=save_format, **save_kwargs)

    await run_bounded(_work)

    stem = Path(safe_filename(file.filename, "image")).stem
    return FileResponse(
        str(out_path),
        media_type=mime,
        filename=f"{stem}_{scale}x.{ext}",
        background=BackgroundTask(os.unlink, str(out_path)),
    )


@router.post("/audio-converter")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def audio_converter(
    request: Request,
    file: UploadFile = File(...),
    format: str = Form("mp3"),
    bitrate: str = Form("192k"),
):
    """Convert audio between MP3, WAV, OGG, FLAC, AAC using ffmpeg."""
    allowed_formats = {"mp3", "wav", "ogg", "flac", "aac"}
    if format not in allowed_formats:
        raise HTTPException(400, f"Unsupported format. Use: {', '.join(sorted(allowed_formats))}")
    allowed_bitrates = {"64k", "128k", "192k", "256k", "320k"}
    if bitrate not in allowed_bitrates:
        bitrate = "192k"

    data = await read_upload(file, label="Audio file", max_bytes=200 * 1024 * 1024)

    # Detect input extension
    orig_name = safe_filename(file.filename, "audio.mp3")
    orig_ext = Path(orig_name).suffix or ".mp3"

    in_path = _temp_path(orig_ext)
    in_path.write_bytes(data)
    out_path = _temp_path(f".{format}")

    cmd = ["ffmpeg", "-y", "-i", str(in_path), "-b:a", bitrate]
    if format == "ogg":
        cmd.extend(["-c:a", "libvorbis"])
    elif format == "aac":
        cmd.extend(["-c:a", "aac"])
    cmd.append(str(out_path))

    try:
        await run_bounded(subprocess.run, cmd, capture_output=True, check=True, timeout=120)
    except subprocess.CalledProcessError as exc:
        cleanup_on_error(in_path, out_path)
        raise HTTPException(500, f"Audio conversion failed: {exc.stderr.decode()[:200]}")
    except subprocess.TimeoutExpired:
        cleanup_on_error(in_path, out_path)
        raise HTTPException(504, "Audio conversion timed out")
    finally:
        try:
            os.unlink(str(in_path))
        except OSError:
            pass

    mime_map = {
        "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg",
        "flac": "audio/flac", "aac": "audio/aac",
    }
    stem = Path(orig_name).stem
    return FileResponse(
        str(out_path),
        media_type=mime_map.get(format, "application/octet-stream"),
        filename=f"{stem}.{format}",
        background=BackgroundTask(os.unlink, str(out_path)),
    )


def _count_pdf_pages(data: bytes) -> int:
    """Parse a PDF and return its page count (-1 if unreadable). PyMuPDF parsing
    is CPU-bound, so callers run this off the event loop."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            return doc.page_count
        finally:
            doc.close()
    except Exception:
        return -1


@router.post("/pdf-page-counter")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def pdf_page_counter(
    request: Request,
    files: list[UploadFile] = File(...),
):
    """Count pages in multiple PDFs. Returns JSON with filename and page count."""
    if not files:
        raise HTTPException(400, "Upload at least one PDF")
    if len(files) > 100:
        raise HTTPException(400, "Maximum 100 files per batch")

    results = []
    total = 0
    for f in files:
        data = await read_upload(f, label=f.filename or "PDF")
        # Offload the fitz parse — up to 100 inline parses on the loop thread
        # would stall every other request on the 2-core VM.
        count = await run_bounded(_count_pdf_pages, data)
        name = safe_filename(f.filename, "document.pdf")
        results.append({"filename": name, "pages": count})
        if count > 0:
            total += count

    return JSONResponse({
        "files": results,
        "total_pages": total,
        "file_count": len(results),
    })
