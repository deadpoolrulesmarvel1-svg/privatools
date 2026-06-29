import asyncio
import logging
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from starlette.background import BackgroundTask

from ..utils.cleanup import (
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    validate_pdf_content,
)
from ..utils.route_helpers import safe_stem

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/auto-crop")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def auto_crop(request: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    out_path = None

    def _work():
        validate_pdf_content(content)
        import fitz

        doc = None
        try:
            try:
                doc = fitz.open(stream=content, filetype="pdf")
            except Exception as exc:
                # PyMuPDF wraps both encrypted-document and corrupt-stream failures here.
                msg = str(exc).lower()
                if "password" in msg or "encrypted" in msg:
                    raise HTTPException(
                        status_code=400,
                        detail="PDF is password-protected — unlock it first",
                    ) from exc
                raise HTTPException(
                    status_code=400,
                    detail="PDF appears corrupt or unreadable",
                ) from exc

            if doc.needs_pass:
                raise HTTPException(
                    status_code=400,
                    detail="PDF is password-protected — unlock it first",
                )

            if len(doc) == 0:
                raise HTTPException(status_code=400, detail="PDF has no pages")

            for page in doc:
                blocks = page.get_text("dict")["blocks"]
                if not blocks:
                    continue
                rects = [fitz.Rect(b["bbox"]) for b in blocks]
                union = rects[0]
                for r in rects[1:]:
                    union |= r
                margin = 20
                crop = fitz.Rect(
                    max(0, union.x0 - margin),
                    max(0, union.y0 - margin),
                    min(page.rect.width, union.x1 + margin),
                    min(page.rect.height, union.y1 + margin),
                )
                page.set_cropbox(crop)

            work_out_path = str(get_temp_path(f"cropped_{uuid.uuid4().hex}.pdf"))
            doc.save(work_out_path)
            doc.close()
            doc = None
            return work_out_path
        finally:
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    pass

    try:
        out_path = await asyncio.to_thread(_work)

        stem = safe_stem(file.filename)
        cleanup = BackgroundTask(remove_files, out_path)
        return FileResponse(
            path=out_path,
            filename=f"{stem}_auto_cropped.pdf",
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
        logger.exception("Unexpected error in /auto-crop")
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
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
