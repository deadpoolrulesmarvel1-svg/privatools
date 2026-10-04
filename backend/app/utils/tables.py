"""Table detection that leaves PyMuPDF's process-wide settings as the app keeps them."""

from __future__ import annotations

import fitz  # PyMuPDF


def find_tables(page: fitz.Page, **kwargs):
    """page.find_tables(**kwargs), with PyMuPDF's process-wide
    small_glyph_heights switch off again afterwards, however it ends.

    PyMuPDF 1.28's find_tables turns the switch on, then reads the page's
    rotation, and only after that enters the try block whose finally turns it
    back. A page whose rotation it cannot read, as in a damaged PDF, left the
    switch on for every later text extraction in the process: word boxes came
    out one font size tall, and on text turned 180 degrees beside the text,
    which is what Redact covers. Nothing in the app turns the switch on, so off
    is where it belongs. When calls overlap in threads (PDF to Excel runs pages
    in parallel), the first to end turns it off under the others, as PyMuPDF's
    own restore already could; whichever ends last leaves it off.
    """
    try:
        return page.find_tables(**kwargs)
    finally:
        fitz.TOOLS.set_small_glyph_heights(False)


__all__ = ["find_tables"]
