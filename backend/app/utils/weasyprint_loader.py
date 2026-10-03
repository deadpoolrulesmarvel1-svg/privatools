"""Load WeasyPrint without changing how Pillow treats a cut-off picture.

WeasyPrint's images module sets ``PIL.ImageFile.LOAD_TRUNCATED_IMAGES = True``
for the whole process when it is first imported, so that it can draw a
picture whose data stops early. Pillow then fills such a picture in with
blank pixels instead of raising. After the first HTML or URL to PDF request
in a worker, every image tool in that worker answered a cut-off upload with a
200 and a partly blank picture (a HEIC came back wholly black), where a fresh
worker answered 400 (utils.images.image_read_error).

Pillow's default, which refuses a cut-off picture, holds in every worker:
utils/__init__.py sets it at start-up, and every import of WeasyPrint goes
through load_weasyprint(), which sets it back as soon as the import returns.
backend/tests/test_cut_off_image_policy.py checks that nothing in the backend
imports WeasyPrint another way.

WeasyPrint decodes a PNG while it writes the PDF, outside the code that leaves
out a picture it cannot read, so with the default a cut-off PNG would fail the
whole page; html_to_pdf_service's URL fetcher leaves one out instead.

One gap remains: while the first import of WeasyPrint in a process runs (well
under a second), a picture decoded on another thread could still be filled in.
"""

from __future__ import annotations

from PIL import ImageFile


def load_weasyprint():
    """Import and return the weasyprint package, keeping Pillow's refusal of
    cut-off pictures. Raises what the import raises (ImportError, or OSError
    when the native libraries are missing)."""
    try:
        import weasyprint
    finally:
        ImageFile.LOAD_TRUNCATED_IMAGES = False
    return weasyprint


__all__ = ["load_weasyprint"]
