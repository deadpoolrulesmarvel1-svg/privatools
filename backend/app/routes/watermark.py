import asyncio
import logging
import uuid
import io
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from PIL import Image

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.route_helpers import read_upload
from ..services import watermark_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_WATERMARK_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

VALID_POSITIONS = {
    "center", "top", "bottom",
    "top-left", "top-right", "bottom-left", "bottom-right",
    "diagonal", "tile",
}


@router.post("/watermark")
async def watermark_pdf(
    file: UploadFile = File(...),
    text: str = Form(""),
    watermark_image: UploadFile | None = File(None),
    opacity: float = Form(0.3, ge=0.0, le=1.0),
    font_size: int = Form(40, ge=6, le=300),
    image_scale: float = Form(0.25, ge=0.05, le=1.0),
    position: str = Form("center"),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    clean_text = (text or "").strip()
    has_image_watermark = bool(watermark_image and watermark_image.filename)
    if not has_image_watermark and not clean_text:
        raise HTTPException(
            status_code=400,
            detail="Provide watermark text or upload a watermark image",
        )
    if clean_text and len(clean_text) > 200:
        raise HTTPException(
            status_code=400,
            detail="Watermark text must be 200 characters or fewer",
        )

    if position not in VALID_POSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Position must be one of: {', '.join(sorted(VALID_POSITIONS))}",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None
    watermark_image_path = None

    try:
        # read_upload enforces the MAX_UPLOAD_MB cap and "file is empty" check
        # in one place instead of re-deriving the logic here.
        content = await read_upload(file, label=file.filename or "PDF file")
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        if has_image_watermark and watermark_image is not None:
            image_bytes = await read_upload(
                watermark_image,
                label=watermark_image.filename or "Watermark image",
                max_bytes=MAX_WATERMARK_IMAGE_BYTES,
            )
            try:
                with Image.open(io.BytesIO(image_bytes)) as img:
                    img.verify()
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Watermark image must be a valid PNG/JPG/WebP file",
                ) from exc

            suffix = Path(watermark_image.filename).suffix.lower() or ".png"
            watermark_image_path = get_temp_path(f"watermark_{uuid.uuid4().hex}{suffix}")
            watermark_image_path.write_bytes(image_bytes)

        output_path = await asyncio.to_thread(
            watermark_service.add_watermark,
            str(temp_path),
            text=clean_text,
            opacity=opacity,
            font_size=font_size,
            position=position,
            watermark_image_path=str(watermark_image_path) if watermark_image_path is not None else None,
            image_scale=image_scale,
        )
        cleanup_paths = [str(temp_path), output_path]
        if watermark_image_path is not None:
            cleanup_paths.append(str(watermark_image_path))
        cleanup = BackgroundTask(remove_files, *cleanup_paths)
        return FileResponse(
            path=output_path,
            filename="watermarked.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = (
            ([str(temp_path)] if temp_path is not None else [])
            + ([output_path] if output_path else [])
            + ([str(watermark_image_path)] if watermark_image_path is not None else [])
        )
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = (
            ([str(temp_path)] if temp_path is not None else [])
            + ([output_path] if output_path else [])
            + ([str(watermark_image_path)] if watermark_image_path is not None else [])
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
