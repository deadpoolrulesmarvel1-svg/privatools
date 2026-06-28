import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import page_numbers_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)


VALID_POSITIONS = {
    "bottom-center",
    "bottom-left",
    "bottom-right",
    "top-center",
    "top-left",
    "top-right",
}


@router.post("/page-numbers")
async def add_page_numbers(
    file: UploadFile = File(...),
    position: str = Form("bottom-center"),
    start_number: int = Form(1, ge=1, le=1_000_000),
    font_size: int = Form(12, ge=6, le=144),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if position not in VALID_POSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Position must be one of: {', '.join(sorted(VALID_POSITIONS))}",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        output_path = await asyncio.to_thread(
            page_numbers_service.add_page_numbers,
            str(temp_path),
            position=position,
            start_number=start_number,
            font_size=font_size,
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_numbered.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error in /page-numbers")
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
