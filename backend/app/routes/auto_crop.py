import logging

from fastapi import APIRouter, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from starlette.background import BackgroundTask

from ..services import auto_crop_service
from ..utils.cleanup import (
    ensure_temp_dir,
    remove_files,
    validate_pdf_content,
)
from ..utils.exceptions import ToolError
from ..utils.route_helpers import safe_stem
from ..utils.concurrency import run_bounded
from ..utils.pdf_errors import pdf_read_error

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/auto-crop")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def auto_crop(request: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    validate_pdf_content(content)
    out_path = None

    try:
        out_path = await run_bounded(auto_crop_service.auto_crop, content)

        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, out_path)
        return FileResponse(
            path=out_path,
            filename=f"{stem}_auto_cropped.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except (HTTPException, ToolError):
        # A password-protected, unreadable or empty PDF (a ToolError): the
        # global handler answers with the error's own status and wording.
        if out_path:
            remove_files(out_path)
        raise
    except Exception as exc:
        if out_path:
            remove_files(out_path)
        if (pdf_error := pdf_read_error(exc)) is not None:
            raise HTTPException(status_code=pdf_error[0], detail=pdf_error[1]) from exc
        logger.exception("Unexpected error in /auto-crop")
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
