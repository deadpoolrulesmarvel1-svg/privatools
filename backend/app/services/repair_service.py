import logging
import os

import fitz
import pikepdf

from ..utils.declared_pages import declared_page_count, readable_page_count, readable_pages
from ..utils.exceptions import ProcessingError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)


def repair_pdf(input_path: str) -> tuple[str, str]:
    """Repair a PDF using multiple strategies.

    Returns (output_path, status) where status is one of:
    - "repaired" — issues were found and fixed
    - "already-valid" — PDF was already valid
    - "partial" — some issues could not be fixed

    A PDF cut short keeps only some of its pages: the repaired file holds the
    pages that survive, and pages_saved() says how many of how many.
    """
    output_path = temp_output("repaired", "pdf")
    status = "already-valid"

    # Strategy 1: pikepdf repair (handles xref issues, linearization errors).
    # qpdf leaves out each page whose object was lost.
    try:
        with pikepdf.open(input_path, suppress_warnings=True) as pdf:
            pdf.save(str(output_path))
        orig_size = os.path.getsize(input_path)
        new_size = os.path.getsize(str(output_path))
        if abs(orig_size - new_size) > 100:
            status = "repaired"
        return str(output_path), status
    except (pikepdf.PdfError, OSError) as pikepdf_err:
        logger.warning("repair: pikepdf failed (%s) — trying fitz fallback", pikepdf_err)

    # Strategy 2: fitz/MuPDF recovery (handles more severe corruption). MuPDF
    # lists a page whose object was lost and shows it blank; only the pages
    # it can read are saved, so that the file has no page that is not there.
    try:
        doc = fitz.open(input_path)
        try:
            readable = readable_pages(doc)
            if not readable:
                raise ValueError("no page survived")
            if len(readable) < len(doc):
                doc.select(readable)
            doc.save(str(output_path), garbage=4, deflate=True)
        finally:
            doc.close()
        return str(output_path), "repaired"
    except (RuntimeError, ValueError, OSError, fitz.mupdf.FzErrorBase) as fitz_err:
        logger.warning("repair: fitz failed (%s) — trying byte-level recovery", fitz_err)

    # Strategy 3: pikepdf with allow_overwriting_input disabled (last-ditch).
    try:
        with pikepdf.open(
            input_path,
            suppress_warnings=True,
            allow_overwriting_input=False,
        ) as pdf:
            pdf.remove_unreferenced_resources()
            pdf.save(str(output_path))
        return str(output_path), "partial"
    except (pikepdf.PdfError, OSError) as final_err:
        logger.error("repair: all strategies failed (%s)", final_err)
        raise ProcessingError(
            "PDF is too corrupted to repair. The file may be severely damaged."
        ) from final_err


def pages_saved(input_path: str, output_path: str) -> tuple[int, int] | None:
    """(pages in the repaired file, pages the damaged one declares), or None
    when the damaged file's page tree cannot be found (utils.declared_pages).
    The pages counted are those MuPDF can read in the repaired file; the
    total is never less than them, since a lost page tree root leaves only a
    lower node's count to go by."""
    declared = declared_page_count(input_path)
    if declared is None:
        return None
    try:
        with fitz.open(output_path) as doc:
            saved = readable_page_count(doc)
    except (RuntimeError, ValueError, OSError):
        return None
    return saved, max(saved, declared)
