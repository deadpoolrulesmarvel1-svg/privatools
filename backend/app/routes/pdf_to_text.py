import asyncio
import uuid
import logging
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from ..utils.cleanup import get_temp_path, ensure_temp_dir, validate_pdf_content, remove_files
from ..services import pdf_to_text_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/pdf-to-text")
async def pdf_to_text(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()
    temp_path = None

    try:
        temp_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content = await file.read()
        validate_pdf_content(content)
        temp_path.write_bytes(content)

        result = await asyncio.to_thread(pdf_to_text_service.extract_text, str(temp_path))
        remove_files(str(temp_path))
        return JSONResponse(result)
    except HTTPException:
        if temp_path is not None:
            remove_files(str(temp_path))
        raise
    except Exception as e:
        if temp_path is not None:
            remove_files(str(temp_path))
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
