import asyncio
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem
from ..utils.render import safe_get_pixmap

router = APIRouter()
logger = logging.getLogger(__name__)



def _process_blank_pages(data: bytes, sensitivity: int, out_path: str) -> str:
    """Detect and remove blank pages using fast pixel sampling."""
    import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    threshold = (100 - sensitivity) / 100.0
    pages_to_keep = []

    for i in range(len(doc)):
        page = doc[i]

        # Fast path: if page has text content, keep it immediately
        if page.get_text("text").strip():
            pages_to_keep.append(i)
            continue

        # Render at low DPI for blank detection
        pix = safe_get_pixmap(page, dpi=72)
        samples = pix.samples
        n = pix.n  # channels per pixel

        # Fast sampling: check every 8th pixel instead of every pixel
        # This is 64x faster with negligible accuracy loss for blank detection
        stride = 8
        white_count = 0
        sample_count = 0

        # Use memoryview for zero-copy access
        mv = memoryview(samples)
        for y in range(0, pix.height, stride):
            row_offset = y * pix.width * n
            for x in range(0, pix.width, stride):
                offset = row_offset + x * n
                sample_count += 1
                # Check if pixel is near-white (all channels > 250)
                is_white = True
                for c in range(min(n, 3)):
                    if mv[offset + c] <= 250:
                        is_white = False
                        break
                if is_white:
                    white_count += 1

        ratio = white_count / sample_count if sample_count > 0 else 1
        if ratio < (1 - threshold):
            pages_to_keep.append(i)

    if not pages_to_keep:
        pages_to_keep = list(range(len(doc)))

    new_doc = fitz.open()
    for i in pages_to_keep:
        new_doc.insert_pdf(doc, from_page=i, to_page=i)
    new_doc.save(out_path)
    new_doc.close()
    doc.close()
    return out_path


@router.post("/remove-blank-pages")
async def remove_blank_pages(
    file: UploadFile = File(...),
    sensitivity: int = Form(85),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    if sensitivity < 0 or sensitivity > 100:
        raise HTTPException(
            status_code=400,
            detail="sensitivity must be between 0 and 100",
        )

    ensure_temp_dir()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    out_path = None
    try:
        validate_pdf_content(content)
        out_path = str(get_temp_path(f"cleaned_{uuid.uuid4().hex}.pdf"))
        await asyncio.to_thread(_process_blank_pages, content, sensitivity, out_path)
        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, out_path)
        return FileResponse(
            path=out_path,
            filename=f"{stem}_blanks_removed.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        if out_path:
            remove_files(out_path)
        raise
    except Exception as exc:
        if out_path:
            remove_files(out_path)
        logger.exception("Unexpected error in /remove-blank-pages")
        msg = str(exc).lower()
        if "password" in msg or "encrypted" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF is password-protected — unlock it first",
            ) from exc
        if "corrupt" in msg or "damaged" in msg or "format error" in msg:
            raise HTTPException(
                status_code=400,
                detail="PDF appears corrupt or unreadable",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
