import asyncio
import uuid
import logging
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import overlay_service

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_MODES = {"overlay", "stamp", "underlay"}


@router.post("/overlay")
async def overlay(
    base_file: UploadFile = File(...),
    overlay_file: UploadFile = File(...),
    mode: str = Form("overlay"),
):
    for f in (base_file, overlay_file):
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"File {f.filename} is not a PDF")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of: {', '.join(sorted(VALID_MODES))}")
    ensure_temp_dir()
    base_path = None
    ovl_path = None
    output_path = None
    try:
        base_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content1 = await base_file.read()
        validate_pdf_content(content1)
        base_path.write_bytes(content1)

        ovl_path = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        content2 = await overlay_file.read()
        validate_pdf_content(content2)
        ovl_path.write_bytes(content2)

        output_path = await asyncio.to_thread(overlay_service.overlay, str(base_path), str(ovl_path), mode=mode)
        cleanup = BackgroundTask(remove_files, str(base_path), str(ovl_path), output_path)
        return FileResponse(
            path=output_path,
            filename="overlaid.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = (
            ([str(base_path)] if base_path is not None else [])
            + ([str(ovl_path)] if ovl_path is not None else [])
            + ([output_path] if output_path else [])
        )
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = (
            ([str(base_path)] if base_path is not None else [])
            + ([str(ovl_path)] if ovl_path is not None else [])
            + ([output_path] if output_path else [])
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
