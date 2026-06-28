import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..services import organize_pages_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/organize-pages/thumbnails")
async def get_thumbnails(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    ensure_temp_dir()
    temp_path = None
    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path.write_bytes(content)
        thumbnails = await asyncio.to_thread(organize_pages_service.generate_thumbnails, str(temp_path))
        remove_files(str(temp_path))
        return JSONResponse({"thumbnails": thumbnails})
    except HTTPException:
        if temp_path is not None:
            remove_files(str(temp_path))
        raise
    except Exception as exc:
        if temp_path is not None:
            remove_files(str(temp_path))
        logger.exception("Unexpected error in /organize-pages/thumbnails")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc


@router.post("/organize-pages")
async def organize_pages(
    file: UploadFile = File(...),
    page_order: str = Form(...),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    # Parse and validate page_order up front so we can give a clean 400.
    try:
        order = json.loads(page_order)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="page_order must be valid JSON (e.g. [3,1,2])",
        ) from exc
    if not isinstance(order, list) or not order:
        raise HTTPException(
            status_code=400,
            detail="page_order must be a non-empty list of page indices",
        )
    for entry in order:
        if not isinstance(entry, int):
            raise HTTPException(
                status_code=400,
                detail="page_order entries must be integers",
            )

    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path.write_bytes(content)
        output_path = await asyncio.to_thread(organize_pages_service.reorder_pages, str(temp_path), order)
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_organized.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise
    except ValueError as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        msg = str(exc).lower()
        if "out of range" in msg or "out of bounds" in msg or "index" in msg:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error in /organize-pages")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        if "index" in msg or "out of range" in msg:
            raise HTTPException(
                status_code=400,
                detail="A page index in page_order is out of range for this PDF",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
