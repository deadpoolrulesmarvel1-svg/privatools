"""Split each PDF page in half — useful for scanned booklets / two-up scans.

Each page is cut into two halves of the page as it is shown, and each half
becomes a page of its own:
  - "vertical"   (default): the left half, then the right half.
  - "horizontal": the top half, then the bottom half.

"As shown" means the page's visible area (its CropBox, within its MediaBox),
turned by its /Rotate (read the way pdf.js reads it, see utils/page_space).
A book spread a scanner stored upright but turned with /Rotate 90 is still
cut into its left and right pages, and a page cropped first is cut down the
middle of what is left.

Each half is a copy of the whole page whose MediaBox and CropBox are that
half, written in the page's own coordinates. Nothing is resampled: the halves
show the page's content exactly as it was. (The service once took the
MediaBox as stored and set the halves through PyMuPDF's set_cropbox, which
measures its rectangle from the top of the MediaBox: on a page whose MediaBox
does not start at y 0 that failed with "CropBox not in MediaBox".)
"""

from __future__ import annotations

import fitz  # PyMuPDF

from ..utils.cleanup import open_pdf_document
from ..utils.exceptions import ValidationError
from ..utils.filenames import temp_output
from ..utils.page_space import settle_rotation

VALID_DIRECTIONS = {"vertical", "horizontal"}

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in PDF user space (y up)


def visible_area(page: fitz.Page) -> Box:
    """The page's visible area in PDF user space: its CropBox within its
    MediaBox, or the MediaBox when there is no CropBox or the two do not
    overlap. PyMuPDF gives the MediaBox as written (normalised) and the
    CropBox measured down from the MediaBox's top edge."""
    media = page.mediabox
    crop = page.cropbox
    x0, y0 = max(media.x0, crop.x0), max(media.y0, media.y1 - crop.y1)
    x1, y1 = min(media.x1, crop.x1), min(media.y1, media.y1 - crop.y0)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return (media.x0, media.y0, media.x1, media.y1)
    return (x0, y0, x1, y1)


def halves(area: Box, rotation: int, direction: str) -> tuple[Box, Box]:
    """The two halves of `area`, in the order a reader meets them on the page
    as shown with `rotation` (0, 90, 180 or 270, clockwise): left then right
    for "vertical", top then bottom for "horizontal".

    /Rotate 90 shows the stored page's left edge (least x) at the top and its
    bottom edge (least y) on the left; 180 turns it upside down; 270 shows
    its right edge at the top and its top edge on the left.
    """
    x0, y0, x1, y1 = area
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    low_x, high_x = (x0, y0, xm, y1), (xm, y0, x1, y1)
    low_y, high_y = (x0, y0, x1, ym), (x0, ym, x1, y1)
    if direction == "vertical":
        return {0: (low_x, high_x), 90: (low_y, high_y), 180: (high_x, low_x), 270: (high_y, low_y)}[rotation]
    return {0: (high_y, low_y), 90: (low_x, high_x), 180: (low_y, high_y), 270: (high_x, low_x)}[rotation]


def _number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _set_boxes(doc: fitz.Document, xref: int, box: Box) -> None:
    """Make `box` the page's MediaBox and CropBox, and its Trim, Bleed and
    Art boxes where the page has them: each half is a finished page."""
    array = "[" + " ".join(_number(v) for v in box) + "]"
    doc.xref_set_key(xref, "MediaBox", array)
    doc.xref_set_key(xref, "CropBox", array)
    for key in ("TrimBox", "BleedBox", "ArtBox"):
        if doc.xref_get_key(xref, key)[0] != "null":
            doc.xref_set_key(xref, key, array)


def split_in_half(input_path: str, direction: str = "vertical") -> str:
    if direction not in VALID_DIRECTIONS:
        raise ValidationError(
            f"direction must be one of: {', '.join(sorted(VALID_DIRECTIONS))}"
        )

    output_path = temp_output("split_half", "pdf")

    src = open_pdf_document(input_path)
    out = fitz.open()
    try:
        for page_idx in range(len(src)):
            page = src[page_idx]
            # Written the way pdf.js reads it, on the page itself, so the copies
            # carry a /Rotate every viewer shows the same way.
            rotation = settle_rotation(page)
            area = visible_area(page)
            for half in halves(area, rotation, direction):
                # insert_pdf copies the whole page, with its inherited MediaBox,
                # CropBox, /Rotate and resources written onto the copy.
                start = len(out)
                out.insert_pdf(src, from_page=page_idx, to_page=page_idx)
                _set_boxes(out, out[start].xref, half)

        out.save(str(output_path), garbage=4, deflate=True)
    finally:
        out.close()
        src.close()

    return str(output_path)
