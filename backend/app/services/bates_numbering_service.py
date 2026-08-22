"""Bates numbering — stamping, continuous multi-file sequences, and removal.

Bates numbers exist to give a document production a single unbroken index: in a
legal production, page 1 of the first file and the last page of the last file
are ends of *one* sequence, not per-file sequences that each restart. The
original implementation numbered each file from `start_number` independently,
which makes the output unusable for the audience the tool is for.

`add_bates_numbering_batch` maintains the running counter across files and
returns a manifest of which range landed on which file — the production log a
paralegal would otherwise reconstruct by hand.
"""

import io
import logging
import re

import fitz  # PyMuPDF
import pikepdf
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from ..utils.cleanup import safe_open_pdf
from ..utils.filenames import temp_output
from ..utils.page_range import parse_page_range

logger = logging.getLogger(__name__)

VALID_POSITIONS = {
    "bottom-right",
    "bottom-left",
    "bottom-center",
    "top-right",
    "top-left",
    "top-center",
}

MIN_FONT_SIZE = 4
MAX_FONT_SIZE = 72

# How far from the page edge a stamp is considered to live. Removal only
# touches text inside this band, so body text that happens to look like a
# Bates number is never redacted.
_MARGIN_BAND_PT = 72.0


def format_bates(prefix: str, number: int, digits: int, suffix: str = "") -> str:
    return f"{prefix}{str(number).zfill(digits)}{suffix}"


def _draw(width: float, height: float, text: str, position: str, font_size: int) -> bytes:
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(width, height))
    c.setFillColor(black)
    c.setFont("Helvetica", font_size)
    margin = 20

    if position == "bottom-right":
        c.drawRightString(width - margin, margin, text)
    elif position == "bottom-left":
        c.drawString(margin, margin, text)
    elif position == "bottom-center":
        c.drawCentredString(width / 2, margin, text)
    elif position == "top-right":
        c.drawRightString(width - margin, height - margin - font_size, text)
    elif position == "top-left":
        c.drawString(margin, height - margin - font_size, text)
    elif position == "top-center":
        c.drawCentredString(width / 2, height - margin - font_size, text)

    c.save()
    packet.seek(0)
    return packet.read()


def add_bates_numbering(
    input_path: str,
    prefix: str = "",
    start_number: int = 1,
    digits: int = 6,
    position: str = "bottom-right",
    suffix: str = "",
    font_size: int = 10,
    pages: str | None = None,
) -> tuple[str, int]:
    """Stamp one document.

    Returns `(output_path, next_number)`. The second value is what makes a
    continuous multi-file sequence possible — the caller feeds it into the next
    document instead of restarting.

    `pages` restricts which pages are *stamped*; the counter still advances
    only for stamped pages, so the sequence stays dense.
    """
    output_path = temp_output("bates", "pdf")
    font_size = max(MIN_FONT_SIZE, min(MAX_FONT_SIZE, int(font_size)))
    number = start_number

    with safe_open_pdf(input_path) as pdf:
        total = len(pdf.pages)
        if pages:
            targets = set(parse_page_range(pages, total, allow_empty=True))
        else:
            targets = set(range(total))

        for i, page in enumerate(pdf.pages):
            if i not in targets:
                continue
            text = format_bates(prefix, number, digits, suffix)
            mediabox = page.mediabox
            width = float(mediabox[2]) - float(mediabox[0])
            height = float(mediabox[3]) - float(mediabox[1])

            overlay_pdf = pikepdf.Pdf.open(
                io.BytesIO(_draw(width, height, text, position, font_size))
            )
            pikepdf.Page(page).add_overlay(overlay_pdf.pages[0])
            number += 1

        pdf.save(str(output_path))

    return str(output_path), number


def add_bates_numbering_batch(
    input_paths: list[str],
    prefix: str = "",
    start_number: int = 1,
    digits: int = 6,
    position: str = "bottom-right",
    suffix: str = "",
    font_size: int = 10,
) -> tuple[list[str], list[dict]]:
    """Stamp several documents as ONE continuous sequence.

    This is the difference between a usable production tool and a toy: the
    second file picks up where the first stopped rather than restarting at
    `start_number`.

    Returns the output paths and a manifest — index, page count, and the first
    and last Bates number on each file.
    """
    outputs: list[str] = []
    manifest: list[dict] = []
    number = start_number

    for index, path in enumerate(input_paths):
        first = number
        out, number = add_bates_numbering(
            path,
            prefix=prefix,
            start_number=number,
            digits=digits,
            position=position,
            suffix=suffix,
            font_size=font_size,
        )
        outputs.append(out)
        manifest.append({
            "index": index,
            "pages": number - first,
            "firstBates": format_bates(prefix, first, digits, suffix),
            "lastBates": format_bates(prefix, max(number - 1, first), digits, suffix),
        })

    return outputs, manifest


def _removal_pattern(prefix: str, suffix: str, digits: int) -> re.Pattern:
    """Build the pattern removal will match.

    With a prefix or suffix supplied we match exactly, which is safe. With
    neither, we fall back to "optional letters, then at least `digits` digits" —
    still anchored, and still confined to the margin band by the caller.
    """
    if prefix or suffix:
        return re.compile(
            rf"^{re.escape(prefix)}\d{{1,12}}{re.escape(suffix)}$"
        )
    return re.compile(rf"^[A-Za-z._-]{{0,12}}\d{{{max(digits, 3)},12}}$")


def remove_bates_numbering(
    input_path: str,
    prefix: str = "",
    suffix: str = "",
    digits: int = 6,
) -> tuple[str, int]:
    """Remove Bates stamps, returning `(output_path, count_removed)`.

    Two guards keep this from eating real content: the text must match the
    Bates pattern, and it must sit within `_MARGIN_BAND_PT` of the top or
    bottom edge. A figure caption reading "000123" in the middle of the page is
    left alone.

    Redaction is used rather than an overlay so the text is genuinely gone
    rather than covered — the whole point of removing a production number is
    that it is no longer in the file.
    """
    output_path = temp_output("bates_removed", "pdf")
    pattern = _removal_pattern(prefix, suffix, digits)
    removed = 0

    doc = fitz.open(input_path)
    try:
        for page in doc:
            height = page.rect.height
            hits = []
            for word in page.get_text("words"):
                x0, y0, x1, y1, text = word[0], word[1], word[2], word[3], word[4]
                if not pattern.match(text.strip()):
                    continue
                in_top = y1 <= _MARGIN_BAND_PT
                in_bottom = y0 >= height - _MARGIN_BAND_PT
                if not (in_top or in_bottom):
                    continue
                hits.append(fitz.Rect(x0, y0, x1, y1))

            for rect in hits:
                page.add_redact_annot(rect)
            if hits:
                page.apply_redactions()
                removed += len(hits)

        doc.save(str(output_path), garbage=4, deflate=True)
    finally:
        doc.close()

    return str(output_path), removed
