"""Table detection that leaves PyMuPDF's process-wide settings as the app keeps them."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

import fitz  # PyMuPDF

# PyMuPDF keeps small_glyph_heights in one variable for the whole process
# (a C global in its `extra` module), which every thread's text extraction
# reads, and find_tables turns it on for as long as it runs. The web process
# runs requests in threads, and PDF to Excel runs pages in threads of its own,
# so one table detection at a time holds this lock, and code whose boxes must
# be exact holds it too while it reads them (exact_glyph_boxes).
_GLYPH_SWITCH = threading.Lock()


def find_tables(page: fitz.Page, **kwargs):
    """page.find_tables(**kwargs), one call at a time in the process, with
    PyMuPDF's process-wide small_glyph_heights switch off again afterwards,
    however it ends.

    PyMuPDF 1.28's find_tables turns the switch on, then reads the page's
    rotation, and only after that enters the try block whose finally turns it
    back. A page whose rotation it cannot read, as in a damaged PDF, left the
    switch on for every later text extraction in the process: word boxes came
    out one font size tall, and on text turned 180 degrees beside the text,
    which is what Smart Redact covers. Nothing in the app turns the switch on,
    so off is where it belongs.

    Calls that overlapped in threads turned the switch off under one another:
    PDF to Excel's pages then lost the spaces between words in some cells, and
    a Smart Redact running beside a table detection searched with the switch
    on. The lock keeps them apart.
    """
    with _GLYPH_SWITCH:
        try:
            return page.find_tables(**kwargs)
        finally:
            fitz.TOOLS.set_small_glyph_heights(False)


@contextmanager
def exact_glyph_boxes() -> Iterator[None]:
    """Hold while reading PyMuPDF's word or character boxes where their size
    and place decide what happens, as Smart Redact's search does: no table
    detection can turn the shared switch on meanwhile."""
    with _GLYPH_SWITCH:
        fitz.TOOLS.set_small_glyph_heights(False)
        yield


__all__ = ["exact_glyph_boxes", "find_tables"]
