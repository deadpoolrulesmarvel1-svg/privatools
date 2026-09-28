"""Private hidden-text subprocess protocol; the web process never parses the upload.

hidden_text_service runs ``python -I this_file <input pdf>``. Only JSON is
written to stdout: the report, with ``"ok": true``, or ``{"ok": false,
"error": ...}`` naming "password", "corrupt", "no_pages", "too_many_pages",
"too_large" or "failed".

Hidden text is text that a PDF reader does not show but that anything reading
the file's text still gets: search, copy and paste, a screening system or an
AI model given the file. The check reports, with the page and place of each:

- text drawn invisibly: text render mode 3 or 7, or an opacity of 0;
- text in the colour of what lies behind it, or so transparent it cannot be
  told from it (white on white and the like);
- text too small to read;
- text outside the page's visible area (its crop box), or cut away by a
  clipping path;
- text in an optional-content layer that is switched off when the file opens;
- text under a filled shape or image drawn on top of it: a redaction box drawn
  over text that is still in the file;
- text in comments and form fields that are hidden, fully transparent, of no
  size, or placed off the page;
- text marked for redaction whose redaction was never applied.

What is read, and how:

- Characters come from MuPDF's structured text, which is what text
  extraction returns, with their ink boxes, colour, opacity and whether they
  are filled or stroked. A second extraction that honours clipping names the
  characters a clipping path cuts away.
- MuPDF's text trace gives the drawing order, which says what lies behind a
  character and what was drawn over it. The two are joined by character and
  position.
- A copy of the file with every layer switched on shows the text that only
  hidden layers hold.
- Colours are compared in CIELAB. A character counts as the same colour as
  its background when the two are closer than SAME_COLOUR_DELTA_E.
- Whether text under a later shape really cannot be seen, and whether text
  over an image or gradient matches it, is decided from pixels: the page is
  rendered and each word's area must show no ink at all (fewer than
  INK_FRACTION of its pixels differ from the rest by more than PIXEL_DELTA). A
  visible word always leaves ink, so this cannot report readable text as
  hidden. Under a picture, which shows ink of its own, a word is hidden only
  if removing it from a copy of the page changes no pixel.

Invisible text laid over a page image, or over drawn content, is what OCR
software adds to make a scan searchable, and is reported apart as an OCR text
layer rather than as hidden text. An invisible copy of the visible words under
it is not reported at all. Invisible text over blank space is hidden text.

What is not detected: text shown in a font whose letters are drawn as
different letters, text made invisible by a soft mask or by a transparency
group's own opacity, and text under a shape that only partly covers each
character. MuPDF does not evaluate visibility expressions (/VE) in optional
content, so content hidden only by one of those is drawn and checked as
visible.

The limits: work grows with the number of pages and what they draw, so the
process caps its own memory and CPU time in ``_isolate``, and the caller stops
it after a time limit. Files with more than MAX_PAGES pages are refused before
any page is read. A page drawing more than MAX_PAGE_DRAWINGS things is still
checked for everything except text under shapes and text coloured like its
background, and the report says so.
"""

from __future__ import annotations

import difflib
import functools
import json
import os
import resource
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

# numpy's BLAS would start a thread per core; nothing here needs one.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

# PyMuPDF under its own name: importing it as "fitz" prints a notice on
# standard output, which is this process's answer to its caller.
import pymupdf as fitz  # noqa: E402
import numpy  # noqa: E402

# ── Limits ───────────────────────────────────────────────────────────────────

MAX_PAGES = 500
# Two web workers each run two heavy jobs at once in a 4 GB container, so four
# of these must fit beside them (the same budget as the sanitize worker).
MEMORY_BASE_BYTES = 768 * 1024 * 1024
MEMORY_PER_FILE_BYTE = 4
# Backstop for a process whose caller died before stopping it.
CPU_SECONDS = 120
MAX_OUTPUT_BYTES = 10 * 1024 * 1024
# Past this many drawn things on one page, the checks that depend on what is
# drawn behind or over the text are skipped for that page (and the report says
# so): a map or chart can draw hundreds of thousands of paths.
MAX_PAGE_DRAWINGS = 20_000
# The report lists at most this many findings, each with at most this much
# text and this many boxes (one per line); counts always cover them all.
MAX_FINDINGS = 500
MAX_FINDING_TEXT = 2000
MAX_FINDING_BOXES = 60
MAX_OCR_TEXT = 600
# Hidden text placed off the page, or of no size, is marked by a band this
# many points thick at the nearest edge of the preview.
EDGE_POINTS = 6.0

# ── What counts as hidden ───────────────────────────────────────────────────

# Text smaller than this, in points, cannot be read on screen or on paper.
TINY_POINTS = 2.0
# CIELAB distance under which text cannot be told from its background. Light
# grey captions (#999 on white) are 36 apart and #CCC is 20; #EEE is 6. Large
# text shows at a smaller difference, so a faint watermark in #E6E6E6 (8.5
# from white) is not reported.
SAME_COLOUR_DELTA_E = 7.0
SAME_COLOUR_DELTA_E_LARGE = 3.0
LARGE_TEXT_POINTS = 18.0
# Pixels whose colour differs from their area's usual colour by more than this,
# in any of red, green or blue (0-255), count as ink; an area with fewer than
# INK_FRACTION of them shows none. 24 is about the CIELAB distance of 10 that
# separates a light grey from white; large text shows at a smaller difference.
PIXEL_DELTA = 24
PIXEL_DELTA_LARGE = 10
INK_FRACTION = 0.01
# Rendering for the pixel checks: points to pixels, and the most pixels one
# page's render may hold.
RENDER_SCALE = 2.0
MAX_RENDER_PIXELS = 6_000_000
# A shape covers a character when it contains the character's ink box shrunk
# by this share of its width and height on each side.
COVER_INSET = 0.15
# Points kept clear of a cover's edge when its pixels are tested.
COVER_EDGE = 1.0
# Invisible text counts as an OCR layer when this share of it lies over images.
OCR_IMAGE_SHARE = 0.5
# An image covering at least this share of the page is a page image (a scan):
# text under it is treated like an OCR layer, word by word.
PAGE_IMAGE_SHARE = 0.5
# An invisible copy of the visible words under it is not reported.
DUPLICATE_SIMILARITY = 0.8
# Invisible words over blank parts of a page image count as hidden text, not
# OCR, only when they hold at least this many letters and digits in a row.
OCR_BLANK_MIN_LETTERS = 12

# MuPDF's structured-text character flags (FZ_STEXT_FILLED and so on).
_FILLED, _STROKED, _CLIPPED = 16, 32, 64
_TEXT_FLAGS = (
    fitz.TEXT_PRESERVE_WHITESPACE
    | fitz.TEXT_PRESERVE_LIGATURES
    | fitz.TEXT_ACCURATE_BBOXES
)
_EVERYWHERE = fitz.Rect(-1e9, -1e9, 1e9, 1e9)
# Drawn things that can lie behind text or cover it.
_AREA_KINDS = frozenset({"fill-path", "fill-image", "fill-imgmask", "fill-shade", "stroke-path"})
# Pictures: an image, or an image mask (how 1-bit scans are often stored), which
# paints only where its pixels are set and so never covers what is under it.
_PICTURE_KINDS = frozenset({"fill-image", "fill-imgmask"})
_TEXT_KINDS = frozenset({"fill-text", "stroke-text", "ignore-text"})

# Reasons, in the order a character is tested: the first that applies is the
# one reported. The UI and the plain-text report use these identifiers.
INVISIBLE = "invisible"            # render mode 3 or 7
TRANSPARENT = "transparent"        # opacity 0, or too transparent to see
HIDDEN_LAYER = "hidden-layer"      # optional content switched off
OFF_PAGE = "off-page"              # outside the crop box
CLIPPED = "clipped"                # cut away by a clipping path
COVERED = "covered"                # under a shape or image drawn later
SAME_COLOUR = "same-colour"        # the colour of what lies behind it
TINY = "tiny"                      # too small to read
HIDDEN_ANNOTATION = "hidden-annotation"
UNAPPLIED_REDACTION = "unapplied-redaction"
REASONS = (INVISIBLE, TRANSPARENT, SAME_COLOUR, TINY, OFF_PAGE, CLIPPED,
           HIDDEN_LAYER, COVERED, HIDDEN_ANNOTATION, UNAPPLIED_REDACTION)


