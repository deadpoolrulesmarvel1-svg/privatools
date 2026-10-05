import logging
import os

import fitz
import pikepdf

from ..utils.declared_pages import (
    MIXED,
    declared_page_count,
    misread,
    mupdf_reading,
    qpdf_reading,
    readable_page_count,
    readable_pages,
)
from ..utils.exceptions import PdfCorruptError, ProcessingError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)

# What Repair PDF says, with a 400, to a file that both libraries read as
# another document: damage made each repair take the objects of a PDF attached
# inside it, or of an older revision, for the file's own
# (utils.declared_pages.misread), and saving either reading would hand the
# visitor pages that are not theirs. friendlyError (frontend/src/lib/utils.ts)
# keeps these words.
CANNOT_TELL_MESSAGE = (
    "This PDF is damaged: its structure is broken in a way that mixes it up with a file attached inside it "
    "or an earlier version of itself, and Repair PDF can't tell which pages are its own. Download it again."
)


def _mixed_up(input_path: str, reading) -> bool:
    """Whether a library's reading of the file at `input_path` took another
    document for it (utils.declared_pages.misread): never saved."""
    found = misread(input_path, reading)
    return found is not None and found[0] == MIXED


def repair_pdf(input_path: str) -> tuple[str, str]:
    """Repair a PDF using multiple strategies.

    Returns (output_path, status) where status is one of:
    - "repaired" — issues were found and fixed
    - "already-valid" — PDF was already valid
    - "partial" — some issues could not be fixed

    A PDF cut short keeps only some of its pages: the repaired file holds the
    pages that survive, and pages_saved() says how many of how many.

    A library's repair can also read the file as another document, taking the
    objects of a PDF attached inside it for the file's own: such a reading is
    never saved. qpdf's rebuild does it where MuPDF's often does not, so the
    next strategy is tried; when MuPDF's reading is mixed up too, the file is
    refused (PdfCorruptError, CANNOT_TELL_MESSAGE).
    """
    output_path = temp_output("repaired", "pdf")
    status = "already-valid"
    mixed_up = False

    # Strategy 1: pikepdf repair (handles xref issues, linearization errors).
    # qpdf leaves out each page whose object was lost. It warns when it
    # rebuilds the file, the only time it can take another document's objects.
    try:
        with pikepdf.open(input_path, suppress_warnings=True) as pdf:
            mixed_up = bool(pdf.get_warnings()) and _mixed_up(
                input_path, lambda declared: qpdf_reading(pdf, declared))
            if not mixed_up:
                pdf.save(str(output_path))
        if not mixed_up:
            orig_size = os.path.getsize(input_path)
            new_size = os.path.getsize(str(output_path))
            if abs(orig_size - new_size) > 100:
                status = "repaired"
            return str(output_path), status
        logger.warning("repair: qpdf read another document's objects as the file's — trying fitz")
    except (pikepdf.PdfError, OSError) as pikepdf_err:
        logger.warning("repair: pikepdf failed (%s) — trying fitz fallback", pikepdf_err)

    # Strategy 2: fitz/MuPDF recovery (handles more severe corruption). MuPDF
    # lists a page whose object was lost and shows it blank; only the pages
    # it can read are saved, so that the file has no page that is not there.
    try:
        doc = fitz.open(input_path)
        try:
            if doc.is_repaired and _mixed_up(input_path, lambda declared: mupdf_reading(doc, declared)):
                raise PdfCorruptError(CANNOT_TELL_MESSAGE)
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

    if mixed_up:
        # Strategy 3 is qpdf's reading again, the attachment's objects and all.
        raise PdfCorruptError(CANNOT_TELL_MESSAGE)

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
    when the damaged file's page tree cannot be found (utils.declared_pages),
    or either count cannot be read: Repair then says nothing of pages. The
    pages counted are those MuPDF can read in the repaired file; the total is
    never less than them, since a lost page tree root leaves only a lower
    node's count to go by."""
    declared = declared_page_count(input_path)
    if declared is None:
        return None
    try:
        with fitz.open(output_path) as doc:
            saved = readable_page_count(doc)
    except (RuntimeError, ValueError, OSError, fitz.mupdf.FzErrorBase):
        # MuPDF's own errors are none of the others: an output it cannot
        # count reached the route's catch-all, which called the upload
        # corrupt (a 400) though its repair had been saved.
        return None
    if saved is None:
        return None
    return saved, max(saved, declared)
