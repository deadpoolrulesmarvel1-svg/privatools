"""Routes for newly-added tools (split-in-half, highlight-pdf)."""

# NOTE: deliberately no `from __future__ import annotations`. The
# `@limiter.limit(...)` decorator wraps the handler via `functools.wraps`,
# and FastAPI's signature introspection then resolves the wrapped
# function's ForwardRef-style annotations against the WRAPPER's
# `__globals__` (slowapi.extension) — where names like `UploadFile`
# aren't defined. Concrete annotations evaluate eagerly and dodge that
# bug; `str | None` already works natively on Python 3.10+ here.

import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

import json
import re

from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..services import (
    highlight_service,
    long_image_service,
    pdf_to_svg_service,
    smart_redact_service,
    split_in_half_service,
    video_tools_service,
)
from ..utils.exceptions import ProcessingError
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import read_upload

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Split each page in half ───────────────────────────────────────────────
@router.post("/split-in-half")
async def split_in_half_endpoint(
    file: UploadFile = File(...),
    direction: str = Form("vertical"),
):
    if direction not in split_in_half_service.VALID_DIRECTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "direction must be one of: "
                + ", ".join(sorted(split_in_half_service.VALID_DIRECTIONS))
            ),
        )

    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "unknown")
    validate_pdf_content(content)

    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(
            split_in_half_service.split_in_half, str(temp_path), direction=direction
        )
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="split-in-half.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        logger.exception("split-in-half failed")
        raise HTTPException(status_code=500, detail="Processing failed")


# ─── Highlight PDF text ────────────────────────────────────────────────────
@router.post("/highlight")
async def highlight_endpoint(
    file: UploadFile = File(...),
    query: str = Form(...),
    color: str = Form("yellow"),
    case_sensitive: bool = Form(False),
):
    """Highlight every occurrence of `query` (text) in the PDF.

    `color` accepts a named color (yellow, green, pink, blue, orange) or a
    hex string like #ffea00.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    query = (query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query is required")
    if len(query) > 500:
        raise HTTPException(status_code=400, detail="Search query must be 500 chars or less")

    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "unknown")
    validate_pdf_content(content)

    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path, hits = await asyncio.to_thread(
            highlight_service.highlight_text,
            str(temp_path), query, color=color, case_sensitive=case_sensitive
        )
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="highlighted.pdf",
            media_type="application/pdf",
            background=cleanup,
            headers={"X-Highlight-Hits": str(hits)},
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        logger.exception("highlight failed")
        raise HTTPException(status_code=500, detail="Highlighting failed")


# ─── PDF → SVG (true vector) ───────────────────────────────────────────────
@router.post("/pdf-to-svg")
async def pdf_to_svg_endpoint(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")

    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "unknown")
    validate_pdf_content(content)

    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(pdf_to_svg_service.pdf_to_svg, str(temp_path))
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        is_zip = output_path.endswith(".zip")
        return FileResponse(
            path=output_path,
            filename="pages.zip" if is_zip else "page_1.svg",
            media_type="application/zip" if is_zip else "image/svg+xml",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        logger.exception("pdf-to-svg failed")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── Smart Redact ──────────────────────────────────────────────────────────
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


@router.post("/smart-redact")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def smart_redact_endpoint(
    request: Request,
    file: UploadFile = File(...),
    needles: str = Form(...),  # JSON-encoded list of strings
    color: str = Form("#000000"),
    case_sensitive: bool = Form(False),
):
    """Redact every match of every supplied string. The needles JSON comes
    from the browser-side NER model — we just trust the client's selection
    and apply real PyMuPDF redactions server-side.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if not _HEX_RE.match(color):
        raise HTTPException(status_code=400, detail="color must be a #RRGGBB hex string")

    try:
        parsed = json.loads(needles)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="needles must be valid JSON") from exc
    if not isinstance(parsed, list) or not all(isinstance(x, str) for x in parsed):
        raise HTTPException(status_code=400, detail="needles must be a JSON array of strings")
    # Cap at 500 needles to bound work — the UI shouldn't ever send this many.
    if len(parsed) > 500:
        raise HTTPException(status_code=400, detail="too many redaction targets (max 500)")

    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "unknown")
    validate_pdf_content(content)
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path, hits = await asyncio.to_thread(
            smart_redact_service.smart_redact,
            str(temp_path), parsed, color=color, case_sensitive=case_sensitive
        )
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="redacted.pdf",
            media_type="application/pdf",
            background=cleanup,
            headers={"X-Redact-Hits": str(hits)},
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path:
            remove_files(output_path)
        logger.exception("smart-redact failed")
        raise HTTPException(status_code=500, detail="Redaction failed")


