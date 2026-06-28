import asyncio
import uuid
import logging
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import alternate_mix_service

router = APIRouter()
logger = logging.getLogger(__name__)
VALID_MODES = {"alternate", "reverse-alternate"}


@router.post("/alternate-mix")
async def alternate_mix(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    mode: str = Form("alternate"),
):
    for f in (file1, file2):
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"File {f.filename} is not a PDF")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of: {', '.join(sorted(VALID_MODES))}")
    ensure_temp_dir()
    path1 = None
    path2 = None
    output_path = None
    try:
        path1 = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content1 = await file1.read()
        validate_pdf_content(content1)
        path1.write_bytes(content1)

        path2 = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content2 = await file2.read()
        validate_pdf_content(content2)
        path2.write_bytes(content2)

        output_path = await asyncio.to_thread(alternate_mix_service.alternate_mix, str(path1), str(path2), mode=mode)
        cleanup = BackgroundTask(remove_files, str(path1), str(path2), output_path)
        return FileResponse(
            path=output_path,
            filename="alternate_mix.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = (
            ([str(path1)] if path1 is not None else [])
            + ([str(path2)] if path2 is not None else [])
            + ([output_path] if output_path else [])
        )
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = (
            ([str(path1)] if path1 is not None else [])
            + ([str(path2)] if path2 is not None else [])
            + ([output_path] if output_path else [])
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
