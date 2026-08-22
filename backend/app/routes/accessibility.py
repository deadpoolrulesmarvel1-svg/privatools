"""PDF accessibility (PDF/UA + WCAG) checker.

Read-only: the upload is analysed and discarded. Nothing is written back to
the file and no result artifact is produced, so unlike the file-returning
tools this endpoint answers with JSON.
"""

import logging
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ..services import accessibility_service
from ..services.accessibility_service import AccessibilityError
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.concurrency import run_bounded

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/accessibility-check")
async def accessibility_check(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()
    temp_path = None

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        validate_pdf_content(content)
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_path.write_bytes(content)

        # The audit walks the full structure tree and extracts text from every
        # page, so it's genuinely CPU-heavy on large documents — it belongs in
        # the bounded heavy pool rather than the shared default executor.
        report = await run_bounded(
            accessibility_service.check_accessibility, str(temp_path)
        )
        return JSONResponse(report)
    except HTTPException:
        raise
    except AccessibilityError as exc:
        # Service-raised errors are already user-facing prose.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /accessibility-check")
        raise HTTPException(
            status_code=500, detail=f"Processing failed: {exc}"
        ) from exc
    finally:
        if temp_path is not None:
            remove_files(str(temp_path))
