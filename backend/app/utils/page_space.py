"""Where the drawing tools put things on a page.

The PyMuPDF tools (Redact, White-Out, Annotate, Add Shapes, Form Creator and
eSign) take boxes in points from the top-left corner of the page's visible
area (its CropBox), before any /Rotate setting the page has is applied. The
website's page converts what the visitor draws on its preview into that
(frontend/src/components/tool-ui/pdf/page-coordinates.ts).

What went wrong on turned pages even with the right numbers:

* The libraries read /Rotate differently from the preview. pdf.js, which
  draws the preview, shows /Rotate -90 as 270, 450 as 90, and a value that is
  not a multiple of 90 (80, say) as 0. MuPDF rounds 80 to 90, and pikepdf's
  placement ignores anything but 90, 180 and 270 as written, so boxes landed
  in a frame the visitor never saw. `settle_rotation` writes /Rotate the way
  pdf.js reads it, on the page itself, before anything is placed; the output
  then shows the same way in every viewer.
* PyMuPDF's own drawing (Shape, insert_image, insert_text, and the fill that
  apply_redactions paints) forgets where the visible area starts once the page
  has a /Rotate: Page.transformation_matrix is (1, 0, 0, -1, 0, height) for any
  turned page. On a turned page whose CropBox or MediaBox does not start at
  0,0, a white-out or a redaction's black box landed that far away. With
  /Rotate 0, PyMuPDF uses MuPDF's own matrix, which is right, so the tools draw
  with the page unturned for the moment (PyMuPDF does the same itself when it
  adds text markup, in Page._add_text_marker).
* Things with a direction (a signature, a highlight) were laid along the page
  as stored, so on a page turned a quarter they showed sideways, or ran 57
  points past the box the visitor drew. Signatures now follow the page as
  shown; text markup follows the text under it (`markup_quad`).

Sign PDF and Edit PDF draw with reportlab on a page of their own and lay it
over the PDF page with pikepdf, which keeps it upright as the page is shown.
They take boxes in points from the bottom-left corner of the page as shown.
Their overlay was the size of the MediaBox as stored and was fitted into the
TrimBox, so on a page turned a quarter, or cut by a CropBox, everything
shrank and moved. `shown_area` gives the overlay the size of the page as shown
and the place it is shown in.

backend/tests/test_page_contract.py checks every tool on turned and cropped
pages, including /Rotate written as -90, 450 or 80 and /Rotate inherited from
the page tree.
"""

from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal
from typing import Iterator

import fitz  # PyMuPDF
import pikepdf


