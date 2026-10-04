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
import time
from itertools import groupby
from typing import NamedTuple

import fitz  # PyMuPDF
import pikepdf
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from ..utils.cleanup import process_pdf, safe_open_pdf
from ..utils.exceptions import PdfCorruptError, ToolError
from ..utils.filenames import temp_output
from ..utils.page_range import parse_page_range
from ..utils.page_space import drawing_unturned, settle_rotation

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

# Half the thickness of what is redacted along the middle of a stamp (see
# _marks).
_MARK_PT = 0.5

# The work budget. It bounds the CPU time the tool spends beyond reading each
# page once, which every tool does. Each candidate stamp costs two runs over
# its page's whole content (reading it again, and checking it went), and the
# page about two more (its drawing log, the redaction): MuPDF interprets
# everything the page draws each time, text, drawings and the forms it draws,
# however often. So a page is charged the CPU time its first run (the words
# pass) took, times twice its candidates plus two. That followed the measured
# cost within a fifth: a page of text with 1,280 candidates was charged 30 s
# and took 28 s, a 49 KB page drawing 1 million line segments with 150
# candidates was charged 93 s and took 88 s. A request may be charged
# _WORK_FLOOR_S, plus _WORK_READS times what reading all its pages once took;
# past that it is refused before the work is done. A page with more than
# _MAX_CANDIDATES candidates is refused too, since MuPDF's own handling of
# redactions grows with their square, which the charge does not follow.
# So a page with up to 19 candidates pays its own way, however long it takes
# to read, and pages with more draw on the floor. Measured on 614 real
# statements, terms and forms (9,343 pages): the busiest page had 13
# candidates (no prefix, the fewest digits), and the most any file was
# charged was 28% of its budget (a 1,080-page file, 42 s of 151 s); with the
# prefix, on 100 files stamped by our own tool, 7%.
_WORK_FLOOR_S = 3.0
_WORK_READS = 40
_MAX_CANDIDATES = 200

# Everything the file draws as text, including what lies outside the page's
# visible area, where a match is still in the file for anyone who extracts it.
_ALL_TEXT = fitz.TEXTFLAGS_WORDS & ~fitz.TEXT_MEDIABOX_CLIP


class BatesWorkError(ToolError):
    """Removing the stamps would take far longer than the file warrants (HTTP 422)."""

    status_code = 422
    default_detail = "This PDF would take far too long to process, so no file was made."


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


class BatesRemoval(NamedTuple):
    """What remove_bates_numbering did."""

    path: str
    # Stamps no longer in the file.
    removed: int
    # Stamps found in the margins but still in the file (drawn by a stamp
    # annotation or a form field, which redaction does not reach).
    remaining: int
    # Text matching the prefix or suffix found anywhere else in the file (in
    # the body, or outside the visible page) and left in place; 0 with neither.
    elsewhere: int


class _Net(NamedTuple):
    """What removal looks for, and where (see _Frame.holds)."""

    pattern: re.Pattern
    # A prefix or suffix was given, so the pattern matches exactly.
    exact: bool


class _Word(NamedTuple):
    """A word as PyMuPDF reads it, with the page unturned: points from the
    top-left corner of the page's visible area as stored."""

    text: str
    box: fitz.Rect
    # Each character and its box.
    chars: tuple[tuple[str, fitz.Rect], ...]
    # It runs across the page as stored (left to right, or right to left).
    across: bool
    # It is painted and nothing covers it. A scan's OCR text layer is not:
    # it is there to be found (see _uncovered).
    drawn: bool


def _words(page: fitz.Page, clip: fitz.Rect) -> list[_Word]:
    """The words within `clip`, split at white space as get_text("words")
    splits them, with what "words" leaves out: which way each runs, whether
    it is painted, and each character's box. On a page of text this takes
    about twenty times as long as "words", so only a small part is read."""
    words: list[_Word] = []
    for block in page.get_text("rawdict", clip=clip, flags=_ALL_TEXT)["blocks"]:
        for line in block.get("lines", ()):
            dx, dy = line["dir"]
            chars = [(char["c"], char["bbox"], span["alpha"] > 0) for span in line["spans"] for char in span["chars"]]
            for space, run in groupby(chars, key=lambda char: char[0].isspace()):
                if space:
                    continue
                run = list(run)
                boxes = [fitz.Rect(bbox) for _, bbox, _ in run]
                words.append(_Word(
                    text="".join(c for c, _, _ in run),
                    box=_union(boxes),
                    chars=tuple((c, box) for (c, _, _), box in zip(run, boxes)),
                    across=abs(dx) >= abs(dy),
                    drawn=any(painted for _, _, painted in run),
                ))
    return words


