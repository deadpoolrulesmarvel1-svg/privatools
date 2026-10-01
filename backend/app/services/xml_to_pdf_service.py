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
# Each level is indented 8 points, so a line nested deeper than this would
# start past the right margin of an A4 page.
MAX_DEPTH = 60
# At most this many printed lines: about 800 A4 pages at 62 lines a page, as
# blank lines are not printed. About that many (a 1 MB file of 10,000 sitemap
# entries with three fields each) took 3.5 s and 126 MB to print. Unbounded,
# a 5 MB file of 1.3 million empty elements took 38 s and 600 MB and printed
# 21,000 pages. JSON to PDF has the same cap. Every element starts a line, so
# a file with more elements than this is refused while it is read, before its
# tree is built; a sitemap whose entries have all four fields takes six lines
# an entry and reaches the cap at about 8,300 entries.
MAX_PRINTED_LINES = 50_000

# The refusals below reach the visitor as they are, so they avoid the words
# the website's friendlyError turns into advice about damaged or locked PDFs
# ("malformed", "corrupt", "password", "too large", ...).
TOO_DEEP = (
    f"This XML nests more than {MAX_DEPTH} levels deep. XML to PDF indents each level, "
    "so deeper lines would start past the right margin of the page."
)
TOO_MANY_ELEMENTS = (
    f"This XML has more than {MAX_PRINTED_LINES:,} elements, and XML to PDF prints at most "
    f"{MAX_PRINTED_LINES:,} lines, about 800 pages. Split it into smaller files."
)


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
        from defusedxml.expatbuilder import DefusedExpatBuilderNS
    except ImportError as exc:
        raise DependencyError(
            "defusedxml is required for XML processing. Install with: pip install defusedxml"
        ) from exc

    class BoundedBuilder(DefusedExpatBuilderNS):
        """defusedxml's own minidom builder, with the same protections, that
        stops at the first element nested deeper than MAX_DEPTH, or past the
        MAX_PRINTED_LINES-th element: before the rest of the tree is built, and
        before pretty-printing, which recurses once per level and answered 500
        from about 990 levels."""

        depth = 0
        elements = 0

        def start_element_handler(self, name, attributes):
            self.depth += 1
            self.elements += 1
            if self.depth > MAX_DEPTH:
                raise ValidationError(TOO_DEEP)
            if self.elements > MAX_PRINTED_LINES:
                raise ValidationError(TOO_MANY_ELEMENTS)
            super().start_element_handler(name, attributes)

        def end_element_handler(self, name):
            self.depth -= 1
            super().end_element_handler(name)

    try:
        # The same defaults as defusedxml.minidom.parseString.
        builder = BoundedBuilder(forbid_dtd=False, forbid_entities=True, forbid_external=True)
        dom = builder.parseString(_parser_input(content))
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

    try:
        return dom.toprettyxml(indent="  ")
    except RecursionError as exc:  # not reachable within MAX_DEPTH; kept as a backstop
        raise ValidationError(TOO_DEEP) from exc


def xml_to_pdf(input_path: str) -> str:
    """Convert an XML file to a formatted PDF."""
    output_path = temp_output("xml", "pdf")

    if os.path.getsize(input_path) > MAX_INPUT_BYTES:
        raise FileTooLargeError(
            f"This XML file is bigger than {MAX_INPUT_BYTES // (1024 * 1024)} MB, the most XML to PDF takes."
        )

    formatted = _safe_pretty_xml(Path(input_path).read_bytes())
    lines = formatted.split("\n")
    printed = sum(1 for line in lines if line.strip())
    if printed > MAX_PRINTED_LINES:  # text with many line breaks, under the element cap
        raise ValidationError(
            f"This XML would print as {printed:,} lines, and XML to PDF prints at most "
            f"{MAX_PRINTED_LINES:,}, about 800 pages. Split it into smaller files."
        )

    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4
    margin = 54
    y = height - margin
    font_size = 9
    line_height = 12

    c.setFont("Courier", font_size)
    char_width = c.stringWidth("M", "Courier", font_size)  # Courier is monospaced

    for line in lines:
        if y < margin:
            c.showPage()
            c.setFont("Courier", font_size)
            y = height - margin

        # Blank lines are not printed. Re-indenting an indented file leaves its
        # old indentation behind as whitespace-only lines, two around every
        # element: given 0.3 of a line each, they made the output look
        # double-spaced and the 50,000-line cap 1,300 pages, and a file of
        # line breaks printed hundreds of empty pages.
        stripped = line.rstrip()
        if not stripped:
            continue

        indent = len(line) - len(line.lstrip())
        x = margin + indent * 4

        # Colorize tags
        if stripped.lstrip().startswith("<"):
            c.setFillColorRGB(0.1, 0.3, 0.6)
        else:
            c.setFillColorRGB(0, 0, 0)

        # Cut a long line off at the right margin, keeping at least 10
        # characters. The characters that fit are counted first, because
        # dropping one at a time and measuring the rest again was quadratic:
        # 43 s for a 32,000-character line. The loop then only corrects for a
        # symbol ReportLab draws from another, wider font.
        room = width - margin - x
        display = stripped.lstrip()[: max(10, int(room // char_width))]
        while c.stringWidth(display, "Courier", font_size) > room and len(display) > 10:
            display = display[:-1]

        c.drawString(x, y, display)
        y -= line_height

    c.setFillColorRGB(0, 0, 0)
    c.save()
    return str(output_path)
