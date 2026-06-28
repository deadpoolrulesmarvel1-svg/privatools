import asyncio
import logging
from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from typing import Optional
from ..services import html_to_pdf_service
from ..utils.cleanup import remove_files

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 2_000_000  # 2 MB


@router.post("/html-to-pdf")
async def convert_html_to_pdf(
    url: Optional[str] = Form(None),
    html_content: Optional[str] = Form(None),
):
    if not url and not html_content:
        raise HTTPException(status_code=400, detail="Provide either a URL or HTML content")

    if html_content and len(html_content) > MAX_HTML_BYTES:
        raise HTTPException(status_code=413, detail="HTML content exceeds 2 MB limit")

    output_path = None
    try:
        if url:
            # URL scheme/host validation happens inside url_to_pdf via _validate_url
            output_path = await asyncio.to_thread(html_to_pdf_service.url_to_pdf, url)
        else:
            output_path = await asyncio.to_thread(html_to_pdf_service.html_to_pdf, html_content)

        cleanup = BackgroundTask(remove_files, output_path)
        return FileResponse(
            path=output_path,
            filename="converted.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        if output_path:
            remove_files(output_path)
        raise
    except Exception as e:
        if output_path:
            remove_files(output_path)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