def _union(rects: list[fitz.Rect]) -> fitz.Rect:
    union = fitz.Rect(rects[0])
    for rect in rects[1:]:
        union |= rect
    return union


def _middle(rect: fitz.Rect) -> fitz.Point:
    return fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)


def _in_band(box: fitz.Rect, height: float) -> bool:
    """Whether `box` lies within the margin band at the top or the bottom of a
    page `height` tall, measured down from its top."""
    return box.y1 <= _MARGIN_BAND_PT or box.y0 >= height - _MARGIN_BAND_PT


def _near_an_edge(box: fitz.Rect, area: fitz.Rect) -> bool:
    """Whether `box` lies within the margin band along any edge of `area`."""
    return (box.x1 <= area.x0 + _MARGIN_BAND_PT or box.x0 >= area.x1 - _MARGIN_BAND_PT
            or box.y1 <= area.y0 + _MARGIN_BAND_PT or box.y0 >= area.y1 - _MARGIN_BAND_PT)


class _Frame(NamedTuple):
    """Where a page shows what: its visible area as stored (the frame of its
    words), the page as shown, the matrix from one to the other, and what our
    own Bates Numbering sizes its stamp for: the MediaBox's width and height."""

    stored: fitz.Rect
    shown: fitz.Rect
    to_shown: fitz.Matrix
    rotation: int
    media: tuple[float, float]

    @classmethod
    def of(cls, page: fitz.Page) -> "_Frame":
        """`page` as the visitor sees it, with /Rotate read the way the site's
        preview (pdf.js) reads it: settle_rotation writes it that way, so
        PyMuPDF's rotation matrix is the preview's."""
        rotation = settle_rotation(page)
        shown = page.rect
        width, height = (shown.height, shown.width) if rotation in (90, 270) else (shown.width, shown.height)
        media = page.mediabox
        return cls(fitz.Rect(0, 0, width, height), shown, page.rotation_matrix, rotation, (media.width, media.height))

    def reports(self, box: fitz.Rect, net: _Net) -> bool:
        """Whether a match at `box` (stored) that is not taken is counted as
        left in place, so the visitor hears of it.

        With a prefix or suffix, every match anywhere in the file is.

        With neither, only these, on a page turned a quarter, where a stamp
        can sit outside the net without a prefix: a Bates-shaped word within
        an inch of the left or right edge as shown, and one where our own
        Bates Numbering puts its stamp on such a page (see _ours). Nothing
        else is: a Bates-shaped number in the body is an ordinary number.
        """
        if net.exact:
            return True
        if self.rotation not in (90, 270) or not box.intersects(self.stored):
            return False
        shown = box * self.to_shown
        return (shown.x1 <= self.shown.x0 + _MARGIN_BAND_PT or shown.x0 >= self.shown.x1 - _MARGIN_BAND_PT
                or self._ours(shown))

    def _ours(self, shown: fitz.Rect) -> bool:
        """Whether `shown` (a box on the page as shown) lies where our own
        Bates Numbering puts a stamp. It draws the stamp on a page the size
        of the MediaBox, 20 points in from its top or bottom, and lays that
        page upright on the page as shown, shrunk to fit and centred
        (pikepdf's add_overlay into the TrimBox, else CropBox, taken here as
        the visible area). On a page stored landscape and turned to show
        portrait, that puts the stamp about 173 points from the top or bottom,
        across the middle of the page, away from every edge. The band is the
        margin band, shrunk the same way."""
        width, height = self.media
        if width <= 0 or height <= 0:
            return False
        scale = min(self.shown.width / width, self.shown.height / height)
        x0 = self.shown.x0 + (self.shown.width - width * scale) / 2
        y0 = self.shown.y0 + (self.shown.height - height * scale) / 2
        overlay = fitz.Rect(x0, y0, x0 + width * scale, y0 + height * scale)
        band = _MARGIN_BAND_PT * scale
        if not (overlay + (-1, -1, 1, 1)).contains(shown):
            return False
        return shown.y1 <= overlay.y0 + band or shown.y0 >= overlay.y1 - band

    def holds(self, box: fitz.Rect, net: _Net, across: bool | None = None) -> bool:
        """Whether a match at `box` (stored) is in the margins removal clears.

        With a prefix or suffix, the pattern is exact, and a match within an
        inch of any edge of the visible area goes: the same edges on the page
        as shown and as stored, so how the file stores the page makes no
        difference, and a stamp is found however the page was turned, before
        or after it was stamped.

        With neither, only the shape is matched, and the net is narrower: the
        top and bottom inch of the page as shown. A word laid across the page
        as stored (`across`; None while that is not known) may also have been
        stamped on the page as stored, by a stamping tool that ignores /Rotate
        or before the page was turned (by our Rotate tool, say); on a page
        turned a quarter such a stamp runs up a side of the page as shown, so
        the top and bottom inch of the page as stored count too. That makes
        this net depend on how the page is stored: a number running up the
        side of a landscape page is taken if the page is stored portrait and
        turned, and left if it is stored landscape. On a page turned 0 or 180
        degrees the two frames have the same bands, so nothing more is taken.
        """
        if net.exact:
            return _near_an_edge(box, self.stored)
        if _in_band(box * self.to_shown, self.shown.height):
            return True
        return across is not False and _in_band(box, self.stored.height)


