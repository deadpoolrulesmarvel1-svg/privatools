"""Hidden Text Checker: find text a reader can't see but a machine can read.

Read-only: the upload is checked in a bounded worker process and deleted when
the report is returned. Nothing is written back to the file and no file is
produced, so the endpoint answers with JSON (the report the service describes).
"""

import logging
import uuid

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter
from ..services import hidden_text_service
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files, validate_pdf_content
from ..utils.concurrency import run_bounded
from ..utils.exceptions import ToolError
from ..utils.route_helpers import stream_upload_to_disk

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/hidden-text-checker")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def hidden_text_checker(request: Request, file: UploadFile = File(...)):
    """Find hidden text in a PDF.

    Reports text a reader cannot see but a text extractor still reads:
    invisible text (render mode 3 or 7, or opacity 0), text in the colour of
    its background, text too small to read, text outside the page or clipped
    away, text in layers that are switched off, text under shapes or images
    drawn over it (a failed redaction), text in hidden comments or form
    fields, and redaction marks never applied. Invisible text over a page
    image, as OCR software adds, is listed apart. Boxes are fractions of the
    page as shown. The limits are in hidden_text_service (pages, time).
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a PDF")

    ensure_temp_dir()
    path = get_temp_path(f"hidden_text_{uuid.uuid4().hex}.pdf")
    try:
        await stream_upload_to_disk(file, path, label="PDF", validate=validate_pdf_content)
        # A wait for the bounded worker process, which is stopped after
        # time_limit(size) seconds; the heavy pool keeps the waits bounded too.
        report = await run_bounded(hidden_text_service.check_hidden_text, str(path))
    except HTTPException:
        raise
    except ValueError as exc:
        # Password-protected, unreadable, or no pages.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ToolError:
        # Too many pages or too much memory (413), too slow (504) or failed
        # (500): the global handler gives each its status and message.
        raise
    except Exception as exc:
        logger.exception("Hidden text checker error")
        raise HTTPException(status_code=500, detail="Failed to check the PDF for hidden text") from exc
    finally:
        remove_files(str(path))
    # The report quotes the document's hidden text: never store it anywhere.
    return JSONResponse(report, headers={"Cache-Control": "no-store"})
