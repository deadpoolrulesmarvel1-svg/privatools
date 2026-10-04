"""Smart Redact — search & redact PDF by text strings.

Frontend extracts text and (via local NER + regex) suggests strings the user
wants to redact. The backend then locates each string in the actual PDF and
applies a real PyMuPDF redaction annotation, which permanently removes the
content beneath the rectangle (not just a black overlay you can copy through).
"""

from __future__ import annotations

from typing import Iterable, Tuple

import fitz  # PyMuPDF

from ..utils.cleanup import open_pdf_document
from ..utils.colors import hex_to_rgb_float
from ..utils.filenames import temp_output
from ..utils.page_space import drawing_unturned


def smart_redact(
    input_path: str,
    needles: Iterable[str],
    color: str = "#000000",
    case_sensitive: bool = False,
) -> Tuple[str, int]:
    """Apply real redaction annotations for every match of every needle."""
    output_path = temp_output("smart_redacted", "pdf")
    fill = hex_to_rgb_float(color)
    flags = 0 if case_sensitive else fitz.TEXT_DEHYPHENATE

    # Dedupe + drop empties so we don't redact giant common strings by accident.
    needle_set = sorted({n.strip() for n in needles if n and len(n.strip()) >= 2}, key=len, reverse=True)
    if not needle_set:
        raise ValueError("No usable strings to redact (each must be ≥ 2 characters).")

    total_hits = 0
    # A PDF that needs a password, cannot be read or has no pages is refused
    # with a 400 in the site's own words.
    doc = open_pdf_document(input_path)
    try:
        for page in doc:
            # Matches come back in the page's stored coordinates. On a turned
            # page whose visible area does not start at 0,0, PyMuPDF painted the
            # black fill away from the text it removed unless the page is
            # unturned while it works (utils/page_space.py).
            with drawing_unturned(page):
                for needle in needle_set:
                    try:
                        quads = page.search_for(needle, quads=True, flags=flags)
                    except TypeError:
                        quads = page.search_for(needle, flags=flags)
                    if not quads:
                        continue
                    for q in quads:
                        rect = q.rect if hasattr(q, "rect") else q
                        page.add_redact_annot(rect, fill=fill)
                        total_hits += 1
                page.apply_redactions()
        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    return str(output_path), total_hits