def _same_place(a: fitz.Rect, b: fitz.Rect) -> bool:
    """Whether two boxes mostly overlap."""
    common = fitz.Rect(a) & b
    return not common.is_empty and common.get_area() >= 0.5 * min(a.get_area(), b.get_area())


def _one_each(items: list[tuple[str, fitz.Rect]]) -> list[list[int]]:
    """The indices of `items` (text, box), grouped so that each group is one
    thing the visitor sees: text drawn twice in the same place, as "fake
    bold" draws it, is one stamp, not two."""
    groups: list[list[int]] = []
    for index, (text, box) in enumerate(items):
        for group in groups:
            first_text, first_box = items[group[0]]
            if first_text == text and _same_place(first_box, box):
                group.append(index)
                break
        else:
            groups.append([index])
    return groups


def _matches(words: list, frame: _Frame, net: _Net) -> tuple[list[tuple[str, fitz.Rect]], list[tuple[str, fitz.Rect]]]:
    """The words matching the pattern, from get_text("words"): those that may
    be stamps (in the margins, see _Frame.holds; which way a word runs is
    read later, only for these), and the others that are left in place and
    reported (_Frame.reports). With an exact pattern a match outside the
    visible area is one of those: it is still in the file for anyone who
    extracts its text."""
    candidates, others = [], []
    for *coords, text, _, _, _ in words:
        if not net.pattern.match(text):
            continue
        box = fitz.Rect(coords)
        if box.intersects(frame.stored) and frame.holds(box, net):
            candidates.append((text, box))
        elif frame.reports(box, net):
            others.append((text, box))
    return candidates, others


_INLINE_PICTURE = re.compile(rb"(?:^|\s)BI\s")  # begin inline image


def _has_pictures(page: fitz.Page) -> bool:
    """Whether `page` may draw a picture: one it lists (quick to ask), or one
    written into its content or into a form it draws (BI ... EI). Asking the
    bbox log instead would draw the whole page."""
    if page.get_images(full=True) or _INLINE_PICTURE.search(page.read_contents()):
        return True
    doc = page.parent
    return any(_INLINE_PICTURE.search(doc.xref_stream(xref) or b"") for xref, *_ in page.get_xobjects())


