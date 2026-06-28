import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import bates_numbering_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)

# 6 positions — matches the spec the frontend BatesUI sends.
VALID_POSITIONS = {
    "bottom-right",
    "bottom-left",
    "bottom-center",
    "top-right",
    "top-left",
    "top-center",
}

MAX_START_NUMBER = 10_000_000   # ~10 million docs is enough for any single load.
MAX_DIGITS = 10


@router.post("/bates-numbering")
async def bates_numbering(
    file: UploadFile = File(...),
    prefix: str = Form(""),
    start_number: int = Form(1),
    digits: int = Form(6),
    position: str = Form("bottom-right"),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if position not in VALID_POSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Position must be one of: {', '.join(sorted(VALID_POSITIONS))}",
        )

    if start_number < 0:
        raise HTTPException(
            status_code=400,
            detail="start_number must be non-negative",
        )
    if start_number > MAX_START_NUMBER:
        raise HTTPException(
            status_code=400,
            detail=f"start_number must be {MAX_START_NUMBER:,} or less",
        )
    if digits < 1 or digits > MAX_DIGITS:
        raise HTTPException(
            status_code=400,
            detail=f"digits must be between 1 and {MAX_DIGITS}",
        )

    # Detect "start_number too large to fit in `digits` zero-padded characters".
    # If the final page would exceed 10**digits we'd visually drop leading zeros,
    # which usually surprises legal users. We don't know page count yet, so
    # only check the start itself here — service can't render fewer digits than
    # `str(start_number)` needs.
    if len(str(start_number)) > digits:
        raise HTTPException(
            status_code=400,
            detail=(
                f"start_number {start_number} needs {len(str(start_number))} digits "
                f"but 'digits' is {digits}. Increase digits or lower start_number."
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
            bates_numbering_service.add_bates_numbering,
            str(temp_path),
            prefix=prefix,
            start_number=start_number,
            digits=digits,
            position=position,
        )
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_bates.pdf",
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
        logger.exception("Unexpected error in /bates-numbering")
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