# ─── Video → PDF ───────────────────────────────────────────────────────────
_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".flv", ".wmv"}


def _ensure_video_filename(filename: str | None) -> None:
    name = (filename or "").lower()
    if not any(name.endswith(ext) for ext in _VIDEO_EXTS):
        raise HTTPException(
            status_code=400,
            detail=f"Please upload a video ({', '.join(sorted(_VIDEO_EXTS))})",
        )


@router.post("/video-to-pdf")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_to_pdf_endpoint(request: Request, 
    file: UploadFile = File(...),
    frames: int = Form(12, ge=1, le=100),
):
    _ensure_video_filename(file.filename)
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "video")
    suffix = "." + (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.video_to_pdf, str(temp_path), frames=frames)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="frames.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("video-to-pdf failed")
        raise HTTPException(status_code=500, detail="Video → PDF conversion failed")


# ─── Video Converter ───────────────────────────────────────────────────────
@router.post("/video-converter")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_converter_endpoint(request: Request, 
    file: UploadFile = File(...),
    target_format: str = Form("mp4"),
):
    _ensure_video_filename(file.filename)
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "video")
    suffix = "." + (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.video_convert, str(temp_path), target_format)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        out_ext = output_path.rsplit(".", 1)[-1].lower()
        # Correct IANA types — `video/<ext>` yields invalid video/mkv|avi|mov.
        video_mime = {
            "mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska",
            "avi": "video/x-msvideo", "mov": "video/quicktime",
        }.get(out_ext, "application/octet-stream")
        return FileResponse(
            path=output_path,
            filename=f"converted.{out_ext}",
            media_type=video_mime,
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("video-converter failed")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── Video Resizer ─────────────────────────────────────────────────────────
@router.post("/video-resizer")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_resizer_endpoint(request: Request, 
    file: UploadFile = File(...),
    preset: str = Form("720p"),
):
    _ensure_video_filename(file.filename)
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "video")
    suffix = "." + (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.video_resize, str(temp_path), preset)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"video_{preset}.mp4",
            media_type="video/mp4",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("video-resizer failed")
        raise HTTPException(status_code=500, detail="Resize failed")


# ─── Video Thumbnail ───────────────────────────────────────────────────────
@router.post("/video-thumbnail")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_thumbnail_endpoint(request: Request, 
    file: UploadFile = File(...),
    time_seconds: float = Form(1.0, ge=0, le=86400),
):
    _ensure_video_filename(file.filename)
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "video")
    suffix = "." + (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.video_thumbnail, str(temp_path), time_seconds)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="thumbnail.jpg",
            media_type="image/jpeg",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("video-thumbnail failed")
        raise HTTPException(status_code=500, detail="Thumbnail extraction failed")


# ─── GIF → MP4 ─────────────────────────────────────────────────────────────
@router.post("/gif-to-mp4")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def gif_to_mp4_endpoint(request: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".gif"):
        raise HTTPException(status_code=400, detail="Please upload a .gif file")
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "gif")
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.gif")
    temp_path.write_bytes(content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.gif_to_mp4, str(temp_path))
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="animation.mp4",
            media_type="video/mp4",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("gif-to-mp4 failed")
        raise HTTPException(status_code=500, detail="GIF → MP4 conversion failed")


