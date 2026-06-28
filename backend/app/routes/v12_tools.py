"""Routes added in v1.2.0: web-optimize, split-by-text, pdf-to-html,
pdf-to-rtf, view-exif.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..services import (
    pdf_to_html_service,
    pdf_to_rtf_service,
    split_by_text_service,
    view_exif_service,
    web_optimize_service,
)
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Web-optimize PDF (linearize for byte-range serving) ────────────────────
@router.post("/web-optimize")
async def web_optimize_endpoint(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        content = await file.read()
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)
        output_path = await web_optimize_service.web_optimize(str(temp_path))
        return FileResponse(
            path=output_path,
            filename="web-optimized.pdf",
            media_type="application/pdf",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
        )
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise
    except ValueError as ve:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        logger.exception("web-optimize failed")
        raise HTTPException(status_code=500, detail=f"Web-optimize failed: {e}")


# ─── Split by text/keyword ──────────────────────────────────────────────────
@router.post("/split-by-text")
async def split_by_text_endpoint(
    file: UploadFile = File(...),
    search: str = Form(...),
    case_sensitive: bool = Form(False),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    if not search or not search.strip():
        raise HTTPException(status_code=400, detail="search must not be empty")
    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        content = await file.read()
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)
        output_path = await asyncio.to_thread(
            split_by_text_service.split_by_text,
            str(temp_path), search.strip(), case_sensitive=case_sensitive
        )
        return FileResponse(
            path=output_path,
            filename="split-by-text.zip",
            media_type="application/zip",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
        )
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise
    except ValueError as ve:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        logger.exception("split-by-text failed")
        raise HTTPException(status_code=500, detail=f"Split-by-text failed: {e}")


# ─── PDF → HTML ─────────────────────────────────────────────────────────────
@router.post("/pdf-to-html")
async def pdf_to_html_endpoint(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        content = await file.read()
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)
        output_path = await asyncio.to_thread(pdf_to_html_service.pdf_to_html, str(temp_path))
        return FileResponse(
            path=output_path,
            filename="document.html",
            media_type="text/html",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
        )
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise
    except Exception as e:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        logger.exception("pdf-to-html failed")
        raise HTTPException(status_code=500, detail=f"pdf-to-html failed: {e}")


# ─── PDF → RTF ──────────────────────────────────────────────────────────────
@router.post("/pdf-to-rtf")
async def pdf_to_rtf_endpoint(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF")
    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        content = await file.read()
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)
        output_path = await asyncio.to_thread(pdf_to_rtf_service.pdf_to_rtf, str(temp_path))
        return FileResponse(
            path=output_path,
            filename="document.rtf",
            media_type="application/rtf",
            background=BackgroundTask(remove_files, str(temp_path), output_path),
        )
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        raise
    except Exception as e:
        remove_files(*([str(temp_path)] if temp_path else []), *([output_path] if output_path else []))
        logger.exception("pdf-to-rtf failed")
        raise HTTPException(status_code=500, detail=f"pdf-to-rtf failed: {e}")


# ─── View EXIF / image metadata ─────────────────────────────────────────────
@router.post("/view-exif")
async def view_exif_endpoint(file: UploadFile = File(...)):
    fname = (file.filename or "").lower()
    if not any(fname.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".heic", ".heif", ".bmp", ".gif")):
        raise HTTPException(status_code=400, detail="Please upload an image (jpg, png, tiff, webp, heic, bmp, gif)")
    ensure_temp_dir()
    temp_path = None
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file")
        # Use only the extension from the upload — the filename itself is
        # untrusted user input and shouldn't be interpolated into a path
        # even with get_temp_path's sanitization.
        suffix = ""
        if "." in (file.filename or ""):
            ext = (file.filename or "").rsplit(".", 1)[-1].lower()
            # Whitelist short alphanumeric extensions only.
            if 1 <= len(ext) <= 8 and ext.isalnum():
                suffix = f".{ext}"
        temp_path = get_temp_path(f"exif_{uuid.uuid4().hex}{suffix}")
        temp_path.write_bytes(content)
        data = await asyncio.to_thread(view_exif_service.view_exif, str(temp_path))
        return JSONResponse(content=data, background=BackgroundTask(remove_files, str(temp_path)))
    except HTTPException:
        remove_files(*([str(temp_path)] if temp_path else []))
        raise
    except Exception as e:
        remove_files(*([str(temp_path)] if temp_path else []))
        logger.exception("view-exif failed")
        raise HTTPException(status_code=500, detail=f"view-exif failed: {e}")