def rotation_as_shown(raw: object) -> int:
    """A /Rotate value the way pdf.js reads it (Page.rotate in its worker):
    0 unless it is a multiple of 90, then turned into 0, 90, 180 or 270."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float, Decimal)):
        return 0
    try:
        if raw % 90 != 0:
            return 0
        return int(raw) % 360
    except (ArithmeticError, ValueError):  # a real too large to divide: pdf.js reads NaN, so 0
        return 0


def _number(kind: str, text: str) -> object:
    """A PDF number from PyMuPDF's xref_get_key, which names a direct integer
    'int' and a direct real 'float' (90.0 as '90'); None for anything else."""
    try:
        if kind == "int":
            return int(text)
        if kind in ("float", "real"):
            return Decimal(text)
    except (ArithmeticError, ValueError):
        return None
    return None


def _raw_rotate_fitz(page: fitz.Page) -> object:
    """The nearest /Rotate on the page or up its page tree, as written."""
    doc = page.parent
    xref, seen = page.xref, set()
    while xref and xref not in seen:
        seen.add(xref)
        kind, value = doc.xref_get_key(xref, "Rotate")
        if kind == "xref":  # an indirect object: a number, or anything else (read as 0)
            text = doc.xref_object(int(value.split()[0]), compressed=True).strip()
            return _number("int" if text.lstrip("+-").isdigit() else "float", text)
        if kind != "null":
            return _number(kind, value)
        kind, value = doc.xref_get_key(xref, "Parent")
        xref = int(value.split()[0]) if kind == "xref" else 0
    return None


def _raw_rotate_pikepdf(page: pikepdf.Page) -> object:
    """The nearest /Rotate on the page or up its page tree, as written."""
    node, seen = page.obj, set()
    while node is not None and node.objgen not in seen:
        if node.objgen != (0, 0):
            seen.add(node.objgen)
        value = node.get(pikepdf.Name.Rotate)
        if value is not None:
            return value if isinstance(value, (int, Decimal)) else None
        node = node.get(pikepdf.Name.Parent)
    return None


def _raw_rotate(page: fitz.Page | pikepdf.Page) -> object:
    return _raw_rotate_fitz(page) if isinstance(page, fitz.Page) else _raw_rotate_pikepdf(page)


def settle_rotation(page: fitz.Page | pikepdf.Page) -> int:
    """Write the page's /Rotate the way pdf.js reads it, when the file says it
    another way; return it (0, 90, 180 or 270).

    Every tool that places something on a page calls this first. A page whose
    /Rotate is absent or already written that way is left byte for byte as it
    was. Otherwise the page gets its own /Rotate: -90 becomes 270, 450 becomes
    90, 80 becomes 0. That is how the preview showed it, and after this every
    viewer shows it that way too.
    """
    raw = _raw_rotate(page)
    rotation = rotation_as_shown(raw)
    if (raw is None and rotation == 0) or (type(raw) is int and raw == rotation):
        return rotation
    if isinstance(page, fitz.Page):
        page.set_rotation(rotation)
    else:
        page.obj[pikepdf.Name.Rotate] = rotation
    return rotation


@contextmanager
def drawing_unturned(page: fitz.Page) -> Iterator[int]:
    """Draw on `page` as stored, whatever its /Rotate; yields the rotation.

    Everything drawn inside uses the page's stored coordinates (the routes'
    convention). The page's /Rotate, settled first, is restored afterwards, so
    the page shows exactly as the preview showed it.
    """
    rotation = settle_rotation(page)
    if rotation:
        page.set_rotation(0)
    try:
        yield rotation
    finally:
        if rotation:
            page.set_rotation(rotation)


def upright_quad(page: fitz.Page, rect: fitz.Rect) -> fitz.Quad:
    """`rect` (stored coordinates) as a quad whose top edge is the top of the
    box as the page is shown, so text markup runs across the page as shown.
    Call it with the page at its own, settled /Rotate."""
    shown = fitz.Rect(rect) * page.rotation_matrix
    return shown.quad * page.derotation_matrix


# A quad (ul, ur, ll, lr) running along each direction text can take on the
# stored page, with y pointing down: the top edge is on the text's upper side.
_QUAD_ALONG = {
    (1, 0): lambda r: fitz.Quad(r.tl, r.tr, r.bl, r.br),
    (-1, 0): lambda r: fitz.Quad(r.br, r.bl, r.tr, r.tl),
    (0, 1): lambda r: fitz.Quad(r.tr, r.br, r.tl, r.bl),
    (0, -1): lambda r: fitz.Quad(r.bl, r.tl, r.br, r.tr),
}


def _text_direction(page: fitz.Page, rect: fitz.Rect) -> tuple[int, int] | None:
    """Which way most of the text under `rect` runs on the stored page, to the
    nearest quarter turn; None where there is no text."""
    weights: dict[tuple[int, int], int] = {}
    for block in page.get_text("dict", clip=rect)["blocks"]:
        for line in block.get("lines", []):
            dx, dy = line["dir"]
            axis = ((1 if dx > 0 else -1), 0) if abs(dx) >= abs(dy) else (0, (1 if dy > 0 else -1))
            count = sum(len(span["text"].strip()) for span in line["spans"])
            if count:
                weights[axis] = weights.get(axis, 0) + count
    return max(weights, key=weights.get) if weights else None


def markup_quad(page: fitz.Page, rect: fitz.Rect) -> fitz.Quad:
    """`rect` (stored coordinates) as a quad for a highlight, underline or
    strikethrough: along the text under the box, the way that text reads, so
    an underline runs under it and a highlight ends where the box does. Where
    there is no text, across the page as shown. Call it with the page at its
    own, settled /Rotate."""
    direction = _text_direction(page, rect)
    if direction is None:
        return upright_quad(page, rect)
    return _QUAD_ALONG[direction](fitz.Rect(rect))


def visible_area(page: fitz.Page) -> tuple[float, float, float, float]:
    """The page's visible area in PDF user space (x0, y0, x1, y1, y up): its
    CropBox within its MediaBox, or the MediaBox when there is no CropBox or
    the two do not overlap. The PyMuPDF counterpart of shown_area's area.

    PyMuPDF gives the MediaBox as written (normalised) and the CropBox
    measured down from the MediaBox's top edge; its text and image positions
    are measured from this area's top-left corner, on the page before /Rotate.
    """
    media = page.mediabox
    crop = page.cropbox
    x0, y0 = max(media.x0, crop.x0), max(media.y0, media.y1 - crop.y1)
    x1, y1 = min(media.x1, crop.x1), min(media.y1, media.y1 - crop.y0)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return (media.x0, media.y0, media.x1, media.y1)
    return (x0, y0, x1, y1)


def pdf_box(box: tuple[float, float, float, float]) -> str:
    """A box as a PDF array for PyMuPDF's xref_set_key, e.g. "[0 40.5 612 792]":
    no exponent, at most four decimals."""
    def number(value: float) -> str:
        text = f"{value:.4f}".rstrip("0").rstrip(".")
        return "0" if text in ("", "-0") else text

    return "[" + " ".join(number(v) for v in box) + "]"


def shown_area(page: pikepdf.Page) -> tuple[pikepdf.Rectangle, float, float]:
    """Where and how big `page` is shown: its visible area (CropBox within
    MediaBox, in PDF units) and that area's width and height as shown, after
    /Rotate (as pdf.js reads it) and /UserUnit.

    An overlay page of that size laid on that area with `add_overlay(rect=)`
    maps 1:1 onto the page as shown, because pikepdf turns and scales it back
    by the page's /Rotate and /UserUnit. pikepdf turns it only for /Rotate
    written as 90, 180 or 270, so call settle_rotation on the page first.
    """
    media = pikepdf.Rectangle(page.mediabox)
    crop = pikepdf.Rectangle(page.cropbox)
    area = pikepdf.Rectangle(
        max(media.llx, crop.llx), max(media.lly, crop.lly),
        min(media.urx, crop.urx), min(media.ury, crop.ury),
    )
    if area.width <= 0 or area.height <= 0:
        area = media
    unit = float(page.obj.get(pikepdf.Name.UserUnit, 1) or 1)
    width, height = area.width * unit, area.height * unit
    if rotation_as_shown(_raw_rotate(page)) in (90, 270):
        width, height = height, width
    return area, width, height
