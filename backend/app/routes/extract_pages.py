import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services import extract_pages_service
from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/extract-pages")
async def extract_pages(
    file: UploadFile = File(...),
    pages: str = Form(...),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if not pages or not pages.strip():
        raise HTTPException(
            status_code=400,
            detail="No pages specified. Provide a range like '1,3-5,9'",
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

        try:
            output_path = await asyncio.to_thread(extract_pages_service.extract_pages, str(temp_path), pages)
        except ValueError as exc:
            msg = str(exc).lower()
            if "no valid pages" in msg or "no pages" in msg:
                raise HTTPException(
                    status_code=400,
                    detail="No valid pages matched — the range selected 0 pages",
                ) from exc
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            if "invalid literal" in str(exc).lower():
                raise HTTPException(
                    status_code=400,
                    detail="Invalid page range syntax. Use formats like '1,3-5,9'",
                ) from exc
            raise

        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, str(temp_path), output_path)
        return FileResponse(
            path=output_path,
            filename=f"{stem}_extracted.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        raise
    except Exception as exc:
        to_remove = ([str(temp_path)] if temp_path is not None else []) + (
            [output_path] if output_path else []
        )
        remove_files(*to_remove)
        logger.exception("Unexpected error in /extract-pages")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        if "invalid literal" in msg:
            raise HTTPException(
                status_code=400,
                detail="Invalid page range syntax. Use formats like '1,3-5,9'",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