def _under_pictures(page: fitz.Page, stamps: list[_Word]) -> list[int]:
    """The indices of the painted `stamps` that a picture drawn after them
    spans. Some OCR software draws the text it recognised in the ordinary way
    and lays the scan over it, so the number that shows is the one printed in
    the picture. PyMuPDF's bbox log lists what the page draws, in order, in
    the frame of the words. Whether the picture really hides the text (a
    picture can be see-through) is settled by _hidden."""
    if not any(stamp.drawn for stamp in stamps) or not _has_pictures(page):
        return []
    log = [(kind, fitz.Rect(box)) for kind, box in page.get_bboxlog()]

    def spanned(word: _Word) -> bool:
        last = max((i for i, (kind, box) in enumerate(log) if kind.endswith("text") and box.intersects(word.box)), default=None)
        return last is not None and any(kind == "fill-image" and box.contains(word.box) for kind, box in log[last + 1:])

    return [i for i, stamp in enumerate(stamps) if stamp.drawn and spanned(stamp)]


def _look(page: fitz.Page, box: fitz.Rect) -> bytes:
    """How the page looks within `box` (stored), without its annotations."""
    with drawing_unturned(page):
        return page.get_pixmap(clip=box, dpi=144, colorspace=fitz.csGRAY, annots=False).samples


def _hidden(before: bytes, after: bytes) -> bool:
    """Whether taking a stamp's text out left its box looking as it did, so
    the text never showed: a picture drawn over it hid it. A see-through
    picture (a soft mask, a colour-key mask, a fill alpha below 1) lets the
    text show, and its removal changes the look. Rewriting the page's content
    can move what is left by a hair, so a few faint pixels do not count."""
    if len(before) != len(after):
        return False
    changed = sum(1 for a, b in zip(before, after) if abs(a - b) > 8)
    return changed < 4


def _marks(word: _Word) -> list[fitz.Rect]:
    """Where to redact to take `word` and nothing else.

    MuPDF removes every character whose box touches a redaction, and a
    word's box runs from the font's ascender to its descender, so at ordinary
    line spacing the lines just above and below a stamp reach a point or two
    into its box: redacting the stamp's box took their characters too. A
    band a point thick along the middle of the word takes the word alone,
    since every character of a line in one size crosses it. Where one does
    not (a stamp set in two sizes, or on a slant), a point in the middle of
    each character does.
    """
    box = word.box
    if word.across:
        middle = (box.y0 + box.y1) / 2
        band = fitz.Rect(box.x0 + _MARK_PT, middle - _MARK_PT, box.x1 - _MARK_PT, middle + _MARK_PT)
        crosses = all(rect.y0 < band.y1 and rect.y1 > band.y0 for _, rect in word.chars)
    else:
        middle = (box.x0 + box.x1) / 2
        band = fitz.Rect(middle - _MARK_PT, box.y0 + _MARK_PT, middle + _MARK_PT, box.y1 - _MARK_PT)
        crosses = all(rect.x0 < band.x1 and rect.x1 > band.x0 for _, rect in word.chars)
    if crosses:
        return [band]
    return [fitz.Rect(_middle(rect), _middle(rect)) + (-_MARK_PT, -_MARK_PT, _MARK_PT, _MARK_PT) for _, rect in word.chars]


class _Annotation(NamedTuple):
    """A link or FreeText annotation, which MuPDF's redaction deletes when a
    redaction touches it, however little."""

    ref: str  # as the page's /Annots array refers to it: "12 0 R"
    link: bool  # a link; else a FreeText annotation
    box: fitz.Rect  # stored, the frame of the words
    text: str  # a FreeText annotation's /Contents


def _annots_array(doc: fitz.Document, page: fitz.Page) -> tuple[int, str]:
    """The page's /Annots array as PDF text, and its xref when it is an
    object of its own (else 0)."""
    kind, value = doc.xref_get_key(page.xref, "Annots")
    if kind == "xref":
        target = int(value.split()[0])
        return target, doc.xref_object(target, compressed=True).strip()
    return 0, value.strip() if kind == "array" else "[]"


def _numbers(text: str) -> list[float]:
    return [float(value) for value in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)", text)]


