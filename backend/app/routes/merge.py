import asyncio
import json
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import merge_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILES = 100


def _classify_processing_error(exc: Exception) -> str:
    """Convert a service-layer exception into a frontend-friendly message."""
    msg = str(exc).lower()
    if "password" in msg or "encrypted" in msg:
        return "One of the PDFs is password-protected — unlock it first"
    if "out of bounds" in msg or "out of range" in msg:
        # Service already crafts "Page X is out of bounds (PDF has Y pages)."
        return str(exc)
    if "invalid page" in msg or "invalid range" in msg or "invalid page number" in msg:
        return "Invalid page range syntax. Use formats like '1,3-5,9'"
    if "selected zero" in msg or "zero pages" in msg:
        return "Page range selected zero pages"
    if "corrupt" in msg or "damaged" in msg or "cannot open" in msg:
        return "PDF appears corrupt or unreadable"
    return str(exc)


@router.post("/merge")
async def merge_pdfs(
    files: List[UploadFile] = File(...),
    page_ranges: Optional[str] = Form(None),
):
    """Merge multiple PDFs into one.

    Optional `page_ranges` is a JSON-encoded array of strings — one per file —
    where each entry is either `null`, `""`, `"all"` (include every page) or a
    Smallpdf-style range like `"1-3,5,7-end"`. The list MUST be the same length
    as `files` if provided.
    """
    if len(files) < 2:
        raise HTTPException(
            status_code=400,
            detail="Please upload at least 2 PDF files to merge",
        )
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Please upload at most {MAX_FILES} PDF files",
        )

    parsed_ranges: Optional[List[Optional[str]]] = None
    if page_ranges:
        try:
            parsed_ranges = json.loads(page_ranges)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Invalid page range syntax. Use formats like '1,3-5,9'",
            ) from exc
        if not isinstance(parsed_ranges, list):
            raise HTTPException(
                status_code=400,
                detail="page_ranges must be a JSON array",
            )
        if len(parsed_ranges) != len(files):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"page_ranges length ({len(parsed_ranges)}) must equal "
                    f"file count ({len(files)})"
                ),
            )

    ensure_temp_dir()
    input_paths: list[str] = []
    output_path: str | None = None

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename or 'unknown'} is not a PDF",
                )
            content = await file.read()
            if not content:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename or 'unknown'} is empty",
                )
            validate_pdf_content(content)
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        try:
            output_path = await asyncio.to_thread(merge_service.merge_pdfs, input_paths, page_ranges=parsed_ranges)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=_classify_processing_error(exc),
            ) from exc

        # Use the first file's stem as the base; append "_merged" so it stays distinct.
        stem = safe_stem(files[0].filename, fallback="documents")
        download_name = f"{stem}_merged.pdf"

        cleanup = BackgroundTask(remove_files, *input_paths, output_path)
        return FileResponse(
            path=output_path,
            filename=download_name,
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = input_paths + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as exc:
        to_remove = input_paths + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error in /merge")
        # Try to classify before falling through to a 500.
        friendly = _classify_processing_error(exc)
        if friendly != str(exc):
            raise HTTPException(status_code=400, detail=friendly) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
