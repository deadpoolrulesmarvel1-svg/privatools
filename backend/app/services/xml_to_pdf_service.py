"""Convert an XML file to a Courier-typeset PDF.

Security: defusedxml is the **only** parser path. We never fall back to
`xml.dom.minidom` directly — that parser resolves external entities and
DOCTYPE references, which is the textbook XXE attack vector.

If defusedxml isn't installed the request fails fast with a 500 instead
of silently parsing with an unsafe library.
"""

from __future__ import annotations

import codecs
import os
import re
from pathlib import Path
from xml.parsers.expat import ExpatError
from xml.parsers.expat import errors as expat_errors

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..utils.exceptions import DependencyError, FileTooLargeError, ValidationError
from ..utils.filenames import temp_output

# Cap input size so a multi-GB XML file can't pin the worker.
MAX_INPUT_BYTES = 5 * 1024 * 1024

# The refusals below reach the visitor as they are, so they avoid the words
# the website's friendlyError turns into advice about damaged or locked PDFs
# ("malformed", "corrupt", "password", "too large", ...).


# XML's EncName production, from the declaration at the start of the file.
_ENCODING_DECLARATION = re.compile(rb"""^<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z][A-Za-z0-9._-]{0,39})["']""")


def _declared_encoding(content: bytes) -> str | None:
    match = _ENCODING_DECLARATION.match(content.removeprefix(codecs.BOM_UTF8))
    return match.group(1).decode("ascii") if match else None


def _parser_input(content: bytes) -> bytes | str:
    """What expat is given: the text when the bytes are valid UTF-8, else the bytes.

    Valid UTF-8 is read as UTF-8 whatever the declaration says. A declaration
    naming the wrong encoding is common (a file saved as UTF-8 that kept an old
    "ISO-8859-1" line); followed literally it turned "Café" into "CafÃ©", and
    expat cannot load "utf8", the spelling Python's own xml.etree writes. A
    UTF-16 byte order mark, or the zero bytes UTF-16 and UTF-32 put near the
    start, sends the bytes to expat, which reads UTF-16 by itself. So does text
    that is not valid UTF-8: it is in the one-byte encoding its declaration
    names, such as ISO-8859-1 or Windows-1252, and expat follows that.
    """
    if content[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE) or b"\x00" in content[:4]:
        return content
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content


def _safe_pretty_xml(content: bytes) -> str:
    """Parse and pretty-print XML *safely* — defusedxml only.

    Reads UTF-8, UTF-16 and one-byte encodings such as ISO-8859-1 and
    Windows-1252 (see _parser_input). Decoding every file as UTF-8, as this
    once did, refused all but UTF-8.
    """
    try:
        from defusedxml import DefusedXmlException
        from defusedxml.minidom import parseString
    except ImportError as exc:
        raise DependencyError(
            "defusedxml is required for XML processing. Install with: pip install defusedxml"
        ) from exc

    try:
        dom = parseString(_parser_input(content))
    except DefusedXmlException as exc:
        raise ValidationError(
            "This XML declares entities in its DOCTYPE, or refers to outside files, which XML to PDF "
            "does not follow, for safety. Remove those declarations and what refers to them, then try again."
        ) from exc
    except ExpatError as exc:
        # expat counts columns from 0; editors show them from 1.
        reason = expat_errors.messages.get(exc.code, "not well-formed")
        raise ValidationError(
            f"This XML could not be read: {reason}, at line {exc.lineno}, column {exc.offset + 1}."
        ) from exc
    except (LookupError, ValueError) as exc:
        # An encoding pyexpat cannot read: one Python does not know
        # (LookupError), or a multi-byte one other than UTF-8 and UTF-16, such
        # as Shift_JIS (ValueError). DefusedXmlException is a ValueError too,
        # so it has to stay above.
        declared = _declared_encoding(content)
        what = f"text in {declared}, the encoding this file declares" if declared else "the encoding this file declares"
        raise ValidationError(f"XML to PDF cannot read {what}. Save it as UTF-8 and try again.") from exc

    return dom.toprettyxml(indent="  ")


def xml_to_pdf(input_path: str) -> str:
    """Convert an XML file to a formatted PDF."""
    output_path = temp_output("xml", "pdf")

    if os.path.getsize(input_path) > MAX_INPUT_BYTES:
        raise FileTooLargeError(
            f"This XML file is bigger than {MAX_INPUT_BYTES // (1024 * 1024)} MB, the most XML to PDF takes."
        )

    formatted = _safe_pretty_xml(Path(input_path).read_bytes())

    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4
    margin = 54
    y = height - margin
    font_size = 9
    line_height = 12

    c.setFont("Courier", font_size)

    for line in formatted.split("\n"):
        if y < margin:
            c.showPage()
            c.setFont("Courier", font_size)
            y = height - margin

        stripped = line.rstrip()
        if not stripped:
            y -= line_height * 0.3
            continue

        indent = len(line) - len(line.lstrip())
        x = margin + indent * 4

        # Colorize tags
        if stripped.lstrip().startswith("<"):
            c.setFillColorRGB(0.1, 0.3, 0.6)
        else:
            c.setFillColorRGB(0, 0, 0)

        # Truncate long lines so they don't run off the page.
        max_w = width - 2 * margin
        display = stripped.lstrip()
        while c.stringWidth(display, "Courier", font_size) > max_w and len(display) > 10:
            display = display[:-1]

        c.drawString(x, y, display)
        y -= line_height

    c.setFillColorRGB(0, 0, 0)
    c.save()
    return str(output_path)