def _annotations(page: fitz.Page) -> dict[int, _Annotation]:
    """The page's links and FreeText annotations, by xref."""
    doc = page.parent
    wanted = [(xref, kind) for xref, kind, *_ in page.annot_xrefs() if kind in (fitz.PDF_ANNOT_LINK, fitz.PDF_ANNOT_FREE_TEXT)]
    if not wanted:
        return {}
    refs = {int(n): f"{n} {g} R" for n, g in re.findall(r"(\d+)\s+(\d+)\s+R", _annots_array(doc, page)[1])}
    with drawing_unturned(page):  # /Rect is in PDF user space; this maps it to the frame of the words
        to_stored = page.transformation_matrix
    found = {}
    for xref, kind in wanted:
        rect_kind, rect = doc.xref_get_key(xref, "Rect")
        if rect_kind == "xref":
            rect = doc.xref_object(int(rect.split()[0]), compressed=True)
        numbers = _numbers(rect)
        if xref not in refs or len(numbers) != 4:
            continue
        contents_kind, contents = doc.xref_get_key(xref, "Contents")
        found[xref] = _Annotation(
            refs[xref], kind == fitz.PDF_ANNOT_LINK, fitz.Rect(numbers).normalize() * to_stored,
            contents if contents_kind == "string" else "",
        )
    return found


def _put_back(page: fitz.Page, before: dict[int, _Annotation], stamps: list[_Word], net: _Net) -> fitz.Page:
    """Return to `page` the links and FreeText comments the redactions
    deleted: every link that is not on a stamp alone (its box inside a
    stamp's, give or take two points), and every FreeText annotation that is
    not itself a Bates number. Returns the page, reloaded if anything was
    put back."""
    if not before:
        return page
    doc = page.parent
    now = {xref for xref, *_ in page.annot_xrefs()}
    boxes = [stamp.box + (-2, -2, 2, 2) for stamp in stamps]
    back = [
        annotation.ref for xref, annotation in before.items()
        if xref not in now and (
            not any(box.contains(annotation.box) for box in boxes) if annotation.link
            else not net.pattern.match(annotation.text.strip())
        )
    ]
    if not back:
        return page
    target, array = _annots_array(doc, page)
    array = f"{array[:-1].rstrip()} {' '.join(back)}]"
    if target:
        doc.update_object(target, array)
    else:
        doc.xref_set_key(page.xref, "Annots", array)
    return doc.reload_page(page)


def _still_there(page: fitz.Page, stamp: _Word) -> bool:
    """Whether any of the stamp's characters is still on the page: the same
    character in the same place."""
    left = [(char, _middle(rect)) for word in _words(page, stamp.box + (-1, -1, 1, 1)) for char, rect in word.chars]
    return any(
        char == other and abs(_middle(rect).x - point.x) < 1 and abs(_middle(rect).y - point.y) < 1
        for char, rect in stamp.chars for other, point in left
    )


class _Outcome(NamedTuple):
    """What became of a page's candidates (see BatesRemoval)."""

    removed: int
    remaining: int
    elsewhere: int


def _remove_from(page: fitz.Page, frame: _Frame, net: _Net, candidates: list[tuple[str, fitz.Rect]]) -> _Outcome:
    """Take the stamps among `candidates` out of `page`, and count them.

    Only the text goes (see _marks), and nothing is painted over the place.
    Pictures and drawings are left alone, except under a stamp whose text
    does not show: invisible, like a scan's OCR text, or hidden by a picture
    drawn over it (_under_pictures, _hidden). There the number that shows is
    part of the picture, so the picture under the word is whitened. Links
    and FreeText comments the redactions touch are put back (_put_back).

    The counts are taken from the page afterwards: a stamp redaction does not
    reach, such as one drawn by a stamp annotation or a form field, is still
    there and is counted as such. A stamp drawn twice in one place counts
    once (_one_each). A candidate that turns out not to be in the net once
    it is read again is left, and counted as left in place when
    _Frame.reports says so.
    """
    stamps, unread, dropped = [], 0, []
    for text, box in candidates:
        # Only the word "words" found counts: one the clip cuts short could
        # match where the whole word does not.
        word = next((
            read for read in _words(page, box + (-1, -1, 1, 1))
            if read.text == text and all(abs(a - b) < 0.5 for a, b in zip(read.box, box))
        ), None)
        if word is None:
            # Found, but not read again, so it cannot be taken out exactly.
            unread += frame.holds(box, net, across=False)
        elif frame.holds(word.box, net, word.across):
            stamps.append(word)
        elif frame.reports(word.box, net):
            dropped.append((word.text, word.box))
    elsewhere = len(_one_each(dropped))
    if not stamps:
        return _Outcome(0, unread, elsewhere)

    covered = _under_pictures(page, stamps)
    looks = {i: _look(page, stamps[i].box) for i in covered}
    before = _annotations(page)
    for word in stamps:
        for rect in _marks(word):
            page.add_redact_annot(rect, cross_out=False)
    page.apply_redactions(
        images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_REMOVE,
    )
    hidden = [word for word in stamps if not word.drawn]
    hidden += [stamps[i] for i, look in looks.items() if _hidden(look, _look(page, stamps[i].box))]
    for word in hidden:
        page.add_redact_annot(word.box, cross_out=False)
    if hidden:
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_PIXELS, graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_NONE,
        )
    page = _put_back(page, before, stamps, net)

    left = [_still_there(page, stamp) for stamp in stamps]
    groups = _one_each([(stamp.text, stamp.box) for stamp in stamps])
    gone = sum(1 for group in groups if not any(left[i] for i in group))
    return _Outcome(gone, len(groups) - gone + unread, elsewhere)


