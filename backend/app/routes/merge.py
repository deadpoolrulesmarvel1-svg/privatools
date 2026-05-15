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

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILES = 100


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
        raise HTTPException(status_code=400, detail="Please upload at least 2 PDF files")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Please upload at most {MAX_FILES} PDF files")

    parsed_ranges: Optional[List[Optional[str]]] = None
    if page_ranges:
        try:
            parsed_ranges = json.loads(page_ranges)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="page_ranges must be valid JSON") from exc
        if not isinstance(parsed_ranges, list):
            raise HTTPException(status_code=400, detail="page_ranges must be a JSON array")
        if len(parsed_ranges) != len(files):
            raise HTTPException(
                status_code=400,
                detail=f"page_ranges length ({len(parsed_ranges)}) must equal file count ({len(files)})",
            )

    ensure_temp_dir()
    input_paths: list[str] = []
    output_path: str | None = None

    try:
        for file in files:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail=f"File {file.filename} is not a PDF")
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"File {file.filename or 'unknown'} is empty")
            validate_pdf_content(content)
            temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
            temp_path.write_bytes(content)
            input_paths.append(str(temp_path))

        try:
            output_path = merge_service.merge_pdfs(input_paths, page_ranges=parsed_ranges)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        cleanup = BackgroundTask(remove_files, *input_paths, output_path)
        return FileResponse(
            path=output_path,
            filename="merged.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = input_paths + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = input_paths + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
