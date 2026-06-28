import asyncio
import base64
import io
import logging
import uuid
from typing import Optional

import pikepdf
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import sign_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_SIGNATURE_BYTES = 4 * 1024 * 1024  # 4 MB
SIGNATURE_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}
MAX_PAGE_DIMENSION = 14400.0  # ~5 m at 72 dpi — sane upper bound for placement


def _validate_signature_image(image_bytes: bytes) -> None:
    """Make sure the signature payload is a real image, not arbitrary bytes."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Signature image must be a valid PNG, JPG or WebP file",
        ) from exc


@router.post("/sign-pdf")
async def sign_pdf(
    file: UploadFile = File(...),
    signature: Optional[UploadFile] = File(None),
    signature_data: Optional[str] = Form(None),
    page: int = Form(1),
    x: float = Form(50),
    y: float = Form(50),
    width: float = Form(200),
    height: float = Form(80),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    # Validate placement geometry up front so we never write temp files for a
    # request that was always going to fail.
    if width <= 0 or height <= 0:
        raise HTTPException(
            status_code=400,
            detail="Signature width and height must be positive",
        )
    if x < 0 or y < 0:
        raise HTTPException(
            status_code=400,
            detail="Signature position cannot be negative",
        )
    if width > MAX_PAGE_DIMENSION or height > MAX_PAGE_DIMENSION:
        raise HTTPException(
            status_code=400,
            detail="Signature dimensions are unreasonably large",
        )

    ensure_temp_dir()

    pdf_content = await file.read()
    if not pdf_content:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")
    temp_pdf = None
    signature_path = None
    try:
        validate_pdf_content(pdf_content)
        temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_pdf.write_bytes(pdf_content)

        # Resolve signature image path — file upload wins over canvas blob.
        if signature and signature.filename:
            sig_content = await signature.read()
            if not sig_content:
                raise HTTPException(status_code=400, detail="Signature image is empty")
            if len(sig_content) > MAX_SIGNATURE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Signature image is too large (4 MB max)",
                )
            _validate_signature_image(sig_content)
            suffix = (signature.filename.rsplit(".", 1)[-1] or "").lower()
            if suffix not in SIGNATURE_IMAGE_EXTS:
                suffix = "png"
            sig_path = get_temp_path(f"sig_{uuid.uuid4().hex}.{suffix}")
            sig_path.write_bytes(sig_content)
            signature_path = str(sig_path)
        elif signature_data:
            # Decode the data URL ourselves so we can enforce the size limit
            # before writing the file — the service helper used to write first
            # then never checked the size.
            try:
                if signature_data.startswith("data:"):
                    _, encoded = signature_data.split(",", 1)
                else:
                    encoded = signature_data
                image_bytes = base64.b64decode(encoded, validate=False)
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Drawn signature data could not be decoded",
                ) from exc
            if not image_bytes:
                raise HTTPException(status_code=400, detail="Drawn signature is empty")
            if len(image_bytes) > MAX_SIGNATURE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Drawn signature image is too large (4 MB max)",
                )
            _validate_signature_image(image_bytes)
            sig_path = get_temp_path(f"sig_{uuid.uuid4().hex}.png")
            sig_path.write_bytes(image_bytes)
            signature_path = str(sig_path)
        else:
            raise HTTPException(
                status_code=400,
                detail="A signature image or drawn signature is required",
            )

        # Validate page index + that the signature box fits inside the target
        # page. Doing this here gives us a precise error before we hand off to
        # the service, which otherwise silently clamps to the last page.
        with pikepdf.open(str(temp_pdf)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                raise HTTPException(status_code=400, detail="PDF has no pages")
            if page < 1 or page > page_count:
                raise HTTPException(
                    status_code=400,
                    detail=f"Page {page} is out of range (PDF has {page_count} page{'s' if page_count != 1 else ''})",
                )
            target_page = pdf.pages[page - 1]
            mediabox = target_page.mediabox
            pg_width = float(mediabox[2]) - float(mediabox[0])
            pg_height = float(mediabox[3]) - float(mediabox[1])
            if x + width > pg_width + 0.5 or y + height > pg_height + 0.5:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Signature position is out of bounds (page is "
                        f"{pg_width:.0f}×{pg_height:.0f} pt)"
                    ),
                )

        output_path = await asyncio.to_thread(
            sign_service.sign_pdf,
            str(temp_pdf),
            signature_path,
            page=page,
            x=x,
            y=y,
            width=width,
            height=height,
        )
        cleanup = BackgroundTask(remove_files, str(temp_pdf), signature_path, output_path)
        return FileResponse(
            path=output_path,
            filename="signed.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        if temp_pdf is not None:
            remove_files(str(temp_pdf))
        if signature_path is not None:
            remove_files(signature_path)
        raise
    except Exception as e:
        if temp_pdf is not None:
            remove_files(str(temp_pdf))
        if signature_path is not None:
            remove_files(signature_path)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
