import asyncio
import uuid
import logging
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..services import deskew_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/deskew")
async def deskew(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")
    ensure_temp_dir()
    temp_path = None
    output_path = None
    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        validate_pdf_content(content)
        temp_path.write_bytes(content)
        output_path = await asyncio.to_thread(deskew_service.deskew, str(temp_path))
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(path=output_path, filename="deskewed.pdf", media_type="application/pdf", background=cleanup)
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
