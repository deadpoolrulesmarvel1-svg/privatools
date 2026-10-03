"""Private PDF-to-Markdown subprocess; the web process never parses the upload.

pdf_to_markdown_service runs ``python -I this_file <input pdf> <output file>
<options json>``. The worker writes the Markdown, or a ZIP of Markdown chunks,
to the output file, and only JSON to standard output: a report, with
``"ok": true``, or ``{"ok": false, "error": ...}`` naming "password",
"corrupt", "no_pages", "unreadable", "too_many_pages" (with "pages" and
"limit"), "no_text" (with "kind": "scan" or "blank"), "too_large" or
"failed". A file that needs more CPU time than its pages allow is stopped by
the kernel (SIGXCPU), which the caller reads as too much work.

What is kept, and how it is found (PyMuPDF only, no models):

- Reading order. Pages are read as shown, turned by their /Rotate. Columns
  are found from the white space between them: an upright channel that no
  line crosses, with several lines on each side, splits a stretch of the page
  into a left part read before the right part (the right part first on a
  page of Hebrew or Arabic). A title or table across the columns ends that
  stretch, so text above, then each column, then text below is the order.
  The sides must be columns: running text on both (a justified line that
  MuPDF split at its stretched word spaces counts whole, and a channel
  through those spaces is no gutter), blocks of lines side by side (MuPDF
  keeps each in a block of its own, where a label and its value share one),
  two bulleted lists, or a sidebar beside running text. Drawing order inside
  the file does not matter, and a paragraph that carries on into the next
  column stays whole. Along a line, pieces run left to right, or right to
  left where most of its letters do.
- Headings, from the sizes of the document's type: body text is the most
  common size outside running headers, footers and ruled tables, and larger
  sizes used for short lines are heading levels, the largest first; a
  sentence in larger type is not one. A short line all in bold at body size
  is a heading one level below those. "1. Introduction" in a heading's type
  is a numbered heading, not a list.
- Paragraphs, joined from their lines, also at one and a half or double
  spacing, where a full line that stops mid-sentence carries on; a word
  broken at the end of a line by a hyphen is joined again, and Chinese or
  Japanese lines join without a space.
- Lists: a line starting with a bullet (of many shapes, Word's Courier "o"
  among them), a number or a letter, with the lines under it. Nesting comes
  from how far each mark is indented. Numbers, letters and Roman numerals
  count only in a run (1., 2.), so "A. Smith", or "12." starting a wrapped
  line, stays a sentence, and a dash that starts a wrapped line stays text.
- Tables drawn with ruled lines (PyMuPDF's table finder), and tables ruled
  only across, by thin rules above, below and under their header row (as
  LaTeX's booktabs draws them) or only under the header and at the foot,
  whose columns are found from the gaps between words. They become GitHub
  tables; a first row in bold, or set above the rule under it, is the header
  row. Tables laid out with spaces alone are not found, and come out as
  lines of text.
- Code: lines set in a monospaced font become fenced blocks, indented as on
  the page; a monospaced word inside a sentence becomes inline code.
- Links to web and mail addresses, from the page's link annotations, their
  addresses percent-encoded so that none can carry markup.
- Bold and italic text, and superscripts (footnote marks, exponents) as
  <sup>.
- Pictures become a placeholder, [Image: ...], holding the picture's
  alternative text when the PDF is tagged with one, or its caption when a line
  starting "Figure", "Fig." or the like sits right below or above it; otherwise
  just [Image]. Nothing is described or guessed.

What is left out: rotated text (a diagonal watermark, a label running up the
margin), text outside the page's visible area, and, when asked, running
headers and footers: lines at the top or bottom of at least two pages in
five that are the same on each but for a page number, outside every table
and set apart from the text below or above them (``repeated_lines``,
``drop_running_lines``). A page without a text layer (a scan) is named in
the output and the report; a file without any text is refused.

The limits: work grows with the pages and what they draw, so the process
caps its own memory and CPU time in ``_isolate`` and ``_cap_cpu``, and the
caller stops it after a time limit. Files with more than MAX_PAGES pages are
refused before any page is read.
"""

from __future__ import annotations

import functools
import json
import os
import re
import resource
import statistics
import sys
import unicodedata
import zipfile
from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from urllib.parse import quote

# PyMuPDF under its own name: importing it as "fitz" prints a notice on
# standard output, which is this process's answer to its caller.
import pymupdf as fitz  # noqa: E402

# ── Limits ───────────────────────────────────────────────────────────────────

MAX_PAGES = 1000
# Two web workers each run two heavy jobs at once in a 4 GB container, so four
# of these must fit beside them. Converting 1,000 dense pages peaked at about
# 195 MB of address space.
MEMORY_BASE_BYTES = 512 * 1024 * 1024
MEMORY_PER_FILE_BYTE = 3
# CPU seconds: enough to open any file, then a budget that grows with the
# pages, up to the most one file may use. Measured on the ARM cores the
# server runs on: a page of dense text takes about 30 ms, two columns of it
# 40 ms, a page with a ruled table 65 ms, and a page ruled into 2,400 cells
# 1.1 s; 1,000 dense pages take 30 s.
CPU_SECONDS_OPEN = 30
CPU_SECONDS_BASE = 10
CPU_SECONDS_PER_PAGE = 0.12
CPU_SECONDS_MAX = 60
CPU_GRACE = 5
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
MAX_REPORT_BYTES = 64 * 1024
# Past this many pieces of text on one page, columns are not looked for and
# lines are read top to bottom; past this many drawing items, tables are not.
# A page whose content holds more than MAX_CONTENT_BYTES (about 50,000 lines
# drawn) is not even asked for its drawings: listing a million of them takes
# more memory than the process has.
MAX_PAGE_PIECES = 6000
MAX_TABLE_DRAWINGS = 6000
MAX_CONTENT_BYTES = 1_000_000
# Chunk sizes, in characters of Markdown.
CHUNK_MIN, CHUNK_MAX, CHUNK_DEFAULT = 500, 50_000, 4000
# Bounds on the structure tree walked for pictures' alternative text.
MAX_STRUCT_NODES = 50_000

TEXT_FLAGS = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP

# ── Options ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Options:
    page_markers: bool = True
    remove_headers_footers: bool = True
    chunk: str = "none"          # none | headings | size
    chunk_size: int = CHUNK_DEFAULT
    chunk_output: str = "zip"    # zip | single

    @classmethod
    def parse(cls, raw: str | dict | None) -> "Options":
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        chunk = data.get("chunk", "none")
        output = data.get("chunk_output", "zip")
        size = int(data.get("chunk_size", CHUNK_DEFAULT))
        if chunk not in ("none", "headings", "size") or output not in ("zip", "single"):
            raise ValueError("bad options")
        return cls(
            page_markers=bool(data.get("page_markers", True)),
            remove_headers_footers=bool(data.get("remove_headers_footers", True)),
            chunk=chunk, chunk_size=min(CHUNK_MAX, max(CHUNK_MIN, size)), chunk_output=output,
        )


class Refusal(Exception):
    def __init__(self, error: str, **facts):
        super().__init__(error)
        self.kind = error
        self.facts = facts


# ── Fonts ────────────────────────────────────────────────────────────────────

_MONO = re.compile(
    r"courier|mono|consol|menlo|monaco|inconsolata|lucida ?console|andale|typewriter|fixedsys|cmtt|"
    r"sfmono|jetbrains|fira ?code|\bhack\b|source ?code|nimbusmon|lmmono|cousine|letter ?gothic|ocr-?[ab]\b",
    re.I)
_BOLD = re.compile(r"bold|black|heavy|semibold|demibold|[-,]bd\b|\bbd\b", re.I)
_ITALIC = re.compile(r"italic|oblique|[-,]it\b", re.I)


def _font_name(font: str) -> str:
    """Without a subset prefix ("ABCDEF+Calibri-Bold" is "Calibri-Bold")."""
    return font.split("+", 1)[1] if len(font) > 7 and font[6] == "+" else font


@functools.lru_cache(maxsize=1024)
def _style(font: str, flags: int) -> tuple[bool, bool, bool]:
    name = _font_name(font)
    mono = bool(flags & fitz.TEXT_FONT_MONOSPACED) or bool(_MONO.search(name))
    bold = bool(flags & fitz.TEXT_FONT_BOLD) or bool(_BOLD.search(name))
    italic = bool(flags & fitz.TEXT_FONT_ITALIC) or bool(_ITALIC.search(name))
    return bold, italic, mono


# ── Pieces of text, in the page as shown ─────────────────────────────────────


@dataclass
class Run:
    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    link: str | None = None
    sup: bool = False             # raised and smaller: a footnote mark, an exponent

    @property
    def style(self) -> tuple:
        return (self.bold, self.italic, self.mono, self.link, self.sup)

    def copy(self, text: str | None = None) -> "Run":
        return Run(self.text if text is None else text, self.bold, self.italic, self.mono, self.link, self.sup)