class Refusal(Exception):
    """The file cannot be checked; ``kind`` is the error reported."""

    def __init__(self, kind: str, **facts):
        super().__init__(kind)
        self.kind = kind
        self.facts = facts


# ── Colour ───────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=4096)
def _lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    """CIELAB (D65) of an sRGB colour given as three values from 0 to 1."""
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def _delta_e(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = _lab(a), _lab(b)
    return ((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2) ** 0.5


def _rgb(components) -> tuple[float, float, float] | None:
    """An sRGB triple from a gray, RGB or CMYK colour, or None."""
    if not components:
        return None
    values = [min(1.0, max(0.0, float(v))) for v in components]
    if len(values) == 1:
        return (values[0],) * 3
    if len(values) == 3:
        return tuple(values)  # type: ignore[return-value]
    if len(values) == 4:
        c, m, y, k = values
        return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return None


def _rgb_from_int(value: int) -> tuple[float, float, float]:
    return ((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255


@functools.lru_cache(maxsize=4096)
def _hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{round(c * 255):02X}" for c in rgb)


@functools.lru_cache(maxsize=4096)
def _describe_colour(rgb: tuple[float, float, float]) -> str:
    """"white" or "black" when exactly that, else the hex code."""
    code = _hex(rgb)
    return {"#FFFFFF": "white", "#000000": "black"}.get(code, code)


# ── Page geometry ────────────────────────────────────────────────────────────

def rotation_as_shown(raw: object) -> int:
    """A /Rotate value the way pdf.js, which draws the website's preview, reads it:
    0 unless it is a multiple of 90, then turned into 0, 90, 180 or 270.

    The twin of backend/app/utils/page_space.rotation_as_shown, which this
    process cannot import; a test holds the two to the same answers.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return 0
    try:
        if raw % 90 != 0:
            return 0
        return int(raw) % 360
    except (ArithmeticError, ValueError):
        return 0


def _raw_rotate(page: fitz.Page) -> object:
    """The nearest /Rotate on the page or up its page tree, as written."""
    doc = page.parent
    xref, seen = page.xref, set()
    while xref and xref not in seen:
        seen.add(xref)
        kind, value = doc.xref_get_key(xref, "Rotate")
        if kind == "xref":
            value = doc.xref_object(int(value.split()[0]), compressed=True).strip()
            kind = "int" if value.lstrip("+-").isdigit() else "float"
        if kind != "null":
            try:
                return int(value) if kind == "int" else float(value) if kind in ("float", "real") else None
            except ValueError:
                return None
        kind, value = doc.xref_get_key(xref, "Parent")
        xref = int(value.split()[0]) if kind == "xref" else 0
    return None


@dataclass(slots=True)
class _Frame:
    """Maps the page as stored (points from the crop box's top-left corner) to
    the page as shown, in fractions of its width and height."""

    width: float
    height: float
    rotation: int

    def box(self, x0: float, y0: float, x1: float, y1: float) -> list[float]:
        w, h, r = self.width or 1.0, self.height or 1.0, self.rotation
        if r == 90:
            corners = ((h - y1) / h, x0 / w, (h - y0) / h, x1 / w)
        elif r == 180:
            corners = ((w - x1) / w, (h - y1) / h, (w - x0) / w, (h - y0) / h)
        elif r == 270:
            corners = (y0 / h, (w - x1) / w, y1 / h, (w - x0) / w)
        else:
            corners = (x0 / w, y0 / h, x1 / w, y1 / h)
        return [round(v, 5) for v in corners]


# ── Characters ───────────────────────────────────────────────────────────────

@dataclass(slots=True, eq=False)
class _Glyph:
    char: str
    x0: float
    y0: float
    x1: float
    y1: float
    ox: float
    oy: float
    size: float
    colour: tuple[float, float, float]
    alpha: float
    flags: int
    line: int
    seqno: int | None = None
    layer: str = ""
    stroke_colour: tuple[float, float, float] | None = None
    clipped: bool = False
    # Set by the checks: why the character is hidden, and what groups it with
    # its neighbours. ``confirm`` names the pixel test a reason still needs.
    reason: str | None = None
    detail: str = ""
    confirm: tuple = ()
    ocr: bool = False
    over_image: bool = False
    on_dark: bool = False
    # Which character at which place: what joins the extractions and the trace.
    key: tuple = ()
    # A space, or a character that draws nothing (a control or format character).
    blank: bool = False

    def __post_init__(self) -> None:
        self.key = _key(self.char, self.ox, self.oy)
        self.blank = _is_blank(self.char)

    @property
    def clip_copy(self) -> bool:
        """Part of a clipping path only (text render modes 4 to 7)."""
        return bool(self.flags & _CLIPPED) and self.alpha == 0

    @property
    def painted(self) -> bool:
        return bool(self.flags & (_FILLED | _STROKED)) and not self.clip_copy

    @property
    def centre(self) -> tuple[float, float]:
        return (self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2

    def set(self, reason: str | None, detail: str = "", confirm: tuple = ()) -> None:
        self.reason, self.detail, self.confirm = reason, detail, confirm


def _key(char: str, x: float, y: float) -> tuple[str, int, int]:
    """Which character at which place, to a tenth of a point."""
    return char, round(x * 10), round(y * 10)


def _char(unicode: int) -> str | None:
    """The character for a code point the trace gives, or None for none."""
    return chr(unicode) if 0 <= unicode <= 0x10FFFF else None


@functools.lru_cache(maxsize=4096)
def _is_blank(char: str) -> bool:
    if len(char) != 1:
        return not char.strip()
    return char.isspace() or unicodedata.category(char) in ("Cc", "Cf", "Zs")


def _stext_glyphs(page: fitz.Page, flags: int = _TEXT_FLAGS, textpage=None) -> list[_Glyph]:
    """The characters MuPDF extracts from the page, in reading order."""
    textpage = textpage or page.get_textpage(clip=_EVERYWHERE, flags=flags)
    glyphs: list[_Glyph] = []
    line_no = 0
    for block in textpage.extractRAWDICT()["blocks"]:
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", ()):
            line_no += 1
            for span in line.get("spans", ()):
                colour = _rgb_from_int(int(span.get("color", 0)))
                alpha = int(span.get("alpha", 255)) / 255
                char_flags = int(span.get("char_flags", _FILLED))
                size = float(span.get("size", 0.0))
                for ch in span.get("chars", ()):
                    if ch.get("synthetic"):
                        continue
                    x0, y0, x1, y1 = ch["bbox"]
                    ox, oy = ch["origin"]
                    glyphs.append(_Glyph(ch["c"], x0, y0, x1, y1, ox, oy, size, colour, alpha, char_flags, line_no))
    return glyphs


def _stext_keys(textpage) -> Counter:
    """How many times MuPDF extracts each character at each place."""
    keys: Counter = Counter()
    for block in textpage.extractRAWDICT()["blocks"]:
        for line in block.get("lines", ()):
            for span in line.get("spans", ()):
                for ch in span.get("chars", ()):
                    if not ch.get("synthetic"):
                        origin = ch["origin"]
                        keys[_key(ch["c"], origin[0], origin[1])] += 1
    return keys


def _drop_clip_copies(glyphs: list[_Glyph]) -> list[_Glyph]:
    """Text in render modes 4 to 6 is extracted twice, drawn and again as part
    of the clipping path with no opacity. Keep the drawn copy; mode 7 text,
    which is only a clipping path, has none and stays."""
    drawn = {g.key for g in glyphs if not g.clip_copy and g.flags & (_FILLED | _STROKED)}
    return [g for g in glyphs if not (g.clip_copy and g.key in drawn)]


def _read_glyphs(page: fitz.Page) -> tuple[list[_Glyph], Counter]:
    """Every character extraction reads, with how it is drawn and in what order.

    Also returns how many times each character position was extracted, before
    anything was dropped, for comparison with the copy with every layer on.
    """
    textpage = page.get_textpage(clip=_EVERYWHERE, flags=_TEXT_FLAGS)
    glyphs = _stext_glyphs(page, textpage=textpage)
    extracted = Counter(g.key for g in glyphs)
    if not glyphs:
        return glyphs, extracted

    # A clipping path that leaves no part of a character is where the
    # extraction that honours clipping drops it. The same text from both
    # means nothing was dropped, which is most pages.
    clipping = page.get_textpage(clip=_EVERYWHERE, flags=_TEXT_FLAGS | fitz.TEXT_CLIP)
    if clipping.extractText() != textpage.extractText():
        kept = _stext_keys(clipping)
        for g in glyphs:
            if kept[g.key] > 0:
                kept[g.key] -= 1
            else:
                g.clipped = True
    glyphs = _drop_clip_copies(glyphs)

    # Each traced character: (order, seqno, kind, layer, colour, opacity, size, bbox, origin).
    trace: dict[tuple[str, int, int], list[tuple]] = defaultdict(list)
    order = 0
    for span in page.get_texttrace():
        kind = span.get("type")
        colour = _rgb(span.get("color")) or (0.0, 0.0, 0.0)
        opacity = float(span.get("opacity") if span.get("opacity") is not None else 1.0)
        size = float(span.get("size") or 0.0)
        seqno, layer = span.get("seqno"), span.get("layer") or ""
        for unicode, _gid, origin, bbox in span.get("chars", ()):
            char = _char(unicode)
            if char is None:
                continue
            trace[_key(char, origin[0], origin[1])].append(
                (order, seqno, kind, layer, colour, opacity, size, bbox, origin))
            order += 1
    for g in glyphs:
        entries = trace.get(g.key)
        if not entries:
            continue
        # Each extracted character takes the first unclaimed drawing of itself
        # there; a stroke drawn with a fill (mode 2) lends its colour.
        for i, entry in enumerate(entries):
            if entry[2] in (0, 1, 3):
                g.seqno, g.layer = entry[1], entry[3]
                if g.x1 <= g.x0 or g.y1 <= g.y0:
                    # A glyph with no outline (OCR's glyphless font): use the
                    # box its font gives it instead.
                    g.x0, g.y0, g.x1, g.y1 = entry[7]
                del entries[i]
                break
        if g.flags & _FILLED:
            for i, entry in enumerate(entries):
                if entry[2] == 1:
                    g.stroke_colour = entry[4]
                    del entries[i]
                    break

    # MuPDF's extraction leaves out characters of no width or height (a font
    # size of 0, or text squeezed flat), which other extractors still read.
    # They are added from the trace, one line per drawing call, in its order.
    first_line = max((g.line for g in glyphs), default=0) + 1
    leftovers = sorted(((entry, key[0]) for key, entries in trace.items() for entry in entries if entry[2] in (0, 1, 3)),
                       key=lambda item: item[0][0])
    for (_order, seqno, kind, layer, colour, opacity, size, bbox, origin), char in leftovers:
        x0, y0, x1, y1 = bbox
        flags = {0: _FILLED, 1: _STROKED}.get(kind, 0)
        line = first_line + (seqno if seqno is not None and seqno >= 0 else 0)
        glyphs.append(_Glyph(char, x0, y0, x1, y1, origin[0], origin[1], size, colour, opacity, flags,
                             line, seqno=seqno, layer=layer))
    return glyphs, extracted


# ── What is drawn ────────────────────────────────────────────────────────────

@dataclass(slots=True, eq=False)
class _Area:
    """Something drawn that can lie behind text or over it."""

    index: int
    kind: str
    x0: float
    y0: float
    x1: float
    y1: float
    colour: tuple[float, float, float] | None = None  # None: an image, a gradient or an unknown fill
    opacity: float = 1.0
    # The exact rectangles a shape is made of; None when only its box is known.
    rects: list[tuple[float, float, float, float]] | None = None
    # The kind of comment (annotation) that draws it, if one does.
    comment: str = ""

    def holds_point(self, x: float, y: float) -> bool:
        if self.rects is not None:
            return any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in self.rects)
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1

    def holds_box(self, x0: float, y0: float, x1: float, y1: float) -> bool:
        if self.rects is not None:
            return any(r[0] <= x0 and r[1] <= y0 and x1 <= r[2] and y1 <= r[3] for r in self.rects)
        return self.x0 <= x0 and self.y0 <= y0 and x1 <= self.x1 and y1 <= self.y1

    def describe(self) -> str:
        if self.kind in _PICTURE_KINDS:
            thing = "an image"
        elif self.kind == "fill-shade":
            thing = "a gradient"
        elif self.kind == "stroke-path":
            thing = "a thick line" if self.colour is None else f"a thick {_describe_colour(self.colour)} line"
        else:
            shape = "box" if self.rects is not None else "shape"
            thing = f"a {shape}" if self.colour is None else f"a {_describe_colour(self.colour)} {shape}"
        return f"{thing} in a {self.comment}" if self.comment else thing


def _rects(drawing: dict) -> list[tuple[float, float, float, float]] | None:
    """The exact rectangles a path is made of, or None when it has other parts."""
    rects = []
    lines = []
    for item in drawing.get("items") or ():
        op = item[0]
        if op == "re":
            x0, y0, x1, y1 = item[1]
            rects.append((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
        elif op == "qu":
            corners = item[1]
            xs = {round(c[0], 2) for c in corners}
            ys = {round(c[1], 2) for c in corners}
            if len(xs) != 2 or len(ys) != 2:
                return None  # a turned or skewed four-sided shape
            rects.append((min(xs), min(ys), max(xs), max(ys)))
        elif op == "l":
            lines.append((item[1], item[2]))
        else:
            return None
    if lines:
        if rects or not 3 <= len(lines) <= 4:
            return None
        if any(abs(a[0] - b[0]) > 0.01 and abs(a[1] - b[1]) > 0.01 for a, b in lines):
            return None  # a diagonal
        xs = sorted({round(point[0], 2) for line in lines for point in line})
        ys = sorted({round(point[1], 2) for line in lines for point in line})
        if len(xs) != 2 or len(ys) != 2:
            return None
        rects.append((xs[0], ys[0], xs[1], ys[1]))
    return rects or None


def _read_areas(page: fitz.Page) -> tuple[list[_Area] | None, list]:
    """Filled shapes, thick lines, images and gradients, in drawing order, and
    the page's drawing log. The areas are None when the page draws more than
    MAX_PAGE_DRAWINGS things."""
    log = page.get_bboxlog()
    if len(log) > MAX_PAGE_DRAWINGS:
        return None, log
    paths = {}
    for d in page.get_cdrawings():
        seqno = d.get("seqno")
        if seqno is not None:
            paths[seqno] = d
    areas = []
    for index, entry in enumerate(log):
        kind, (x0, y0, x1, y1) = entry[0], entry[1]
        if kind not in _AREA_KINDS or x1 <= x0 or y1 <= y0:
            continue
        area = _Area(index, kind, x0, y0, x1, y1)
        path = paths.get(index)
        if kind == "fill-path":
            if path is None or path.get("fill") is None:
                continue
            area.colour = _rgb(path.get("fill"))
            area.opacity = float(path.get("fill_opacity") if path.get("fill_opacity") is not None else 1.0)
            area.rects = _rects(path)
        elif kind == "stroke-path":
            # Only a thick straight line matters, as a marker line drawn over
            # text or a band behind it. A fill-and-stroke path is numbered
            # by its fill; its stroke adds nothing that matters here.
            if path is None or path.get("type") != "s":
                continue
            items = path.get("items") or []
            width = float(path.get("width") or 0)
            if len(items) != 1 or items[0][0] != "l" or width < 2:
                continue
            (px, py), (qx, qy) = items[0][1], items[0][2]
            half = width / 2
            if abs(py - qy) < 0.01:
                area.rects = [(min(px, qx), py - half, max(px, qx), py + half)]
            elif abs(px - qx) < 0.01:
                area.rects = [(px - half, min(py, qy), px + half, max(py, qy))]
            else:
                continue
            area.colour = _rgb(path.get("color"))
            area.opacity = float(path.get("stroke_opacity") if path.get("stroke_opacity") is not None else 1.0)
        areas.append(area)
    return areas, log


def _order_is_known(log: list, glyphs: list[_Glyph]) -> bool:
    """Whether the text trace's numbering matches the drawing log's. Both count
    every drawing call on the page, and comparing text with the shapes around
    it relies on that."""
    for g in glyphs:
        if g.seqno is None:
            continue
        if not 0 <= g.seqno < len(log) or log[g.seqno][0] not in _TEXT_KINDS:
            return False
    return True


class _Grid:
    """Areas bucketed by 72-point cells, to find those at a point quickly."""

    CELL = 72.0

    def __init__(self, areas: list[_Area], width: float, height: float):
        self.cells: dict[tuple[int, int], list[_Area]] = defaultdict(list)
        # Areas reaching far off the page are clamped: text there is off the
        # page already and never looked up.
        lo_x, lo_y, hi_x, hi_y = -width, -height, 2 * width, 2 * height
        for a in areas:
            cx0, cx1 = int(max(a.x0, lo_x) // self.CELL), int(min(a.x1, hi_x) // self.CELL)
            cy0, cy1 = int(max(a.y0, lo_y) // self.CELL), int(min(a.y1, hi_y) // self.CELL)
            for cx in range(cx0, cx1 + 1):
                for cy in range(cy0, cy1 + 1):
                    self.cells[(cx, cy)].append(a)

    def at(self, x: float, y: float) -> list[_Area]:
        return self.cells.get((int(x // self.CELL), int(y // self.CELL)), [])


# ── The checks ───────────────────────────────────────────────────────────────

def _behind(g: _Glyph, candidates: list[_Area], before: int, depth: int = 0):
    """What a character is drawn on: (rgb, area); (None, area) on an image, a
    gradient or a shape of unknown colour; (white, None) on the bare page."""
    cx, cy = g.centre
    best = None
    for a in candidates:
        if a.index < before and (best is None or a.index > best.index) and a.holds_point(cx, cy):
            best = a
    if best is None:
        return (1.0, 1.0, 1.0), None
    if best.colour is None:
        return None, best
    if best.opacity >= 0.999 or depth >= 4:
        return best.colour, best
    under, _ = _behind(g, candidates, best.index, depth + 1)
    if under is None:
        return None, best
    o = best.opacity
    return tuple(o * c + (1 - o) * u for c, u in zip(best.colour, under)), best


def _cover(g: _Glyph, candidates: list[_Area]) -> _Area | None:
    """The first shape, image or gradient drawn after a character over all of it.

    On upright text the tail of a p, g or y may show below a box that hides
    the rest of the word: only the letter down to its baseline must be covered.
    """
    bottom = g.oy if g.y0 < g.oy < g.y1 else g.y1
    dx, dy = (g.x1 - g.x0) * COVER_INSET, (bottom - g.y0) * COVER_INSET
    box = (g.x0 + dx, g.y0 + dy, g.x1 - dx, bottom - dy)
    first = None
    for a in candidates:
        if a.index > g.seqno and a.kind != "fill-imgmask" and a.opacity >= 0.5 and a.holds_box(*box):
            if first is None or a.index < first.index:
                first = a
    return first


@functools.lru_cache(maxsize=65536)
def _colour_verdict(colour: tuple, alpha: float, stroke: tuple | None, background: tuple,
                    large: bool, bare_page: bool) -> tuple[str, str, tuple] | None:
    """Whether text of this colour, opacity and stroke can be told from this
    background: None when it can, else its reason, detail and pixel test."""
    limit = SAME_COLOUR_DELTA_E_LARGE if large else SAME_COLOUR_DELTA_E
    effective = tuple(alpha * c + (1 - alpha) * b for c, b in zip(colour, background))
    if stroke is not None and _delta_e(stroke, background) >= limit:
        return None
    if _delta_e(effective, background) >= limit:
        return None
    on = f"a {_describe_colour(background)} " + ("page" if bare_page else "background")
    if alpha < 0.999 and _delta_e(colour, background) >= limit:
        return TRANSPARENT, f"{round(alpha * 100)}% opacity on {on}", ("colour", _hex(background))
    text = _describe_colour(colour)
    detail = (f"{text} text on {on}" if text != _hex(colour) or text == _describe_colour(background)
              else f"text coloured {text} on {on}")
    return SAME_COLOUR, detail, ("colour", _hex(colour), _hex(background))


def _tiny(g: _Glyph) -> bool:
    return g.size < TINY_POINTS


def _tiny_detail(g: _Glyph) -> str:
    return f"{g.size:.2g} pt, too small to read"


def _classify(g: _Glyph, frame: _Frame, grid: _Grid | None) -> None:
    """Give a character the first reason it is hidden, if it has one.

    A reason that pixels must confirm is set with ``confirm`` naming the test.
    """
    if not g.painted:
        g.set(INVISIBLE, "set to be invisible (text render mode 3 or 7)")
        return
    if g.alpha * 255 < 0.5:
        g.set(TRANSPARENT, "fully transparent (opacity 0)")
        return
    if g.x1 <= 0 or g.y1 <= 0 or g.x0 >= frame.width or g.y0 >= frame.height:
        g.set(OFF_PAGE, "outside the visible page")
        return
    if g.clipped:
        g.set(CLIPPED, "cut away by a clipping path")
        return
    if grid is not None and g.seqno is not None:
        candidates = grid.at(*g.centre)
        cover = _cover(g, candidates) if candidates else None
        if cover is not None:
            detail = f"under {cover.describe()} drawn on top of it"
            if cover.kind == "fill-image":
                area = (cover.x1 - cover.x0) * (cover.y1 - cover.y0)
                page_image = area >= PAGE_IMAGE_SHARE * frame.width * frame.height
                g.set(COVERED, detail, ("page-image", cover.index) if page_image else ("image", cover.index))
            else:
                g.set(COVERED, detail, ("covered", cover.rects is not None and cover.colour is not None, cover.index))
            return
        background, source = _behind(g, candidates, g.seqno) if candidates else ((1.0, 1.0, 1.0), None)
        if background is None:
            # On an image or a gradient: only pixels can tell whether it shows.
            if g.stroke_colour is None:
                where = source.describe() if source is not None else "what is behind it"
                if g.alpha < 0.999:
                    g.set(TRANSPARENT, f"{round(g.alpha * 100)}% opacity over {where}", ("blend", source.index if source else -1))
                else:
                    g.set(SAME_COLOUR, f"{_describe_colour(g.colour)} text that matches {where} behind it",
                          ("blend", source.index if source else -1))
                return
        else:
            verdict = _colour_verdict(g.colour, g.alpha, g.stroke_colour, background,
                                      g.size >= LARGE_TEXT_POINTS, source is None)
            if verdict is not None:
                g.set(*verdict)
                return
    if _tiny(g):
        g.set(TINY, _tiny_detail(g))


# ── Pixels ───────────────────────────────────────────────────────────────────

class _Pixels:
    """One render of the part of a page the pixel checks ask about."""

    def __init__(self, page: fitz.Page, boxes: list[tuple[float, float, float, float]], frame: _Frame):
        self.array = None
        self.region: list[tuple[float, float, float, float]] = []
        if not boxes:
            return
        x0 = max(0.0, min(b[0] for b in boxes))
        y0 = max(0.0, min(b[1] for b in boxes))
        x1 = min(frame.width, max(b[2] for b in boxes))
        y1 = min(frame.height, max(b[3] for b in boxes))
        # The area rendered, as one box, so another render can match it.
        self.region = [(x0, y0, x1, y1)]
        if x1 - x0 < 0.5 or y1 - y0 < 0.5:
            return
        scale = RENDER_SCALE
        if (x1 - x0) * (y1 - y0) * scale * scale > MAX_RENDER_PIXELS:
            scale = (MAX_RENDER_PIXELS / ((x1 - x0) * (y1 - y0))) ** 0.5
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=fitz.Rect(x0, y0, x1, y1),
                              alpha=False, colorspace=fitz.csRGB, annots=True)
        self.array = numpy.frombuffer(pix.samples, dtype=numpy.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
        self.scale = scale
        # The pixmap's own origin in device pixels; MuPDF rounds it outward.
        self.px0, self.py0 = pix.x, pix.y

    def _pixels(self, boxes: list[tuple[float, float, float, float]]) -> numpy.ndarray | None:
        if self.array is None:
            return None
        pieces = []
        h, w = self.array.shape[:2]
        for x0, y0, x1, y1 in boxes:
            c0 = max(0, int(x0 * self.scale) - self.px0)
            r0 = max(0, int(y0 * self.scale) - self.py0)
            c1 = min(w, int(x1 * self.scale + 0.999) - self.px0)
            r1 = min(h, int(y1 * self.scale + 0.999) - self.py0)
            if c1 > c0 and r1 > r0:
                pieces.append(self.array[r0:r1, c0:c1].reshape(-1, 3))
        if not pieces:
            return None
        pixels = numpy.concatenate(pieces)
        return pixels if len(pixels) >= 4 else None

    def dark(self, boxes: list[tuple[float, float, float, float]]) -> bool:
        """Whether the area is mostly dark, like a bar drawn over words."""
        pixels = self._pixels(boxes)
        if pixels is None:
            return False
        luma = pixels.astype(numpy.float32) @ numpy.array([0.2126, 0.7152, 0.0722], dtype=numpy.float32)
        return float(numpy.median(luma)) < 128

    def differs(self, other: "_Pixels", boxes: list[tuple[float, float, float, float]]) -> bool | None:
        """Whether this render and ``other``, of the same area, differ in these boxes."""
        a, b = self._pixels(boxes), other._pixels(boxes)
        if a is None or b is None or a.shape != b.shape:
            return None
        far = numpy.abs(a.astype(numpy.int16) - b.astype(numpy.int16)).max(axis=1) > PIXEL_DELTA_LARGE
        return int(numpy.count_nonzero(far)) >= max(2, INK_FRACTION * len(a))

    def shows_ink(self, boxes: list[tuple[float, float, float, float]], delta: int = PIXEL_DELTA) -> bool | None:
        """Whether any part of these boxes shows ink, or None when too small to tell."""
        pixels = self._pixels(boxes)
        if pixels is None:
            return None
        # Against the area's mean colour: an area of one colour has no pixel
        # far from it, and ink makes some pixels far from any mean.
        values = pixels.astype(numpy.float32)
        far = numpy.abs(values - values.mean(axis=0)).max(axis=1) > delta
        return int(numpy.count_nonzero(far)) >= max(2, INK_FRACTION * len(values))


# ── Runs of characters ───────────────────────────────────────────────────────

@dataclass(eq=False)
class _Run:
    reason: str
    detail: str
    glyphs: list[_Glyph] = field(default_factory=list)

    @property
    def ocr(self) -> bool:
        return self.glyphs[0].ocr

    @property
    def confirm(self) -> tuple:
        return self.glyphs[0].confirm

    def marks(self) -> list[_Glyph]:
        return [g for g in self.glyphs if not g.blank]

    def text(self) -> str:
        out: list[str] = []
        line = None
        for g in self.glyphs:
            if line is not None and g.line != line and out and not out[-1].isspace():
                out.append(" ")
            out.append(g.char)
            line = g.line
        return " ".join("".join(out).split())

    def boxes(self) -> list[tuple[float, float, float, float]]:
        """One box per line, around the characters' ink."""
        lines: dict[int, list[float]] = {}
        for g in self.marks():
            box = lines.get(g.line)
            if box is None:
                lines[g.line] = [g.x0, g.y0, g.x1, g.y1]
            else:
                box[0], box[1] = min(box[0], g.x0), min(box[1], g.y0)
                box[2], box[3] = max(box[2], g.x1), max(box[3], g.y1)
        return [(b[0], b[1], b[2], b[3]) for b in lines.values()]

    def set(self, reason: str | None, detail: str = "") -> None:
        for g in self.marks():
            g.set(reason, detail)


def _clear(word: list[_Glyph]) -> None:
    """The word shows after all: no reason, unless it is too small to read."""
    for g in word:
        if _tiny(g):
            g.set(TINY, _tiny_detail(g))
        else:
            g.set(None)


def _changes_when_removed(page: fitz.Page, words: list[tuple[list[_Glyph], _Area | None]], frame: _Frame,
                          before: "_Pixels") -> list[bool | None]:
    """For each word, whether the pixels under its cover change when it is removed."""
    boxes = [_boxes(word)[0] for word, _cover in words]
    copy = fitz.open()
    try:
        copy.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        stripped = copy[0]
        for box in boxes:
            stripped.add_redact_annot(fitz.Rect(box), fill=False)
        stripped.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                                  text=fitz.PDF_REDACT_TEXT_REMOVE)
        after = _Pixels(stripped, before.region, frame)
        return [before.differs(after, _under([box], cover)) for box, (_word, cover) in zip(boxes, words)]
    finally:
        copy.close()


def _words(run: _Run) -> list[list[_Glyph]]:
    """The run's characters split into words: at spaces and line ends."""
    words: list[list[_Glyph]] = []
    word: list[_Glyph] = []
    line = None
    for g in run.glyphs:
        if g.blank or g.line != line:
            if word:
                words.append(word)
            word = []
        if not g.blank:
            word.append(g)
        line = g.line
    if word:
        words.append(word)
    return words


def _boxes(word: list[_Glyph]) -> list[tuple[float, float, float, float]]:
    return [(min(g.x0 for g in word), min(g.y0 for g in word), max(g.x1 for g in word), max(g.y1 for g in word))]


def _under(boxes: list[tuple[float, float, float, float]], area: _Area | None) -> list[tuple[float, float, float, float]]:
    """The parts of ``boxes`` that ``area`` covers. A cover that stops short of
    a descender or an accent still hides the word, so only what lies under it
    is tested for ink."""
    if area is None:
        return boxes
    parts = []
    for x0, y0, x1, y1 in boxes:
        for r in area.rects or [(area.x0, area.y0, area.x1, area.y1)]:
            # Kept clear of the cover's own edge, which renders half-toned.
            clipped = (max(x0, r[0] + COVER_EDGE), max(y0, r[1] + COVER_EDGE),
                       min(x1, r[2] - COVER_EDGE), min(y1, r[3] - COVER_EDGE))
            if clipped[2] > clipped[0] and clipped[3] > clipped[1]:
                parts.append(clipped)
    return parts


def _runs(glyphs: list[_Glyph]) -> list[_Run]:
    """Consecutive hidden characters with the same reason, and the spaces between them."""
    runs: list[_Run] = []
    current: _Run | None = None
    blanks: list[_Glyph] = []
    for g in glyphs:
        if g.blank:
            if current is not None:
                blanks.append(g)
            continue
        if g.reason is None:
            current, blanks = None, []
            continue
        head = current.glyphs[0] if current is not None else None
        if head is not None and (head.reason, head.detail, head.confirm, head.ocr, head.layer) == (
                g.reason, g.detail, g.confirm, g.ocr, g.layer):
            current.glyphs.extend(blanks)
            current.glyphs.append(g)
        else:
            current = _Run(g.reason, g.detail, [g])
            runs.append(current)
        blanks = []
    return runs


def _similar(a: str, b: str) -> float:
    """How much of ``a`` appears in ``b``, ignoring case, spacing and punctuation."""
    a = "".join(c for c in a.lower() if c.isalnum())
    b = "".join(c for c in b.lower() if c.isalnum())
    if not a:
        return 1.0
    if not b:
        return 0.0
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return sum(block.size for block in matcher.get_matching_blocks()) / len(a)


def _overlaps(box, other) -> bool:
    return box[0] < other[2] and other[0] < box[2] and box[1] < other[3] and other[1] < box[3]


def _settle_invisible(run: _Run, visible: "_GlyphGrid", areas: list[_Area] | None) -> str:
    """What invisible text is: "copy", "ocr", "hidden", or "ink?" when pixels
    must say whether drawn content lies under it.

    Over the same visible words it is a copy, and is not reported. Over images
    it is an OCR layer. Over other drawn content it is an OCR-style layer if
    ink shows under it. Anywhere else, or over different words, it is hidden.
    """
    marks = run.marks()
    if not marks:
        return "hidden"
    # Most of it lies on visible characters: compare the words.
    under: dict[int, _Glyph] = {}
    over = 0
    for g in marks:
        found = visible.overlapping(g)
        if found:
            over += 1
            for v in found:
                under[id(v)] = v
    if over >= 0.5 * len(marks):
        beneath = "".join(v.char for v in sorted(under.values(), key=lambda v: (v.line, v.x0)))
        return "copy" if _similar(run.text(), beneath) >= DUPLICATE_SIMILARITY else "hidden"
    if not areas:
        return "hidden"
    pictures = [a for a in areas if a.kind in _PICTURE_KINDS]
    if pictures:
        inside = sum(1 for g in marks if any(a.holds_point(*g.centre) for a in pictures))
        if inside / len(marks) >= OCR_IMAGE_SHARE:
            return "ocr"
    boxes = run.boxes()
    if any(any(_overlaps((a.x0, a.y0, a.x1, a.y1), b) for b in boxes) for a in areas):
        return "ink?"
    return "hidden"


class _GlyphGrid:
    """Visible characters bucketed by 12-point cells, to find those under a character."""

    CELL = 12.0

    def __init__(self, glyphs: list[_Glyph]):
        self.cells: dict[tuple[int, int], list[_Glyph]] = defaultdict(list)
        for g in glyphs:
            if g.reason in (None, TINY) and not g.blank and g.x1 > g.x0 and g.y1 > g.y0:
                for cx in range(int(g.x0 // self.CELL), int(g.x1 // self.CELL) + 1):
                    for cy in range(int(g.y0 // self.CELL), int(g.y1 // self.CELL) + 1):
                        self.cells[(cx, cy)].append(g)

    def overlapping(self, g: _Glyph) -> list[_Glyph]:
        box = (g.x0, g.y0, g.x1, g.y1)
        seen: dict[int, _Glyph] = {}
        for cx in range(int(g.x0 // self.CELL), int(g.x1 // self.CELL) + 1):
            for cy in range(int(g.y0 // self.CELL), int(g.y1 // self.CELL) + 1):
                for v in self.cells.get((cx, cy), ()):
                    if v is not g and _overlaps(box, (v.x0, v.y0, v.x1, v.y1)):
                        seen[id(v)] = v
        return list(seen.values())


# ── A page ───────────────────────────────────────────────────────────────────

@dataclass
class PageResult:
    findings: list[dict] = field(default_factory=list)
    ocr: dict | None = None
    notes: list[str] = field(default_factory=list)
    has_text: bool = False


def _finding(page_no: int, reason: str, detail: str, text: str, boxes: list[list[float]], **extra) -> dict:
    return {
        "page": page_no,
        "reason": reason,
        "detail": detail,
        "text": text[:MAX_FINDING_TEXT],
        "truncated": len(text) > MAX_FINDING_TEXT,
        "words": len(text.split()),
        "boxes": boxes[:MAX_FINDING_BOXES],
        **extra,
    }


def _clamp(rect, frame: _Frame) -> tuple[float, float, float, float]:
    """A box pulled onto the page. Something placed off it, or of no size,
    becomes a band EDGE_POINTS thick at the nearest edge, so it can be shown."""
    w, h = frame.width, frame.height

    def band(lo: float, hi: float, limit: float) -> tuple[float, float]:
        lo, hi = min(max(lo, 0.0), limit), min(max(hi, 0.0), limit)
        if hi - lo >= EDGE_POINTS or limit <= EDGE_POINTS:
            return lo, hi
        middle = min(max((lo + hi) / 2, EDGE_POINTS / 2), limit - EDGE_POINTS / 2)
        return middle - EDGE_POINTS / 2, middle + EDGE_POINTS / 2

    x0, x1 = band(rect[0], rect[2], w)
    y0, y1 = band(rect[1], rect[3], h)
    return x0, y0, x1, y1


_ANNOTATION_NAMES = {
    "FreeText": "text box", "Text": "sticky note", "Square": "rectangle comment", "Circle": "ellipse comment",
    "Highlight": "highlight", "Underline": "underline", "StrikeOut": "strike-out", "Squiggly": "squiggly underline",
    "Stamp": "stamp", "Ink": "drawing", "Line": "line comment", "Polygon": "polygon comment",
    "PolyLine": "polyline comment", "Caret": "caret comment", "FileAttachment": "file attachment",
    "Sound": "sound", "Redact": "redaction mark",
}
# Why an annotation a reader would otherwise draw cannot be seen. MuPDF still
# draws the text of these, off the page or with nothing to see, so that text
# is reported once, as the annotation's.
_DRAWN_BUT_UNSEEN = ("fully transparent", "with no size", "placed off the page")
_NOTE_REASONS = frozenset({INVISIBLE, TRANSPARENT, TINY, OFF_PAGE, CLIPPED})


@dataclass(slots=True, eq=False)
class _Note:
    """A comment (annotation) or form field on the page."""

    rect: fitz.Rect
    name: str
    text: str = ""
    why_hidden: str | None = None
    redacts: list[fitz.Rect] | None = None  # the areas a redaction mark covers


def _why_hidden(rect: fitz.Rect, flags: int, opacity: float, page_area: fitz.Rect) -> str | None:
    if flags & fitz.PDF_ANNOT_IS_HIDDEN:
        return "marked hidden"
    if flags & fitz.PDF_ANNOT_IS_NO_VIEW:
        return "marked not to be shown on screen"
    if 0 <= opacity < 0.004:
        return "fully transparent"
    if rect.width < 1 or rect.height < 1:
        return "with no size"
    if not rect.intersects(page_area):
        return "placed off the page"
    return None


def _read_notes(page: fitz.Page, frame: _Frame) -> list[_Note]:
    notes = []
    page_area = fitz.Rect(0, 0, frame.width, frame.height)
    for annot in page.annots():
        kind, label = annot.type[0], annot.type[1]
        if kind in (fitz.PDF_ANNOT_POPUP, fitz.PDF_ANNOT_LINK):
            continue
        rect = fitz.Rect(annot.rect)
        note = _Note(rect, _ANNOTATION_NAMES.get(label, "comment"))
        if kind == fitz.PDF_ANNOT_REDACT:
            vertices = annot.vertices or []
            note.redacts = [fitz.Quad(vertices[i:i + 4]).rect for i in range(0, len(vertices) - 3, 4)] or [rect]
            notes.append(note)
            continue
        note.why_hidden = _why_hidden(rect, annot.flags, annot.opacity, page_area)
        if note.why_hidden is not None:
            note.text = (annot.info.get("content") or "").strip()
            if not note.text:
                try:
                    note.text = (annot.get_text() or "").strip()
                except Exception:  # noqa: BLE001 - an appearance that will not read has no text to report
                    note.text = ""
        notes.append(note)
    for widget in page.widgets():
        if widget.field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON,
                                 fitz.PDF_WIDGET_TYPE_BUTTON, fitz.PDF_WIDGET_TYPE_SIGNATURE):
            continue
        value = widget.field_value
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value)
        rect = fitz.Rect(widget.rect)
        flags = {1: fitz.PDF_ANNOT_IS_HIDDEN, 3: fitz.PDF_ANNOT_IS_NO_VIEW}.get(widget.field_display, 0)
        notes.append(_Note(rect, f"form field “{widget.field_name or 'unnamed'}”", str(value or "").strip(),
                           _why_hidden(rect, flags, -1, page_area)))
    return notes


def _name_comment_shapes(areas: list[_Area], notes: list[_Note]) -> None:
    """Say which shapes a comment draws, so a box drawn by one is described as its."""
    for a in areas:
        for note in notes:
            r = note.rect
            if r.x0 - 1.5 <= a.x0 and r.y0 - 1.5 <= a.y0 and a.x1 <= r.x1 + 1.5 and a.y1 <= r.y1 + 1.5:
                a.comment = note.name
                break


def _note_findings(notes: list[_Note], glyphs: list[_Glyph], page_no: int, frame: _Frame) -> list[dict]:
    found = []
    for note in notes:
        if note.redacts is not None:
            under = [g for g in glyphs if any(a.contains(fitz.Point(*g.centre)) for a in note.redacts)]
            text = " ".join("".join(g.char for g in under).split())
            if text:
                found.append(_finding(page_no, UNAPPLIED_REDACTION,
                                      "marked for redaction, but the redaction was never applied",
                                      text, [frame.box(*_clamp(a, frame)) for a in note.redacts]))
            continue
        text = " ".join(note.text.split())
        if note.why_hidden is None or not text:
            continue
        field = note.name.startswith("form field")
        what = f"the value of {note.name}" if field else f"a {note.name}"
        found.append(_finding(page_no, HIDDEN_ANNOTATION, f"{what}, {note.why_hidden}", text,
                              [frame.box(*_clamp(note.rect, frame))], source="form-field" if field else "comment"))
    return found


def _hidden_layer_glyphs(extracted: Counter, page: fitz.Page) -> list[_Glyph]:
    """Characters on ``page``, from the copy with every layer on, that the file
    as opened does not show; ``extracted`` counts what it does show."""
    everything = _stext_glyphs(page)
    if len(everything) <= sum(extracted.values()):
        return []
    remaining = Counter(extracted)
    extra = []
    for g in everything:
        if remaining[g.key] > 0:
            remaining[g.key] -= 1
        else:
            extra.append(g)
    extra = _drop_clip_copies(extra)
    if all(g.blank for g in extra):
        return []
    layers: dict[tuple[str, int, int], str] = {}
    for span in page.get_texttrace():
        if not span.get("layer"):
            continue
        for unicode, _gid, origin, _bbox in span.get("chars", ()):
            char = _char(unicode)
            if char is not None:
                layers.setdefault(_key(char, origin[0], origin[1]), span["layer"])
    for g in extra:
        g.layer = layers.get(g.key, "")
        if not g.blank:
            g.set(HIDDEN_LAYER, f"in the layer “{g.layer}”, which is switched off" if g.layer
                  else "in a layer that is switched off")
    return extra


def analyse_page(page: fitz.Page, page_no: int, rotation: int = 0, layered_page: fitz.Page | None = None) -> PageResult:
    """Check one page shown unturned (/Rotate 0); ``rotation`` is how the
    website's preview turns it, and ``layered_page`` is the same page in the
    copy of the file with every layer switched on."""
    result = PageResult()
    frame = _Frame(page.rect.width, page.rect.height, rotation)
    glyphs, extracted = _read_glyphs(page)
    result.has_text = any(not g.blank for g in glyphs)

    areas = None
    if result.has_text:
        areas, log = _read_areas(page)
        if areas is None:
            result.notes.append(f"Page {page_no} draws too many shapes to check for text hidden under them or "
                                "coloured like its background. The other checks ran.")
        elif not _order_is_known(log, glyphs):
            areas = None
            result.notes.append(f"Page {page_no} could not be checked for text hidden under shapes or coloured "
                                "like its background. The other checks ran.")
        del log
    notes = _read_notes(page, frame)
    if areas and notes:
        _name_comment_shapes(areas, notes)
    # No areas at all still means the colour checks run, against the bare page.
    grid = _Grid(areas, frame.width, frame.height) if areas is not None else None

    for g in glyphs:
        if not g.blank:
            _classify(g, frame, grid)

    # Text a hidden comment or form field draws is reported as that comment's:
    # inside its box and hidden the way the comment is, not page text under it.
    for note in notes:
        if note.why_hidden in _DRAWN_BUT_UNSEEN:
            r = note.rect
            for g in glyphs:
                cx, cy = g.centre
                if g.reason in _NOTE_REASONS and r.x0 - 1 <= cx <= r.x1 + 1 and r.y0 - 1 <= cy <= r.y1 + 1:
                    g.set(None)

    # Invisible text: a copy of visible words, an OCR layer, or hidden.
    questions: list[tuple[str, _Run]] = []
    visible = None
    for run in _runs(glyphs):
        if run.reason in (INVISIBLE, TRANSPARENT) and not run.confirm:
            visible = visible or _GlyphGrid(glyphs)
            verdict = _settle_invisible(run, visible, areas)
            if verdict == "copy":
                run.set(None)
            elif verdict == "ocr":
                questions.append(("page-image", run))
            elif verdict == "ink?":
                questions.append(("ink", run))
        elif run.confirm:
            questions.append((run.confirm[0], run))

    # One render answers every pixel question on the page. Words are tested one
    # by one, so a few words under a black bar are found among many that show.
    if questions:
        by_index = {a.index: a for a in areas or ()}
        pixels = _Pixels(page, [b for _, run in questions for b in run.boxes()], frame)
        small_image_words: list[tuple[list[_Glyph], _Area | None]] = []
        for question, run in questions:
            if question == "ink":
                if pixels.shows_ink(run.boxes()):
                    for g in run.marks():
                        g.ocr = True
            elif question == "page-image":
                # Text over or under a page image is an OCR layer where the image
                # shows ink; over blank paper or a dark bar it is hidden.
                for word in _words(run):
                    boxes = _boxes(word)
                    ink = pixels.shows_ink(boxes)
                    dark = ink is False and pixels.dark(boxes)
                    for g in word:
                        g.over_image, g.ocr, g.on_dark = True, ink is not False, dark
                        if g.reason == COVERED and ink is False:
                            g.detail = ("under a dark bar in the page image drawn on top of it" if dark
                                        else "under the page image drawn on top of it, which is blank there")
            elif question == "image":
                small_image_words.extend((word, by_index.get(run.confirm[1])) for word in _words(run))
            else:
                exact = run.confirm[1] if question == "covered" else False
                cover = by_index.get(run.confirm[2]) if question == "covered" else None
                for word in _words(run):
                    large = min(g.size for g in word) >= LARGE_TEXT_POINTS
                    ink = pixels.shows_ink(_under(_boxes(word), cover), PIXEL_DELTA_LARGE if large else PIXEL_DELTA)
                    # Hidden only if the word's area shows no ink. When it is too
                    # small to tell, trust the drawing only if its shape and
                    # colour are known.
                    if ink or (ink is None and (question == "blend" or (question == "covered" and exact is not True))):
                        _clear(word)
        if small_image_words:
            # A picture shows its own detail, so ink proves nothing there: the
            # words are hidden only if removing them changes no pixel under it.
            changes = _changes_when_removed(page, small_image_words, frame, pixels)
            for (word, _cover_area), changed in zip(small_image_words, changes):
                if changed is not False:
                    _clear(word)
        # OCR software reads specks as stray letters; only a real stretch of
        # words over blank paper counts as hidden. Words on a dark bar always do.
        for run in _runs(glyphs):
            marks = run.marks()
            if not run.ocr and marks and all(g.over_image for g in marks) and not any(g.on_dark for g in marks):
                if sum(1 for g in marks if g.char.isalnum()) < OCR_BLANK_MIN_LETTERS:
                    for g in marks:
                        g.ocr = True

    ocr_runs = []
    for run in _runs(glyphs):
        text = run.text()
        if not text:
            continue
        if run.ocr:
            ocr_runs.append((run, text))
            continue
        sizes = [g.size for g in run.marks()]
        result.findings.append(_finding(page_no, run.reason, run.detail, text,
                                        [frame.box(*_clamp(b, frame)) for b in run.boxes()],
                                        size=round(min(sizes), 2) if sizes else None))

    if ocr_runs:
        text = " ".join(t for _, t in ocr_runs)
        boxes = [b for run, _ in ocr_runs for b in run.boxes()]
        union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        result.ocr = {
            "page": page_no,
            "text": text[:MAX_OCR_TEXT],
            "truncated": len(text) > MAX_OCR_TEXT,
            "words": len(text.split()),
            "boxes": [frame.box(*_clamp(union, frame))],
        }

    if layered_page is not None:
        hidden = _hidden_layer_glyphs(extracted, layered_page)
        for run in _runs(hidden):
            text = run.text()
            if text:
                boxes = [frame.box(*_clamp(b, frame)) for b in run.boxes()]
                result.findings.append(_finding(page_no, HIDDEN_LAYER, run.detail, text, boxes))
        result.has_text = result.has_text or bool(hidden)

    result.findings.extend(_note_findings(notes, glyphs, page_no, frame))
    result.findings.sort(key=lambda f: (min((b[1] for b in f["boxes"]), default=0.0),
                                        min((b[0] for b in f["boxes"]), default=0.0)))
    return result


# ── Hidden layers ────────────────────────────────────────────────────────────

def _all_layers_on(doc: fitz.Document) -> fitz.Document | None:
    """A copy of the document with every optional-content group switched on,
    or None when no layer is off."""
    try:
        groups = doc.get_ocgs()
    except Exception:  # noqa: BLE001 - a layer list MuPDF cannot read hides nothing it draws
        return None
    if not groups or all(info.get("on") for info in groups.values()):
        return None
    every = " ".join(f"{xref} 0 R" for xref in groups)
    # From the file itself when there is one: the copy is then written out
    # once, to be read again with the new settings, not twice.
    source = doc.name if doc.name and os.path.isfile(doc.name) else None
    copy = fitz.open(source, filetype="pdf") if source else fitz.open("pdf", doc.tobytes(garbage=0))
    # A key path through an indirect object would not reach it, so write to
    # the dictionary itself.
    owner, key = copy.pdf_catalog(), "OCProperties/D"
    kind, value = copy.xref_get_key(owner, "OCProperties")
    if kind == "xref":
        owner, key = int(value.split()[0]), "D"
    copy.xref_set_key(owner, key, f"<</BaseState/ON/ON[{every}]/OFF[]>>")
    return fitz.open("pdf", copy.tobytes(garbage=0))


# ── The document ─────────────────────────────────────────────────────────────

def analyse(doc: fitz.Document) -> dict:
    """The report for a whole document (see the module docstring)."""
    if doc.needs_pass:
        raise Refusal("password")
    if doc.page_count == 0:
        raise Refusal("no_pages")
    if doc.page_count > MAX_PAGES:
        raise Refusal("too_many_pages", pages=doc.page_count, limit=MAX_PAGES)

    rotations = [rotation_as_shown(_raw_rotate(doc[i])) for i in range(doc.page_count)]
    findings: list[dict] = []
    ocr: list[dict] = []
    notes: list[str] = []
    try:
        layered = _all_layers_on(doc)
    except MemoryError:
        raise
    except Exception:  # noqa: BLE001 - a damaged layer list must not stop the other checks
        layered = None
        notes.append("This PDF's layers could not be switched on to look inside them, so text in layers "
                     "that are switched off was not checked. The other checks ran.")
    unreadable: list[int] = []
    has_text = False
    for index in range(doc.page_count):
        page_no = index + 1
        try:
            page = doc[index]
            page.set_rotation(0)
            layered_page = None
            if layered is not None and index < layered.page_count:
                layered_page = layered[index]
                layered_page.set_rotation(0)
            result = analyse_page(page, page_no, rotations[index], layered_page)
        except MemoryError:
            raise
        except Exception:  # noqa: BLE001 - MuPDF raises several kinds for a page it cannot read
            unreadable.append(page_no)
            continue
        has_text = has_text or result.has_text
        findings.extend(result.findings)
        if result.ocr:
            ocr.append(result.ocr)
        notes.extend(result.notes)

    if unreadable:
        listed = ", ".join(str(p) for p in unreadable[:20]) + (" and others" if len(unreadable) > 20 else "")
        plural = len(unreadable) > 1
        notes.insert(0, f"Page{'s' if plural else ''} {listed} could not be read, so "
                        f"{'they were' if plural else 'it was'} not checked.")
    if not has_text and not findings:
        notes.append("No text was found in this PDF. A scan without OCR holds pictures of text, "
                     "not text, so these checks have nothing to find.")

    counts = Counter(f["reason"] for f in findings)
    words: Counter = Counter()
    for f in findings:
        words[f["reason"]] += f["words"]
    return {
        "ok": True,
        "pages": doc.page_count,
        "pagesChecked": doc.page_count - len(unreadable),
        "summary": {
            "findings": len(findings),
            "byReason": {reason: counts.get(reason, 0) for reason in REASONS},
            "wordsByReason": {reason: words.get(reason, 0) for reason in REASONS},
            "pagesWithFindings": sorted({f["page"] for f in findings}),
            "ocrPages": [item["page"] for item in ocr],
        },
        "findings": findings[:MAX_FINDINGS],
        "findingsTruncated": len(findings) > MAX_FINDINGS,
        "ocr": ocr,
        "notes": notes,
    }


# ── Process protocol ─────────────────────────────────────────────────────────

def _limit(kind: int, soft: int, hard: int) -> None:
    """Lower a resource limit, keeping any hard limit that is already lower."""
    _, current = resource.getrlimit(kind)
    if current != resource.RLIM_INFINITY:
        soft, hard = min(soft, current), min(hard, current)
    resource.setrlimit(kind, (soft, hard))


def _isolate(file_size: int) -> None:
    """Cap memory and CPU time, and never dump core. _sanitize_worker.py has a twin."""
    if sys.platform.startswith("linux"):
        # Where the image runs. macOS does not enforce an address-space limit
        # the same way, and the caller's time limit still applies there.
        memory = MEMORY_BASE_BYTES + MEMORY_PER_FILE_BYTE * file_size
        _limit(resource.RLIMIT_AS, memory, memory)
    _limit(resource.RLIMIT_CPU, CPU_SECONDS, CPU_SECONDS + 5)
    _limit(resource.RLIMIT_CORE, 0, 0)


# The answer goes to the real standard output; anything else a library prints
# while the file is checked goes to standard error, which the caller discards.
_ANSWER = sys.stdout


def _emit(payload: dict, status: int = 0) -> None:
    output = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(output.encode("utf-8")) > MAX_OUTPUT_BYTES:
        output, status = '{"ok": false, "error": "failed"}', 3
    _ANSWER.write(output)
    _ANSWER.flush()
    raise SystemExit(status)


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
    except MemoryError:
        _emit({"ok": False, "error": "too_large"})
    except Exception:  # noqa: BLE001 - MuPDF raises several kinds for a file it cannot read
        _emit({"ok": False, "error": "corrupt"})
    try:
        report = analyse(doc)
    except Refusal as refusal:
        _emit({"ok": False, "error": refusal.kind, **refusal.facts})
    except MemoryError:
        _emit({"ok": False, "error": "too_large"})
    except Exception:  # noqa: BLE001 - the caller logs a failure
        _emit({"ok": False, "error": "failed"}, 1)
    _emit(report)


if __name__ == "__main__":
    main()
