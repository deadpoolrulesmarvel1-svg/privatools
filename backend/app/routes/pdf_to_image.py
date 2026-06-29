import asyncio
import uuid
import logging
from fastapi import APIRouter, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import pdf_to_image_service

router = APIRouter()
logger = logging.getLogger(__name__)



_FORMAT_CONFIG = {
    "jpeg": ("jpg", "image/jpeg"),
    "jpg":  ("jpg", "image/jpeg"),
    "png":  ("png", "image/png"),
    "bmp":  ("bmp", "image/bmp"),
    "gif":  ("gif", "image/gif"),
    "tiff": ("tif", "image/tiff"),
    "tif":  ("tif", "image/tiff"),
    "webp": ("webp", "image/webp"),
}


@router.post("/pdf-to-image")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def pdf_to_image(
    request: Request,
    file: UploadFile = File(...),
    format: str = Form("jpeg"),
    dpi: int = Form(150, ge=36, le=600),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    fmt = format.lower()
    if fmt not in _FORMAT_CONFIG:
        allowed = ", ".join(sorted(set(v[0] for v in _FORMAT_CONFIG.values())))
        raise HTTPException(status_code=400, detail=f"Format must be one of: {allowed}")
    ext, media_type = _FORMAT_CONFIG[fmt]

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

        output_path = await asyncio.to_thread(pdf_to_image_service.pdf_to_images, str(temp_path), fmt=fmt, dpi=dpi)

        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        if output_path.endswith(".zip"):
            return FileResponse(
                path=output_path,
                filename="images.zip",
                media_type="application/zip",
                background=cleanup,
            )
        # Single-file output (single-page render OR multi-page bundle like TIFF).
        return FileResponse(
            path=output_path,
            filename=f"pages.{ext}" if fmt in ("tiff", "tif") else f"page_1.{ext}",
            media_type=media_type,
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