@dataclass
class Piece:
    """One line of text as MuPDF reads it (split at a wide gap), a table or a picture."""

    x0: float
    y0: float
    x1: float
    y1: float
    base: float
    size: float
    runs: list[Run] = field(default_factory=list)
    kind: str = "text"            # text | table | image
    data: object = None
    raw_line: int = -1            # which MuPDF line it came from
    block: int = -1               # and which MuPDF block
    # A space before or after it where MuPDF split a line: a word space that
    # justification stretched, not a gap between cells or columns.
    space_before: bool = False
    space_after: bool = False
    rtl: int = 0                  # letters written right to left (Hebrew, Arabic)
    ltr: int = 0                  # and left to right

    @property
    def text(self) -> str:
        return "".join(r.text for r in self.runs)

    @property
    def yc(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Frame:
    """The page turned so that its text runs left to right.

    ``unrot`` maps PDF space (where MuPDF gives text, pictures and drawings)
    and ``shown`` maps the page as shown (where it gives links and tables)
    into that reading space; None is no change. A page turned by /Rotate is
    read as shown, and a page whose text runs up or down it (a wide table
    printed sideways) is read along its text."""

    unrot: fitz.Matrix | None
    shown: fitz.Matrix | None
    rect: fitz.Rect


_TURNS = {(1, 0): 0, (0, 1): 270, (-1, 0): 180, (0, -1): 90}


def _span_len(span: dict) -> int:
    return len(span["chars"]) if "chars" in span else len(span.get("text", ""))


def page_frame(page: fitz.Page, lines: list[dict]) -> Frame:
    shown = page.rotation_matrix if page.rotation % 360 else None
    weights: Counter = Counter()
    for line in lines:
        dx, dy = line["dir"]
        if shown is not None:
            dx, dy = dx * shown.a + dy * shown.c, dx * shown.b + dy * shown.d
        key = (round(dx), round(dy))
        if key in _TURNS and abs(abs(dx) + abs(dy) - 1) < 0.05:
            weights[key] += sum(_span_len(sp) for sp in line["spans"])
    turn = _TURNS[weights.most_common(1)[0][0]] if weights else 0
    turned = fitz.Matrix(turn) if turn else None
    if shown is None and turned is None:
        return Frame(None, None, fitz.Rect(page.rect))
    unrot = turned if shown is None else (shown if turned is None else shown * turned)
    rect = page.rect * turned if turned is not None else fitz.Rect(page.rect)
    return Frame(unrot, turned, rect)


def _along(line: dict, frame: Frame) -> bool:
    """Whether a line runs along the page's text (rotated text does not:
    a diagonal watermark, a label up the margin)."""
    dx, dy = line["dir"]
    m = frame.unrot
    if m is not None:
        dx = dx * m.a + dy * m.c
    return dx >= 0.95


def _text_lines(data: dict) -> list[dict]:
    return [line for block in data["blocks"] if block.get("type") == 0 for line in block["lines"]]


def _to(box, matrix: fitz.Matrix | None) -> fitz.Rect:
    return fitz.Rect(box) * matrix if matrix is not None else fitz.Rect(box)


_SAFE_SCHEMES = ("http://", "https://", "mailto:", "ftp://", "tel:")


def _links(page: fitz.Page, frame: Frame) -> list[tuple[fitz.Rect, str]]:
    """Web and mail links (PyMuPDF gives their areas in the page as shown)."""
    found = []
    for link in page.get_links():
        uri = (link.get("uri") or "").strip()
        if link.get("kind") == fitz.LINK_URI and uri.lower().startswith(_SAFE_SCHEMES):
            found.append((_to(link["from"], frame.shown), uri))
    return found


_PAGE_NUMBER = re.compile(
    r"(?:(?:page|pg|p|seite|s|página|pág|pagina|pag|side|sida|strona|str)\.?)?(#|[ivxlc]{1,7})"
    r"(?:(?:of|/|von|de|di|z|av|af)#)?")


def line_key(text: str) -> tuple[str, tuple[int, ...]] | None:
    """A line as compared across pages: its letters in lower case, without
    spaces, with each number as #, and the numbers. A Roman numeral is a
    number only where it is the whole of a page number ("Page iv")."""
    text = "".join(ch for ch in text.lower() if ch not in _DROP)
    text = "".join(text.split()).strip(".-–—|·•()[]")
    if not text or len(text) > 200:
        return None
    numbers = [int(n[-9:]) for n in re.findall(r"\d+", text)]
    template = re.sub(r"\d+", "#", text)
    page = _PAGE_NUMBER.fullmatch(template)
    if page and page.group(1) != "#":
        value = _roman(page.group(1))
        if value:
            start = page.start(1)
            template = template[:start] + "#" + template[page.end(1):]
            numbers = [value] + numbers
    return template, tuple(numbers)


@dataclass
class PageText:
    frame: Frame
    pieces: list[Piece]
    line_texts: dict[int, str]          # MuPDF line number -> its text as printed
    line_boxes: dict[int, fitz.Rect]


def read_text(page: fitz.Page) -> PageText:
    """The page's text as pieces, in its reading frame: lines that run along
    the page's text, split where a gap is wider than a word space can be."""
    data = page.get_text("rawdict", flags=TEXT_FLAGS)
    lines = _text_lines(data)
    frame = page_frame(page, lines)
    links = _links(page, frame)
    matrix = frame.unrot
    pieces: list[Piece] = []
    line_texts: dict[int, str] = {}
    line_boxes: dict[int, fitz.Rect] = {}
    line_no = -1
    for block_no, block in enumerate(data["blocks"]):
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            line_no += 1
            if not _along(line, frame):
                continue
            made = _split_line(line, line_no, block_no, frame.rect, matrix, links)
            if made:
                pieces.extend(made)
                line_texts[line_no] = " ".join(p.text for p in made)
                box = fitz.Rect(made[0].x0, made[0].y0, made[0].x1, made[0].y1)
                for p in made[1:]:
                    box |= fitz.Rect(p.x0, p.y0, p.x1, p.y1)
                line_boxes[line_no] = box
    return PageText(frame, pieces, line_texts, line_boxes)


# Characters read as a space, and characters that are not text at all (a soft
# hyphen, zero-width and direction marks, a byte-order mark).
_SPACES = frozenset("\u00a0\t\u2002\u2003\u2009\u202f")
_DROP = frozenset("\u00ad\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\u202a\u202b\u202c\u202d\u202e"
                  "\u2066\u2067\u2068\u2069")


def _split_line(line: dict, line_no: int, block_no: int, visible: fitz.Rect, matrix, links) -> list[Piece]:
    """One MuPDF line as pieces, split at a gap wider than a word space can be.

    This runs for every character of the document, so it works on plain
    numbers rather than PyMuPDF's Rect and Point objects."""
    vx0, vy0, vx1, vy1 = visible.x0, visible.y0, visible.x1, visible.y1
    turned = matrix is not None
    if turned:
        ma, mb, mc, md, me, mf = matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f
    near = []
    if links:
        lb = _to(line["bbox"], matrix)
        near = [(r, u) for r, u in links if r.y1 >= lb.y0 - 2 and r.y0 <= lb.y1 + 2 and r.x1 >= lb.x0 - 2 and r.x0 <= lb.x1 + 2]
    pieces: list[Piece] = []
    # [x0, y0, x1, y1, base, runs, sizes, space before]; a run is [parts, bold, italic, mono, link, sup]
    cur: list | None = None
    prev_x1 = None
    lead_space = False

    def close(state: list) -> None:
        runs = state[5]
        trailing = False
        while runs and not "".join(runs[-1][0]).strip():
            runs.pop()
            trailing = True
        if not runs:
            return
        made = [Run("".join(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in runs]
        if made[-1].text != made[-1].text.rstrip():
            made[-1].text = made[-1].text.rstrip()
            trailing = True
        if all(r.sup for r in made):
            for r in made:
                r.sup = False  # a whole line raised is not a superscript
        sizes = state[6]
        size = max(sizes, key=sizes.get) if sizes else 0
        rtl, ltr = _directions("".join(r.text for r in made))
        pieces.append(Piece(state[0], state[1], state[2], state[3], state[4], size, made, raw_line=line_no,
                            block=block_no, space_before=state[7], space_after=trailing, rtl=rtl, ltr=ltr))

    for span in line["spans"]:
        size = round(span["size"], 1)
        bold, italic, mono = _style(span.get("font", ""), span.get("flags", 0))
        sup = bool(span.get("flags", 0) & fitz.TEXT_FONT_SUPERSCRIPT)
        gap_limit = max(1.6 * size, 12.0)
        for ch in span["chars"]:
            c = ch["c"]
            x0, y0, x1, y1 = ch["bbox"]
            if turned:
                ax, ay = x0 * ma + y0 * mc + me, x0 * mb + y0 * md + mf
                bx, by = x1 * ma + y1 * mc + me, x1 * mb + y1 * md + mf
                x0, x1 = (ax, bx) if ax <= bx else (bx, ax)
                y0, y1 = (ay, by) if ay <= by else (by, ay)
                ox, oy = ch["origin"]
                base = ox * mb + oy * md + mf
            else:
                base = ch["origin"][1]
            if x1 < vx0 or x0 > vx1 or y1 < vy0 or y0 > vy1:
                continue
            if c in _SPACES:
                c = " "
            elif c in _DROP or c < " " or "\x7f" <= c <= "\x9f":
                continue
            if cur is not None and prev_x1 is not None and (
                    x0 - prev_x1 > gap_limit or (c == " " and x1 - x0 > gap_limit)):
                close(cur)
                cur = None
                lead_space = True
            prev_x1 = x1
            if cur is None:
                if c == " ":
                    lead_space = True
                    continue
                cur = [x0, y0, x1, y1, base, [], {}, lead_space]
            link = None
            if near:
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                for rect, uri in near:
                    if rect.x0 - 1 <= mx <= rect.x1 + 1 and rect.y0 - 1 <= my <= rect.y1 + 1:
                        link = uri
                        break
            runs = cur[5]
            last = runs[-1] if runs else None
            if last is not None and (c == " " or (last[1] == bold and last[2] == italic and last[3] == mono
                                                  and last[4] == link and last[5] == sup)):
                last[0].append(c)  # a space keeps the style before it
            else:
                runs.append([[c], bold, italic, mono, link, sup])
            if c != " ":
                cur[6][size] = cur[6].get(size, 0) + 1
            if x0 < cur[0]:
                cur[0] = x0
            if y0 < cur[1]:
                cur[1] = y0
            if x1 > cur[2]:
                cur[2] = x1
            if y1 > cur[3]:
                cur[3] = y1
    if cur is not None:
        close(cur)
    return pieces


def _directions(text: str) -> tuple[int, int]:
    """How many of the text's characters run right to left, and how many
    left to right. Text without any letter past Latin, Greek and Cyrillic
    runs left to right, and is not looked at letter by letter."""
    if not text or max(text) < "\u0590":
        return 0, len(text) - text.count(" ")
    rtl = ltr = 0
    for ch in text:
        if ch < "\u0590":
            ltr += ch.isalpha()
        else:
            direction = unicodedata.bidirectional(ch)
            rtl += direction in ("R", "AL")
            ltr += direction == "L"
    return rtl, ltr


# ── Pictures ─────────────────────────────────────────────────────────────────

# A picture smaller than this share of the page, and under 72 points both
# ways, is decoration (a logo, an icon, a rule drawn as an image).
MIN_IMAGE_SHARE = 0.015


def read_images(page: fitz.Page, frame: Frame, alts: dict[int, str]) -> list[Piece]:
    if not page.get_images():
        return []  # get_image_info reads the whole page again; most pages draw no picture
    area = abs(frame.rect)
    found = []
    seen = set()
    for info in page.get_image_info(xrefs=True):
        box = _to(info["bbox"], frame.unrot) & frame.rect
        if box.is_empty:
            continue
        if abs(box) < MIN_IMAGE_SHARE * area and box.width < 72 and box.height < 72:
            continue
        key = tuple(round(v) for v in box)
        if key in seen:
            continue
        seen.add(key)
        alt = alts.get(info.get("xref") or 0, "")
        found.append(Piece(box.x0, box.y0, box.x1, box.y1, box.y1, 0, kind="image", data={"alt": alt}))
    return found


def figure_alts(doc: fitz.Document, page: fitz.Page, figures: dict[int, dict[int, str]]) -> dict[int, str]:
    """Alternative text by image xref, for a tagged page whose Figures carry /Alt.

    Marked content sequences in the page's own content name the MCID of each
    picture they draw; the structure tree (``figures``) gives each MCID's
    text. Only pictures drawn directly by the page are matched."""
    by_mcid = figures.get(page.xref)
    if not by_mcid:
        return {}
    names = {}
    for item in page.get_images(full=True):
        xref, name, referencer = item[0], item[7], item[9]
        if not referencer:
            names[name] = xref
    if not names:
        return {}
    try:
        content = page.read_contents()
    except Exception:  # noqa: BLE001
        return {}
    out: dict[int, str] = {}
    stack: list[int | None] = []
    token = re.compile(rb"/MCID\s+(\d+)[^B]*?BDC|\bBDC\b|\bBMC\b|\bEMC\b|/([^\s/<>\[\]()]+)\s+Do\b")
    for m in token.finditer(content):
        whole = m.group(0)
        if m.group(1) is not None:
            stack.append(int(m.group(1)))
        elif whole.endswith((b"BDC", b"BMC")):
            stack.append(None)
        elif whole == b"EMC":
            if stack:
                stack.pop()
        elif m.group(2) is not None:
            mcid = next((v for v in reversed(stack) if v is not None), None)
            name = m.group(2).decode("latin-1")
            if mcid is not None and mcid in by_mcid and name in names:
                out.setdefault(names[name], by_mcid[mcid])
    return out


def tagged_figures(doc: fitz.Document) -> dict[int, dict[int, str]]:
    """{page xref: {mcid: alt}} for every Figure element with /Alt (bounded walk)."""
    cat = doc.pdf_catalog()
    kind, root = doc.xref_get_key(cat, "StructTreeRoot")
    if kind != "xref":
        return {}
    figures: dict[int, dict[int, str]] = defaultdict(dict)
    todo = [(int(root.split()[0]), None)]
    seen = set()
    while todo and len(seen) < MAX_STRUCT_NODES:
        xref, page = todo.pop()
        if xref in seen or xref <= 0:
            continue
        seen.add(xref)
        if doc.xref_get_key(xref, "Pg")[0] == "xref":
            page = int(doc.xref_get_key(xref, "Pg")[1].split()[0])
        role = doc.xref_get_key(xref, "S")[1]
        alt_kind, alt = doc.xref_get_key(xref, "Alt")
        k_kind, k_val = doc.xref_get_key(xref, "K")
        if role == "/Figure" and alt_kind == "string" and alt.strip() and page:
            for mcid in _mcids(k_kind, k_val):
                figures[page][mcid] = " ".join(alt.split())
        if k_kind == "xref":
            todo.append((int(k_val.split()[0]), page))
        elif k_kind == "array":
            for ref in re.findall(r"(\d+) 0 R", k_val):
                todo.append((int(ref), page))
    return dict(figures)


def _mcids(kind: str, value: str) -> list[int]:
    """The marked-content ids a structure element's /K names: a number, an
    array of numbers and references, or marked-content reference dictionaries."""
    if kind == "int":
        return [int(value)]
    if kind == "array":
        ids = [int(v) for v in re.findall(r"(?<![\d/])(\d+)(?! 0 R)(?!\d)", re.sub(r"\d+ 0 R", "", value))]
        ids += [int(v) for v in re.findall(r"/MCID (\d+)", value)]
        return ids
    if kind == "dict":
        return [int(v) for v in re.findall(r"/MCID (\d+)", value)]
    return []


# ── Tables ───────────────────────────────────────────────────────────────────


@dataclass
class Ruling:
    horizontal: list[tuple[float, float, float]]   # thin rules across, (y, x0, x1) in the reading frame
    regions: list[fitz.Rect]                        # areas ruled both ways, where a table may be
    items: int                                      # drawing items on the page
    crowded: bool = False                           # too much drawn to read the drawings at all


def drawn_bytes(page: fitz.Page, limit: int) -> int:
    """How much the page's content streams hold, with every form they draw
    (each counted once), stopping past ``limit``: a cheap measure of how much
    reading its drawings would cost, taken before they are read."""
    doc = page.parent
    total = 0
    try:
        xrefs = list(page.get_contents()) + [x[0] for x in page.get_xobjects()]
    except Exception:  # noqa: BLE001 - a page whose resources cannot be read has no drawings to read
        return limit + 1
    for xref in xrefs:
        try:
            total += len(doc.xref_stream(xref) or b"")
        except Exception:  # noqa: BLE001
            continue
        if total > limit:
            break
    return total


def _rules(page: fitz.Page, frame: Frame) -> Ruling:
    """The page's ruled lines, in the reading frame: thin horizontal rules
    (for tables ruled only across), and regions holding lines both ways
    (where PyMuPDF's table finder looks; searching the whole page costs five
    times as much). A filled or framed rectangle bounds a region but is not
    a rule, and one covering half the page or more (a slide's background, a
    page border) bounds nothing: it would make the whole page a table."""
    if drawn_bytes(page, MAX_CONTENT_BYTES) > MAX_CONTENT_BYTES:
        return Ruling([], [], 0, crowded=True)
    matrix = frame.unrot
    horizontal: list[tuple[float, float, float]] = []
    segments: list[tuple[fitz.Rect, str]] = []
    items = 0
    backdrop = 0.5 * abs(frame.rect)
    for path in page.get_cdrawings():
        for item in path.get("items", ()):
            items += 1
            if items > MAX_TABLE_DRAWINGS:
                return Ruling([], [], items)
            op = item[0]
            if op == "l":
                a, b = fitz.Point(item[1]), fitz.Point(item[2])
                if matrix is not None:
                    a, b = a * matrix, b * matrix
                box = fitz.Rect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
                if box.height < 1 and box.width >= 8:
                    horizontal.append(((a.y + b.y) / 2, box.x0, box.x1))
                    segments.append((box, "h"))
                elif box.width < 1 and box.height >= 5:
                    segments.append((box, "v"))
            elif op == "re":
                r = _to(item[1], matrix)
                if r.height <= 2.5 and r.width >= 8:
                    horizontal.append(((r.y0 + r.y1) / 2, r.x0, r.x1))
                    segments.append((r, "h"))
                elif r.width <= 2.5 and r.height >= 5:
                    segments.append((r, "v"))
                elif r.width >= 8 and r.height >= 5 and abs(r) < backdrop:
                    segments += [(r, "h"), (r, "v")]
    return Ruling(horizontal, _ruled_regions(segments), items)


def _ruled_regions(segments: list[tuple[fitz.Rect, str]]) -> list[fitz.Rect]:
    """Groups of touching segments with at least two lines each way.

    Plain numbers, not Rect methods: a ruled line's box has no height (or no
    width), and PyMuPDF treats such a rectangle as empty, so it would never
    touch anything."""
    groups: list[list[float]] = []   # [x0, y0, x1, y1, horizontal count, vertical count]
    for box, kind in sorted(segments, key=lambda seg: (seg[0].y0, seg[0].x0)):
        x0, y0, x1, y1 = box.x0 - 3, box.y0 - 3, box.x1 + 3, box.y1 + 3
        merged = [box.x0, box.y0, box.x1, box.y1, 1 if kind == "h" else 0, 1 if kind == "v" else 0]
        keep = []
        for g in groups:
            if g[0] <= x1 and x0 <= g[2] and g[1] <= y1 and y0 <= g[3]:
                merged = [min(merged[0], g[0]), min(merged[1], g[1]), max(merged[2], g[2]), max(merged[3], g[3]),
                          merged[4] + g[4], merged[5] + g[5]]
            else:
                keep.append(g)
        groups = keep + [merged]
    return [fitz.Rect(g[:4]) for g in groups if g[4] >= 2 and g[5] >= 2]


def _cell(text: str | None) -> str:
    """A cell on one line: a word hyphenated at a line break is joined again
    ("Pre- and post-" keeps its hyphen), Markdown's own characters are
    escaped as in a paragraph, and a pipe cannot end the cell."""
    text = re.sub(r"(?<=[a-zà-ž])-\n(?=[a-zà-ž])", "", text or "")
    return _escape(" ".join(text.split())).replace("|", "\\|")


def table_markdown(rows: list[list[str]], header: bool) -> str:
    width = max(len(r) for r in rows)
    rows = [[_cell(c) for c in r] + [""] * (width - len(r)) for r in rows]
    keep = [i for i in range(width) if any(r[i] for r in rows)]
    rows = [[r[i] for i in keep] for r in rows]
    rows = [r for r in rows if any(r)]
    if not rows or not keep:
        return ""
    head, body = (rows[0], rows[1:]) if header else ([""] * len(keep), rows)
    line = lambda cells: "| " + " | ".join(cells) + " |"  # noqa: E731
    return "\n".join([line(head), line(["---"] * len(keep))] + [line(r) for r in body])


def _bold_share(pieces: list[Piece], box: fitz.Rect) -> float:
    total = bold = 0
    for p in pieces:
        if box.x0 - 1 <= p.xc <= box.x1 + 1 and box.y0 - 1 <= p.yc <= box.y1 + 1:
            for r in p.runs:
                n = len(r.text.strip())
                total += n
                bold += n if r.bold else 0
    return bold / total if total else 0.0


def ruled_tables(page: fitz.Page, pieces: list[Piece], frame: Frame, regions: list[fitz.Rect]) -> list[Piece]:
    """Tables drawn with lines both ways, from PyMuPDF's table finder, which
    works in the page as shown and is given one ruled region at a time."""
    back = ~frame.shown if frame.shown is not None else None
    tables = []
    for region in regions:
        clip = _to((region.x0 - 2, region.y0 - 2, region.x1 + 2, region.y1 + 2), back)
        try:
            tables += page.find_tables(clip=clip, strategy="lines").tables
        except Exception:  # noqa: BLE001 - a region the finder cannot read keeps its text
            continue
    out = []
    for table in tables:
        if table.row_count < 2 or table.col_count < 2:
            continue  # a box around a note, or a page border
        grid = _reading_grid(table, frame)
        if not grid:
            continue
        rows, first, box = grid
        header = _bold_share(pieces, first) >= 0.8
        md = table_markdown(rows, header)
        if md:
            out.append(Piece(box.x0, box.y0, box.x1, box.y1, box.y1, 0, kind="table",
                             data={"md": md, "rows": len(rows)}))
    return out


def _reading_grid(table, frame: Frame):
    """The table's rows as read, the first row's area and the table's, in the
    reading frame. PyMuPDF finds tables in the page as shown; a table printed
    sideways is read along its text, so its rows are rebuilt from its cells."""
    texts = table.extract()
    if frame.shown is None:
        first = fitz.Rect(table.rows[0].bbox) if table.rows else fitz.Rect(table.bbox)
        return texts, first, fitz.Rect(table.bbox)
    cells = []
    for r, row in enumerate(table.rows):
        for c, box in enumerate(row.cells):
            if box is None or r >= len(texts) or c >= len(texts[r]):
                continue
            cells.append((_to(box, frame.shown), texts[r][c]))
    if not cells:
        return None
    cells.sort(key=lambda cell: (cell[0].y0 + cell[0].y1) / 2)
    rows_cells: list[list] = []
    for rect, text in cells:
        mid = (rect.y0 + rect.y1) / 2
        if rows_cells and abs(mid - rows_cells[-1][0][2]) <= 2:
            rows_cells[-1].append((rect, text, mid))
        else:
            rows_cells.append([(rect, text, mid)])
    rows = [[t for _, t, _ in sorted(r, key=lambda cell: cell[0].x0)] for r in rows_cells]
    first = fitz.Rect(rows_cells[0][0][0])
    for rect, _, _ in rows_cells[0][1:]:
        first |= rect
    return rows, first, _to(table.bbox, frame.shown)


def rule_bounded_tables(page_words: list[tuple], rules: list[tuple[float, float, float]], taken: list[fitz.Rect],
                        size: float) -> list[Piece]:
    """Tables ruled only across (booktabs): two or more rules of the same
    width bound the table; columns are the gaps between words that no row
    crosses; the rows above the first inner rule are the header. A table
    ruled under its header and at its foot, with no rule above, takes the
    row sitting on the first rule as its header, when that row's words fall
    in the table's columns."""
    rules = sorted({(round(y, 1), round(a), round(b)) for y, a, b in rules if b - a >= 60})
    stacks: dict[tuple[int, int], list[float]] = defaultdict(list)
    for y, a, b in rules:
        key = next((k for k in stacks if abs(k[0] - a) <= 4 and abs(k[1] - b) <= 4), (a, b))
        stacks[key].append(y)
    out = []
    for (a, b), ys in stacks.items():
        ys = sorted(set(ys))
        if len(ys) < 2:
            continue
        region = fitz.Rect(a - 2, ys[0], b + 2, ys[-1])
        if region.height < 2 * size or any(region.intersects(t) for t in taken):
            continue
        words = [w for w in page_words if region.contains(fitz.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))]
        table = _aligned_table(words, ys, size)
        if table and not table[1]:
            head = _row_on_rule(page_words, a, b, ys[0], size)
            with_head = _aligned_table(head + words, [ys[0] - 2 * size] + ys, size) if head else None
            if with_head and with_head[1] and len(with_head[0][0]) == len(table[0][0]):
                table = with_head
                region.y0 = min(w[1] for w in head)
        if table:
            rows, header = table
            md = table_markdown(rows, header)
            if md:
                out.append(Piece(region.x0, region.y0, region.x1, region.y1, region.y1, 0, kind="table",
                                 data={"md": md, "rows": len(rows)}))
    return out


def _row_on_rule(page_words: list[tuple], a: float, b: float, rule_y: float, size: float) -> list[tuple]:
    """The words of the one line sitting directly on a rule (its foot within
    about two thirds of a letter of it), across the rule's width."""
    words = [w for w in page_words if a - 2 <= (w[0] + w[2]) / 2 <= b + 2
             and rule_y - 2 * size <= (w[1] + w[3]) / 2 < rule_y and w[3] >= rule_y - 0.7 * size]
    if len(words) < 2 or max(w[1] for w in words) - min(w[1] for w in words) > 0.5 * size:
        return []
    return words


def _aligned_table(words: list[tuple], rule_ys: list[float], size: float):
    if len(words) < 4:
        return None
    # Columns: maximal x-intervals covered by words, split by gaps of at least
    # about a letter and a half that no word crosses.
    spans = sorted((w[0], w[2]) for w in words)
    cols = [[spans[0][0], spans[0][1]]]
    for x0, x1 in spans[1:]:
        if x0 - cols[-1][1] >= max(1.0 * size, 6):
            cols.append([x0, x1])
        else:
            cols[-1][1] = max(cols[-1][1], x1)
    if len(cols) < 2 or len(cols) > 20:
        return None
    # Rows: words whose middles share a line.
    by_line = sorted(words, key=lambda w: (w[1] + w[3]) / 2)
    lines: list[list[tuple]] = []
    for w in by_line:
        mid = (w[1] + w[3]) / 2
        if lines and abs(mid - (lines[-1][0][1] + lines[-1][0][3]) / 2) <= 0.45 * size:
            lines[-1].append(w)
        else:
            lines.append([w])
    rows: list[list[str]] = []
    tops: list[float] = []
    for ln in lines:
        cells = [[] for _ in cols]
        for w in sorted(ln, key=lambda w: w[0]):
            mid = (w[0] + w[2]) / 2
            i = next((k for k, (c0, c1) in enumerate(cols) if c0 - 1 <= mid <= c1 + 1), None)
            if i is None:
                return None
            cells[i].append(w[4])
        row = [" ".join(c) for c in cells]
        top = min(w[1] for w in ln)
        # A line with nothing in the first column, close under the last row,
        # carries on that row's cells (a wrapped cell).
        if rows and not row[0] and top - tops[-1] < 1.6 * size and not _rule_between(rule_ys, tops[-1], top):
            rows[-1] = [(f"{x} {y}".strip()) for x, y in zip(rows[-1], row)]
            tops[-1] = top
            continue
        rows.append(row)
        tops.append(top)
    if len(rows) < 2:
        return None
    cells = [c for r in rows for c in r]
    if sum(1 for c in cells if not c) > len(cells) / 2:
        return None
    if statistics.median(len(c) for c in cells) > 40:
        return None  # columns of running text, not a table
    inner = [y for y in rule_ys[1:-1]]
    header_rows = sum(1 for t in tops if inner and t < inner[0])
    if header_rows > 1:
        merged = [" ".join(filter(None, col)) for col in zip(*rows[:header_rows])]
        rows = [merged] + rows[header_rows:]
        header_rows = 1
    return rows, header_rows == 1


def _rule_between(ys: list[float], top: float, bottom: float) -> bool:
    i = bisect_left(ys, top)
    return i < len(ys) and ys[i] < bottom


# ── Reading order ────────────────────────────────────────────────────────────


def _gutter(items: list[Piece], blocks: dict | None = None, page_width: float = 0.0):
    """The strongest column gutter among ``items``: (x0, x1, top, bottom), or None.

    A gutter is an upright channel at least half a letter wide that no item
    crosses over a stretch of the page, with at least two lines on each side
    within that stretch, where the sides are columns (``_columns``, which
    measures lines against the width of the page's text, ``page_width``, so
    a narrow part of the page does not make short lines look like prose)."""
    text = [p for p in items if p.kind == "text"] or items
    left_edge = min(p.x0 for p in items)
    right_edge = max(p.x1 for p in items)
    width = right_edge - left_edge
    if width < 100:
        return None
    size = statistics.median(p.size for p in text if p.size) if any(p.size for p in text) else 10
    step = 2.0
    bins = int(width / step) + 1
    cover = [0] * bins
    for p in items:
        a = int((p.x0 - left_edge) / step)
        b = int((p.x1 - left_edge) / step)
        for i in range(max(a, 0), min(b + 1, bins)):
            cover[i] += 1
    peak = max(cover)
    lo, hi = int(0.18 * bins), int(0.82 * bins)
    candidates = []
    i = lo
    while i < hi:
        if cover[i] <= 0.5 * peak:
            j = i
            while j < hi and cover[j] <= 0.5 * peak:
                j += 1
            low = min(cover[i:j])
            # Test the emptiest bins of the stretch.
            for k in range(i, j):
                if cover[k] == low:
                    candidates.append(left_edge + (k + 0.5) * step)
            i = j
        else:
            i += 1
    best = None
    tested = set()
    for x in candidates:
        key = round(x / 6)
        if key in tested:
            continue
        tested.add(key)
        crossing = sorted((p for p in items if p.x0 < x < p.x1), key=lambda p: p.y0)
        bounds = [-1e9] + [v for p in crossing for v in (p.y0, p.y1)] + [1e9]
        for top, bottom in zip(bounds[0::2], bounds[1::2]):
            if bottom - top < 2 * size:
                continue
            inside = [p for p in items if top <= p.yc <= bottom and not (p.x0 < x < p.x1)]
            left = [p for p in inside if p.x1 <= x]
            right = [p for p in inside if p.x0 >= x]
            if len(left) < 2 or len(right) < 2:
                continue
            g0, g1 = max(p.x1 for p in left), min(p.x0 for p in right)
            if g1 - g0 < max(0.5 * size, 4) or _through_words(left, right):
                continue
            if not _columns(left, right, max(width, page_width), blocks):
                continue
            score = (min(len(left), len(right)), g1 - g0)
            if best is None or score > best[0]:
                best = (score, (g0, g1, top, bottom))
    return best[1] if best else None


def _through_words(left: list[Piece], right: list[Piece]) -> bool:
    """Whether a channel runs through the word spaces of justified lines:
    most lines with words on both sides of it are one MuPDF line that MuPDF
    split there, at a space that justification stretched. Two columns are
    never one line, and nothing joins them with a space."""
    ends: dict = {}
    starts: dict = {}
    for p in left:
        if p.kind == "text" and p.block >= 0:
            key = (p.block, round(p.base))
            if key not in ends or p.x1 > ends[key].x1:
                ends[key] = p
    for p in right:
        if p.kind == "text" and p.block >= 0:
            key = (p.block, round(p.base))
            if key not in starts or p.x0 < starts[key].x0:
                starts[key] = p
    shared = ends.keys() & starts.keys()
    if len(shared) < 2:
        return False
    spaced = sum(1 for key in shared if ends[key].space_after or starts[key].space_before)
    return spaced > len(shared) / 2


def _extent(side: list[Piece]) -> float:
    return max(p.x1 for p in side) - min(p.x0 for p in side)


def _word_split(left: Piece, right: Piece) -> bool:
    """Whether two pieces side by side are one line that MuPDF split at a
    word space justification stretched: the same block and baseline, and
    the space between them still there (cells of a table have none)."""
    if left.kind != "text" or right.kind != "text" or left.block < 0 or left.block != right.block \
            or round(left.base) != round(right.base):
        return False
    if right.rtl > right.ltr:
        return right.space_after or left.space_before
    return left.space_after or right.space_before


def _prose(side: list[Piece], width: float) -> bool:
    """Running text: its usual line is at least a quarter of the width, and
    most of its lines are about that long (a paragraph's last line may not
    be). A justified line that MuPDF split at its wide word spaces counts
    whole (``_word_split``). A side holding two columns of its own passes
    too."""
    spans: list[list] = []   # [x0, x1, last piece]
    for p in sorted(side, key=lambda q: (q.block, round(q.base), q.x0)):
        if spans and _word_split(spans[-1][2], p):
            spans[-1][1], spans[-1][2] = max(spans[-1][1], p.x1), p
        else:
            spans.append([p.x0, p.x1, p])
    widths = sorted(x1 - x0 for x0, x1, _ in spans)
    usual = widths[min(len(widths) - 1, int(0.8 * len(widths)))]
    if usual < 0.25 * width:
        return False
    return sum(1 for w in widths if w >= 0.75 * usual) >= 0.5 * len(widths)


def _bulleted(side: list[Piece]) -> bool:
    """Whether a side is a bulleted list: two of its lines at least, and
    half of them, start with a bullet."""
    starts: dict[int, Piece] = {}
    for p in side:
        if p.kind == "text" and (round(p.base) not in starts or p.x0 < starts[round(p.base)].x0):
            starts[round(p.base)] = p
    marked = sum(1 for p in starts.values() if _BULLET_START.match(p.text))
    return marked >= 2 and marked >= 0.5 * len(starts)


def _all_bold(p: Piece) -> bool:
    letters = [r for r in p.runs if r.text.strip()]
    return bool(letters) and all(r.bold for r in letters)


def _apart(left: list[Piece], right: list[Piece], blocks: dict) -> bool:
    """Blocks of lines side by side, as an invoice's two addresses are: each
    side's text comes from MuPDF blocks lying wholly on that side, and one
    of them holds several lines. A label and its value, or the cells of a
    table's row, share a block across the gap, so they stay rows; so do
    labels set apart from their values (a form filled in after it was
    drawn), known by being all bold or all ending in a colon."""
    edge = (max(p.x1 for p in left) + min(p.x0 for p in right)) / 2
    several = False
    for side, on_left in ((left, True), (right, False)):
        for b in {p.block for p in side if p.kind == "text"}:
            if b not in blocks:
                return False
            x0, x1, lines = blocks[b]
            if (x1 > edge) if on_left else (x0 < edge):
                return False
            several = several or lines >= 2
    labels = [p for p in left if p.kind == "text"]
    if not several or not labels:
        return False
    return not (all(_all_bold(p) for p in labels) or all(p.text.rstrip().endswith(":") for p in labels))


def block_extents(pieces: list[Piece]) -> dict[int, tuple[float, float, int]]:
    """Each MuPDF block's left and right edges, and how many lines it has."""
    edges: dict[int, list] = {}
    for p in pieces:
        if p.kind != "text" or p.block < 0:
            continue
        e = edges.get(p.block)
        if e is None:
            edges[p.block] = [p.x0, p.x1, {round(p.base)}]
        else:
            e[0], e[1] = min(e[0], p.x0), max(e[1], p.x1)
            e[2].add(round(p.base))
    return {b: (e[0], e[1], len(e[2])) for b, e in edges.items()}


def _terms(narrow: list[Piece], prose: list[Piece]) -> bool:
    """Whether the narrow side's lines sit level with the starts of the other
    side's paragraphs, as terms beside their definitions do."""
    lines = sorted(prose, key=lambda p: p.y0)
    starts = []
    for i, p in enumerate(lines):
        if i == 0 or p.y0 - lines[i - 1].y1 > 0.45 * max(p.size, 1):
            starts.append(p.base)
    level = sum(1 for p in narrow if any(abs(p.base - b) <= 1.5 for b in starts))
    return level >= 0.6 * len(narrow)


def _columns(left: list[Piece], right: list[Piece], width: float, blocks: dict | None = None) -> bool:
    """Two columns of running text; blocks of lines side by side (``_apart``);
    or a sidebar of short lines (a résumé's skills) beside running text.
    Labels beside values, cells of a table drawn without lines, and terms
    beside their definitions are rows, not columns."""
    prose_left, prose_right = _prose(left, width), _prose(right, width)
    if prose_left and prose_right:
        return True
    if blocks and _apart(left, right, blocks):
        return True
    if _bulleted(left) and _bulleted(right):
        return True  # two lists side by side, as a slide sets them
    floor = max(40.0, 0.1 * width)
    if prose_right and len(right) >= 3 and _extent(left) >= floor:
        return not _terms(left, right)
    if prose_left and len(left) >= 3 and _extent(right) >= floor:
        return not _terms(right, left)
    return False


def _rtl(items: list[Piece]) -> bool:
    """Whether most of these pieces' letters are written right to left."""
    return sum(p.rtl for p in items) > sum(p.ltr for p in items)


def reading_order(items: list[Piece], depth: int = 0, blocks: dict | None = None,
                  page_width: float = 0.0) -> list[Piece]:
    if len(items) < 4 or depth > 6 or len(items) > MAX_PAGE_PIECES:
        return _rows(items)
    page_width = page_width or _extent(items)
    gutter = _gutter(items, blocks, page_width)
    if gutter is None:
        return _rows(items)
    g0, g1, top, bottom = gutter
    mid = (g0 + g1) / 2
    above = [p for p in items if p.yc < top]
    below = [p for p in items if p.yc > bottom]
    inside = [p for p in items if top <= p.yc <= bottom]
    left = [p for p in inside if p.xc < mid]
    right = [p for p in inside if p.xc >= mid]
    if _rtl(inside):
        left, right = right, left  # Hebrew and Arabic columns are read from the right
    return [p for part in (above, left, right, below) for p in reading_order(part, depth + 1, blocks, page_width)]


def _along_line(row: list[Piece]) -> list[Piece]:
    """One line's pieces in reading order: left to right, or right to left
    when most of its letters are (MuPDF gives each piece in logical order)."""
    if _rtl(row):
        return sorted(row, key=lambda q: -q.x1)
    return sorted(row, key=lambda q: q.x0)


def _rows(items: list[Piece]) -> list[Piece]:
    """Top to bottom, and along each line (by baseline)."""
    ordered = sorted(items, key=lambda p: (p.base, p.x0))
    out: list[Piece] = []
    row: list[Piece] = []
    for p in ordered:
        if row and (p.kind != "text" or row[0].kind != "text"
                    or abs(p.base - row[0].base) > 0.45 * max(min(p.size, row[0].size), 4)):
            out += _along_line(row)
            row = []
        row.append(p)
    out += _along_line(row)
    return out


# ── Lines and blocks ─────────────────────────────────────────────────────────


@dataclass
class Line:
    pieces: list[Piece]
    justified: bool = False   # its ends line up with other lines' (``_justified``)

    def __post_init__(self):
        self.x0 = min(p.x0 for p in self.pieces)
        self.x1 = max(p.x1 for p in self.pieces)
        self.y0 = min(p.y0 for p in self.pieces)
        self.y1 = max(p.y1 for p in self.pieces)
        self.near: tuple[list, int] | None = None   # the page's lines, and where this one is (``column``)
        self.base = self.pieces[0].base
        weights: Counter = Counter()
        for p in self.pieces:
            weights[p.size] += max(len(p.text), 1)
        self.size = weights.most_common(1)[0][0] if weights else 0
        self.runs: list[Run] = []
        # A line with a wide gap inside (a label and its value, cells of a
        # table drawn without lines) is a row of its own, not wrapped prose;
        # a word space that justification stretched is not such a gap.
        self.gapped = False
        for i, p in enumerate(self.pieces):
            if i:
                last = self.pieces[i - 1]
                gap = p.x0 - last.x1 if p.x0 >= last.x1 - 1 else last.x0 - p.x1
                spaced = last.space_after or p.space_before
                if spaced or gap > 0.15 * max(p.size, 1):
                    self.runs.append(Run(" "))
                if gap >= 2 * max(p.size, 1) and not (spaced and self.justified):
                    self.gapped = True
            self.runs.extend(r.copy() for r in p.runs)
        letters = [r for r in self.runs if r.text.strip()]
        self.mono = bool(letters) and all(r.mono for r in letters)
        self.bold = bool(letters) and all(r.bold for r in letters)
        self.text = "".join(r.text for r in self.runs)


def _justified(pieces: list[Piece]) -> set[tuple[int, int]]:
    """(block, baseline) of each line whose two ends line up with another
    line's in the same MuPDF block, or with two more lines' on the page (a
    paragraph's lines, or a column's), as justified lines' do."""
    spans: dict[tuple[int, int], list[float]] = {}
    for p in pieces:
        if p.kind == "text" and p.block >= 0:
            key = (p.block, round(p.base))
            s = spans.get(key)
            if s is None:
                spans[key] = [p.x0, p.x1]
            else:
                s[0], s[1] = min(s[0], p.x0), max(s[1], p.x1)
    in_block: Counter = Counter((b, round(s[0]), round(s[1])) for (b, _), s in spans.items())
    on_page: Counter = Counter((round(s[0]), round(s[1])) for s in spans.values())
    near = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    out = set()
    for (b, base), s in spans.items():
        x0, x1 = round(s[0]), round(s[1])
        if (sum(in_block[(b, x0 + i, x1 + j)] for i, j in near) >= 2
                or sum(on_page[(x0 + i, x1 + j)] for i, j in near) >= 3):
            out.add((b, base))
    return out


def visual_lines(ordered: list[Piece]) -> list[Line | Piece]:
    """Pieces read in order, joined into lines where they share a baseline."""
    justified = _justified(ordered)
    out: list[Line | Piece] = []
    current: list[Piece] = []

    def line(pieces: list[Piece]) -> Line:
        return Line(pieces, (pieces[0].block, round(pieces[0].base)) in justified)

    for p in ordered:
        if p.kind != "text":
            if current:
                out.append(line(current))
                current = []
            out.append(p)
            continue
        if current:
            last = current[-1]
            # Pieces on one baseline within a column make one line, however
            # far apart (a label and its value, a bullet and its text), in
            # either direction (right to left for Hebrew and Arabic).
            same_line = abs(p.base - last.base) <= 0.45 * max(min(p.size, last.size), 4)
            if same_line and (p.x0 >= last.x1 - 1 or p.x1 <= last.x0 + 1):
                current.append(p)
                continue
            out.append(line(current))
        current = [p]
    if current:
        out.append(line(current))
    return out


# Bullets as fonts draw them, Word's Symbol and Wingdings ones in the private
# use area among them. Word's second level, an "o" in Courier New, is told
# apart from the letter in ``_marker``.
_BULLETS = ("•◦▪▫‣⁃∙●○■□◆◇►▶▸▹➢➤➔➜➝➞→⇒✓✔✗✘☐☑☒★☆✦✧❖»·–—\\-*"
            "\uf0b7\uf0a7\uf0d8\uf0fc\uf076\uf0a8\uf06e\uf0e8\uf0a0")
_DASHES = "–—-"
_BULLET_START = re.compile(r"^[" + _BULLETS + r"](?:\s|$)")
_MARKER = re.compile(
    r"^(?:(?P<bullet>[" + _BULLETS + r"])|(?P<num>\(?\d{1,3}[.)])|(?P<alpha>\(?[a-zA-Z][.)])"
    r"|(?P<roman>\(?(?:[ivxl]{1,5}|[IVXL]{1,5})[.)]))(?:\s+|$)")
_ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50}


def _roman(text: str) -> int | None:
    total, prev = 0, 0
    for ch in reversed(text.lower()):
        v = _ROMAN.get(ch)
        if v is None:
            return None
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total or None


@dataclass
class Block:
    page: int
    kind: str                        # para | heading | item | code | table | image | anchor | note
    lines: list[Line] = field(default_factory=list)
    level: int = 0
    marker: str = ""                 # a list item's mark as printed
    marker_kind: str = ""            # bullet | num | alpha | roman
    marker_x: float = 0.0
    md: str = ""
    piece: Piece | None = None

    @property
    def size(self) -> float:
        return self.lines[0].size if self.lines else 0

    @property
    def text(self) -> str:
        return " ".join(ln.text for ln in self.lines)


def _marker(line: Line) -> tuple[str, str] | None:
    if line.mono:
        return None
    first = line.pieces[0]
    # Word's second-level bullet: an "o" in Courier New, or one set apart from its text.
    if first.text == "o" and len(line.pieces) > 1 and line.pieces[1].x0 - first.x1 >= 0.4 * max(line.size, 1):
        return "bullet", "o"
    letters = [r for r in line.runs if r.text.strip()]
    if len(letters) > 1 and letters[0].text.strip() == "o" and letters[0].mono and not letters[1].mono:
        return "bullet", "o"
    m = _MARKER.match(line.text)
    if not m:
        return None
    kind = next(k for k in ("bullet", "num", "alpha", "roman") if m.group(k))
    rest = line.text[m.end():].strip()
    if not rest and kind != "bullet":
        return None
    return kind, m.group(kind)


def _mark_value(mark: str, kind: str) -> int | None:
    core = mark.strip("()").rstrip(".)")
    if kind == "num":
        return int(core) if core.isdigit() else None
    if kind == "alpha":
        return ord(core.lower()) - 96 if len(core) == 1 and core.isalpha() else None
    if kind == "roman":
        return _roman(core)
    return None


def line_marks(lines: list[Line | Piece], style: "DocStyle") -> list[tuple[str, str] | None]:
    """Each line's list mark, or None. A bullet is a mark wherever it is.
    A number, letter or Roman numeral is one only on a line not set in a
    heading's type (there, "1. Introduction" is a numbered heading), and only
    in a run: another line at the same indent carries the next or the
    previous value, so "12." starting a wrapped line, or "A. Smith", stays
    text."""
    marks = []
    for ln in lines:
        mark = _marker(ln) if isinstance(ln, Line) else None
        if mark and mark[0] != "bullet" and style.level_for(ln.size):
            mark = None
        marks.append(mark)
    numbered = [(i, ln.x0, marks[i][1]) for i, ln in enumerate(lines) if marks[i] and marks[i][0] != "bullet"]
    for i, x, text in numbered:
        found = None
        for kind in ("num", "alpha", "roman"):
            v = _mark_value(text, kind)
            if v is None:
                continue
            if any(j != i and abs(xj - x) <= 3 and (w := _mark_value(other, kind)) is not None and abs(w - v) == 1
                   for j, xj, other in numbered):
                found = kind
                break
        marks[i] = (found, text) if found else None
    return marks


def build_blocks(page_no: int, lines: list[Line | Piece], style: "DocStyle") -> list[Block]:
    blocks: list[Block] = []
    cur: Block | None = None

    def flush():
        nonlocal cur
        if cur is not None:
            blocks.append(cur)
        cur = None

    marks = line_marks(lines, style)
    text_lines = [ln for ln in lines if isinstance(ln, Line)]
    for k, ln in enumerate(text_lines):
        ln.near = (text_lines, k)
    prev: Line | None = None
    for ln, mark in zip(lines, marks):
        if isinstance(ln, Piece):
            flush()
            blocks.append(Block(page_no, ln.kind, piece=ln))
            prev = None
            continue
        code = ln.mono and style.code_fonts
        if cur is not None and prev is not None and _continues(cur, prev, ln, mark, code, style):
            cur.lines.append(ln)
        else:
            flush()
            if code:
                cur = Block(page_no, "code", [ln])
            elif mark:
                cur = Block(page_no, "item", [ln], marker=mark[1], marker_kind=mark[0], marker_x=ln.x0)
            else:
                cur = Block(page_no, "para", [ln])
        prev = ln
    flush()
    return blocks


# What ends a sentence, what may follow its end (a closing quote or bracket),
# and a reference after it ("... informieren. [3]").
_SENTENCE_END = tuple(".:;!?。！？：；")
_CLOSERS = "\"'”’)]»」』）"
_REFERENCE = re.compile(r"\s*(\[[^\[\]]{1,12}\]|\(\d{1,4}\))$")


def column(ln: Line) -> tuple[float, float]:
    """The edges of the column of text around a line: as far as any line of
    its size within twenty of it, overlapping it across, reaches either way."""
    left, right = ln.x0, ln.x1
    if ln.near is not None:
        text, k = ln.near
        for other in text[max(0, k - 20): k + 21]:
            if other.x0 < ln.x1 and other.x1 > ln.x0 and abs(other.size - ln.size) <= 0.6:
                left, right = min(left, other.x0), max(right, other.x1)
    return left, right


def _open_end(prev: Line, size: float) -> bool:
    """Whether ``prev`` is a full line that stops mid-sentence: it fills
    its column, nearly, and is ten letters long at least, and no full stop
    ends it."""
    if prev.x1 - prev.x0 < 10 * size:
        return False
    left, right = column(prev)
    if prev.x1 - prev.x0 < 0.85 * (right - left):
        return False
    end = _REFERENCE.sub("", prev.text.rstrip()).rstrip(_CLOSERS)
    return bool(end) and not end.endswith(_SENTENCE_END)


def _wraps(block: Block, prev: Line, ln: Line, size: float) -> bool:
    """Whether the text wrapped from ``prev`` onto ``ln``: ``prev`` is a full
    line that stops mid-sentence (``_open_end``), and ``ln`` starts at the
    block's margin. This joins the lines of a paragraph set at one and a
    half or double spacing."""
    if prev.bold != ln.bold or abs(ln.size - prev.size) > 0.6 or not _open_end(prev, size):
        return False
    if block.kind == "item":
        return ln.x0 >= block.marker_x + 0.5
    return abs(ln.x0 - min(x.x0 for x in block.lines)) <= 0.8 * size


def _continues(block: Block, prev: Line, ln: Line, mark, code: bool, style: "DocStyle") -> bool:
    gap = ln.y0 - prev.y1
    size = max(prev.size, ln.size, 1)
    if block.kind == "code":
        return code and gap <= 2.6 * size
    if code or ln.gapped or prev.gapped:
        return False
    if ln.y1 < prev.y0 and (ln.x0 >= prev.x1 - 1 or ln.x1 <= prev.x0 + 1):
        # The next column: a paragraph carries on at its top when the last
        # column ended mid-sentence on a full line.
        return (block.kind == "para" and not mark and abs(ln.size - prev.size) <= 0.6 and ln.bold == prev.bold
                and _open_end(prev, size))
    if abs(ln.size - prev.size) > 0.6 or gap < -0.6 * size:
        return False
    if ln.bold != prev.bold and (ln.bold or prev.bold) and abs(ln.size - style.body) < 0.6:
        return False  # a bold line of its own at body size starts or ends a heading
    # A dash or middle dot that starts a wrapped line ("... one of them /
    # – a motion ...") is not a bullet.
    if mark and not (block.kind == "para" and mark[0] == "bullet" and mark[1] in _DASHES + "·"
                     and _wraps(block, prev, ln, size)):
        return False
    if gap > max(0.45 * size, 2.5) and not (gap <= 1.6 * size and _wraps(block, prev, ln, size)):
        return False
    if block.kind == "item":
        return ln.x0 >= block.marker_x + 0.5
    heading_like = prev.size >= style.body + 1
    margin = min(x.x0 for x in block.lines)
    if not heading_like and ln.x0 > prev.x0 + 0.8 * size and ln.x0 > margin + 0.8 * size:
        return False  # an indented first line starts a paragraph
    return True


# ── The document's type sizes ────────────────────────────────────────────────


@dataclass
class DocStyle:
    body: float = 10.0
    levels: dict[float, int] = field(default_factory=dict)   # heading size -> level
    bold_level: int = 2
    code_fonts: bool = True                                   # monospace means code

    def level_for(self, size: float) -> int:
        for s, lv in self.levels.items():
            if abs(size - s) <= 0.6:
                return lv
        return 0


def doc_style(sizes: Counter, mono_chars: int, all_chars: int, heading_sizes: Counter) -> DocStyle:
    style = DocStyle()
    if sizes:
        style.body = max(sizes.items(), key=lambda kv: (kv[1], -kv[0]))[0]
    style.code_fonts = not all_chars or mono_chars / all_chars < 0.7
    big = sorted((s for s in heading_sizes if s >= style.body + 1), reverse=True)
    merged: list[float] = []
    for s in big:
        if not merged or merged[-1] - s > 0.6:
            merged.append(s)
    for i, s in enumerate(merged[:6]):
        style.levels[s] = i + 1
    style.bold_level = min(6, max(2, len(style.levels) + 1))
    return style


# ── Markdown ─────────────────────────────────────────────────────────────────

# What would start a heading, quote, list, fence, table row or thematic break
# at the start of a line, where text from the page must stay text.
_START_ESCAPE = re.compile(r"^(#{1,6}(\s|$)|>|[-+*](\s|$)|```|~~~|=+\s*$|\||(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)")
_ORDERED_START = re.compile(r"^\d{1,9}(?=[.)](\s|$))")


def _escape(text: str) -> str:
    text = re.sub(r"\\(?=[!-/:-@\[-`{-~])", r"\\\\", text)
    text = text.replace("*", "\\*").replace("`", "\\`")
    return re.sub(r"<(?=[A-Za-z/!?])", r"\\<", text)


def _escape_start(text: str) -> str:
    """A line of text that Markdown would read as structure, made text again:
    "1. " becomes "1\\. ", "# " becomes "\\# "."""
    ordered = _ORDERED_START.match(text)
    if ordered:
        return text[:ordered.end()] + "\\" + text[ordered.end():]
    return "\\" + text if _START_ESCAPE.match(text) else text


# Characters a link address keeps; everything else is percent-encoded, so an
# address can neither end the link early nor carry markup.
_ADDRESS_SAFE = ":/?#[]@!$&'*+,;=%~-._"


def link_address(uri: str) -> str:
    return quote(uri, safe=_ADDRESS_SAFE)


def render_runs(runs: list[Run], plain: bool = False) -> str:
    """Inline Markdown for styled runs; ``plain`` drops bold and italic (headings)."""
    merged: list[Run] = []
    for r in runs:
        if merged and merged[-1].style == r.style:
            merged[-1].text += r.text
        elif merged and not r.text.strip():
            merged[-1].text += r.text
        else:
            merged.append(r.copy())
    out = []
    for r in merged:
        lead = r.text[: len(r.text) - len(r.text.lstrip())]
        trail = r.text[len(r.text.rstrip()):]
        core = r.text.strip()
        if not core:
            out.append(r.text)
            continue
        if r.mono:
            ticks = "``" if "`" in core else "`"
            inner = f"{ticks}{core}{ticks}" if ticks == "`" else f"{ticks} {core} {ticks}"
        else:
            inner = _escape(core)
            if r.link:
                inner = inner.replace("[", "\\[").replace("]", "\\]")
            if not plain and r.bold and r.italic:
                inner = f"***{inner}***"
            elif not plain and r.bold:
                inner = f"**{inner}**"
            elif not plain and r.italic:
                inner = f"*{inner}*"
        if r.sup and len(core) <= 8:
            inner = f"<sup>{inner}</sup>"
        if r.link:
            inner = f"[{inner}]({link_address(r.link)})"
        out.append(lead + inner + trail)
    return "".join(out)


# Chinese, Japanese and the punctuation they use: no space where their lines join.
_CJK = re.compile(r"[\u2e80-\u2fff\u3000-\u30ff\u3100-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]")


def _join_lines(lines: list[Line]) -> list[Run]:
    """A block's runs, its lines joined by spaces; a word hyphenated across
    the line end is joined again, and Chinese or Japanese lines join without
    a space."""
    runs: list[Run] = []
    for i, ln in enumerate(lines):
        line_runs = [r.copy() for r in ln.runs]
        if i and runs:
            prev = runs[-1]
            nxt = line_runs[0].text if line_runs else ""
            if re.search(r"[A-Za-zÀ-ž]-$", prev.text) and nxt[:1].islower():
                prev.text = prev.text[:-1]
            elif not (prev.text and nxt and _CJK.match(prev.text[-1]) and _CJK.match(nxt[0])):
                runs.append(Run(" ", prev.bold and line_runs[0].bold if line_runs else False,
                                False, False, prev.link if line_runs and line_runs[0].link == prev.link else None))
        runs.extend(line_runs)
    return runs


def _strip_marker(runs: list[Run], marker: str) -> list[Run]:
    runs = [r.copy() for r in runs]
    remaining = len(marker)
    while runs and remaining > 0:
        first = runs[0]
        stripped = first.text.lstrip()
        if len(stripped) <= remaining:
            remaining -= len(stripped)
            runs.pop(0)
        else:
            first.text = stripped[remaining:]
            remaining = 0
    if runs:
        runs[0].text = runs[0].text.lstrip()
    return runs


def render_paragraph(block: Block) -> str:
    return _escape_start(render_runs(_join_lines(block.lines)).strip())


def render_code(block: Block) -> str:
    lines = block.lines
    widths = [(ln.x1 - ln.x0) / max(len(ln.text), 1) for ln in lines if len(ln.text) >= 3]
    char_w = statistics.median(widths) if widths else 0.6 * block.size or 6
    left = min(ln.x0 for ln in lines)
    out = []
    for i, ln in enumerate(lines):
        if i:
            gap = ln.y0 - lines[i - 1].y1
            out += [""] * min(2, max(0, round(gap / max(ln.y1 - ln.y0, 1))))
        indent = max(0, round((ln.x0 - left) / char_w)) if char_w > 0 else 0
        out.append(" " * indent + ln.text.rstrip())
    body = "\n".join(out)
    fence = "```"
    while fence in body:
        fence += "`"
    return f"{fence}\n{body}\n{fence}"


_CAPTION = re.compile(
    r"^(figure|fig\.|chart|graph|diagram|image|photo|picture|illustration|map|plate|exhibit|"
    r"abbildung|abb\.|figura|figure)\s*[\dIVXivx]", re.I)


def render_blocks(blocks: list[Block], style: DocStyle, stats: Counter) -> list[Block]:
    """Give every block its Markdown: headings get levels, list items their
    nesting, a caption joins the picture it names."""
    out: list[Block] = []
    i = 0
    list_stack: list[tuple[float, str]] = []   # (marker x, indent for children)
    while i < len(blocks):
        b = blocks[i]
        if b.kind == "item":
            while list_stack and b.marker_x < list_stack[-1][0] - 3:
                list_stack.pop()
            if list_stack and abs(b.marker_x - list_stack[-1][0]) <= 3:
                list_stack.pop()
            indent = list_stack[-1][1] if list_stack else ""
            # "- # of entries" would be a heading inside the item.
            body = _escape_start(render_runs(_strip_marker(_join_lines(b.lines), b.marker)).strip())
            if b.marker_kind == "num":
                mark = re.sub(r"\D", "", b.marker) + "."
            elif b.marker_kind in ("alpha", "roman"):
                mark = "- " + b.marker.strip("()").rstrip(".)") + "."
            else:
                mark = "-"
            b.md = f"{indent}{mark} {body}".rstrip()
            child_indent = indent + " " * (len(mark.split(' ')[0]) + 1)
            list_stack.append((b.marker_x, child_indent))
            stats["list_items"] += 1
            out.append(b)
            i += 1
            continue
        list_stack = []
        if b.kind == "image":
            alt = (b.piece.data or {}).get("alt", "") if b.piece else ""
            caption = None
            if not alt:
                for j in (i + 1, i - 1):
                    if 0 <= j < len(blocks) and blocks[j].kind == "para" and _CAPTION.match(blocks[j].text) \
                            and _near(b.piece, blocks[j]) and len(blocks[j].text) <= 300:
                        caption = j
                        break
            label = alt or (" ".join(blocks[caption].text.split()) if caption is not None else "")
            b.md = f"[Image: {_escape(label)}]" if label else "[Image]"
            stats["images"] += 1
            if caption is not None:
                if caption < i and out and out[-1] is blocks[caption]:
                    out.pop()
                elif caption > i:
                    blocks[caption].kind = "consumed"
            out.append(b)
            i += 1
            continue
        if b.kind == "consumed":
            i += 1
            continue
        if b.kind == "table":
            b.md = b.piece.data["md"]
            stats["tables"] += 1
        elif b.kind == "code":
            b.md = render_code(b)
            stats["code_blocks"] += 1
        elif b.kind == "para":
            level = _heading_level(b, style)
            if level:
                b.kind, b.level = "heading", level
                b.md = "#" * level + " " + render_runs(_join_lines(b.lines), plain=True).strip()
                stats["headings"] += 1
            else:
                b.md = render_paragraph(b)
        if b.md:
            stats["links"] += b.md.count("](")
            out.append(b)
        i += 1
    return out


def _near(image: Piece, block: Block) -> bool:
    if not block.lines:
        return False
    top, bottom = block.lines[0].y0, block.lines[-1].y1
    x0 = min(ln.x0 for ln in block.lines)
    x1 = max(ln.x1 for ln in block.lines)
    overlap = min(image.x1, x1) - max(image.x0, x0)
    close = (-6 <= top - image.y1 <= 36) or (-6 <= image.y0 - bottom <= 36)
    return close and overlap > 0


def _heading_level(b: Block, style: DocStyle) -> int:
    if len(b.lines) > 3:
        return 0
    text = b.text.strip()
    if len(text) > 250 or sum(ch.isalpha() for ch in text) < 2:
        return 0
    level = style.level_for(b.size)
    if level:
        # A sentence in larger type (a summary under a title) is not a
        # heading: a full stop after a word ends it, where "U.S." does not.
        return 0 if re.search(r"[,;]$|[^A-Z.]\.$", text) else level
    # A short bold line at body size; not one with wide gaps inside, which
    # is a table's row of column names.
    if (len(b.lines) == 1 and b.lines[0].bold and not b.lines[0].gapped and abs(b.size - style.body) < 0.6
            and len(text) <= 120 and len(text.split()) <= 14 and not re.search(r"[.:;,]$", text)):
        return style.bold_level
    return 0


# ── Running headers and footers ──────────────────────────────────────────────

BAND = 0.09   # the top and bottom 9% of a page


def _band(frame: Frame, box: fitz.Rect) -> str | None:
    height = frame.rect.height
    if box.y1 <= frame.rect.y0 + BAND * height:
        return "top"
    if box.y0 >= frame.rect.y1 - BAND * height:
        return "bottom"
    return None


def band_lines(lines: list[dict], frame: Frame) -> list[tuple[str, str, tuple[int, ...], float]]:
    """This page's lines in the top and bottom bands, from a quick read: the
    band, the line's template and numbers (``line_key``), and its largest
    type size."""
    found = []
    for line in lines:
        text = "".join(s["text"] for s in line["spans"]).strip()
        band = _band(frame, _to(line["bbox"], frame.unrot)) if text and _along(line, frame) else None
        key = line_key(text) if band else None
        if key:
            size = max((sp["size"] for sp in line["spans"] if sp["text"].strip()), default=0)
            found.append((band, key[0], key[1], round(size * 2) / 2))
    return found


def _running(pages: list[int], values: list[int]) -> list[bool]:
    """Which of a number's values, one for each line, belong to a running
    line: the same on four lines in five, or counting with the pages (a page
    number, with any offset, in runs of at least three pages)."""
    common, n = Counter(values).most_common(1)[0]
    if n >= 0.8 * len(values):
        return [v == common for v in values]
    offsets = Counter(v - p for p, v in zip(pages, values))
    need = min(3, len(values))
    return [offsets[v - p] >= need for p, v in zip(pages, values)]


def repeated_lines(candidates: list[list[tuple]], pages_with_text: int, body: float) -> set[tuple]:
    """The running lines, as (page, band, template, numbers): lines at the
    top or bottom of at least two pages in five, and of three pages at least
    (of every page, in a file of three pages or fewer), the same on each but
    for a page number, in type no larger than the body text's. A heading that starts
    every page ("Section 1", "Section 2") is not a running line, nor is a
    table's row, whose numbers change in other ways."""
    if pages_with_text < 2:
        return set()
    groups: dict[tuple[str, str], list[tuple[int, tuple[int, ...]]]] = defaultdict(list)
    for page_no, page in enumerate(candidates, 1):
        for band, template, numbers, size in page:
            if size <= body + 1:
                groups[(band, template)].append((page_no, numbers))
    need = pages_with_text if pages_with_text <= 3 else max(3, -(-2 * pages_with_text // 5))
    out = set()
    for (band, template), found in groups.items():
        if len({p for p, _ in found}) < need or len({len(n) for _, n in found}) != 1:
            continue
        pages = [p for p, _ in found]
        keep = [True] * len(found)
        for j in range(len(found[0][1])):
            for k, ok in enumerate(_running(pages, [numbers[j] for _, numbers in found])):
                keep[k] = keep[k] and ok
        kept = [f for f, ok in zip(found, keep) if ok]
        if len({p for p, _ in kept}) >= need:
            out |= {(p, band, template, numbers) for p, numbers in kept}
    return out


def drop_running_lines(text: "PageText", pieces: list[Piece], page_no: int, repeated: set,
                       tables: list[fitz.Rect]) -> tuple[list[tuple[tuple[str, str], str]], list[Piece]]:
    """This page's running lines left out of ``pieces``: band lines that
    ``repeated`` names for this page, outside every table, and set apart from
    the rest of the page's text by at least their type's size (a table's
    column names carry straight on into its rows). Returns what was left
    out, as ((band, template), text as printed), and the pieces kept."""
    present = {p.raw_line for p in pieces}
    candidates = {}
    for line_no, printed in text.line_texts.items():
        box = text.line_boxes[line_no]
        band = _band(text.frame, box)
        key = line_key(printed) if band and line_no in present else None
        if key and (page_no, band, key[0], key[1]) in repeated:
            candidates[line_no] = (band, key[0], printed, box)
    if not candidates:
        return [], pieces
    others = [(p.y0, p.y1) for p in pieces if p.raw_line not in candidates] + [(t.y0, t.y1) for t in tables]
    drop = set()
    for line_no, (band, _, _, box) in candidates.items():
        size = max(p.size for p in pieces if p.raw_line == line_no) or 1
        if band == "top":
            below = [y0 for y0, _ in others if y0 >= box.y1 - 0.25 * size]
            gap = min(below) - box.y1 if below else size
        else:
            above = [y1 for _, y1 in others if y1 <= box.y0 + 0.25 * size]
            gap = box.y0 - max(above) if above else size
        if gap >= size:
            drop.add(line_no)
    removed = [((candidates[n][0], candidates[n][1]), candidates[n][2]) for n in sorted(drop)]
    return removed, [p for p in pieces if p.raw_line not in drop]


# ── The document ─────────────────────────────────────────────────────────────


@dataclass
class Result:
    blocks: list[Block]
    report: dict


@dataclass
class Survey:
    sizes: Counter                  # characters by type size: body text
    heading_sizes: Counter          # and in lines short enough to be headings
    mono: int
    total: int
    bands: list[list[tuple]]        # each page's band lines (band_lines)
    with_text: int                  # pages with any text
    rulings: list[Ruling | None]    # each page's ruled lines, for the second pass


def survey(doc: fitz.Document) -> Survey:
    """A quick first pass: type sizes, monospace share, the lines at the top
    and bottom of each page, and each page's ruled lines. Body text is the
    most common size outside the top and bottom bands and outside ruled
    tables, where running lines and cells in smaller type would outvote it
    (when there is enough text there to go by)."""
    sizes: Counter = Counter()
    every_size: Counter = Counter()
    heading_sizes: Counter = Counter()
    mono = total = 0
    bands: list[list[tuple]] = []
    rulings: list[Ruling | None] = []
    with_text = 0
    for page in doc:
        try:
            lines = _text_lines(page.get_text("dict", flags=TEXT_FLAGS))
            frame = page_frame(page, lines)
        except Exception:  # noqa: BLE001 - read again, and named, in the second pass
            bands.append([])
            rulings.append(None)
            continue
        try:
            ruling = _rules(page, frame)
        except Exception:  # noqa: BLE001 - the second pass reads the drawings again
            ruling = None
        rulings.append(ruling)
        regions = ruling.regions if ruling else []
        page_chars = 0
        for line in lines:
            if not _along(line, frame):
                continue
            box = _to(line["bbox"], frame.unrot)
            cx, cy = (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2
            in_table = any(r.x0 <= cx <= r.x1 and r.y0 <= cy <= r.y1 for r in regions)
            in_band = _band(frame, box) is not None
            text = "".join(s["text"] for s in line["spans"])
            n_line = len(text.strip())
            for s in line["spans"]:
                n = len(s["text"].strip())
                if not n:
                    continue
                page_chars += n
                total += n
                _, _, is_mono = _style(s.get("font", ""), s.get("flags", 0))
                if is_mono:
                    mono += n
                    continue
                size = round(s["size"] * 2) / 2
                every_size[size] += n
                if not (in_table or in_band):
                    sizes[size] += n
                if n_line <= 150 and not in_table:
                    heading_sizes[size] += n
        if page_chars:
            with_text += 1
        bands.append(band_lines(lines, frame) if page_chars else [])
    # A page that is all table but for its title has too little text
    # outside to tell the body's size from.
    body_sizes = sizes if sum(sizes.values()) >= 100 else every_size
    return Survey(body_sizes, heading_sizes, mono, total, bands, with_text, rulings)


def convert(doc: fitz.Document, options: Options, *, cap_cpu=None) -> Result:
    if doc.needs_pass:
        raise Refusal("password")
    if doc.page_count == 0:
        # A file cut short (an interrupted download) is repaired to no pages.
        raise Refusal("corrupt" if doc.is_repaired else "no_pages")
    if doc.page_count > MAX_PAGES:
        raise Refusal("too_many_pages", pages=doc.page_count, limit=MAX_PAGES)
    if cap_cpu:
        cap_cpu(doc.page_count)

    first = survey(doc)
    style = doc_style(first.sizes, first.mono, first.total, first.heading_sizes)
    repeated = repeated_lines(first.bands, first.with_text, style.body) if options.remove_headers_footers else set()
    try:
        figures = tagged_figures(doc)
    except Exception:  # noqa: BLE001 - a damaged structure tree only costs the alternative text
        figures = {}

    stats: Counter = Counter()
    blocks: list[Block] = []
    unreadable: list[int] = []
    no_text: list[int] = []
    removed_examples: list[str] = []
    removed_keys: set[tuple[str, str]] = set()
    removed_pages: set[int] = set()
    has_text = has_marks = False
    for index in range(doc.page_count):
        page_no = index + 1
        try:
            page = doc[index]
            page_blocks, page_info = convert_page(doc, page, page_no, style, repeated, figures, first.rulings[index])
        except MemoryError:
            raise
        except Exception:  # noqa: BLE001 - MuPDF raises several kinds for a page it cannot read
            unreadable.append(page_no)
            if options.page_markers:
                blocks.append(Block(page_no, "anchor", md=f"<!-- page {page_no} -->"))
            blocks.append(Block(page_no, "note", md=f"<!-- page {page_no} could not be read, so it was not converted -->"))
            continue
        has_marks = has_marks or page_info["marks"]
        if options.page_markers:
            blocks.append(Block(page_no, "anchor", md=f"<!-- page {page_no} -->"))
        if page_info["text"]:
            has_text = True
        elif page_info["marks"]:
            no_text.append(page_no)
            blocks.append(Block(page_no, "note", md=(
                f"<!-- page {page_no} has no text layer (it may be a scan), so nothing on it was converted. "
                "OCR PDF can add one. -->")))
        for key, printed in page_info["removed"]:
            removed_pages.add(page_no)
            if key not in removed_keys and len(removed_examples) < 5:
                removed_keys.add(key)
                removed_examples.append(" ".join(printed.split()))
        blocks.extend(render_blocks(page_blocks, style, stats))

    if unreadable and len(unreadable) == doc.page_count:
        raise Refusal("unreadable")
    if not has_text:
        raise Refusal("no_text", kind="scan" if has_marks else "blank")
    report = {
        "pages": doc.page_count,
        "pagesWithoutText": no_text,
        "pagesNotRead": unreadable,
        "headings": stats["headings"],
        "tables": stats["tables"],
        "listItems": stats["list_items"],
        "codeBlocks": stats["code_blocks"],
        "images": stats["images"],
        "links": stats["links"],
        # From what was actually left out, page by page.
        "headersFootersRemoved": len(removed_pages),
        "removedLines": removed_examples,
    }
    return Result(blocks, report)


def convert_page(doc, page: fitz.Page, page_no: int, style: DocStyle, repeated: set, figures: dict,
                 ruling: Ruling | None = None):
    text = read_text(page)
    frame = text.frame
    pieces = text.pieces
    if ruling is None:
        ruling = _rules(page, frame)

    alts = figure_alts(doc, page, figures) if figures else {}
    images = read_images(page, frame, alts)
    # A picture under the page's text (a background, or a scan with an OCR
    # layer) is not a picture in the text.
    if pieces:
        images = [im for im in images if not any(im.x0 <= p.xc <= im.x1 and im.y0 <= p.yc <= im.y1 for p in pieces)]

    # Tables first: their text comes from the table, and a running header's
    # test must not take a table's column names or last row for one.
    tables: list[Piece] = []
    rules, items = ruling.horizontal, ruling.items
    if pieces and not ruling.crowded and items <= MAX_TABLE_DRAWINGS and len(pieces) <= MAX_PAGE_PIECES:
        if ruling.regions:
            tables = ruled_tables(page, pieces, frame, ruling.regions)
        if len(rules) >= 2:
            words = page.get_text("words", flags=TEXT_FLAGS)
            if frame.unrot is not None:
                words = [tuple(_to(w[:4], frame.unrot)) + tuple(w[4:]) for w in words]
            tables += rule_bounded_tables(words, rules, [fitz.Rect(t.x0, t.y0, t.x1, t.y1) for t in tables], style.body)
    boxes = [fitz.Rect(t.x0, t.y0, t.x1, t.y1) for t in tables]
    if boxes:
        pieces = [p for p in pieces if not any(b.x0 - 1 <= p.xc <= b.x1 + 1 and b.y0 - 1 <= p.yc <= b.y1 + 1 for b in boxes)]

    removed: list = []
    if repeated:
        removed, pieces = drop_running_lines(text, pieces, page_no, repeated, boxes)

    marks = bool(page.get_images()) or items > 0 or ruling.crowded
    if not text.pieces:
        images = []  # a page without text is named as such; its pictures are not listed
    ordered = reading_order(pieces + tables + images, blocks=block_extents(text.pieces))
    lines = visual_lines(ordered)
    blocks = build_blocks(page_no, lines, style)
    return blocks, {"text": bool(text.pieces), "marks": marks, "removed": removed}


# ── Output: one file, or chunks ──────────────────────────────────────────────


def _md(blocks: list[Block]) -> str:
    """Blocks joined by blank lines; items of one list stay on consecutive lines."""
    out: list[str] = []
    prev: Block | None = None
    for b in blocks:
        if not b.md:
            continue
        if out:
            out.append("\n" if prev is not None and prev.kind == "item" and b.kind == "item" else "\n\n")
        out.append(b.md)
        prev = b
    return "".join(out).strip() + "\n"


def chunk_blocks(blocks: list[Block], options: Options) -> list[list[Block]]:
    """The blocks in chunks: before each heading of the two highest levels in
    the document, or packed up to ``chunk_size`` characters."""
    if options.chunk == "headings":
        levels = sorted({b.level for b in blocks if b.kind == "heading"})
        split_at = set(levels[:2])
        chunks: list[list[Block]] = [[]]
        for b in blocks:
            if b.kind == "heading" and b.level in split_at and _has_content(chunks[-1]):
                _start_chunk(chunks, b, options.page_markers)
            chunks[-1].append(b)
        return [c for c in chunks if _has_content(c)] or [blocks]
    if options.chunk == "size":
        return _by_size(blocks, options.chunk_size, options.page_markers)
    return [blocks]


def _has_content(blocks: list[Block]) -> bool:
    return any(b.kind != "anchor" for b in blocks)


def _start_chunk(chunks: list[list[Block]], first: Block, markers: bool) -> int:
    """Open a new chunk for ``first``: a heading or page marker that ended the
    last chunk moves to it, and a chunk that starts part-way through a page
    says which page. Returns the characters the new chunk already holds."""
    carry: list[Block] = []
    while chunks[-1] and chunks[-1][-1].kind in ("heading", "anchor") and first.kind != "anchor":
        carry.insert(0, chunks[-1].pop())
    if markers and first.kind != "anchor" and not (carry and carry[0].kind == "anchor"):
        page = carry[0].page if carry else first.page
        carry.insert(0, Block(page, "anchor", md=f"<!-- page {page} -->"))
    chunks.append(carry)
    return sum(len(b.md) + 2 for b in carry)


# Blocks that can be cut to fit a chunk: text between sentences, a table
# between rows (its header repeated), code between lines.
_CUTTABLE = ("para", "item", "table", "code")


def _by_size(blocks: list[Block], limit: int, markers: bool) -> list[list[Block]]:
    """Blocks packed into chunks of at most ``limit`` characters. A block that
    does not fit starts the next chunk whole; only a block longer than a chunk
    is cut (``_cut``)."""
    queue = list(reversed(blocks))
    chunks: list[list[Block]] = [[]]
    used = 0
    while queue:
        b = queue.pop()
        cost = len(b.md) + 2
        if used + cost > limit and _has_content(chunks[-1]):
            used = _start_chunk(chunks, b, markers)
        if used + cost > limit and b.kind in _CUTTABLE:
            first, rest = _cut(b, max(limit - used - 2, 100))
            if rest is not None:
                queue.append(rest)
                b, cost = first, len(first.md) + 2
        chunks[-1].append(b)
        used += cost
    return [c for c in chunks if _has_content(c)]


def _cut(b: Block, size: int) -> tuple[Block, Block | None]:
    """The first part of ``b`` that fits in ``size`` characters, and the rest
    (None when it all fits): a table between rows with its header repeated,
    code between lines with its fences, text at the last sentence end, or
    word, that fits."""
    if len(b.md) <= size:
        return b, None
    if b.kind in ("table", "code"):
        lines = b.md.split("\n")
        head, body, tail = (lines[:2], lines[2:], []) if b.kind == "table" else (lines[:1], lines[1:-1], lines[-1:])
        take: list[str] = []
        for line in body:
            if take and len("\n".join(head + take + [line] + tail)) > size:
                break
            take.append(line)
        rest = body[len(take):]
        if not rest:
            return b, None
        return (Block(b.page, b.kind, md="\n".join(head + take + tail)),
                Block(b.page, b.kind, md="\n".join(head + rest + tail)))
    text = b.md
    ends = [m.end() for m in re.finditer(r"[.!?][)\]\"'’”]*\s+", text[:size + 1])]
    # Between sentences; between words only when one sentence is longer than the room.
    cut = ends[-1] if ends else text.rfind(" ", 0, size + 1)
    if cut <= 0:
        cut = size
    first, rest = text[:cut].rstrip(), text[cut:].lstrip()
    if not rest:
        return b, None
    # The rest of a list item carries on as text, without a second mark.
    return Block(b.page, b.kind, md=first, level=b.level), Block(b.page, "para", md=rest)


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:40].rstrip("-") or "part"


def write_output(result: Result, options: Options, target: str) -> dict:
    chunks = chunk_blocks(result.blocks, options) if options.chunk != "none" else [result.blocks]
    report = dict(result.report)
    if options.chunk == "none":
        data = _md(result.blocks).encode("utf-8")
        _check_size(len(data))
        with open(target, "wb") as f:
            f.write(data)
        report.update(format="markdown", chunks=1, characters=len(data.decode("utf-8")))
        return report
    total = len(chunks)
    texts = []
    for n, chunk in enumerate(chunks, 1):
        texts.append(_md(chunk))
    if options.chunk_output == "single":
        parts = [f"<!-- chunk {n} of {total} -->\n\n{t}" for n, t in enumerate(texts, 1)]
        data = "\n".join(parts).encode("utf-8")
        _check_size(len(data))
        with open(target, "wb") as f:
            f.write(data)
        report.update(format="markdown", chunks=total, characters=len(data.decode("utf-8")))
        return report
    size = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for n, (chunk, text) in enumerate(zip(chunks, texts), 1):
            title = next((b.md.lstrip("#").strip() for b in chunk if b.kind == "heading"), "")
            name = f"{n:03d}-{_slug(title) if title else 'part'}.md"
            size += len(text.encode("utf-8"))
            _check_size(size)
            z.writestr(name, text)
    report.update(format="zip", chunks=total, characters=sum(len(t) for t in texts))
    return report


def _check_size(n: int) -> None:
    if n > MAX_OUTPUT_BYTES:
        raise MemoryError("output too large")


# ── Process protocol ─────────────────────────────────────────────────────────


def _limit(kind: int, soft: int, hard: int) -> None:
    """Lower a resource limit, keeping any hard limit that is already lower."""
    _, current = resource.getrlimit(kind)
    if current != resource.RLIM_INFINITY:
        soft, hard = min(soft, current), min(hard, current)
    resource.setrlimit(kind, (soft, hard))


def _isolate(file_size: int) -> None:
    """Cap memory and CPU time, and never dump core. _hidden_text_worker.py has a twin."""
    if sys.platform.startswith("linux"):
        # Where the image runs. macOS does not enforce an address-space limit
        # the same way, and the caller's time limit still applies there.
        memory = MEMORY_BASE_BYTES + MEMORY_PER_FILE_BYTE * file_size
        _limit(resource.RLIMIT_AS, memory, memory)
    # SIGXCPU at the soft limit stops the process (its default action); the
    # hard limit, a little later, is SIGKILL. A process can raise neither past
    # the hard limit, so it is the most any file may use from the start.
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


_ANSWER = sys.stdout


def _emit(payload: dict, status: int = 0) -> None:
    output = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(output.encode("utf-8")) > MAX_REPORT_BYTES:
        output, status = '{"ok": false, "error": "failed"}', 3
    _ANSWER.write(output)
    _ANSWER.flush()
    raise SystemExit(status)


def _is_memory(exc: BaseException) -> bool:
    return isinstance(exc, MemoryError) or "malloc" in str(exc).lower() or "out of memory" in str(exc).lower()


def main() -> None:
    try:
        source, target, raw = sys.argv[1], sys.argv[2], sys.argv[3]
        size = os.path.getsize(source)
        options = Options.parse(raw)
    except (IndexError, OSError, ValueError, TypeError):
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
        result = convert(doc, options, cap_cpu=_cap_cpu)
        report = write_output(result, options, target)
    except Refusal as refusal:
        _emit({"ok": False, "error": refusal.kind, **refusal.facts})
    except Exception as exc:  # noqa: BLE001 - the caller logs a failure
        if _is_memory(exc):
            _emit({"ok": False, "error": "too_large"})
        _emit({"ok": False, "error": "failed"}, 1)
    _emit({"ok": True, **report})


if __name__ == "__main__":
    main()