def _too_much(net: _Net, found: int, page: int) -> str:
    what = ("text matching that prefix or suffix" if net.exact else "numbers that look like Bates stamps")
    advice = ("Check the prefix or suffix the stamps use." if net.exact else "Give the prefix or suffix the stamps use.")
    return (
        f"Removing the {what} in this PDF's page margins ({found:,} up to page {page}) would take far "
        f"longer than a file like this warrants, so no file was made. {advice}"
    )


def remove_bates_numbering(
    input_path: str,
    prefix: str = "",
    suffix: str = "",
    digits: int = 6,
) -> BatesRemoval:
    """Remove Bates stamps; see BatesRemoval for what is returned.

    Two guards keep this from eating real content: the text must match the
    Bates pattern, and it must sit in the margins (see _Frame.holds). A
    figure caption reading "000123" in the middle of the page is left alone.

    Redaction is used rather than an overlay so the text is genuinely gone
    rather than covered — the whole point of removing a production number is
    that it is no longer in the file.

    The work is charged, page by page, before it is done (see _WORK_FLOOR_S),
    and a file that would take far longer than it warrants is refused with
    BatesWorkError.
    """
    output_path = temp_output("bates_removed", "pdf")
    net = _Net(_removal_pattern(prefix, suffix, digits), exact=bool(prefix or suffix))
    read_s = charged_s = 0.0
    found = removed = remaining = elsewhere = 0

    def remove(doc: fitz.Document) -> None:
        nonlocal read_s, charged_s, found, removed, remaining, elsewhere
        if not doc.is_pdf:
            # MuPDF opens HTML, images and more by their content; reading a
            # PDF key of such a page crashes it (the route lets only content
            # starting like a PDF through, which MuPDF opens as one or refuses).
            raise PdfCorruptError()
        for number in range(doc.page_count):
            page = doc[number]
            frame = _Frame.of(page)
            started = time.thread_time()
            words = page.get_text("words", clip=fitz.INFINITE_RECT(), flags=_ALL_TEXT)
            run_s = time.thread_time() - started
            read_s += run_s
            candidates, others = _matches(words, frame, net)
            found += len(candidates)
            if candidates:
                charged_s += run_s * (2 * len(candidates) + 2)
            if len(candidates) > _MAX_CANDIDATES or charged_s > _WORK_FLOOR_S + _WORK_READS * read_s:
                logger.info("bates-remove refused: %d candidates up to page %d (%d on it), charged %.2f s, read %.2f s",
                            found, number + 1, len(candidates), charged_s, read_s)
                raise BatesWorkError(_too_much(net, found, number + 1))
            elsewhere += len(_one_each(others))
            if candidates:
                outcome = _remove_from(page, frame, net, candidates)
                removed += outcome.removed
                remaining += outcome.remaining
                elsewhere += outcome.elsewhere

        doc.save(str(output_path), garbage=4, deflate=True)

    # A locked, damaged or pageless PDF is refused in the standard words; work
    # that fails on a repaired one is refused as damaged, never redone on a
    # rebuild that may have left pages out (utils.cleanup.process_pdf).
    process_pdf(input_path, remove, rebuild=False)

    return BatesRemoval(str(output_path), removed, remaining, elsewhere)
