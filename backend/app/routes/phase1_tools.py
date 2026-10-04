"""Phase 1 tool routes: DOCX/XLSX/PPTX/TXT conversions, PDF stamp, HEIC→JPG."""

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import (
    excel_to_pdf_service,
    heic_to_jpg_service,
    pptx_to_pdf_service,
    stamp_service,
    txt_to_pdf_service,
    word_to_pdf_service,
)
from ..utils.exceptions import ToolError
from ..utils.images import image_read_error
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from ..utils.route_helpers import read_upload, cleanup_on_error, MAX_SIZE
from ..utils.pdf_errors import pdf_read_error

router = APIRouter()
logger = logging.getLogger(__name__)

STAMP_TYPES = set(stamp_service.STAMP_PRESETS.keys()) | {"custom"}
STAMP_POSITIONS = {"center", "top", "bottom", "diagonal"}


async def _read_upload(file: UploadFile, *, label: str, max_bytes: int = MAX_SIZE) -> bytes:
    return await read_upload(file, label=label, max_bytes=max_bytes)


def _cleanup_on_error(*paths: str | Path | None) -> None:
    cleanup_on_error(*paths)


# ─── Word → PDF ───────────────────────────────────────────
@router.post("/word-to-pdf")
async def word_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Please upload a .docx file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Word document")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.docx")
        temp.write_bytes(content)

        out, equations = await asyncio.to_thread(word_to_pdf_service.word_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        # The PDF has none of the document's Word equations; the page says how many.
        return FileResponse(out, filename="converted.pdf", media_type="application/pdf", background=cleanup,
                            headers={"X-Equations-Left-Out": str(equations)})
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("word-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── Excel → PDF ──────────────────────────────────────────
@router.post("/excel-to-pdf")
async def excel_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Spreadsheet")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.xlsx")
        temp.write_bytes(content)

        out = await asyncio.to_thread(excel_to_pdf_service.excel_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="converted.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("excel-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── PowerPoint → PDF ────────────────────────────────────
@router.post("/pptx-to-pdf-convert")
async def pptx_to_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Please upload a .pptx file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Presentation")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pptx")
        temp.write_bytes(content)

        out = await asyncio.to_thread(pptx_to_pdf_service.pptx_to_pdf, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="converted.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("pptx-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── PDF Stamp ────────────────────────────────────────────
@router.post("/stamp-pdf")
async def stamp_pdf(
    file: UploadFile = File(...),
    stamp_type: str = Form("confidential"),
    custom_text: str | None = Form(None),
    opacity: float = Form(0.3, ge=0.0, le=1.0),
    position: str = Form("center"),
    pages: str = Form("all", description=(
        "The pages to stamp: 'all', or page numbers and ranges separated by commas, such as "
        "'1,3,5-8'. 'end' is the last page, '8-' runs to the end and '-3' is the first three. "
        "A page the PDF does not have is refused with a 400 that gives the valid range."
    )),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if stamp_type not in STAMP_TYPES:
        raise HTTPException(status_code=400, detail=f"stamp_type must be one of: {', '.join(sorted(STAMP_TYPES))}")
    if stamp_type == "custom" and not (custom_text or "").strip():
        raise HTTPException(status_code=400, detail="custom_text is required when stamp_type is custom")
    if len((custom_text or "").strip()) > 120:
        raise HTTPException(status_code=400, detail="custom_text must be 120 characters or fewer")
    if position not in STAMP_POSITIONS:
        raise HTTPException(status_code=400, detail=f"position must be one of: {', '.join(sorted(STAMP_POSITIONS))}")
    # The pages are read with the shared parser (utils.page_range) once the
    # page count is known, as Rotate PDF reads them: ranges included.

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)

        out = await asyncio.to_thread(
            stamp_service.stamp_pdf,
            str(temp),
            stamp_type,
            (custom_text or "").strip() or None,
            opacity,
            position,
            pages.strip() if pages else "all",
        )
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="stamped.pdf", media_type="application/pdf", background=cleanup)
    except (HTTPException, ToolError):
        # ToolError: a PDF that is damaged, needs a password or has no pages
        # (utils.cleanup.process_pdf); the global handler gives its 400.
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        if (pdf_error := pdf_read_error(e)) is not None:
            raise HTTPException(status_code=pdf_error[0], detail=pdf_error[1]) from e
        logger.exception("stamp error")
        raise HTTPException(status_code=500, detail="Stamping failed")


# ─── TXT → PDF ────────────────────────────────────────────
@router.post("/txt-to-pdf")
async def txt_to_pdf(
    file: UploadFile = File(...),
    font_size: int = Form(11, ge=6, le=48),
):
    if not file.filename or not file.filename.lower().endswith(".txt"):
        raise HTTPException(status_code=400, detail="Please upload a .txt file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Text file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.txt")
        temp.write_bytes(content)

        out = await asyncio.to_thread(txt_to_pdf_service.txt_to_pdf, str(temp), font_size=font_size)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="converted.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("txt-to-pdf error")
        raise HTTPException(status_code=500, detail="Conversion failed")


# ─── HEIC → JPG ──────────────────────────────────────────
@router.post("/heic-to-jpg")
async def heic_to_jpg(
    file: UploadFile = File(...),
    quality: int = Form(90, ge=1, le=100),
):
    fname = file.filename or ""
    if not fname.lower().endswith((".heic", ".heif")):
        raise HTTPException(status_code=400, detail="Please upload a .heic or .heif file")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="HEIC image")
        suffix = Path(fname).suffix.lower()
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        temp.write_bytes(content)

        out = await asyncio.to_thread(heic_to_jpg_service.heic_to_jpg, str(temp), quality=quality)
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="converted.jpg", media_type="image/jpeg", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        if (image_error := image_read_error(e)) is not None:
            raise HTTPException(status_code=image_error[0], detail=image_error[1]) from e
        logger.exception("heic-to-jpg error")
        raise HTTPException(status_code=500, detail="Conversion failed")
