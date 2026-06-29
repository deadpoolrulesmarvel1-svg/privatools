import asyncio
import os
import uuid
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..utils.render import safe_get_pixmap

router = APIRouter()
logger = logging.getLogger(__name__)

_MAX_WORKERS = min(os.cpu_count() or 2, 4)


def _invert_page(args: tuple) -> tuple:
    """Invert a single page. Returns (index, width, height, png_bytes)."""
    import fitz

    idx, page_bytes, dpi = args
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    page = doc[0]
    w, h = page.rect.width, page.rect.height
    pix = safe_get_pixmap(page, matrix=fitz.Matrix(dpi / 72, dpi / 72))
    pix.invert_irect(pix.irect)
    png_bytes = pix.tobytes("png")
    doc.close()
    return (idx, w, h, png_bytes)


def _invert(input_path: str, dpi: int) -> str:
    """CPU-heavy pixmap inversion — processes pages in parallel."""
    import fitz

    src = fitz.open(input_path)
    page_count = len(src)

    if page_count <= 2:
        # Few pages — direct sequential (avoids overhead)
        doc = fitz.open()
        for page in src:
            pix = safe_get_pixmap(page, matrix=fitz.Matrix(dpi / 72, dpi / 72))
            pix.invert_irect(pix.irect)
            new_page = doc.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, pixmap=pix)
        out_path = str(get_temp_path(f"inverted_{uuid.uuid4().hex}.pdf"))
        doc.save(out_path, deflate=True, garbage=4)
        doc.close()
        src.close()
        return out_path

    # Extract individual page PDFs for parallel processing
    page_pdfs = []
    for i in range(page_count):
        single = fitz.open()
        single.insert_pdf(src, from_page=i, to_page=i)
        page_pdfs.append(single.tobytes())
        single.close()
    src.close()

    tasks = [(i, pb, dpi) for i, pb in enumerate(page_pdfs)]

    results = [None] * page_count
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for idx, w, h, png_bytes in pool.map(_invert_page, tasks):
            results[idx] = (w, h, png_bytes)

    # Assemble final PDF
    import fitz as fitz2
    doc = fitz2.open()
    for w, h, png_bytes in results:
        new_page = doc.new_page(width=w, height=h)
        new_page.insert_image(new_page.rect, stream=png_bytes)

    out_path = str(get_temp_path(f"inverted_{uuid.uuid4().hex}.pdf"))
    doc.save(out_path, deflate=True, garbage=4)
    doc.close()
    return out_path


@router.post("/invert-colors")
async def invert_colors(
    file: UploadFile = File(...),
    dpi: int = Form(72),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()

    content = await file.read()
    temp_pdf = None
    output_path = None
    try:
        validate_pdf_content(content)
        temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_pdf.write_bytes(content)

        # Clamp DPI to a reasonable range (72–200)
        safe_dpi = max(72, min(dpi, 200))

        output_path = await asyncio.to_thread(_invert, str(temp_pdf), safe_dpi)
        cleanup = BackgroundTask(remove_files, str(temp_pdf), output_path)
        return FileResponse(
            path=output_path,
            filename="inverted.pdf",
            media_type="application/pdf",
            background=cleanup,
        )
    except HTTPException:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
