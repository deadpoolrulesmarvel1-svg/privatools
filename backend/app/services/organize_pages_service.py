import base64
import io

import pikepdf
from pdf2image import convert_from_path
from pdf2image.exceptions import PDFPageCountError

from ..utils.cleanup import _DAMAGED_PDF, open_pdf_document, safe_open_pdf
from ..utils.exceptions import PageRangeError, PdfCorruptError
from ..utils.filenames import temp_output
from ..utils.page_removal import WorkBudget, copy_pages, prune_to_page_tree


def generate_thumbnails(input_path: str) -> list[str]:
    """Return one base64-encoded PNG thumbnail per page.

    Poppler draws them, and it cannot count the pages of most PDFs cut short
    (pdf2image's PDFPageCountError, "Couldn't find trailer dictionary"), which
    MuPDF repairs. So MuPDF looks at the file first: a locked, unreadable or
    pageless PDF gets open_pdf_document's 400 before Poppler runs, and Poppler
    failing to count the pages of a file MuPDF had to repair is that file's
    damage. Poppler failing on a file MuPDF reads intact stays the server's.
    """
    doc = open_pdf_document(input_path)
    repaired = doc.is_repaired
    doc.close()
    try:
        images = convert_from_path(input_path, dpi=72, size=(150, None))
    except PDFPageCountError as exc:
        if repaired:
            raise PdfCorruptError(_DAMAGED_PDF) from exc
        raise
    thumbnails: list[str] = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        thumbnails.append(base64.b64encode(buf.read()).decode("utf-8"))
    return thumbnails


def reorder_pages(input_path: str, page_order: list) -> str:
    output_path = temp_output("organized", "pdf")
    with safe_open_pdf(input_path) as pdf:
        total = len(pdf.pages)
        indices = []
        for page_num in page_order:
            idx = int(page_num) - 1
            if idx < 0 or idx >= total:
                raise PageRangeError(
                    f"Page {page_num} is out of range (PDF has {total} pages)."
                )
            indices.append(idx)
        budget = WorkBudget.for_files("organize-pages", input_path)
        with pikepdf.Pdf.new() as out:
            copy_pages(out, pdf, indices, budget=budget)
            if len(set(indices)) < total:
                # Pages left out must not ride along with the links, form
                # fields and threads of the pages that stay.
                prune_to_page_tree(out, budget=budget).save(str(output_path))
            else:
                out.save(str(output_path))
    return str(output_path)
