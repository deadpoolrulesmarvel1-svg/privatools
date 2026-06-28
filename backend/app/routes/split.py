import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import split_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)


VALID_MODES = {"pages", "individual", "every_n"}


def _classify_split_error(exc: Exception) -> str:
    """Map pikepdf / service errors to frontend-readable strings."""
    msg = str(exc).lower()
    if "password" in msg or "encrypted" in msg:
        return "PDF is password-protected — unlock it first"
    if "out of bounds" in msg or "out of range" in msg:
        return str(exc)  # already framed as "Page X is out of bounds…"
    if "no page range" in msg or "no valid page" in msg or "invalid range" in msg or "invalid page value" in msg:
        return "Invalid page range syntax. Use formats like '1,3-5,9'"
    if "corrupt" in msg or "damaged" in msg or "cannot open" in msg:
        return "PDF appears corrupt or unreadable"
    return str(exc)


@router.post("/split")
async def split_pdf(
    file: UploadFile = File(...),
    mode: str = Form("pages"),
    pages: str = Form(""),
    n: int = Form(2),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if mode not in VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Mode must be one of: {', '.join(sorted(VALID_MODES))}",
        )

    if mode == "every_n" and n <= 0:
        raise HTTPException(
            status_code=400,
            detail="Chunk size 'n' must be greater than 0",
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

        try:
            output_path = await asyncio.to_thread(split_service.split_pdf, str(temp_path), mode=mode, pages=pages, n=n)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=_classify_split_error(exc)) from exc

        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        if output_path.endswith(".zip"):
            return FileResponse(
                path=output_path,
                filename=f"{stem}_split.zip",
                media_type="application/zip",
                background=cleanup,
            )
        return FileResponse(
            path=output_path,
            filename=f"{stem}_split.pdf",
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
        logger.exception("Unexpected error in /split")
        friendly = _classify_split_error(exc)
        if friendly != str(exc):
            raise HTTPException(status_code=400, detail=friendly) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
