"""Private form-field detection subprocess; the web process never reads the pages.

form_detect_service runs ``python -I this_file <input pdf>``. Only JSON is
written to stdout: the report, with ``"ok": true``, or ``{"ok": false,
"error": ...}`` naming "password", "corrupt", "unreadable", "no_pages",
"too_many_pages" (with "pages" and "limit"), "too_large" or "failed".

A PDF drawn as a form but without fillable fields still shows where the
blanks are: what its pages draw and say. This finds, from PyMuPDF's drawing
list and its text with each character's ink box:

- a line after a label ("Name: ____"), drawn as a stroke, as a thin filled
  bar (how Word exports an underlined blank), typed as underscores
  (three or more, and "__/__/____" as one date), or as a row of dots;
- a line with a caption under it ("Signature of applicant"), when the
  caption names a field, and lines stacked under a question, as one field;
- an empty box, square or rounded, with a label beside or above it, and a
  light shaded area without an outline;
- the empty cells of a ruled table that is mostly blanks (not a table of
  data), named after the cell to their left and the heading above them, and
  the space under a small caption in a cell's top corner;
- a row of three or more touching boxes (one per character) as one field;
- checkboxes: small squares, and the box characters (☐ □ ❑ and the like,
  and the boxes of the Wingdings and ZapfDingbats fonts).

Each blank becomes a candidate: its page, its rectangle in the numbers Form
Creator's route takes (points from the top-left corner of the page's
visible area, before /Rotate), a type (text, checkbox, signature, or date
where the label says so), a field name made from its label, unique in the
file, and a confidence. The confidence is a heuristic score from 0 to 1 that
orders the candidates; it is not a probability, and nothing below
MIN_CONFIDENCE is reported.

Pages are read in the direction their text runs, so a page stored turned
(/Rotate) is read as it is shown. A page whose drawings are too many to read
(MAX_PAGE_PATH_OPERATORS) is still read for typed blanks and box characters
and is named in "complexPages"; one MuPDF cannot read is named in
"pagesNotChecked". A page that is a picture (a scan) has no drawn lines or
text to find blanks in; a page with nothing found and a picture over most
of it is named in "scanPages".

The limits: work grows with the pages and what they draw, so the process
caps its own memory and CPU time (more pages, more time, up to a ceiling),
and the caller stops it after a time limit. Files with more than MAX_PAGES
pages are refused before any page is read.
"""

from __future__ import annotations

import bisect
import json
import os
import re
import resource
import sys
import unicodedata
from dataclasses import dataclass, field

# PyMuPDF under its own name: importing it as "fitz" prints a notice on
# standard output, which is this process's answer to its caller.
import pymupdf as fitz  # noqa: E402

# ── Limits ───────────────────────────────────────────────────────────────────

MAX_PAGES = 50
# Two web workers each run two heavy jobs at once in a 4 GB container, so four
# of these must fit beside them (as the Markdown converter's).
MEMORY_BASE_BYTES = 512 * 1024 * 1024
MEMORY_PER_FILE_BYTE = 3
# CPU seconds: enough to open any file, then a budget that grows with the
# pages, up to the most one file may use (measured: see form_detect_service).
CPU_SECONDS_OPEN = 20
CPU_SECONDS_BASE = 5
CPU_SECONDS_PER_PAGE = 0.5
CPU_SECONDS_MAX = 30
CPU_GRACE = 5
# A page whose content holds more path operators than this is not asked for
# its drawings (a map or a chart can draw hundreds of thousands); its typed
# blanks and box characters are still read.
MAX_PAGE_PATH_OPERATORS = 30_000
# Past these, a page's ruled lines are not searched for boxes and cells.
MAX_SEGMENTS = 3000
MAX_LATTICE_CELLS = 5_000
MAX_CANDIDATES = 300
MIN_CONFIDENCE = 0.5
MAX_REPORT_BYTES = 2 * 1024 * 1024
MAX_NAME = 40
MAX_LABEL = 80

TEXT_FLAGS = (fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_MEDIABOX_CLIP
              | fitz.TEXT_ACCURATE_BBOXES)


class Refusal(Exception):
    def __init__(self, error: str, **facts):
        super().__init__(error)
        self.kind = error
        self.facts = facts


# ── Characters ───────────────────────────────────────────────────────────────

UNDERSCORES = "_＿"
DOTS = ".…"
# Box characters a person ticks: ☐ ☑ ☒ □ ▢ ◻ ◽ ⬜ ❏ ❐ ❑ ❒ ⌧ ⊠.
BOX_CHARACTERS = frozenset("☐☑☒□▢◻◽⬜❏❐❑❒⌧⊠")
# The same boxes in symbol fonts, which most PDFs extract as the letter the
# font draws them at (or that letter's private-use code, U+F000 above it).
SYMBOL_FONT_BOXES = (
    ("wingdings2", frozenset("£RSTQ")),
    ("wingdings", frozenset("opqrx¨ýþ")),
    ("zapfdingbats", frozenset("opqr")),
    ("dingbats", frozenset("opqr")),
)
DATE_SEPARATORS = frozenset("/-.")

# Words that make a caption under a line, or a line under a label, a field's
# label rather than a person's name or a footnote.
FIELD_WORDS = re.compile(
    r"\b(signature|sign(?:ed)?|date|dated|name|print|title|position|witness|initials?|address|phone|"
    r"telephone|mobile|email|e-mail|applicant|employee|employer|parent|guardian|student|patient|"
    r"manager|supervisor|officer|authori[sz]ed|representative|company|organi[sz]ation|place|city|"
    r"relationship|occupation|birth|dob|number|id|firma|fecha|nombre|unterschrift|datum|"
    r"nom|lieu|ort|assinatura|nome|data|handtekening|naam|podpis)\b",
    re.I,
)
DATE_WORDS = re.compile(r"\b(date|dated|dob|d\.o\.b|birthday|dd\s*/\s*mm|mm\s*/\s*dd|yyyy|fecha|datum)\b", re.I)
SIGNATURE_WORDS = re.compile(r"\b(signature|sign(?:ed)?(?:\s+here)?|firma|unterschrift|assinatura|"
                             r"handtekening|podpis)\b", re.I)
PAGE_NUMBER = re.compile(r"^(\d{1,4}|[ivxlcdm]{1,6})$", re.I)
# What a leader of dots can lead to in a statement: an amount, not a blank.
AMOUNT = re.compile(r"^[-+(]?[$€£¥]?\s?\d[\d,.\s]*%?\)?$")
# A date to be written in a box, printed there as a hint: "DD/MM/YYYY", "/ /".
DATE_HINT = re.compile(r"^(?:dd|mm|yy|yyyy|jj|aaaa|tt|[-/.\s])+$", re.I)
# The cross printed at the start of a signature line.
SIGN_MARK = frozenset({"x", "X", "\u2717", "\u2718"})


# ── Geometry ─────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def inset(self, d: float) -> "Box":
        return Box(self.x0 + d, self.y0 + d, self.x1 - d, self.y1 - d)

    def overlap(self, other: "Box") -> float:
        w = min(self.x1, other.x1) - max(self.x0, other.x0)
        h = min(self.y1, other.y1) - max(self.y0, other.y0)
        return w * h if w > 0 and h > 0 else 0.0

    def contains_point(self, x: float, y: float) -> bool:
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1


def _box(r) -> Box:
    """A Box from a rectangle, corners in order: MuPDF gives a rectangle drawn
    through a turned matrix with its corners as they lie (x0 > x1)."""
    x0, y0, x1, y1 = r
    return Box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


class Turn:
    """A turn of the page by quarter turns, as plain arithmetic: PyMuPDF's
    Point and Rect objects cost more than the reading on a page of dense
    text, where every character is turned."""

    __slots__ = ("a", "b", "c", "d", "e", "f")

    def __init__(self, a: float, b: float, c: float, d: float, e: float, f: float):
        self.a, self.b, self.c, self.d, self.e, self.f = a, b, c, d, e, f

    def point(self, x: float, y: float) -> tuple[float, float]:
        return self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f

    def direction(self, x: float, y: float) -> tuple[float, float]:
        return self.a * x + self.c * y, self.b * x + self.d * y

    def box(self, x0: float, y0: float, x1: float, y1: float) -> Box:
        """A box turned: by quarter turns, two opposite corners still bound it."""
        ax, ay = self.point(x0, y0)
        bx, by = self.point(x1, y1)
        return Box(min(ax, bx), min(ay, by), max(ax, bx), max(ay, by))

    def inverse(self) -> "Turn":
        det = self.a * self.d - self.b * self.c
        a, b, c, d = self.d / det, -self.b / det, -self.c / det, self.a / det
        return Turn(a, b, c, d, -(a * self.e + c * self.f), -(b * self.e + d * self.f))


