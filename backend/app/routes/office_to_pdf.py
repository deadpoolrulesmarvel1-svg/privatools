import uuid
from pathlib import Path
import logging
from fastapi import APIRouter, File, UploadFile, HTTPException, Request
from fastapi.responses import FileResponse
from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files
from ..utils.route_helpers import stream_upload_to_disk
from ..services import office_to_pdf_service

router = APIRouter()
logger = logging.getLogger(__name__)


ALLOWED_EXTENSIONS = office_to_pdf_service.ALLOWED_EXTENSIONS


@router.post("/office-to-pdf")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def office_to_pdf(request: Request, file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower() if file.filename else ""
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    ensure_temp_dir()
    temp_path = None
    output_path = None

    try:
        # Stream the (potentially 50-200 MB) Office file straight to disk
        # instead of buffering it in RAM — keeps peak memory at one chunk so
        # concurrent conversions can't OOM the worker (research C3).
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}{suffix}")
        await stream_upload_to_disk(file, temp_path, label="Office document")

        output_path = await office_to_pdf_service.office_to_pdf(str(temp_path))
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="converted.pdf",
            media_type="application/pdf",
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
