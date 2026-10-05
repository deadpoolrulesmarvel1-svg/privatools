import asyncio
import io
import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..utils.exceptions import PdfCorruptError, ToolError
from ..utils.cleanup import (
    end_is_missing,
    ensure_temp_dir,
    get_temp_path,
    remove_files,
    safe_open_pdf,
    validate_pdf_content,
)
from ..utils.page_removal import WorkBudget, remove_pages
from ..utils.route_helpers import safe_stem
from ..utils.render import safe_get_pixmap
from ..utils.pdf_errors import pdf_read_error

router = APIRouter()
logger = logging.getLogger(__name__)

# What the tool says, with a 400, to a PDF cut short in which it found blank
# pages: a page can look blank because its content was lost with the rest of
# the file. The way out is the whole file again. Repair PDF keeps such a page
# as it is, blank, so sending the visitor there (as the words for a damaged
# PDF do) ended with the page removed after all. friendlyError
# (frontend/src/lib/utils.ts) keeps these words.
CUT_SHORT_MESSAGE = (
    "Download this PDF again: it was cut short, most likely by an interrupted download. "
    "Pages that lost their content look blank, so no page was removed; "
    "Repair PDF can't bring that content back."
)


def _process_blank_pages(data: bytes, sensitivity: int, out_path: str) -> str:
    """Detect and remove blank pages using fast pixel sampling."""
    import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    threshold = (100 - sensitivity) / 100.0
    # Pages are recorded by object number, not position: see below.
    blank_objects: set[int] = set()
    content_objects: set[int] = set()

    for i in range(len(doc)):
        try:
            page = doc[i]
        except (IndexError, RuntimeError):
            # MuPDF counted a page it cannot load (a /Count larger than the
            # tree). Not judged, so it is not removed.
            continue

        # Fast path: if page has text content, keep it immediately
        if page.get_text("text").strip():
            content_objects.add(page.xref)
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
            content_objects.add(page.xref)
        else:
            blank_objects.add(page.xref)

    repaired = doc.is_repaired
    doc.close()

    # Removed with pikepdf rather than by copying the kept pages into a new
    # PyMuPDF document: a form field with a widget on a blank page pulled that
    # whole page, content and images, back into the copy.
    #
    # MuPDF and qpdf can read a damaged page tree differently: MuPDF trusts
    # /Count and takes a junk or dangling /Kids entry for a page, qpdf skips
    # it. Counting positions across the two then removes the wrong pages, so
    # a page goes only if MuPDF judged that very object blank. Any page qpdf
    # lists that MuPDF did not judge, or judged to have content, stays.
    with safe_open_pdf(io.BytesIO(data)) as pdf:
        pages = [page.obj for page in pdf.pages]
        blank = [
            i for i, page in enumerate(pages)
            if page.objgen[0] in blank_objects and page.objgen[0] not in content_objects
        ]
        if len(blank) == len(pages):
            blank = []  # every page looks blank: keep them all
        if blank and repaired and end_is_missing(data):
            # A PDF cut short: a page can come out blank because its content
            # was lost with the rest of the file, and removing it would answer
            # with fewer pages than the visitor sent, and say nothing. Blank
            # pages of a file that only needed its cross-reference table
            # rebuilt go as before.
            raise PdfCorruptError(CUT_SHORT_MESSAGE)
        if blank:
            budget = WorkBudget("remove-blank-pages", len(data))
            remove_pages(pdf, blank, budget=budget).save(out_path)
        else:
            pdf.save(out_path)  # nothing removed: nothing to prune or check
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
    except (HTTPException, ToolError):
        if out_path:
            remove_files(out_path)
        raise
    except Exception as exc:
        if out_path:
            remove_files(out_path)
        if (pdf_error := pdf_read_error(exc)) is not None:
            raise HTTPException(status_code=pdf_error[0], detail=pdf_error[1]) from exc
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