@dataclass
class Frame:
    """The page as its text reads: x to the right along the text, y down."""
    to_read: Turn
    to_page: Turn
    width: float
    height: float
    page_width: float   # the page as stored, before /Rotate
    page_height: float


def _turn(width: float, height: float, quarter: int) -> tuple[Turn, float, float]:
    """The turn of stored coordinates by `quarter` quarter turns clockwise
    (as /Rotate does), and the size of the turned page."""
    if quarter == 1:
        return Turn(0, 1, -1, 0, height, 0), height, width
    if quarter == 2:
        return Turn(-1, 0, 0, -1, width, height), width, height
    if quarter == 3:
        return Turn(0, -1, 1, 0, 0, width), height, width
    return Turn(1, 0, 0, 1, 0, 0), width, height


def _reading_frame(page: fitz.Page, raw: dict) -> Frame:
    """Turn the page so that most of its text runs left to right. A page
    stored turned (/Rotate 90, say) holds its text running up the stored
    page; read as stored, labels would sit above their lines."""
    shown = page.rect * page.derotation_matrix
    width, height = abs(shown.width), abs(shown.height)
    weights = [0, 0, 0, 0]
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1, 0))
            count = sum(len(span.get("chars", ())) for span in line.get("spans", ()))
            if abs(dx) >= abs(dy):
                weights[0 if dx > 0 else 2] += count
            else:
                # Text running up the stored page reads upright turned a quarter clockwise.
                weights[1 if dy < 0 else 3] += count
    quarter = max(range(4), key=lambda q: (weights[q], q == 0)) if any(weights) else 0
    turn, w, h = _turn(width, height, quarter)
    return Frame(turn, turn.inverse(), w, h, width, height)


# ── Text ─────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Token:
    kind: str          # "phrase", "underscores", "dots" or "box"
    text: str
    box: Box           # ink box, in the reading frame
    baseline: float
    size: float
    bold: bool = False


_BOLD = re.compile(r"bold|black|heavy|semibold|demibold", re.I)


def _font_key(name: str) -> str:
    name = name.split("+", 1)[-1].lower()
    return re.sub(r"[^a-z0-9]", "", name)


def _is_box_char(c: str, font: str) -> bool:
    if c in BOX_CHARACTERS:
        return True
    code = ord(c)
    if 0xF000 <= code <= 0xF0FF:
        c = chr(code - 0xF000)
    key = _font_key(font)
    for family, chars in SYMBOL_FONT_BOXES:
        if family in key:
            return c in chars
    return False


@dataclass(slots=True)
class _Char:
    c: str
    box: Box
    origin: tuple[float, float]
    size: float
    font: str
    bold: bool


def _page_tokens(raw: dict, frame: Frame) -> list[Token]:
    """The page's visible text as phrases, typed blanks and box characters,
    in the reading frame. Text that does not run along the frame (a margin
    note set sideways) and invisible text (an OCR layer) are left out."""
    tokens: list[Token] = []
    turn = frame.to_read
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1, 0))
            if turn.direction(dx, dy)[0] < 0.95:
                continue
            chars: list[_Char] = []
            for span in line.get("spans", ()):
                if span.get("alpha", 255) == 0:
                    continue
                size = float(span.get("size") or 0)
                font = str(span.get("font") or "")
                bold = bool(int(span.get("flags") or 0) & 16) or bool(_BOLD.search(font))
                for ch in span.get("chars", ()):
                    chars.append(_Char(ch["c"], turn.box(*ch["bbox"]), turn.point(*ch["origin"]), size, font, bold))
            tokens += _line_tokens(chars)
    return _join_split_dates(tokens)


def _line_tokens(chars: list[_Char]) -> list[Token]:
    tokens: list[Token] = []
    i, n = 0, len(chars)
    phrase: list[_Char] = []

    def close_phrase() -> None:
        visible = [ch for ch in phrase if not ch.c.isspace()]
        if visible:
            text = re.sub(r"\s+", " ", "".join(ch.c for ch in phrase)).strip()
            box = Box(min(ch.box.x0 for ch in visible), min(ch.box.y0 for ch in visible),
                      max(ch.box.x1 for ch in visible), max(ch.box.y1 for ch in visible))
            bold = sum(ch.bold for ch in visible) * 2 > len(visible)
            tokens.append(Token("phrase", text, box, visible[0].origin[1], max(ch.size for ch in visible), bold))
        phrase.clear()

    def run(match) -> int:
        j = i
        while j < n and match(chars[j].c):
            j += 1
        return j

    last_visible: _Char | None = None
    while i < n:
        ch = chars[i]
        if ch.c in UNDERSCORES:
            j = run(lambda c: c in UNDERSCORES)
            if j - i >= 3:
                close_phrase()
                group = chars[i:j]
                tokens.append(Token("underscores", "_" * (j - i), _union(group), ch.origin[1], ch.size))
                i, last_visible = j, chars[j - 1]
                continue
        elif ch.c in DOTS:
            j = run(lambda c: c in DOTS)
            dots = sum(3 if chars[k].c == "…" else 1 for k in range(i, j))
            if dots >= 5:
                close_phrase()
                group = chars[i:j]
                tokens.append(Token("dots", "." * dots, _union(group), ch.origin[1], ch.size))
                i, last_visible = j, chars[j - 1]
                continue
        elif _is_box_char(ch.c, ch.font):
            close_phrase()
            tokens.append(Token("box", ch.c, ch.box, ch.origin[1], ch.size))
            i, last_visible = i + 1, ch
            continue
        if not ch.c.isspace():
            if phrase and last_visible is not None and ch.box.x0 - last_visible.box.x1 > 1.5 * max(ch.size, 1):
                close_phrase()
            last_visible = ch
        elif not phrase:
            i += 1
            continue
        phrase.append(ch)
        i += 1
    close_phrase()
    return tokens


def _union(chars: list[_Char]) -> Box:
    return Box(min(c.box.x0 for c in chars), min(c.box.y0 for c in chars),
               max(c.box.x1 for c in chars), max(c.box.y1 for c in chars))


def _join_split_dates(tokens: list[Token]) -> list[Token]:
    """"__/__/____" is typed as blanks with separators between them: one date."""
    out: list[Token] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.kind == "underscores":
            parts, j = [t], i + 1
            while (j + 1 < len(tokens) and tokens[j].kind == "phrase" and tokens[j].text in DATE_SEPARATORS
                   and tokens[j + 1].kind == "underscores"
                   and abs(tokens[j + 1].baseline - t.baseline) < 0.3 * t.size
                   and tokens[j + 1].box.x0 - parts[-1].box.x1 < 2 * t.size):
                parts.append(tokens[j + 1])
                j += 2
            if len(parts) >= 2:
                box = Box(parts[0].box.x0, min(p.box.y0 for p in parts), parts[-1].box.x1,
                          max(p.box.y1 for p in parts))
                out.append(Token("underscores", "/".join(p.text for p in parts), box, t.baseline, t.size))
                i = j
                continue
        out.append(t)
        i += 1
    return out


# ── Drawings ─────────────────────────────────────────────────────────────────

@dataclass
class Segment:
    pos: float      # y of a horizontal segment, x of a vertical one
    a: float        # where it starts along its length
    b: float        # where it ends
    width: float    # stroke width
    edge: bool = False   # an edge of a box or a cell


@dataclass
class Shade:
    box: Box
    colour: tuple


_PATH_OPERATOR = re.compile(rb"(?<=\s)(?:re|[mlcvy])(?=\s)")


def drawn_operators(page: fitz.Page, limit: int) -> int:
    """How many path operators the page's content streams hold, with every
    form they draw (each counted once), counted to just past ``limit``: a
    cheap measure of what reading its drawings would cost, taken before
    they are read."""
    doc = page.parent
    count = 0
    try:
        xrefs = list(page.get_contents()) + [x[0] for x in page.get_xobjects()]
    except Exception:  # noqa: BLE001 - a page whose resources cannot be read has no drawings to read
        return limit + 1
    for xref in xrefs:
        try:
            data = doc.xref_stream(xref) or b""
        except MemoryError:
            return limit + 1
        except Exception:  # noqa: BLE001 - not a stream, or one MuPDF cannot decode
            continue
        for _ in _PATH_OPERATOR.finditer(data):
            count += 1
            if count > limit:
                return count
    return count


def _visible(colour) -> bool:
    """A stroke or fill a person sees on white paper."""
    if colour is None:
        return False
    values = list(colour)
    return bool(values) and min(values) < 0.95


