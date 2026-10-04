import asyncio
import json
import logging
import re
import uuid

from fastapi import APIRouter, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..utils.cleanup import get_temp_path, ensure_temp_dir, remove_files, validate_pdf_content
from ..services import redact_service
from ..utils.concurrency import run_bounded
from ..utils.route_helpers import pdf_page_count
from ..utils.pdf_errors import pdf_read_error

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_REDACTIONS = 5000  # plenty of headroom; protects against runaway clients

# `page` has counted from 0 since the route moved to PyMuPDF (2026-03-05), and
# API callers depend on that: reading it from 1 instead would silently move
# their boxes to the page before. The website's page shows page numbers from 1
# and subtracts one when it sends them (RedactUI.tsx).
REDACTIONS_DESCRIPTION = (
    "JSON array of rectangles to redact. Each has `page`, the page's index counted "
    "from 0 (0 is the first page), and either `x`, `y`, `width` and `height` or "
    "`x0`, `y0`, `x1` and `y1`, in points (1/72 inch) from the top-left corner of "
    "the page's visible area (its CropBox), before any /Rotate setting it has is "
    "applied. Optional `code`, an "
    "exemption code of up to 32 characters, is printed inside the box."
)


def _page_word(count: int) -> str:
    return f"{count} page{'s' if count != 1 else ''}"


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
                    f"Redaction #{i + 1} has page {page_idx}, which this PDF does not have: "
                    f"the page field counts from 0, so a PDF with {_page_word(page_count)} "
                    f"takes {'0' if page_count == 1 else f'0 to {page_count - 1}'}."
                ),
            )

        # Optional statutory exemption code, e.g. "(b)(6)" for FOIA. Bounded
        # because it is drawn inside the redaction box — a long string either
        # overflows or renders unreadably small.
        code = r.get("code")
        if code is not None:
            if not isinstance(code, str):
                raise HTTPException(
                    status_code=400,
                    detail=f"Redaction #{i + 1} code must be a string",
                )
            if len(code) > redact_service.MAX_CODE_CHARS:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Redaction #{i + 1} code must be "
                        f"{redact_service.MAX_CODE_CHARS} characters or fewer"
                    ),
                )


@router.post("/redact")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def redact_pdf(
    request: Request,
    file: UploadFile = File(...),
    redactions: str = Form(..., description=REDACTIONS_DESCRIPTION),
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
        page_count = await pdf_page_count(temp_pdf)
        if page_count == 0:
            raise HTTPException(status_code=400, detail="PDF has no pages")

        _validate_redactions(rects, page_count)

        output_path, report = await run_bounded(
            redact_service.redact_pdf, str(temp_pdf), rects, color=color
        )
        cleanup = BackgroundTask(remove_files, str(temp_pdf), output_path)
        return FileResponse(
            path=output_path,
            filename="redacted.pdf",
            media_type="application/pdf",
            background=cleanup,
            headers={
                # The withholding log: how many redactions per page and how many
                # under each exemption code. A FOIA production needs this
                # accounting; without it the released PDF is the only record.
                "X-Redaction-Report": json.dumps(report),
            },
        )
    except HTTPException:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        raise
    except Exception as e:
        to_remove = ([str(temp_pdf)] if temp_pdf is not None else []) + ([output_path] if output_path else [])
        remove_files(*to_remove)
        if (pdf_error := pdf_read_error(e)) is not None:
            raise HTTPException(status_code=pdf_error[0], detail=pdf_error[1]) from e
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
