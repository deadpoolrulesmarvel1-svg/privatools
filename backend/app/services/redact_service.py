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

import fitz  # PyMuPDF

from ..utils.colors import hex_to_rgb_float
from ..utils.filenames import temp_output

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


def redact_pdf(
    input_path: str,
    redactions: list,
    color: str = "#000000",
    code_font_size: int = 7,
) -> tuple[str, dict]:
    """Redact, optionally stamping an exemption code on each box.

    Returns `(output_path, report)`. The report is the withholding log: how many
    redactions landed on each page, and how many were made under each code.

    Codes are drawn by PyMuPDF's own redaction machinery (`add_redact_annot`'s
    `text=`), so the citation is part of the flattened result rather than an
    annotation someone can peel off.
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

    doc = fitz.open(input_path)
    try:
        page_count = len(doc)

        for pg_idx in sorted(by_page):
            if pg_idx < 0 or pg_idx >= page_count:
                continue
            page = doc[pg_idx]
            page_codes: dict[str, int] = {}
            applied = 0

            for spec in by_page[pg_idx]:
                rect = _rect_from(spec)
                code = str(spec.get("code") or "").strip()[:MAX_CODE_CHARS]

                if code:
                    page.add_redact_annot(
                        rect,
                        text=code,
                        fontsize=code_font_size,
                        fill=fill_color,
                        text_color=text_color,
                        align=fitz.TEXT_ALIGN_CENTER,
                    )
                    page_codes[code] = page_codes.get(code, 0) + 1
                    code_counts[code] = code_counts.get(code, 0) + 1
                else:
                    page.add_redact_annot(rect, fill=fill_color)
                    uncoded += 1

                applied += 1

            # Permanently removes the content under the rects.
            page.apply_redactions()

            total += applied
            page_rows.append({
                "page": pg_idx + 1,
                "count": applied,
                "codes": page_codes,
            })

        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    report = {
        "totalRedactions": total,
        "uncoded": uncoded,
        "codes": code_counts,
        "pages": page_rows,
    }
    return str(output_path), report
