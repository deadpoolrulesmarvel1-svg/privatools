"""Split each PDF page in half — useful for scanned booklets / two-up scans.

Two modes:
  - "vertical"   (default): bisect each page down the middle, producing left
                  and right halves. Each input page becomes two output pages
                  (left first, then right).
  - "horizontal": bisect each page across the middle, producing top and
                  bottom halves. Each input page becomes two output pages
                  (top first, then bottom).

Implementation uses PyMuPDF (fitz) because pikepdf's page-copy API requires
appending whole pages, but we need two independently-cropped copies of each
source page — fitz lets us insert + then mutate the MediaBox per page.
"""

from __future__ import annotations

import uuid

import fitz  # PyMuPDF

from ..utils.cleanup import ensure_temp_dir, get_temp_path

VALID_DIRECTIONS = {"vertical", "horizontal"}


def split_in_half(input_path: str, direction: str = "vertical") -> str:
    if direction not in VALID_DIRECTIONS:
        raise ValueError(
            f"direction must be one of: {', '.join(sorted(VALID_DIRECTIONS))}"
        )

    ensure_temp_dir()
    output_path = get_temp_path(f"split_half_{uuid.uuid4().hex}.pdf")

    src = fitz.open(input_path)
    out = fitz.open()
    try:
        for page_idx in range(len(src)):
            mediabox = src[page_idx].mediabox  # fitz.Rect, top-left origin
            x0, y0, x1, y1 = mediabox.x0, mediabox.y0, mediabox.x1, mediabox.y1
            width = x1 - x0
            height = y1 - y0

            if direction == "vertical":
                mid = x0 + width / 2.0
                # In fitz coordinates (top-left origin) the "first" half is left,
                # the "second" is right.
                first  = fitz.Rect(x0, y0, mid, y1)
                second = fitz.Rect(mid, y0, x1, y1)
            else:  # horizontal
                mid = y0 + height / 2.0
                # Top half first (smaller y in fitz top-left coords).
                first  = fitz.Rect(x0, y0, x1, mid)
                second = fitz.Rect(x0, mid, x1, y1)

            for box in (first, second):
                # insert_pdf copies the whole source page; then we shrink the
                # MediaBox + CropBox so the viewer only renders the half we want.
                # Order matters: shrink CropBox first (it's allowed to fit in the
                # full MediaBox), THEN shrink MediaBox to match. Doing it the
                # other way around tripped fitz's "CropBox not in MediaBox"
                # validator on horizontal splits where the new MediaBox has a
                # non-zero y origin.
                start = len(out)
                out.insert_pdf(src, from_page=page_idx, to_page=page_idx)
                new_page = out[start]
                new_page.set_cropbox(box)
                new_page.set_mediabox(box)

        out.save(str(output_path), garbage=4, deflate=True)
    finally:
        out.close()
        src.close()

    return str(output_path)
