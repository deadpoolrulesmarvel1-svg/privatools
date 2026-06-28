import asyncio
import json
import logging
import re
import uuid

import fitz
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import redact_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_REDACTIONS = 5000  # plenty of headroom; protects against runaway clients


def _validate_redactions(rects: list, page_count: int) -> None:
    """Make sure every redaction has positive dimensions and lands on a real page.

    The frontend redaction canvas does this client-side but we cannot trust it
    — a hand-crafted POST would otherwise crash deep inside PyMuPDF or, worse,
    silently no-op so the caller thinks the document was scrubbed when nothing
    actually happened.
    """
    if not rects:
        raise HTTPException(status_code=400, detail="No redaction rectangles provided")
    if len(rects) > MAX_REDACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many redactions ({len(rects)} > {MAX_REDACTIONS})",
        )

    for i, r in enumerate(rects):
        if not isinstance(r, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Redaction #{i + 1} must be an object",
            )

        # Accept either x0/y0/x1/y1 or x/y/width/height — match service.
        if "x0" in r and "x1" in r:
            try:
                w = float(r.get("x1", 0)) - float(r.get("x0", 0))
                h = float(r.get("y1", 0)) - float(r.get("y0", 0))
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Redaction #{i + 1} has non-numeric coordinates",
                ) from exc
        else:
            try:
                w = float(r.get("width", 0))
                h = float(r.get("height", 0))
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Redaction #{i + 1} has non-numeric dimensions",
                ) from exc

        if w <= 0 or h <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Redaction #{i + 1} must have positive width and height",
            )

        try:
            page_idx = int(r.get("page", 0))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Redaction #{i + 1} page must be an integer",
            ) from exc
        if page_idx < 0 or page_idx >= page_count:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Redaction #{i + 1} page {page_idx} is out of range "
                    f"(PDF has {page_count} page{'s' if page_count != 1 else ''})"
                ),
            )


@router.post("/redact")
async def redact_pdf(
    file: UploadFile = File(...),
    redactions: str = Form(...),
    color: str = Form("#000000"),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        rects = json.loads(redactions)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid redactions JSON") from exc

    if not isinstance(rects, list):
        raise HTTPException(status_code=400, detail="Redactions must be a JSON array")

    if not re.match(r"^#[0-9a-fA-F]{6}$", color):
        raise HTTPException(
            status_code=400,
            detail="Color must be a valid hex color (e.g. #000000)",
        )

    ensure_temp_dir()
    temp_pdf = None
    output_path = None

    try:
        validate_pdf_content(content)
        temp_pdf = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
        temp_pdf.write_bytes(content)

        # Open the PDF once just to count pages so we can reject out-of-range
        # redactions with a precise message before any real work happens.
        with fitz.open(str(temp_pdf)) as probe:
            page_count = len(probe)
        if page_count == 0:
            raise HTTPException(status_code=400, detail="PDF has no pages")

        _validate_redactions(rects, page_count)

        output_path = await asyncio.to_thread(redact_service.redact_pdf, str(temp_pdf), rects, color=color)
        cleanup = BackgroundTask(remove_files, str(temp_pdf), output_path)
        return FileResponse(
            path=output_path,
            filename="redacted.pdf",
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
