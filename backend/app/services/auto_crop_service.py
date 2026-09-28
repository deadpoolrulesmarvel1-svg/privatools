"""Auto Crop: trim each page to its text and images, plus a margin.

Each page's visible area (its CropBox) is set to the box around the text and
image blocks PyMuPDF finds on it, plus MARGIN points, never beyond the area
that showed before. Nothing is removed from the file: the trimmed parts stay
on the page, out of view. A page with no text or images showing is left as it
was.

PyMuPDF measures those blocks on the page before /Rotate, from the visible
area's top-left corner, so the box is worked out in that frame and written
straight into the CropBox in PDF user space. The route once clamped the box
to page.rect, the page after /Rotate, and handed it to set_cropbox, which
measures from the MediaBox's top: a scan stored with /Rotate 90 or a MediaBox
not starting at 0,0 failed with "CropBox not in MediaBox" (a 500), and a page
that already had a CropBox was trimmed in the wrong place.
"""

from __future__ import annotations

import fitz  # PyMuPDF

from ..utils.cleanup import open_pdf_document
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output
from ..utils.page_space import pdf_box, visible_area

MARGIN = 20.0  # points kept around what is found

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in PDF user space (y up)


def content_crop(page: fitz.Page) -> Box | None:
    """The CropBox that keeps the page's text and images plus MARGIN, within
    what shows now; None when nothing shows."""
    vx0, vy0, vx1, vy1 = visible_area(page)
    # The frame PyMuPDF measures in: the visible area before /Rotate. Its size
    # is the visible area's, unless the page sets /UserUnit.
    width, height = page.rect.width, page.rect.height
    if page.rotation in (90, 270):
        width, height = height, width
    if width <= 0 or height <= 0:
        return None
    bounds = fitz.Rect(0, 0, width, height)
    content: fitz.Rect | None = None
    for block in page.get_text("dict")["blocks"]:
        shown = fitz.Rect(block["bbox"]) & bounds
        if shown.is_empty:
            continue  # off the page, or nothing at all: it does not show
        content = shown if content is None else content | shown
    if content is None:
        return None
    keep = fitz.Rect(content.x0 - MARGIN, content.y0 - MARGIN, content.x1 + MARGIN, content.y1 + MARGIN) & bounds
    sx, sy = (vx1 - vx0) / width, (vy1 - vy0) / height
    return (vx0 + keep.x0 * sx, vy1 - keep.y1 * sy, vx0 + keep.x1 * sx, vy1 - keep.y0 * sy)


def auto_crop(content: bytes) -> str:
    """Trim every page of the PDF in `content`; returns the output path."""
    output_path = temp_output("cropped", "pdf")
    doc = open_pdf_document(content)
    try:
        if len(doc) == 0:
            raise ValidationError("This PDF has no pages.")
        for page in doc:
            box = content_crop(page)
            if box is not None:
                doc.xref_set_key(page.xref, "CropBox", pdf_box(box))
        doc.save(str(output_path))
    finally:
        doc.close()
    return str(output_path)