def _light(colour) -> bool:
    """A pale tint, as forms shade their writing areas: not white, not a
    colour a chart's bars are drawn in."""
    if colour is None:
        return False
    values = list(colour)
    if len(values) == 4:  # CMYK: a little ink
        return 0.003 < max(values) <= 0.25
    return bool(values) and 0.75 <= min(values) < 0.99


def _page_drawings(page: fitz.Page, frame: Frame) -> tuple[list[Segment], list[Segment], list[Shade], list[Box]]:
    """Horizontal and vertical strokes (lines, thin bars, the sides of boxes),
    pale shaded areas, and the rest of what the page draws (curves, slanted
    lines, dark or coloured shapes, pictures) as boxes of ink, in the reading
    frame. A box with ink in it holds a picture or a chart, not a blank."""
    horizontal: list[Segment] = []
    vertical: list[Segment] = []
    shades: list[Shade] = []
    ink: list[Box] = []
    m = frame.to_read

    def add_ink(r) -> None:
        x0, y0, x1, y1 = r
        ink.append(m.box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))

    def add_line(p, q, width: float) -> None:
        (px, py), (qx, qy) = m.point(p[0], p[1]), m.point(q[0], q[1])
        if abs(py - qy) <= 0.6 and abs(px - qx) >= 2:
            horizontal.append(Segment((py + qy) / 2, min(px, qx), max(px, qx), width))
        elif abs(px - qx) <= 0.6 and abs(py - qy) >= 2:
            vertical.append(Segment((px + qx) / 2, min(py, qy), max(py, qy), width))

    def add_rect(r: Box, width: float) -> None:
        add_line((r.x0, r.y0), (r.x1, r.y0), width)
        add_line((r.x0, r.y1), (r.x1, r.y1), width)
        add_line((r.x0, r.y0), (r.x0, r.y1), width)
        add_line((r.x1, r.y0), (r.x1, r.y1), width)

    def add_filled(r: Box, fill) -> None:
        """A filled rectangle with no outline: a thin one is a line (Word
        draws underlines and table borders so), a pale one a shaded area."""
        t = m.box(r.x0, r.y0, r.x1, r.y1)
        if t.height <= 3 and t.width >= 6:
            horizontal.append(Segment(t.cy, t.x0, t.x1, t.height))
        elif t.width <= 3 and t.height >= 6:
            vertical.append(Segment(t.cx, t.y0, t.y1, t.width))
        elif _light(fill):
            shades.append(Shade(t, tuple(fill)))
        else:
            ink.append(t)

    for path in page.get_cdrawings():
        kind = path.get("type") or ""
        stroked = "s" in kind and _visible(path.get("color"))
        filled = "f" in kind and _visible(path.get("fill"))
        width = float(path.get("width") or 1.0) if stroked else 0.0
        items = path.get("items") or []
        if not (stroked or filled):
            continue
        if any(item[0] == "c" for item in items):
            rounded = _rounded_box(items, path.get("rect"))
            if rounded is not None:
                if stroked:
                    add_rect(rounded, width)
                else:
                    add_filled(rounded, path.get("fill"))
                continue
            # Curves are ink (a circle, a logo, a chart's line); the straight
            # pieces of the same path are still read below as rules.
            for item in items:
                if item[0] == "c":
                    xs, ys = [pt[0] for pt in item[1:5]], [pt[1] for pt in item[1:5]]
                    add_ink((min(xs), min(ys), max(xs), max(ys)))
        if filled and not stroked and items and all(item[0] == "l" for item in items):
            # A filled polygon of lines, as a rectangle drawn through a turned
            # matrix can come back: a rectangle if its corners lie on its box.
            polygon = _axis_rectangle(items, path.get("rect"))
            if polygon is not None:
                add_filled(polygon, path.get("fill"))
            elif path.get("rect") is not None:
                add_ink(path["rect"])
            continue
        for item in items:
            op = item[0]
            if op == "l" and stroked:
                p, q = item[1], item[2]
                if abs(p[0] - q[0]) > 0.6 and abs(p[1] - q[1]) > 0.6:
                    add_ink((p[0], p[1], q[0], q[1]))  # a slanted line
                else:
                    add_line(p, q, width)
            elif op in ("re", "qu"):
                if op == "qu":
                    quad = fitz.Quad(item[1])
                    if not (quad.is_rectangular and _square_to_axes(quad.ul, quad.ur)):
                        add_ink(tuple(quad.rect))
                        continue
                    r = _box(quad.rect)
                else:
                    r = _box(item[1])
                if stroked:
                    add_rect(r, width)
                elif filled:
                    add_filled(r, path.get("fill"))
    try:
        for info in page.get_image_info():
            add_ink(info["bbox"])
    except Exception:  # noqa: BLE001 - pictures that cannot be listed are not looked for
        pass
    return _merge(horizontal), _merge(vertical), shades, ink


def _axis_rectangle(items, rect) -> Box | None:
    """The box of a closed path of lines that runs along the sides of its
    bounding box, or None."""
    if rect is None or not 3 <= len(items) <= 5:
        return None
    r = _box(rect)
    for item in items:
        p, q = fitz.Point(item[1]), fitz.Point(item[2])
        for point in (p, q):
            if min(abs(point.x - r.x0), abs(point.x - r.x1)) > 0.5 or min(abs(point.y - r.y0), abs(point.y - r.y1)) > 0.5:
                return None
        if not _square_to_axes(p, q):
            return None
    return r


def _square_to_axes(p: fitz.Point, q: fitz.Point) -> bool:
    """Whether the side from p to q runs along an axis (a quad turned by a
    quarter turn is still a box; one turned by 30° is not)."""
    return abs(p.x - q.x) <= 0.5 or abs(p.y - q.y) <= 0.5


def _rounded_box(items, rect) -> Box | None:
    """A rectangle with rounded corners: straight sides along its box, joined
    by curves."""
    if rect is None:
        return None
    r = _box(rect)
    if r.width < 5 or r.height < 5:
        return None
    sides = {"top": 0.0, "bottom": 0.0, "left": 0.0, "right": 0.0}
    for item in items:
        if item[0] == "c":
            continue
        if item[0] != "l":
            return None
        p, q = fitz.Point(item[1]), fitz.Point(item[2])
        if abs(p.y - q.y) <= 0.6 and abs(p.y - r.y0) <= 1:
            sides["top"] += abs(p.x - q.x)
        elif abs(p.y - q.y) <= 0.6 and abs(p.y - r.y1) <= 1:
            sides["bottom"] += abs(p.x - q.x)
        elif abs(p.x - q.x) <= 0.6 and abs(p.x - r.x0) <= 1:
            sides["left"] += abs(p.y - q.y)
        elif abs(p.x - q.x) <= 0.6 and abs(p.x - r.x1) <= 1:
            sides["right"] += abs(p.y - q.y)
        else:
            return None
    if (sides["top"] >= 0.3 * r.width and sides["bottom"] >= 0.3 * r.width
            and sides["left"] >= 0.2 * r.height and sides["right"] >= 0.2 * r.height):
        return r
    return None


def _merge(segments: list[Segment]) -> list[Segment]:
    """Join pieces of the same line: same position, touching or overlapping."""
    segments = sorted(segments, key=lambda s: (round(s.pos, 1), s.a))
    out: list[Segment] = []
    for s in sorted(segments, key=lambda s: s.pos):
        for o in reversed(out[-40:]):
            if abs(o.pos - s.pos) <= 0.8 and s.a <= o.b + 1.5 and o.a <= s.b + 1.5:
                o.a, o.b = min(o.a, s.a), max(o.b, s.b)
                o.width = max(o.width, s.width)
                break
        else:
            out.append(Segment(s.pos, s.a, s.b, s.width))
    return out


# ── Cells: the rectangles ruled lines enclose ────────────────────────────────

@dataclass
class Cell:
    box: Box
    table: int
    stroke: float
    tokens: list[Token] = field(default_factory=list)
    date_hint: bool = False   # its only text is a date's pattern, "DD/MM/YYYY"
    kind: str | None = None   # what kind of blank it is (PageReader.plan_tables)


def _cluster(values: list[float], tolerance: float = 1.0) -> list[float]:
    out: list[float] = []
    for v in sorted(values):
        if out and v - out[-1] <= tolerance:
            continue
        out.append(v)
    return out


def _covered(intervals: list[tuple[float, float]], a: float, b: float, tolerance: float = 1.5) -> bool:
    for x0, x1 in intervals:
        if x0 <= a + tolerance and x1 >= b - tolerance:
            return True
    return False