# ─── Burn-in Subtitles ─────────────────────────────────────────────────────
@router.post("/add-subtitles")
async def add_subtitles_endpoint(
    file: UploadFile = File(...),
    srt: UploadFile = File(...),
):
    _ensure_video_filename(file.filename)
    if not (srt.filename or "").lower().endswith((".srt", ".vtt")):
        raise HTTPException(status_code=400, detail="Subtitle file must be .srt or .vtt")

    ensure_temp_dir()
    vid_content = await read_upload(file, label=file.filename or "video")
    srt_content = await read_upload(srt, label=srt.filename or "subtitles")
    suffix = "." + (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    vid_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
    srt_path = get_temp_path(f"upload_{uuid.uuid4().hex}.srt")
    vid_path.write_bytes(vid_content)
    srt_path.write_bytes(srt_content)
    output_path: str | None = None

    try:
        output_path = await asyncio.to_thread(video_tools_service.burn_subtitles, str(vid_path), str(srt_path))
        cleanup = BackgroundTask(remove_files, str(vid_path), str(srt_path), output_path)
        return FileResponse(
            path=output_path,
            filename="subtitled.mp4",
            media_type="video/mp4",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(str(vid_path), str(srt_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(vid_path), str(srt_path))
        if output_path: remove_files(output_path)
        logger.exception("add-subtitles failed")
        raise HTTPException(status_code=500, detail="Subtitle burn-in failed")


# ─── Video Merge ───────────────────────────────────────────────────────────
@router.post("/video-merge")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_merge_endpoint(request: Request, files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="Upload at least 2 videos to merge")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 videos per merge")

    ensure_temp_dir()
    temp_paths: list[str] = []
    output_path: str | None = None
    try:
        for f in files:
            _ensure_video_filename(f.filename)
            content = await read_upload(f, label=f.filename or "video")
            suffix = "." + (f.filename or "video.mp4").rsplit(".", 1)[-1].lower()
            tp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
            tp.write_bytes(content)
            temp_paths.append(str(tp))

        output_path = await asyncio.to_thread(video_tools_service.video_merge, temp_paths)
        cleanup = BackgroundTask(remove_files, *temp_paths, output_path)
        return FileResponse(
            path=output_path,
            filename="merged.mp4",
            media_type="video/mp4",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        # _ensure_video_filename / read_upload raise clean 400/413s — let them
        # through instead of mangling them into a 500 (and a false stack trace).
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        raise
    except Exception:
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        logger.exception("video-merge failed")
        raise HTTPException(status_code=500, detail="Video merge failed")


# ─── Audio Merge ───────────────────────────────────────────────────────────
_AUDIO_EXTS = {".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".wma"}


@router.post("/audio-merge")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def audio_merge_endpoint(request: Request, files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="Upload at least 2 audio files to merge")
    if len(files) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 audio files per merge")

    ensure_temp_dir()
    temp_paths: list[str] = []
    output_path: str | None = None
    try:
        for f in files:
            name = (f.filename or "").lower()
            if not any(name.endswith(ext) for ext in _AUDIO_EXTS):
                raise HTTPException(status_code=400, detail=f"{f.filename}: unsupported audio format")
            content = await read_upload(f, label=f.filename or "audio")
            suffix = "." + name.rsplit(".", 1)[-1]
            tp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
            tp.write_bytes(content)
            temp_paths.append(str(tp))

        output_path = await asyncio.to_thread(video_tools_service.audio_merge, temp_paths)
        cleanup = BackgroundTask(remove_files, *temp_paths, output_path)
        return FileResponse(
            path=output_path,
            filename="merged.mp3",
            media_type="audio/mpeg",
            background=cleanup,
        )
    except ValueError as exc:
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        raise
    except Exception:
        remove_files(*temp_paths)
        if output_path: remove_files(output_path)
        logger.exception("audio-merge failed")
        raise HTTPException(status_code=500, detail="Audio merge failed")


# ─── PDF → Long Image ──────────────────────────────────────────────────────
@router.post("/pdf-to-long-image")
async def pdf_to_long_image_endpoint(
    file: UploadFile = File(...),
    format: str = Form("png"),
    dpi: int = Form(100),
):
    """Stitch every page of a PDF into one tall PNG/JPEG."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")
    ensure_temp_dir()
    content = await read_upload(file, label=file.filename or "document")
    validate_pdf_content(content)
    temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp_path.write_bytes(content)
    output_path: str | None = None
    try:
        # fitz render + Pillow stitch is CPU-heavy → run off the event loop.
        output_path = await asyncio.to_thread(
            long_image_service.pdf_to_long_image, str(temp_path), format, dpi
        )
        ext = output_path.rsplit(".", 1)[-1]
        stem = (file.filename or "document").rsplit(".", 1)[0] or "document"
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_long.{ext}",
            media_type="image/jpeg" if ext == "jpg" else f"image/{ext}",
            background=cleanup,
        )
    except (ValueError, ProcessingError) as exc:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        remove_files(str(temp_path))
        if output_path: remove_files(output_path)
        logger.exception("pdf-to-long-image failed")
        raise HTTPException(status_code=500, detail="Could not build the long image")
