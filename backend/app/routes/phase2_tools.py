"""Phase 2 tool routes: E-sign PDF, table extraction, image background removal."""

import asyncio
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import bg_remover_service, esign_service, table_extractor_service
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from ..utils.route_helpers import read_upload, cleanup_on_error, MAX_SIZE

router = APIRouter()
logger = logging.getLogger(__name__)

PAGE_SELECTION_RE = re.compile(r"^(all|\d+(?:\s*,\s*\d+)*)$", re.IGNORECASE)
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


async def _read_upload(file: UploadFile, *, label: str, max_bytes: int = MAX_SIZE) -> bytes:
    return await read_upload(file, label=label, max_bytes=max_bytes)


def _cleanup_on_error(*paths: str | Path | None) -> None:
    cleanup_on_error(*paths)


# ─── E-Sign PDF ───────────────────────────────────────────
@router.post("/esign-pdf")
async def esign_pdf(
    file: UploadFile = File(...),
    signature: str = Form(...),
    page: int = Form(1, ge=1),
    x: float = Form(100, ge=0),
    y: float = Form(600, ge=0),
    width: float = Form(200, ge=1, le=2000),
    height: float = Form(80, ge=1, le=2000),
):
    """Sign a PDF with an uploaded/drawn signature image."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if not signature.strip():
        raise HTTPException(status_code=400, detail="Signature data is required")
    if len(signature) > 4_000_000:
        raise HTTPException(status_code=413, detail="Signature data is too large")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)

        out = await asyncio.to_thread(
            esign_service.esign_pdf,
            str(temp), signature, page_number=page,
            x=x, y=y, width=width, height=height
        )
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="signed.pdf", media_type="application/pdf", background=cleanup)
    except ValueError as e:
        _cleanup_on_error(temp, out)
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("esign-pdf error")
        raise HTTPException(status_code=500, detail="Signing failed")


# ─── PDF Table Extractor ─────────────────────────────────
@router.post("/extract-tables")
async def extract_tables(
    file: UploadFile = File(...),
    pages: str = Form("all"),
):
    """Extract tables from a PDF and return as CSV."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if not PAGE_SELECTION_RE.match((pages or "").strip()):
        raise HTTPException(status_code=400, detail="pages must be 'all' or comma-separated page numbers like '1,2,5'")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="PDF file")
        validate_pdf_content(content)
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp.write_bytes(content)

        out = await asyncio.to_thread(table_extractor_service.extract_tables, str(temp), pages=pages.strip() or "all")
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="tables.csv", media_type="text/csv", background=cleanup)
    except ValueError as e:
        _cleanup_on_error(temp, out)
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("extract-tables error")
        raise HTTPException(status_code=500, detail="Table extraction failed")


# ─── Background Remover ──────────────────────────────────
@router.post("/remove-background")
async def remove_background(
    file: UploadFile = File(...),
):
    """Remove the background from an image (runs locally, no API)."""
    fname = file.filename or ""
    suffix = Path(fname).suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Please upload an image (JPG, PNG, WebP)")

    ensure_temp_dir()
    temp = None
    out = None
    try:
        content = await _read_upload(file, label="Image file")
        temp = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        temp.write_bytes(content)

        out = await asyncio.to_thread(bg_remover_service.remove_background, str(temp))
        cleanup = BackgroundTask(remove_files, str(temp), out)
        return FileResponse(out, filename="no_background.png", media_type="image/png", background=cleanup)
    except HTTPException:
        _cleanup_on_error(temp, out)
        raise
    except Exception as e:
        _cleanup_on_error(temp, out)
        logger.exception("remove-background error")
        raise HTTPException(status_code=500, detail="Background removal failed")