def _cells(horizontal: list[Segment], vertical: list[Segment]) -> list[Cell] | None:
    """The smallest rectangles enclosed by the ruled lines, from a lattice of
    each connected group of lines; None when there are too many to read."""
    if len(horizontal) + len(vertical) > MAX_SEGMENTS:
        return None
    # Connected groups of horizontal and vertical segments that touch.
    parent = list(range(len(horizontal) + len(vertical)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    by_x = sorted(range(len(vertical)), key=lambda k: vertical[k].pos)
    xs = [vertical[k].pos for k in by_x]
    for i, h in enumerate(horizontal):
        lo = bisect.bisect_left(xs, h.a - 2)
        hi = bisect.bisect_right(xs, h.b + 2)
        for k in by_x[lo:hi]:
            v = vertical[k]
            if v.a - 2 <= h.pos <= v.b + 2:
                a, b = find(i), find(len(horizontal) + k)
                if a != b:
                    parent[a] = b
    groups: dict[int, tuple[list[Segment], list[Segment]]] = {}
    for i, h in enumerate(horizontal):
        groups.setdefault(find(i), ([], []))[0].append(h)
    for k, v in enumerate(vertical):
        groups.setdefault(find(len(horizontal) + k), ([], []))[1].append(v)

    cells: list[Cell] = []
    table = 0
    for hs, vs in groups.values():
        if len(hs) < 2 or len(vs) < 2:
            continue
        table += 1
        ys = _cluster([h.pos for h in hs])
        xs_ = _cluster([v.pos for v in vs])
        if (len(ys) - 1) * (len(xs_) - 1) > MAX_LATTICE_CELLS:
            return None
        rows: dict[int, list[tuple[float, float]]] = {}
        for h in hs:
            rows.setdefault(_nearest(ys, h.pos), []).append((h.a, h.b))
        cols: dict[int, list[tuple[float, float]]] = {}
        for v in vs:
            cols.setdefault(_nearest(xs_, v.pos), []).append((v.a, v.b))
        stroke = max([s.width for s in hs + vs] or [0.75])
        cells += _lattice_cells(xs_, ys, rows, cols, table, stroke)
        for s in hs + vs:
            s.edge = True
    return cells


def _nearest(values: list[float], v: float) -> int:
    return min(range(len(values)), key=lambda i: abs(values[i] - v))


def _lattice_cells(xs, ys, rows, cols, table: int, stroke: float) -> list[Cell]:
    nx, ny = len(xs) - 1, len(ys) - 1

    def h_edge(i: int, j: int) -> bool:   # the horizontal edge at ys[i] over column j
        return _covered(rows.get(i, []), xs[j], xs[j + 1])

    def v_edge(i: int, j: int) -> bool:   # the vertical edge at xs[j] over row i
        return _covered(cols.get(j, []), ys[i], ys[i + 1])

    parent = list(range(nx * ny))

    def find(k: int) -> int:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for i in range(ny):
        for j in range(nx):
            k = i * nx + j
            if j + 1 < nx and not v_edge(i, j + 1):
                a, b = find(k), find(k + 1)
                if a != b:
                    parent[a] = b
            if i + 1 < ny and not h_edge(i + 1, j):
                a, b = find(k), find(k + nx)
                if a != b:
                    parent[a] = b
    regions: dict[int, list[tuple[int, int]]] = {}
    for i in range(ny):
        for j in range(nx):
            regions.setdefault(find(i * nx + j), []).append((i, j))
    cells: list[Cell] = []
    for members in regions.values():
        i0, i1 = min(m[0] for m in members), max(m[0] for m in members)
        j0, j1 = min(m[1] for m in members), max(m[1] for m in members)
        if len(members) != (i1 - i0 + 1) * (j1 - j0 + 1):
            continue  # not a rectangle
        closed = (all(h_edge(i0, j) and h_edge(i1 + 1, j) for j in range(j0, j1 + 1))
                  and all(v_edge(i, j0) and v_edge(i, j1 + 1) for i in range(i0, i1 + 1)))
        if closed:
            cells.append(Cell(Box(xs[j0], ys[i0], xs[j1 + 1], ys[i1 + 1]), table, stroke))
    return cells


# ── Candidates ───────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    box: Box            # reading frame
    type: str
    label: str
    confidence: float
    multiline: bool = False
    name_prefix: str = ""   # a checkbox's question, before its option


def writing_height(size: float) -> float:
    """How tall a field on a line is: room to write at the label's size."""
    return min(22.0, max(14.0, 1.6 * size))


def _kind(label: str, default: str = "text") -> str:
    if label.strip() in SIGN_MARK:
        return "signature"
    date, signature = DATE_WORDS.search(label), SIGNATURE_WORDS.search(label)
    if date and signature:
        return "date" if date.start() < signature.start() else "signature"
    if signature:
        return "signature"
    if date:
        return "date"
    return default


def _ends_like_label(text: str) -> bool:
    return text.rstrip().endswith((":", "?", "："))


def _words(text: str) -> int:
    return len(re.findall(r"\w+", text))


class Rows:
    """Things filed by the bands of height they cover, so that a search near
    one height reads only what lies near it. Without it a page of thousands
    of blanks and words compared every blank with every word."""

    STEP = 16.0

    def __init__(self, items, extent, height: float):
        self.extent = extent
        self.low, self.high = -4 * self.STEP, height + 4 * self.STEP
        self.bands: dict[int, list] = {}
        for item in items:
            self.add(item)

    def _span(self, y0: float, y1: float) -> range:
        # Clamped to the page: a file can place things at any height.
        y0, y1 = max(self.low, min(y0, self.high)), max(self.low, min(y1, self.high))
        return range(int(y0 // self.STEP), int(y1 // self.STEP) + 1)

    def add(self, item) -> None:
        y0, y1 = self.extent(item)
        for band in self._span(y0, y1):
            self.bands.setdefault(band, []).append(item)

    def near(self, y0: float, y1: float) -> list:
        seen: set[int] = set()
        out = []
        for band in self._span(y0, y1):
            for item in self.bands.get(band, ()):
                if id(item) not in seen:
                    seen.add(id(item))
                    out.append(item)
        return out


class PageReader:
    """Finds the blanks on one page."""

    def __init__(self, frame: Frame, tokens: list[Token], horizontal: list[Segment],
                 vertical: list[Segment], shades: list[Shade], cells: list[Cell], ink: list[Box] | None = None):
        self.frame = frame
        height = frame.height
        self.ink = Rows(ink or [], lambda b: (b.y0, b.y1), height)
        self.tokens = Rows(tokens, lambda t: (min(t.box.y0, t.baseline), max(t.box.y1, t.baseline)), height)
        self.all_tokens = tokens
        self.horizontal = horizontal
        self.horizontal_rows = Rows(horizontal, lambda s: (s.pos, s.pos), height)
        self.vertical = Rows(vertical, lambda s: (s.a, s.b), height)
        self.shades = shades
        self.cells = cells
        self.cell_rows = Rows(cells, lambda c: (c.box.y0, c.box.y1), height)
        self.found: list[Candidate] = []
        self.ticks: list[Box] = []
        self.tick_rows = Rows([], lambda t: (t.y0, t.y1), height)

    def near(self, y0: float, y1: float, kind: str | None = None) -> list[Token]:
        tokens = self.tokens.near(y0, y1)
        return tokens if kind is None else [t for t in tokens if t.kind == kind]

    # ── finding labels ───────────────────────────────────────────────────
    def label_left_of(self, x: float, top: float, bottom: float, *, gap: float = 160,
                      baseline: tuple[float, float] | None = None) -> Token | None:
        """The nearest phrase ending left of x on the same line: its baseline
        in `baseline`, or its middle between top and bottom."""
        best, best_x = None, None
        span = baseline if baseline is not None else (top, bottom)
        for t in self.near(span[0] - 20, span[1] + 20):
            if t.box.x1 > x + 2 or x - t.box.x1 > gap:
                continue
            if baseline is not None:
                if not baseline[0] <= t.baseline <= baseline[1]:
                    continue
            elif not top <= t.box.cy <= bottom:
                continue
            if best_x is None or t.box.x1 > best_x:
                best, best_x = t, t.box.x1
        if best is None or best.kind != "phrase":
            return None
        if self._walled(best.box.x1, x, best.box.cy):
            return None  # a ruled line or another box stands between them
        return best

    def _walled(self, x0: float, x1: float, y: float) -> bool:
        """Whether a vertical rule, a cell or a checkbox lies across the row
        at height y between x0 and x1."""
        if any(x0 + 1 < s.pos < x1 - 1 and s.a <= y <= s.b for s in self.vertical.near(y, y)):
            return True
        return any(c.box.x0 >= x0 - 1 and c.box.x1 <= x1 + 1 and c.box.y0 <= y <= c.box.y1
                   for c in self.cell_rows.near(y, y)) \
            or any(t.x0 >= x0 - 1 and t.x1 <= x1 + 1 and t.y0 - 2 <= y <= t.y1 + 2 for t in self.tick_rows.near(y, y))

    def label_over_line(self, x0: float, x1: float, y: float) -> Token | None:
        """The nearest phrase above a line, starting near its left end, with
        nothing between them: the question an answer line answers."""
        best = None
        for t in self.near(y - 40, y, "phrase"):
            if t.box.y1 > y - 4 or t.box.y1 < y - 40:
                continue
            if not (x0 - 12 <= t.box.x0 <= x0 + 0.5 * (x1 - x0)):
                continue
            if best is None or t.box.y1 > best.box.y1:
                best = t
        if best is None:
            return None
        if self.blocked(Box(x0 + 1, best.box.y1 + 0.5, x1 - 1, y - 0.6), ignore=(best,)):
            return None
        if any(s.a < x1 - 1 and s.b > x0 + 1 and best.box.y1 < s.pos < y - 0.6
               for s in self.horizontal_rows.near(best.box.y1, y)):
            return None
        return best

    def label_right_of(self, x: float, top: float, bottom: float, gap: float = 30) -> Token | None:
        best = None
        for t in self.near(top, bottom):
            if t.box.x0 < x - 1 or t.box.x0 - x > gap or not top <= t.box.cy <= bottom:
                continue
            if best is None or t.box.x0 < best.box.x0:
                best = t
        return best if best is not None and best.kind == "phrase" else None

    def label_above(self, box: Box, reach: float = 16) -> Token | None:
        """A short phrase just above the box, starting near its left edge."""
        best = None
        for t in self.near(box.y0 - reach, box.y0 + 1, "phrase"):
            if not (box.y0 - reach <= t.box.y1 <= box.y0 + 1):
                continue
            if not (box.x0 - 12 <= t.box.x0 <= box.x0 + 0.5 * box.width) or t.box.x0 > box.x1:
                continue
            if best is None or t.box.y1 > best.box.y1:
                best = t
        return best

    def text_in(self, box: Box) -> list[Token]:
        return [t for t in self.near(box.y0, box.y1) if box.contains_point(t.box.cx, t.box.cy)]

    def inked(self, box: Box) -> bool:
        """Whether a picture or a shape that is not a rule lies in the box: a
        framed picture or chart is not a blank to write in. Ink counts when
        most of it lies in the box, or when it covers part of the box and is
        not much larger: a picture behind the whole page (a letterhead, a
        faint emblem) is not in any one box."""
        area = max(box.area, 0.01)
        for b in self.ink.near(box.y0, box.y1):
            shared = b.overlap(box)
            if shared <= 0:
                continue
            if shared >= 0.5 * max(b.area, 0.01) or (shared >= 0.2 * area and b.area <= 4 * area):
                return True
        return False

    def blocked(self, box: Box, *, ignore: tuple = ()) -> bool:
        """Whether text lies in the box (where a person would write)."""
        for t in self.near(box.y0, box.y1):
            if t in ignore:
                continue
            o = t.box.overlap(box)
            if o > 0 and o >= 0.25 * max(t.box.area, 0.01):
                return True
        return False

    def room_above(self, x0: float, x1: float, y: float, want: float, *, ignore: tuple = ()) -> float:
        """How tall a strip above y, from x0 to x1, can be before it meets
        text or a line drawn above it."""
        limit = y - want
        for t in self.near(y - want, y):
            if t in ignore or t.box.x1 <= x0 + 1 or t.box.x0 >= x1 - 1:
                continue
            if limit < t.box.y1 < y - 0.5:
                limit = t.box.y1
        for s in self.horizontal_rows.near(y - want, y):
            if s.b <= x0 + 1 or s.a >= x1 - 1:
                continue
            if limit < s.pos < y - 0.5:
                limit = s.pos + s.width / 2
        return y - limit

    # ── blanks on lines ──────────────────────────────────────────────────
    def lines(self) -> None:
        """Underlined blanks: drawn lines and bars that are not the sides of a
        box, typed underscores and dot leaders."""
        lines: list[tuple[float, float, float, Token | None]] = []   # x0, x1, y, token
        for s in self.horizontal:
            if s.edge or s.width > 3 or s.b - s.a < 24 or s.b - s.a > 0.98 * self.frame.width:
                continue
            lines.append((s.a, s.b, s.pos - s.width / 2, None))
        for t in self.all_tokens:
            if t.kind == "underscores" and t.box.width >= 14:
                lines.append((t.box.x0, t.box.x1, t.box.y1, t))
            elif t.kind == "dots" and t.box.width >= 20:
                lines.append((t.box.x0, t.box.x1, t.box.y1, t))
        lines.sort(key=lambda line: (line[2], line[0]))
        claimed: set[int] = set()
        for index in range(len(lines)):
            if index in claimed:
                continue
            candidate = self._line(index, lines, claimed)
            if candidate is not None:
                self.found.append(candidate)

    def _line(self, index: int, lines: list, claimed: set[int]) -> Candidate | None:
        x0, x1, y, token = lines[index]
        ignore = (token,) if token is not None else ()
        if self.blocked(Box(x0 + 1, y - 8, x1 - 1, y - 0.6), ignore=ignore):
            if token is None:
                return self._label_on_line(x0, x1, y)
            return None  # text on the line: underlined text, or a table's rule
        if token is not None and token.kind == "dots":
            after = self._next_on_line(token)
            if after is not None and (PAGE_NUMBER.match(after.text) or AMOUNT.match(after.text)):
                return None  # a table of contents, or a leader to an amount
        size = 10.5
        if token is not None:
            label = self.label_left_of(x0, 0, 0, baseline=(token.baseline - 0.35 * token.size,
                                                           token.baseline + 0.35 * token.size))
        else:
            label = self.label_left_of(x0, 0, 0, baseline=(y - 13, y + 3))
            if label is not None and not (y - 0.75 * label.size <= label.baseline <= y + 3):
                label = None
        confidence = 0.0
        where = None
        if label is not None:
            where, size = "left", label.size
            confidence = 0.85 + (0.05 if _ends_like_label(label.text) else 0.0)
            if x0 - label.box.x1 > 60:
                confidence -= 0.1
            if label.size > 13 and label.text.strip() not in SIGN_MARK:  # a heading, not a label
                confidence -= 0.25
            if _words(label.text) > 8:
                confidence -= 0.25
        else:
            label = self._caption_under(x0, x1, y)
            if label is not None:
                where, size, confidence = "under", 10.5, 0.8
        stacked: list[int] = []
        if token is None and where != "under":
            stacked = self._stacked_below(index, lines, claimed)
        if label is None:
            above = self.label_over_line(x0, x1, y)
            # A question over an answer line ends with ":" or "?", or names a
            # field in plain text; a heading over a rule names one in bold or
            # large type ("Patient Information").
            if above is not None and _words(above.text) <= 10 and (
                    _ends_like_label(above.text)
                    or (FIELD_WORDS.search(above.text) and not above.bold and above.size <= 12.5)):
                label, where, size = above, "above", above.size
                confidence = 0.8 if stacked else 0.7
        if label is None:
            return None
        height = writing_height(size)
        room = self.room_above(x0, x1, y, height, ignore=ignore + ((label,) if where == "above" else ()))
        if where == "above":
            room = min(room, y - label.box.y1 - 1)
        height = min(height, room)
        if height < 9:
            return None
        bottom = y
        if stacked:
            claimed.update(stacked)
            bottom = lines[stacked[-1]][2]
        return Candidate(Box(x0, y - height, x1, bottom), _kind(label.text), label.text, round(confidence, 2),
                         multiline=bool(stacked))

    def _label_on_line(self, x0: float, x1: float, y: float) -> Candidate | None:
        """A label written on its own line at the left end ("Name" sitting on
        the start of the line): the rest of the line is the blank. A heading
        over a rule looks the same, so the label must be plain text no larger
        than body text, and end with a colon, name a field, or be small."""
        strip = Box(x0 + 1, y - 8, x1 - 1, y - 0.6)
        on = [t for t in self.near(strip.y0, strip.y1) if t.box.overlap(strip) > 0]
        if len(on) != 1 or on[0].kind != "phrase":
            return None
        label = on[0]
        if not (x0 - 2 <= label.box.x0 <= x0 + 20) or label.box.x1 > x0 + 0.6 * (x1 - x0):
            return None
        if label.bold or label.size > 11.5 or label.baseline > y + 1 or y - label.baseline > 4:
            return None
        if not (_ends_like_label(label.text) or FIELD_WORDS.search(label.text) or label.size <= 9):
            return None
        start = label.box.x1 + 4
        height = min(writing_height(label.size), self.room_above(start, x1, y, writing_height(label.size)))
        if x1 - start < 30 or height < 9:
            return None
        return Candidate(Box(start, y - height, x1, y), _kind(label.text), label.text, 0.75)

    def _next_on_line(self, token: Token) -> Token | None:
        best = None
        for t in self.near(token.baseline - token.size, token.baseline + token.size):
            if t is token or t.box.x0 < token.box.x1 - 1 or abs(t.baseline - token.baseline) > 0.35 * token.size:
                continue
            if best is None or t.box.x0 < best.box.x0:
                best = t
        return best

    def _caption_under(self, x0: float, x1: float, y: float) -> Token | None:
        """One short caption just under the line that names a field
        ("Signature of applicant", "Date"); several pieces of text under it
        are a table's row, and a person's name is not a field's label."""
        under = [t for t in self.near(y, y + 16) if y + 1 <= t.box.y0 <= y + 16 and t.box.x1 > x0 and t.box.x0 < x1]
        if len(under) != 1 or under[0].kind != "phrase":
            return None
        caption = under[0]
        if caption.box.x0 < x0 - 10 or caption.box.x1 > x1 + 10:
            return None
        if _words(caption.text) > 6 or caption.text.endswith(".") or not FIELD_WORDS.search(caption.text):
            return None
        if x1 - x0 > 0.7 * self.frame.width:
            return None
        return caption

    def _stacked_below(self, index: int, lines: list, claimed: set[int]) -> list[int]:
        """Lines under this one, at the same width and an even spacing, with
        nothing between them and no label of their own: one answer."""
        x0, x1, y, _ = lines[index]
        out: list[int] = []
        previous_y, step = y, None
        for k in range(index + 1, len(lines)):
            a, b, ly, token = lines[k]
            if ly - previous_y > 40:
                break
            if token is not None or k in claimed or abs(a - x0) > 3 or abs(b - x1) > 3:
                continue
            gap = ly - previous_y
            if gap < 12 or (step is not None and abs(gap - step) > 3):
                break
            if self.blocked(Box(x0 + 1, previous_y + 0.5, x1 - 1, ly - 0.5)):
                break
            if self.label_left_of(a, 0, 0, baseline=(ly - 13, ly + 3)) is not None:
                break
            out.append(k)
            previous_y, step = ly, gap
        return out

    # ── boxes and cells ──────────────────────────────────────────────────
    def plan_tables(self) -> list[tuple[list[Cell], list[list[Cell]]]]:
        """Which cells are blanks, table by table: every cell's kind, the rows
        of character boxes, and the small empty cells, which are checkboxes.
        A table with few blanks among many cells holds data, not blanks."""
        for cell in self.cells:
            cell.tokens = self.text_in(cell.box.inset(0.5))
            cell.kind = self._blank_kind(cell)
        tables: dict[int, list[Cell]] = {}
        for cell in self.cells:
            tables.setdefault(cell.table, []).append(cell)
        plans = []
        for cells in tables.values():
            blanks = [c for c in cells if c.kind is not None]
            if len(cells) > 1 and len(blanks) < 0.25 * len(cells):
                continue  # a table of data with a few empty cells
            small = [c for c in cells if c.kind == "empty" and 5.5 <= c.box.width <= 24
                     and 5.5 <= c.box.height <= 24 and 0.7 <= c.box.width / c.box.height <= 1.43]
            combs = self._combs(small)
            in_comb = {id(c) for comb in combs for c in comb}
            for c in small:
                if id(c) in in_comb:
                    c.kind = "comb"
                else:
                    c.kind = "tick"
                    self.ticks.append(c.box.inset(c.stroke / 2 + 0.5))
            plans.append((cells, combs))
        return plans

    def _blank_kind(self, cell: Cell) -> str | None:
        """What kind of blank a cell is, if it is one."""
        b = cell.box
        if b.width < 5 or b.height < 5 or self.inked(b.inset(cell.stroke + 1)):
            return None
        if not [t for t in cell.tokens if re.search(r"\w", t.text) or t.kind == "box"]:
            return "empty"
        if all(t.kind == "phrase" and DATE_HINT.match(t.text) for t in cell.tokens):
            cell.date_hint = True
            return "empty"
        phrases = [t for t in cell.tokens if t.kind == "phrase"]
        if len(phrases) != len(cell.tokens) or not phrases:
            return None
        bottom = max(t.box.y1 for t in phrases)
        if (bottom <= b.y0 + 0.55 * b.height and b.y1 - bottom >= 12
                and sum(_words(t.text) for t in phrases) <= 8):
            return "caption"
        right = max(t.box.x1 for t in phrases)
        if (len(phrases) == 1 and _ends_like_label(phrases[0].text) and right <= b.x0 + 0.5 * b.width
                and b.x1 - right >= 40):
            return "label-left"
        return None

    def label_table(self, cells: list[Cell], combs: list[list[Cell]]) -> None:
        page_area = self.frame.width * self.frame.height
        columns: dict[tuple[int, int], list[Cell]] = {}
        for c in cells:
            columns.setdefault((round(c.box.x0), round(c.box.x1)), []).append(c)
        for comb in combs:
            box = Box(comb[0].box.x0, min(c.box.y0 for c in comb), comb[-1].box.x1, max(c.box.y1 for c in comb))
            label = self._box_label(box, cells, columns)
            confidence = 0.8 if label else 0.55
            inner = box.inset(comb[0].stroke / 2 + 0.5)
            self.found.append(Candidate(inner, _kind(label or ""), label or "", confidence))
        for cell in cells:
            b = cell.box
            inner = b.inset(cell.stroke / 2 + 0.5)
            if cell.kind == "empty":
                if b.height < 8 or b.width < 20 or b.area > 0.35 * page_area:
                    continue
                label = self._box_label(b, cells, columns)
                confidence = 0.85 if label else 0.45
                kind = "date" if cell.date_hint else _kind(label or "")
                self.found.append(Candidate(inner, kind, label or "", confidence, multiline=b.height >= 34))
            elif cell.kind == "caption":
                caption = " ".join(t.text for t in sorted(cell.tokens, key=lambda t: (t.box.y0, t.box.x0)))
                top = max(t.box.y1 for t in cell.tokens) + 1
                box = Box(inner.x0, top, inner.x1, inner.y1)
                self.found.append(Candidate(box, _kind(caption), caption, 0.85, multiline=box.height >= 34))
            elif cell.kind == "label-left":
                label = cell.tokens[0]
                box = Box(label.box.x1 + 4, inner.y0, inner.x1, inner.y1)
                self.found.append(Candidate(box, _kind(label.text), label.text, 0.8, multiline=box.height >= 34))

    def _combs(self, small: list[Cell]) -> list[list[Cell]]:
        """Rows of three or more touching boxes of one size: one character each."""
        rows: dict[tuple[int, int], list[Cell]] = {}
        for c in small:
            rows.setdefault((round(c.box.y0), round(c.box.y1)), []).append(c)
        combs: list[list[Cell]] = []
        for row in rows.values():
            row.sort(key=lambda c: c.box.x0)
            run = [row[0]]
            for c in row[1:]:
                if c.box.x0 - run[-1].box.x1 <= 1.5 and abs(c.box.width - run[-1].box.width) <= 0.25 * c.box.width:
                    run.append(c)
                    continue
                if len(run) >= 3:
                    combs.append(run)
                run = [c]
            if len(run) >= 3:
                combs.append(run)
        return combs

    def _box_label(self, box: Box, cells: list[Cell], columns: dict | None = None) -> str:
        """The label of an empty box: in a table, the heading of its row (the
        nearest cell to its left with text, past other blanks) and of its
        column; else text beside or above it."""
        left = self._row_heading(box, cells) if cells else ""
        above = self._column_heading(box, columns or {}) if cells else ""
        if left and above:
            return f"{left} {above}"
        if left or above:
            return left or above
        token = self.label_left_of(box.x0, box.y0, box.y1, gap=220)
        if token is not None and _words(token.text) <= 10:
            return token.text
        token = self.label_above(box)
        if token is not None and _words(token.text) <= 10:
            return token.text
        return ""

    def _row_heading(self, box: Box, cells: list[Cell]) -> str:
        table = cells[0].table
        row = [c for c in self.cell_rows.near(box.y0, box.y1) if c.table == table and c.box.x1 <= box.x0 + 1.5
               and min(c.box.y1, box.y1) - max(c.box.y0, box.y0) >= 0.6 * min(c.box.height, box.height)]
        for c in sorted(row, key=lambda c: -c.box.x1):
            if c.kind in ("empty", "tick", "comb"):
                continue  # another blank in the same row
            phrases = [t for t in c.tokens if t.kind == "phrase"]
            if c.kind is None and phrases:
                return " ".join(t.text for t in sorted(phrases, key=lambda t: (t.box.y0, t.box.x0)))
            return ""
        return ""

    def _column_heading(self, box: Box, columns: dict) -> str:
        """The text of the top cell of this box's column, when that cell is a
        heading (text) and every cell between is a blank."""
        column = [c for c in columns.get((round(box.x0), round(box.x1)), ()) if c.box.y1 <= box.y0 + 1]
        if not column:
            return ""
        top = min(column, key=lambda c: c.box.y0)
        phrases = [t for t in top.tokens if t.kind == "phrase"]
        if not phrases or top.kind is not None:
            return ""
        if any(c.kind not in ("empty", "tick", "comb") for c in column if c is not top):
            return ""
        return " ".join(t.text for t in phrases)

    def shaded(self) -> None:
        """Pale areas without an outline, sized for writing in."""
        page_area = self.frame.width * self.frame.height
        for shade in self.shades:
            b = shade.box
            if b.height < 12 or b.height > 220 or b.width < 40 or b.area > 0.35 * page_area:
                continue
            if self.text_in(b) or self.inked(b) \
                    or any(c.box.overlap(b) > 0.2 * b.area for c in self.cell_rows.near(b.y0, b.y1)):
                continue
            # A label beside it, or one above it that reads as a label: the
            # row above an empty stripe of a striped table is not its label.
            token = self.label_left_of(b.x0, b.y0, b.y1, gap=220)
            label = token.text if token is not None and _words(token.text) <= 10 else ""
            if not label:
                above = self.label_above(b)
                if above is not None and _words(above.text) <= 10 and (
                        _ends_like_label(above.text) or FIELD_WORDS.search(above.text)):
                    label = above.text
            if not label:
                continue
            self.found.append(Candidate(b.inset(1), _kind(label), label, 0.75, multiline=b.height >= 34))

    # ── checkboxes ───────────────────────────────────────────────────────
    def tick_boxes(self) -> None:
        """The box characters: their ink, made square."""
        for t in self.all_tokens:
            if t.kind == "box":
                box = t.box
                if box.cy > t.baseline:
                    # A box character stands on its baseline. MuPDF gives the
                    # ZapfDingbats boxes of upside-down text unflipped, hanging
                    # below it: mirror them back.
                    box = Box(box.x0, 2 * t.baseline - box.y1, box.x1, 2 * t.baseline - box.y0)
                side = max(box.width, box.height)
                self.ticks.append(Box(box.cx - side / 2, box.cy - side / 2, box.cx + side / 2, box.cy + side / 2))

    def _checkbox(self, square: Box) -> None:
        top, bottom = square.y0 - 2, square.y1 + 2
        option = self.label_right_of(square.x1, top, bottom)
        if option is not None and any(square.x1 - 0.5 <= t.cx <= option.box.x0 and top <= t.cy <= bottom
                                      for t in self.tick_rows.near(top, bottom) if t is not square):
            option = None  # the text right of the next box is that box's
        question = None
        if option is not None:
            question = self._question(square, top, bottom)
        else:
            option = self.label_left_of(square.x0, top, bottom, gap=30)
        label = option.text if option is not None else ""
        prefix = question if question and label and _words(label) <= 3 else ""
        confidence = 0.9 if option is not None else 0.6
        self.found.append(Candidate(square, "checkbox", label or (question or ""), confidence,
                                    name_prefix=prefix))

    def _question(self, square: Box, top: float, bottom: float) -> str | None:
        """The question a row of checkboxes answers: the phrase before the
        first box of the row (each box's option sits after it), when it ends
        with "?" or ":"."""
        ticks = self.tick_rows.near(top, bottom)
        phrases = self.near(top, bottom, "phrase")
        x = square.x0
        for _ in range(100):
            tick = max((t for t in ticks if t.x1 <= x + 0.5 and x - t.x1 <= 40 and top <= t.cy <= bottom),
                       key=lambda t: t.x1, default=None)
            phrase = max((t for t in phrases
                          if t.box.x1 <= x + 1 and x - t.box.x1 <= 0.5 * self.frame.width and top <= t.box.cy <= bottom),
                         key=lambda t: t.box.x1, default=None)
            if tick is not None and (phrase is None or tick.x1 >= phrase.box.x1):
                x = tick.x0
                continue
            if phrase is None:
                return None
            before = max((t for t in ticks
                          if t.x1 <= phrase.box.x0 + 1 and phrase.box.x0 - t.x1 <= 30 and top <= t.cy <= bottom),
                         key=lambda t: t.x1, default=None)
            if before is not None:
                x = before.x0  # an earlier option's label
                continue
            return phrase.text if _ends_like_label(phrase.text) else None
        return None

    # ── all of it ────────────────────────────────────────────────────────
    def read(self) -> list[Candidate]:
        self.tick_boxes()
        plans = self.plan_tables()
        for tick in self.ticks:
            self.tick_rows.add(tick)
        for cells, combs in plans:
            self.label_table(cells, combs)
        for square in self.ticks:
            self._checkbox(square)
        self.lines()
        self.shaded()
        return self.found


# ── Names ────────────────────────────────────────────────────────────────────

_NUMBERING = re.compile(r"^\s*(?:\(?[0-9]{1,3}[.)]|\(?[a-z][.)]|q[0-9]{1,3}[.:)]?)\s+", re.I)
_PARENTHESES = re.compile(r"\([^)]*\)|\[[^\]]*\]")


def field_name(label: str, fallback: str, *, limit: int = MAX_NAME) -> str:
    """A field name from a label: "1. Date of birth (DD/MM/YYYY):" becomes
    "date_of_birth". Letters keep their script; accents on Latin letters go;
    anything else becomes an underscore, so a name never holds the dot that
    would make it part of another field's name. At most `limit` characters,
    cut at a word where one ends in its second half."""
    text = _NUMBERING.sub("", label or "")
    stripped = _PARENTHESES.sub(" ", text)
    if re.search(r"\w", stripped):
        text = stripped
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[\W_]+", "_", text).strip("_")
    if limit <= 0:
        return fallback
    if len(text) > limit:
        cut = text[:limit]
        text = (cut.rsplit("_", 1)[0] if "_" in cut[limit // 2:] else cut).strip("_")
    return text or fallback


def _unique(name: str, taken: set[str]) -> str:
    if name not in taken:
        taken.add(name)
        return name
    n = 2
    while f"{name}_{n}" in taken:
        n += 1
    taken.add(f"{name}_{n}")
    return f"{name}_{n}"


# ── The document ─────────────────────────────────────────────────────────────

def _keep(found: list[Candidate], widgets: list[Box]) -> list[Candidate]:
    """The confident candidates, without two over the same blank, and none
    over a field the PDF already has."""
    kept: list[Candidate] = []
    for c in sorted(found, key=lambda c: -c.confidence):
        if c.confidence < MIN_CONFIDENCE or c.box.width < 4 or c.box.height < 4:
            continue
        if any(_same_place(c.box, w) for w in widgets):
            continue
        if any(_same_place(c.box, k.box) for k in kept):
            continue
        kept.append(c)
    return kept


def _same_place(a: Box, b: Box) -> bool:
    o = a.overlap(b)
    if o <= 0:
        return False
    smaller = max(min(a.area, b.area), 0.01)
    return o >= 0.5 * smaller or o / (a.area + b.area - o) >= 0.3


def _is_picture(page: fitz.Page) -> bool:
    """Whether a picture covers most of the page, as a scan's does."""
    area = abs(page.rect)
    try:
        infos = page.get_image_info()
    except Exception:  # noqa: BLE001 - nothing readable to say it is a picture
        return False
    return any(abs(fitz.Rect(info["bbox"]) & page.rect) >= 0.5 * area for info in infos)


def detect(doc: fitz.Document, *, cap_cpu=None) -> dict:
    """The candidates for every page of `doc`, and what could not be read."""
    if doc.needs_pass:
        raise Refusal("password")
    pages = doc.page_count
    if pages == 0:
        raise Refusal("no_pages")
    if pages > MAX_PAGES:
        raise Refusal("too_many_pages", pages=pages, limit=MAX_PAGES)
    if cap_cpu is not None:
        cap_cpu(pages)
    taken: set[str] = set()
    existing = 0
    widgets_by_page: dict[int, list[Box]] = {}
    for number in range(pages):
        try:
            page = doc[number]
            for widget in page.widgets() or []:
                existing += 1
                if widget.field_name:
                    taken.add(str(widget.field_name))
                widgets_by_page.setdefault(number, []).append(_box(widget.rect))
        except Exception:  # noqa: BLE001 - a page whose fields cannot be read is read below
            continue
    candidates: list[dict] = []
    not_checked: list[int] = []
    complex_pages: list[int] = []
    scan_pages: list[int] = []
    for number in range(pages):
        try:
            page = doc[number]
            found, frame, crowded, words = _read_page(page, widgets_by_page.get(number, []))
        except (RuntimeError, ValueError, fitz.mupdf.FzErrorBase) as exc:
            if isinstance(exc, MemoryError) or _is_memory(exc):
                raise MemoryError() from exc
            not_checked.append(number + 1)
            continue
        if crowded:
            complex_pages.append(number + 1)
        # A scan: a picture over the page and no visible text but a stamp or a
        # page number (an OCR layer is invisible); a form printed over a
        # picture still has its labels.
        if not found and words <= 4 and _is_picture(page):
            scan_pages.append(number + 1)
        for c in sorted(found, key=lambda c: (round(c.box.y0 / 4), c.box.x0)):
            b = frame.to_page.box(c.box.x0, c.box.y0, c.box.x1, c.box.y1)
            r = fitz.Rect(b.x0, b.y0, b.x1, b.y1) & fitz.Rect(0, 0, frame.page_width, frame.page_height)
            if r.is_empty:
                continue
            name = field_name("" if c.label.strip() in SIGN_MARK else c.label, c.type)
            if c.name_prefix:
                # The question shortened before the option, so "…_yes" and "…_no" stay apart.
                question = field_name(c.name_prefix, "", limit=MAX_NAME - len(name) - 1)
                name = f"{question}_{name}" if question else name
            candidates.append({
                "page": number + 1,
                "x": round(r.x0, 2), "y": round(r.y0, 2),
                "width": round(r.width, 2), "height": round(r.height, 2),
                "type": c.type,
                "name": name,
                "label": c.label[:MAX_LABEL],
                "confidence": c.confidence,
                "multiline": c.multiline,
            })
    if len(not_checked) == pages:
        raise Refusal("unreadable")
    truncated = len(candidates) > MAX_CANDIDATES
    if truncated:
        keep = sorted(range(len(candidates)), key=lambda i: -candidates[i]["confidence"])[:MAX_CANDIDATES]
        candidates = [candidates[i] for i in sorted(keep)]
    for index, c in enumerate(candidates, start=1):
        c["id"] = f"c{index}"
        c["name"] = _unique(c["name"], taken)
    return {
        "pages": pages,
        "candidates": candidates,
        "truncated": truncated,
        "scanPages": scan_pages,
        "complexPages": complex_pages,
        "pagesNotChecked": not_checked,
        "existingFields": existing,
    }


def _read_page(page: fitz.Page, widgets: list[Box]) -> tuple[list[Candidate], Frame, bool, int]:
    """The candidates on one page, its reading frame, whether its drawings
    were too many to read (then only typed blanks and box characters are
    looked for), and how many words of visible text it has (a scan has none
    but perhaps a stamp or a page number)."""
    raw = page.get_text("rawdict", flags=TEXT_FLAGS)
    frame = _reading_frame(page, raw)
    tokens = _page_tokens(raw, frame)
    horizontal: list[Segment] = []
    vertical: list[Segment] = []
    shades: list[Shade] = []
    ink: list[Box] = []
    cells: list[Cell] = []
    crowded = drawn_operators(page, MAX_PAGE_PATH_OPERATORS) > MAX_PAGE_PATH_OPERATORS
    if not crowded:
        horizontal, vertical, shades, ink = _page_drawings(page, frame)
        found_cells = _cells(horizontal, vertical)
        if found_cells is None:
            crowded = True
            horizontal, vertical, shades, ink = [], [], [], []
        else:
            cells = found_cells
    reader = PageReader(frame, tokens, horizontal, vertical, shades, cells, ink)
    found = reader.read()
    in_frame = [frame.to_read.box(w.x0, w.y0, w.x1, w.y1) for w in widgets]
    words = sum(_words(t.text) for t in tokens if t.kind == "phrase")
    return _keep(found, in_frame), frame, crowded, words


# ── Process protocol ─────────────────────────────────────────────────────────

def _limit(kind: int, soft: int, hard: int) -> None:
    """Lower a resource limit, keeping any hard limit that is already lower."""
    _, current = resource.getrlimit(kind)
    if current != resource.RLIM_INFINITY:
        soft, hard = min(soft, current), min(hard, current)
    resource.setrlimit(kind, (soft, hard))


def _isolate(file_size: int) -> None:
    """Cap memory and CPU time, and never dump core. _pdf_markdown_worker.py has a twin."""
    if sys.platform.startswith("linux"):
        # Where the image runs. macOS does not enforce an address-space limit
        # the same way, and the caller's time limit still applies there.
        memory = MEMORY_BASE_BYTES + MEMORY_PER_FILE_BYTE * file_size
        _limit(resource.RLIMIT_AS, memory, memory)
    # SIGXCPU at the soft limit stops the process (its default action); the
    # hard limit, a little later, is SIGKILL.
    _limit(resource.RLIMIT_CPU, CPU_SECONDS_OPEN, CPU_SECONDS_MAX + CPU_GRACE)
    _limit(resource.RLIMIT_CORE, 0, 0)


def cpu_budget(pages: int) -> int:
    """CPU seconds a file of ``pages`` pages may use (the caller states it)."""
    return int(min(CPU_SECONDS_MAX, CPU_SECONDS_BASE + CPU_SECONDS_PER_PAGE * pages))


def _cap_cpu(pages: int) -> None:
    """Once the pages are counted: their budget, counted from now."""
    used = resource.getrusage(resource.RUSAGE_SELF)
    spent = int(used.ru_utime + used.ru_stime) + 1
    soft = min(spent + cpu_budget(pages), CPU_SECONDS_MAX)
    _limit(resource.RLIMIT_CPU, soft, soft + CPU_GRACE)


# The answer goes to the real standard output; anything else a library prints
# goes to standard error, which the caller discards.
_ANSWER = sys.stdout


def _emit(payload: dict, status: int = 0) -> None:
    output = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(output.encode("utf-8")) > MAX_REPORT_BYTES:
        output, status = '{"ok": false, "error": "failed"}', 3
    _ANSWER.write(output)
    _ANSWER.flush()
    raise SystemExit(status)


def _is_memory(exc: BaseException) -> bool:
    """Whether `exc` is the process running out of memory. Under its address
    space limit an allocation can fail inside PyMuPDF's C code and come back
    as a SystemError ("returned a result with an exception set") whose cause
    is the MemoryError; or as an error that names neither, when the process
    has used nearly all the memory it may."""
    seen = 0
    while exc is not None and seen < 10:
        text = str(exc).lower()
        if isinstance(exc, MemoryError) or "malloc" in text or "out of memory" in text:
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return _near_memory_limit()


def _near_memory_limit() -> bool:
    """Whether this process's peak address space has reached nine tenths of
    its limit (Linux, where the limit is set)."""
    soft, _ = resource.getrlimit(resource.RLIMIT_AS)
    if soft == resource.RLIM_INFINITY:
        return False
    try:
        with open("/proc/self/status", encoding="ascii", errors="replace") as status:
            for line in status:
                if line.startswith("VmPeak:"):
                    return int(line.split()[1]) * 1024 >= 0.9 * soft
    except (OSError, ValueError, IndexError):
        return False
    return False


def main() -> None:
    try:
        source = sys.argv[1]
        size = os.path.getsize(source)
    except (IndexError, OSError):
        _emit({"ok": False, "error": "failed"}, 2)
    _isolate(size)
    sys.stdout = sys.stderr
    fitz.set_messages(stream=sys.stderr)
    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    try:
        doc = fitz.open(source, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - MuPDF raises several kinds for a file it cannot read
        _emit({"ok": False, "error": "too_large" if _is_memory(exc) else "corrupt"})
    try:
        report = detect(doc, cap_cpu=_cap_cpu)
    except Refusal as refusal:
        _emit({"ok": False, "error": refusal.kind, **refusal.facts})
    except Exception as exc:  # noqa: BLE001 - the caller logs a failure
        if _is_memory(exc):
            _emit({"ok": False, "error": "too_large"})
        # The library failing on a file MuPDF had to repair: damage, as
        # utils.cleanup.process_pdf calls it in the web process.
        if _damage(doc, exc):
            _emit({"ok": False, "error": "corrupt"})
        _emit({"ok": False, "error": "failed"}, 1)
    _emit({"ok": True, **report})


def _damage(doc: fitz.Document, exc: Exception) -> bool:
    if not isinstance(exc, (RuntimeError, ValueError, fitz.mupdf.FzErrorBase)):
        return False
    try:
        return bool(doc.is_repaired)
    except Exception:  # noqa: BLE001 - a document that cannot even say is not called damaged
        return False


if __name__ == "__main__":
    main()
