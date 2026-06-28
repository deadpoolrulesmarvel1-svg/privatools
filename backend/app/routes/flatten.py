import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..services import flatten_service

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_SCOPES = {"all", "annotations", "forms"}


@router.post("/flatten")
async def flatten_pdf(
    file: UploadFile = File(...),
    scope: str = Form("all"),
):
    """Flatten annotations and/or form fields into static page content.

    - ``scope=all`` (default): flatten annotations AND form fields.
    - ``scope=annotations``: only annotations; form fields stay interactive.
    - ``scope=forms``: only form widgets; comments/highlights stay editable.

    The underlying service currently always flattens both, so for the partial
    scopes we still need to call it — but accepting the parameter now means
    the frontend can wire the UI today and the service can be tightened later
    without another round of route changes.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    if scope not in VALID_SCOPES:
        raise HTTPException(
            status_code=400,
            detail=f"scope must be one of: {', '.join(sorted(VALID_SCOPES))}",
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

        output_path = await asyncio.to_thread(flatten_service.flatten_pdf, str(temp_path))
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename="flattened.pdf",
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
