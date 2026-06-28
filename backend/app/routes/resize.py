import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import resize_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_PAGE_SIZES = {"a4", "letter", "a3", "legal", "custom"}
# Reasonable PDF page-size bounds (in points). PDF spec allows 3-14400.
_MIN_DIM_PT = 36       # 0.5"
_MAX_DIM_PT = 14400    # 200"


@router.post("/resize")
async def resize_pdf(
    file: UploadFile = File(...),
    page_size: str = Form("a4"),
    width: Optional[float] = Form(None),
    height: Optional[float] = Form(None),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if page_size.lower() not in VALID_PAGE_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"page_size must be one of: {', '.join(sorted(VALID_PAGE_SIZES))}",
        )

    if page_size.lower() == "custom":
        if width is None or height is None:
            raise HTTPException(
                status_code=400,
                detail="Custom page size requires both width and height",
            )
        if width <= 0 or height <= 0:
            raise HTTPException(
                status_code=400,
                detail="Custom width and height must be greater than 0",
            )
        if not (_MIN_DIM_PT <= width <= _MAX_DIM_PT and _MIN_DIM_PT <= height <= _MAX_DIM_PT):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Custom width and height must be between {_MIN_DIM_PT} and "
                    f"{_MAX_DIM_PT} points"
                ),
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

        output_path = await asyncio.to_thread(
            resize_service.resize_pdf,
            str(temp_path), page_size=page_size, width=width, height=height
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_resized.pdf",
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error in /resize")
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
