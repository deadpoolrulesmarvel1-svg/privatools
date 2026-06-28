import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import qr_code_service
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content

router = APIRouter()
logger = logging.getLogger(__name__)

# Max 5 MB logo upload — anything beyond is wasteful (it's resized to ~20% of QR width).
MAX_LOGO_BYTES = 5 * 1024 * 1024
_ALLOWED_LOGO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


@router.post("/qr-code")
async def generate_qr_code(
    data: str = Form(...),
    size: int = Form(300, ge=64, le=2000),
    format: str = Form("png"),
    fg_color: str = Form("#000000"),
    bg_color: str = Form("#ffffff"),
    logo: Optional[UploadFile] = File(None),
    embed_in_pdf: Optional[UploadFile] = File(None),
    page: int = Form(1, ge=1),
    x: float = Form(50),
    y: float = Form(50),
    qr_size: float = Form(100, gt=0),
):
    if not data.strip():
        raise HTTPException(status_code=400, detail="QR code data cannot be empty")

    ensure_temp_dir()
    temp_pdf = None

    try:
        fmt = format.lower().strip()
        if fmt not in {"png", "pdf"}:
            raise HTTPException(status_code=400, detail="format must be either 'png' or 'pdf'")

        logo_bytes: bytes | None = None
        if logo is not None and logo.filename:
            # Validate logo image format by extension (avoid sniffing surprises).
            lf = (logo.filename or "").lower()
            if not any(lf.endswith(ext) for ext in _ALLOWED_LOGO_EXTS):
                raise HTTPException(
                    status_code=400,
                    detail="Logo format must be one of: PNG, JPG, WEBP, BMP, GIF",
                )
            logo_bytes = await logo.read()
            if not logo_bytes:
                raise HTTPException(status_code=400, detail="Logo file is empty")
            if len(logo_bytes) > MAX_LOGO_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Logo file too large (max {MAX_LOGO_BYTES // (1024*1024)} MB)",
                )

        if embed_in_pdf and embed_in_pdf.filename:
            if not embed_in_pdf.filename.lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail="embed_in_pdf must be a PDF file")
            pdf_content = await embed_in_pdf.read()
            validate_pdf_content(pdf_content)
            temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_pdf.write_bytes(pdf_content)
            output_path = await asyncio.to_thread(
                qr_code_service.embed_qr_in_pdf,
                str(temp_pdf), data,
                page=page, x=x, y=y, qr_size=qr_size,
                fg_color=fg_color, bg_color=bg_color, logo_bytes=logo_bytes,
            )
            cleanup = BackgroundTask(remove_files, str(temp_pdf), output_path)
            return FileResponse(
                path=output_path,
                filename="qr_embedded.pdf",
                media_type="application/pdf",
                background=cleanup,
            )

        if fmt == "pdf":
            output_path = await asyncio.to_thread(
                qr_code_service.generate_qr_pdf,
                data, size=size, fg_color=fg_color, bg_color=bg_color, logo_bytes=logo_bytes,
            )
            cleanup = BackgroundTask(remove_files, output_path)
            return FileResponse(
                path=output_path,
                filename="qr_code.pdf",
                media_type="application/pdf",
                background=cleanup,
            )
        output_path = await asyncio.to_thread(
            qr_code_service.generate_qr_png,
            data, size=size, fg_color=fg_color, bg_color=bg_color, logo_bytes=logo_bytes,
        )
        cleanup = BackgroundTask(remove_files, output_path)
        return FileResponse(
            path=output_path,
            filename="qr_code.png",
            media_type="image/png",
            background=cleanup,
        )
    except HTTPException:
        if temp_pdf is not None:
            remove_files(str(temp_pdf))
        raise
    except ValueError as exc:
        # Friendly validation error from the service (e.g. invalid hex)
        if temp_pdf is not None:
            remove_files(str(temp_pdf))
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        if temp_pdf is not None:
            remove_files(str(temp_pdf))
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
