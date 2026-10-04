"""Permanent redaction, with statutory exemption codes stamped on each box.

Plain black boxes are enough for "hide this". They are not enough for a FOIA or
Privacy Act production, where every withholding has to be *justified* — the
released page carries the citation authorising it, and the producing party
keeps a log of what was withheld under which exemption.

Adobe is the only competitor that does this; DocHub, PDFescape, Foxit, Nitro,
TinyWow, LightPDF and ihatepdf.cv all stop at the black box. It costs us a
`code` field per rectangle and a summary, and it turns the tool from "hides
things" into something usable for the work redaction actually exists for.
"""

import math

import fitz  # PyMuPDF

from ..utils.cleanup import process_pdf
from ..utils.colors import hex_to_rgb_float
from ..utils.filenames import temp_output
from ..utils.page_space import drawing_unturned, settle_rotation

MAX_CODE_CHARS = 32

# A code stamped in a colour close to its box is a code nobody can read, and an
# unreadable exemption citation is the same as no citation.
_LUMINANCE_MIDPOINT = 0.55


def _readable_text_color(fill: tuple[float, float, float]) -> tuple[float, float, float]:
    """Pick black or white text for the box colour, by perceived luminance."""
    r, g, b = fill
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return (0.0, 0.0, 0.0) if luminance > _LUMINANCE_MIDPOINT else (1.0, 1.0, 1.0)


def _rect_from(spec: dict) -> fitz.Rect:
    """Accept both x0/y0/x1/y1 and x/y/width/height."""
    if "x0" in spec:
        return fitz.Rect(
            float(spec.get("x0", 0)),
            float(spec.get("y0", 0)),
            float(spec.get("x1", 10)),
            float(spec.get("y1", 10)),
        )
    x = float(spec.get("x", 0))
    y = float(spec.get("y", 0))
    return fitz.Rect(x, y, x + float(spec.get("width", 10)), y + float(spec.get("height", 10)))


def _code_boxes_upright(page: fitz.Page, boxes: list[tuple[fitz.Rect, str]], fontsize: float) -> list[tuple[fitz.Rect, str]]:
    """Where to print each code, in the page's stored coordinates, so that it
    sits in its box as PyMuPDF's apply_redactions would put it on an unturned
    page (a band centred on the box's height), measured on the box as shown.
    Call it with the page at its own /Rotate; `boxes` are in stored coordinates."""
    placed = []
    for rect, code in boxes:
        shown = rect * page.rotation_matrix
        if shown.width > 1e-5:
            needed = math.ceil(fitz.get_text_length(code, "helv", fontsize) / shown.width) * fontsize * 1.2
            if needed < shown.height:
                shown.y0 = (shown.y0 + shown.y1 - needed) * 0.5
        placed.append((shown * page.derotation_matrix, code))
    return placed


def _print_codes(page: fitz.Page, rotation: int, boxes: list[tuple[fitz.Rect, str]], fontsize: float, color: tuple) -> None:
    """Print each code in its band, turned with the page so it reads upright
    as shown, shrinking the font until it fits as PyMuPDF does. `page` is
    unturned for the moment (drawing_unturned)."""
    shape = page.new_shape()
    for band, code in boxes:
        size, rc = fontsize, -1.0
        while rc < 0 and size >= 4:
            rc = shape.insert_textbox(band, code, fontname="helv", fontsize=size, color=color,
                                      align=fitz.TEXT_ALIGN_CENTER, rotate=rotation)
            size -= 0.5
    shape.commit()


def redact_pdf(
    input_path: str,
    redactions: list,
    color: str = "#000000",
    code_font_size: int = 7,
) -> tuple[str, dict]:
    """Redact, optionally stamping an exemption code on each box.

    Each redaction's `page` is an index counted from 0; the report names pages
    counted from 1, the way a person cites them. Boxes are in points from the
    top-left corner of the page's visible area (its CropBox), before any
    /Rotate the page has.

    Returns `(output_path, report)`. The report is the withholding log: how many
    redactions landed on each page, and how many were made under each code.

    Codes are drawn by PyMuPDF's own redaction machinery (`add_redact_annot`'s
    `text=`), so the citation is part of the flattened result rather than an
    annotation someone can peel off. On a page turned by /Rotate they are drawn
    into the page the same way right after the redaction, upright as the page
    is shown.
    """
    output_path = temp_output("redacted", "pdf")
    fill_color = hex_to_rgb_float(color)
    text_color = _readable_text_color(fill_color)

    by_page: dict[int, list] = {}
    for r in redactions:
        by_page.setdefault(int(r.get("page", 0)), []).append(r)

    code_counts: dict[str, int] = {}
    page_rows: list[dict] = []
    total = 0
    uncoded = 0

    def redact(doc: fitz.Document) -> None:
        nonlocal total, uncoded
        page_count = len(doc)

        for pg_idx in sorted(by_page):
            if pg_idx < 0 or pg_idx >= page_count:
                continue
            page = doc[pg_idx]
            page_codes: dict[str, int] = {}
            applied = 0
            # On a turned page, codes are printed afterwards, upright as the
            # page is shown; PyMuPDF prints them along the page as stored, which
            # showed them sideways or upside down, split over several lines.
            # /Rotate is read the way the preview read it (utils/page_space.py).
            turned = settle_rotation(page) != 0
            specs = [(_rect_from(spec), str(spec.get("code") or "").strip()[:MAX_CODE_CHARS]) for spec in by_page[pg_idx]]
            bands = _code_boxes_upright(page, [(rect, code) for rect, code in specs if code], code_font_size) if turned else []

            # The boxes are in the page's stored coordinates. On a turned page
            # whose visible area does not start at 0,0, PyMuPDF painted the
            # black fill away from the box it emptied unless the page is
            # unturned while it works (utils/page_space.py).
            with drawing_unturned(page) as rotation:
                for rect, code in specs:
                    if code and not turned:
                        page.add_redact_annot(
                            rect,
                            text=code,
                            fontsize=code_font_size,
                            fill=fill_color,
                            text_color=text_color,
                            align=fitz.TEXT_ALIGN_CENTER,
                        )
                    else:
                        page.add_redact_annot(rect, fill=fill_color)
                    if code:
                        page_codes[code] = page_codes.get(code, 0) + 1
                        code_counts[code] = code_counts.get(code, 0) + 1
                    else:
                        uncoded += 1

                    applied += 1

                # Permanently removes the content under the rects.
                page.apply_redactions()
                if bands:
                    _print_codes(page, rotation, bands, code_font_size, text_color)

            total += applied
            page_rows.append({
                "page": pg_idx + 1,
                "count": applied,
                "codes": page_codes,
            })

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, redact, rebuild=False)

    report = {
        "totalRedactions": total,
        "uncoded": uncoded,
        "codes": code_counts,
        "pages": page_rows,
    }
    return str(output_path), report
