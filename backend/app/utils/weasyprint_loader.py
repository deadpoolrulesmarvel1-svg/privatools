"""Load WeasyPrint without changing how Pillow treats a cut-off picture, and
keep the pictures visitors inline out of its log lines.

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

WeasyPrint also logs every picture or stylesheet it leaves out with its URL
("Failed to load image at 'data:image/png;base64,...'"), and the name of each
stylesheet it parses. A picture inlined in the HTML sent to HTML to PDF put
the whole picture, in base64, in the server's logs. The filter below, on
WeasyPrint's loggers from the moment this module is imported, shortens a
data: URI to its media type and size: "data:image/png (48213 bytes)".
"""

from __future__ import annotations

import logging
import re

from PIL import ImageFile

# A data: URI in running text ends at a space or a quote. An argument that is
# one (WeasyPrint passes the URL as an argument) is shortened whole, so a raw
# SVG with spaces and quotes in it is too.
_DATA_URI = re.compile(r"\bdata:[^\s'\"]*", re.IGNORECASE)
_MEDIA_TYPE = re.compile(r"data:([a-z0-9!#$&^_.+-]{1,64}/[a-z0-9!#$&^_.+-]{1,64})", re.IGNORECASE)
_WEASYPRINT_LOGGERS = ("weasyprint", "weasyprint.progress")


def _summary(uri: str) -> str:
    media_type = _MEDIA_TYPE.match(uri)
    size = len(uri.encode("utf-8", "replace"))
    return f"data:{media_type[1] if media_type else ''} ({size} bytes)"


def _shortened_text(text: str) -> str:
    return _DATA_URI.sub(lambda found: _summary(found[0]), text)


def _shortened(value):
    if isinstance(value, str):
        return _summary(value) if value[:5].lower() == "data:" else _shortened_text(value)
    if isinstance(value, (int, float)) or value is None:
        return value
    try:
        text = str(value)  # an exception whose message names the URL
    except Exception:
        return value
    return _shortened_text(text) if _DATA_URI.search(text) else value


class _ShortDataURIs(logging.Filter):
    """Shorten every data: URI in a WeasyPrint log record to its media type
    and size. A logger's filters see only the records logged on it, not its
    children's, so it is on each of WeasyPrint's loggers."""

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "_privatools_data_uris_shortened", False):
            return True
        record._privatools_data_uris_shortened = True
        if isinstance(record.msg, str):
            # A summary has no %, so the message still formats with its arguments.
            record.msg = _shortened_text(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_shortened(arg) for arg in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: _shortened(arg) for key, arg in record.args.items()}
        return True


for _name in _WEASYPRINT_LOGGERS:
    logging.getLogger(_name).addFilter(_ShortDataURIs())


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
