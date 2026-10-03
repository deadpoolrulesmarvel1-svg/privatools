"""Synthetic PDFs for PDF to Markdown: one per structure the converter must
keep, and the files it must refuse.

The documents are laid out with reportlab, as a word processor lays out
pages: running text in Helvetica, headings in larger bold type, tables drawn
with ruled lines, lists with bullet or number marks, code in Courier, links as
link annotations. Scans are pictures of a page with no text layer. All files
are generated here; none is a real document.
"""

from __future__ import annotations

import io

import fitz  # PyMuPDF
from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, FrameBreak, Image as RLImage, KeepTogether, ListFlowable, ListItem,
    NextPageTemplate, PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle,
)

WIDTH, HEIGHT = A4
MARGIN = 20 * mm

BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=13.5, spaceAfter=6)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, leading=27, spaceAfter=10)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceBefore=8, spaceAfter=6)
H3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12, leading=15, spaceBefore=6, spaceAfter=4)
CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.5, leading=12)
CELL_HEAD = ParagraphStyle("cell-head", fontName="Helvetica-Bold", fontSize=9.5, leading=12)
CODE = ParagraphStyle("code", fontName="Courier", fontSize=9, leading=11.5, leftIndent=8, spaceBefore=4, spaceAfter=8)
CAPTION = ParagraphStyle("caption", fontName="Helvetica-Oblique", fontSize=9, leading=11, alignment=TA_CENTER, spaceAfter=8)


def _build(story: list, *, templates: list[PageTemplate] | None = None, on_page=None) -> bytes:
    out = io.BytesIO()
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
                          bottomMargin=MARGIN, title="Synthetic test document", author="PrivaTools tests")
    if templates is None:
        frame = Frame(MARGIN, MARGIN, WIDTH - 2 * MARGIN, HEIGHT - 2 * MARGIN, id="body")
        templates = [PageTemplate(id="one", frames=[frame], onPage=on_page or (lambda c, d: None))]
    doc.addPageTemplates(templates)
    doc.build(story)
    return out.getvalue()


# ── Headings and paragraphs ──────────────────────────────────────────────────

HEADINGS_TEXT = {
    "title": "Annual Garden Survey",
    "section": "Results by crop",
    "subsection": "Tomatoes",
    "body": "Most growers planted early and watered twice a week through the dry spell.",
    "second": "Late blight reached three allotments in August, all of them on the lower terraces.",
}


def headings() -> bytes:
    t = HEADINGS_TEXT
    return _build([
        Paragraph(t["title"], H1),
        Paragraph(t["body"], BODY),
        Paragraph(t["section"], H2),
        Paragraph(t["subsection"], H3),
        Paragraph(t["second"], BODY),
    ])


# ── Two columns ──────────────────────────────────────────────────────────────

COLUMNS_TITLE = "Field Notes on Urban Beekeeping"
COLUMN_PARAGRAPHS = [
    "Hives on flat roofs need shade by noon, or the comb softens and the colony spends its day fanning "
    "instead of foraging. A plank laid over the lid does the job for most of the summer months.",
    "Wind is the other enemy up there. Strap every hive to a pallet and weigh the pallet down, because a "
    "single storm can tip an unsecured box and chill the brood before anyone can reach the roof.",
    "Forage in the city is richer than most people expect. Lime trees along the avenues flower for three "
    "weeks in July, and the bees will fly two kilometres to reach them when the parks run dry.",
    "Keep a water dish with stones in it near every apiary. Bees that cannot find water close by will visit "
    "swimming pools and dripping taps, which is how most complaints from neighbours begin.",
]


def two_columns() -> bytes:
    """A title across the page, then text flowing down the left column and on into the right one."""
    gap = 8 * mm
    col = (WIDTH - 2 * MARGIN - gap) / 2
    title_h = 18 * mm
    body_h = HEIGHT - 2 * MARGIN - title_h
    frames = [
        Frame(MARGIN, HEIGHT - MARGIN - title_h, WIDTH - 2 * MARGIN, title_h, id="title"),
        Frame(MARGIN, MARGIN + body_h - 95 * mm, col, 95 * mm, id="left"),
        Frame(MARGIN + col + gap, MARGIN + body_h - 95 * mm, col, 95 * mm, id="right"),
    ]
    story: list = [Paragraph(COLUMNS_TITLE, H1), FrameBreak()]
    story += [Paragraph("Rooftop hives", H2)]
    story += [Paragraph(p, BODY) for p in COLUMN_PARAGRAPHS[:2]]
    story += [FrameBreak(), Paragraph("City forage", H2)]
    story += [Paragraph(p, BODY) for p in COLUMN_PARAGRAPHS[2:]]
    return _build(story, templates=[PageTemplate(id="columns", frames=frames)])


def _wrap(text: str, width: float, size: float = 10) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if fitz.get_text_length(trial, fontname="helv", fontsize=size) > width and line:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line] if line else lines


def two_columns_drawn_across() -> bytes:
    """Two columns whose lines are drawn row by row, left then right, as some
    PDF producers write them: the drawing order is not the reading order."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((MARGIN, 80), COLUMNS_TITLE, fontname="hebo", fontsize=22)
    gap = 8 * mm
    col = (WIDTH - 2 * MARGIN - gap) / 2
    left = [line for p in COLUMN_PARAGRAPHS[:2] for line in _wrap(p, col) + [""]]
    right = [line for p in COLUMN_PARAGRAPHS[2:] for line in _wrap(p, col) + [""]]
    y = 120
    for i in range(max(len(left), len(right))):
        for x, lines in ((MARGIN, left), (MARGIN + col + gap, right)):
            if i < len(lines) and lines[i]:
                page.insert_text((x, y), lines[i], fontname="helv", fontsize=10)
        y += 13.5
    return doc.tobytes(garbage=3, deflate=True)


# ── Tables ───────────────────────────────────────────────────────────────────

TABLE_HEADER = ["Name", "Role", "Started"]
TABLE_ROWS = [
    ["Ada Lovelace", "Analyst", "1843"],
    ["Grace Hopper", "Compiler engineer", "1944"],
    ["Katherine Johnson", "Mathematician", "1953"],
]
TABLE_BEFORE = "The roster below lists who joined the computing group, and when."
TABLE_AFTER = "Everyone on the roster still receives the quarterly newsletter."


def ruled_table() -> bytes:
    data = [[Paragraph(c, CELL_HEAD) for c in TABLE_HEADER]] + [[Paragraph(c, CELL) for c in row] for row in TABLE_ROWS]
    table = Table(data, colWidths=[55 * mm, 55 * mm, 30 * mm])
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return _build([
        Paragraph("Computing group roster", H2),
        Paragraph(TABLE_BEFORE, BODY),
        table,
        Spacer(1, 8),
        Paragraph(TABLE_AFTER, BODY),
    ])


def rules_only_table() -> bytes:
    """A table ruled only above and below its header and at its foot, as LaTeX's booktabs draws them."""
    data = [TABLE_HEADER] + TABLE_ROWS
    table = Table(data, colWidths=[55 * mm, 55 * mm, 30 * mm])
    table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
        ("LINEABOVE", (0, 0), (-1, 0), 1.2, colors.black),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.black),
        ("LINEBELOW", (0, -1), (-1, -1), 1.2, colors.black),
    ]))
    return _build([Paragraph("Computing group roster", H2), Paragraph(TABLE_BEFORE, BODY), table, Spacer(1, 8),
                   Paragraph(TABLE_AFTER, BODY)])


WRAPPED_ROWS = [
    ["Ingest", "Reads every file in the drop folder and checks that each one opens before anything else runs."],
    ["Publish", "Copies the approved files to the archive."],
]


def table_with_wrapped_cells() -> bytes:
    """A cell whose text runs over two lines stays one cell."""
    data = [[Paragraph("Step", CELL_HEAD), Paragraph("What it does", CELL_HEAD)]]
    data += [[Paragraph(a, CELL), Paragraph(b, CELL)] for a, b in WRAPPED_ROWS]
    table = Table(data, colWidths=[30 * mm, 70 * mm])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.6, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return _build([Paragraph("Pipeline steps", H2), table])


# ── Lists ────────────────────────────────────────────────────────────────────

def _bullets(items: list, start: str, indent: float = 14) -> ListFlowable:
    return ListFlowable(items, bulletType="bullet", start=start, leftIndent=indent, bulletFontName="Helvetica",
                        bulletFontSize=10)


def nested_lists() -> bytes:
    """A bulleted list and a numbered list, each with a list inside its second item."""
    gear = _bullets([
        ListItem(Paragraph("Tent", BODY)),
        ListItem([Paragraph("Sleeping bag", BODY),
                  _bullets([ListItem(Paragraph("Liner", BODY)), ListItem(Paragraph("Pillow", BODY))], "–")]),
        ListItem(Paragraph("Stove", BODY)),
    ], "•")
    steps = ListFlowable([
        ListItem(Paragraph("Check the forecast", BODY)),
        ListItem([Paragraph("File a route plan", BODY),
                  ListFlowable([ListItem(Paragraph("Share it with a friend", BODY)),
                                ListItem(Paragraph("Leave a copy in the car", BODY))],
                               bulletType="a", bulletFormat="%s.", leftIndent=16, bulletFontName="Helvetica",
                               bulletFontSize=10)]),
        ListItem(Paragraph("Pack the car", BODY)),
    ], bulletType="1", bulletFormat="%s.", leftIndent=16, bulletFontName="Helvetica", bulletFontSize=10)
    return _build([
        Paragraph("Packing list", H2), gear,
        Paragraph("Before you leave", H2), steps,
    ])


# ── Running headers and footers ──────────────────────────────────────────────

RUNNING_HEADER = "Northwind Traders · Quarterly Report"
RUNNING_FOOTER = "Confidential"
REPORT_SECTIONS = [
    ("Sales", "Sales rose in every region except the coast, where two stores closed for refits."),
    ("Stock", "Stock levels held steady, and the warehouse finished the quarter with no back orders."),
    ("Staff", "Twelve people joined the company, most of them in the new distribution centre."),
    ("Outlook", "Next quarter the company expects slower growth while the refitted stores reopen."),
]


def headers_and_footers() -> bytes:
    pages = len(REPORT_SECTIONS)

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(MARGIN, HEIGHT - 12 * mm, RUNNING_HEADER)
        canvas.drawRightString(WIDTH - MARGIN, 10 * mm, f"Page {doc.page} of {pages}")
        canvas.drawString(MARGIN, 10 * mm, RUNNING_FOOTER)
        canvas.restoreState()

    story: list = []
    for i, (title, text) in enumerate(REPORT_SECTIONS):
        if i:
            story.append(PageBreak())
        story += [Paragraph(title, H2), Paragraph(text, BODY)]
    return _build(story, on_page=decorate)


# ── Code ─────────────────────────────────────────────────────────────────────

CODE_BLOCK = '''def greet(name):
    """Say hello."""
    if not name:
        return "Hello, stranger"
    return f"Hello, {name}"'''
CODE_INTRO = "Define the function, then call it with a name:"


def code_block() -> bytes:
    return _build([
        Paragraph("Quick start", H2),
        Paragraph(CODE_INTRO, BODY),
        Preformatted(CODE_BLOCK, CODE),
        Paragraph('Call <font face="Courier">greet()</font> with no name to see the fallback.', BODY),
    ])


# ── Links ────────────────────────────────────────────────────────────────────

LINK_URL = "https://example.com/setup-guide"
LINK_MAIL = "mailto:help@example.com"


def links() -> bytes:
    return _build([
        Paragraph("Getting help", H2),
        Paragraph(f'Read <a href="{LINK_URL}" color="blue">the setup guide</a> before you start, or write to '
                  f'<a href="{LINK_MAIL}" color="blue">the help desk</a> if something fails.', BODY),
    ])


# ── Images ───────────────────────────────────────────────────────────────────

FIGURE_CAPTION = "Figure 1. Hives per district, 2025"


def _chart_png() -> bytes:
    img = Image.new("RGB", (480, 240), "white")
    draw = ImageDraw.Draw(img)
    for i, h in enumerate([60, 140, 100, 190, 80]):
        draw.rectangle([40 + i * 85, 220 - h, 100 + i * 85, 220], fill=(70, 110, 180))
    draw.line([30, 220, 460, 220], fill="black", width=2)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def image_with_caption() -> bytes:
    return _build([
        Paragraph("Where the hives are", H2),
        Paragraph("The chart counts registered hives in each district.", BODY),
        KeepTogether([RLImage(io.BytesIO(_chart_png()), width=120 * mm, height=60 * mm), Paragraph(FIGURE_CAPTION, CAPTION)]),
        Paragraph("Central districts hold the most hives per square kilometre.", BODY),
    ])


FIGURE_ALT = "Bar chart: hives per district, highest in the harbour district"


def tagged_figure() -> bytes:
    """A tagged PDF whose picture's Figure element carries alternative text,
    tied to the picture by its marked-content id, as word processors write it."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 80), "Where the hives are", fontname="hebo", fontsize=15)
    page.insert_text((72, 110), "The chart counts registered hives in each district.", fontsize=10)
    page.insert_image(fitz.Rect(72, 130, 392, 290), stream=_chart_png())
    page.insert_text((72, 320), "Central districts hold the most hives per square kilometre.", fontsize=10)
    page.clean_contents()
    xref = page.get_contents()[0]
    content = doc.xref_stream(xref)
    import re

    content = re.sub(rb"(q\s[^Q]*?/[^\s/]+\s+Do\s+Q)", rb"/Figure <</MCID 0>> BDC \1 EMC", content, count=1)
    doc.update_stream(xref, content)
    root = doc.get_new_xref()
    figure = doc.get_new_xref()
    doc.update_object(root, f"<< /Type /StructTreeRoot /K [{figure} 0 R] >>")
    doc.update_object(figure, f"<< /Type /StructElem /S /Figure /P {root} 0 R /Pg {page.xref} 0 R /K 0 "
                              f"/Alt ({FIGURE_ALT}) >>")
    cat = doc.pdf_catalog()
    doc.xref_set_key(cat, "StructTreeRoot", f"{root} 0 R")
    doc.xref_set_key(cat, "MarkInfo", "<< /Marked true >>")
    return doc.tobytes()


# ── Scans: pictures of pages with no text layer ──────────────────────────────

SCANNED_WORDS = "This page was scanned, so its words are only a picture."


def _picture_of_text(text: str) -> bytes:
    src = fitz.open()
    page = src.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 120), text, fontsize=14)
    png = page.get_pixmap(dpi=100).tobytes("png")
    src.close()
    return png


def _scan_page(doc: fitz.Document, text: str) -> None:
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_image(page.rect, stream=_picture_of_text(text))


def scanned() -> bytes:
    doc = fitz.open()
    _scan_page(doc, SCANNED_WORDS)
    _scan_page(doc, "A second scanned page.")
    return doc.tobytes(garbage=3, deflate=True)


MIXED_TEXT = "The first page has real text that can be selected and copied."


def text_then_scan() -> bytes:
    doc = fitz.open(stream=_build([Paragraph("Mixed document", H2), Paragraph(MIXED_TEXT, BODY)]), filetype="pdf")
    _scan_page(doc, SCANNED_WORDS)
    return doc.tobytes(garbage=3, deflate=True)


# ── Harder layouts ───────────────────────────────────────────────────────────

COLUMN_TEXT = [
    "Alpha paragraph opens the first column with a sentence long enough to wrap over several lines of text.",
    "Bravo paragraph continues the first column, and it also runs on for a while so the column fills up.",
    "Charlie paragraph starts the second column and keeps going with more words than one line can hold.",
    "Delta paragraph follows in the second column, adding detail that a reader expects after Charlie.",
    "Echo paragraph opens the third column, which a reader reaches only after finishing the second one.",
    "Foxtrot paragraph ends the third column and so ends the page, after everything else has been read.",
]


def three_columns() -> bytes:
    gap = 6 * mm
    col = (WIDTH - 2 * MARGIN - 2 * gap) / 3
    frames = [Frame(MARGIN, HEIGHT - MARGIN - 18 * mm, WIDTH - 2 * MARGIN, 18 * mm, id="title")]
    frames += [Frame(MARGIN + i * (col + gap), HEIGHT - MARGIN - 108 * mm, col, 90 * mm, id=f"col{i}") for i in range(3)]
    story: list = [Paragraph("Three Column Newsletter", H1), FrameBreak()]
    for i in range(3):
        story += [Paragraph(COLUMN_TEXT[2 * i], BODY), Paragraph(COLUMN_TEXT[2 * i + 1], BODY)]
        if i < 2:
            story.append(FrameBreak())
    return _build(story, templates=[PageTemplate(id="three", frames=frames)])


def columns_around_table() -> bytes:
    """Two columns, a ruled table across the page, then two columns again."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    left, gap = 57, 22
    col = (WIDTH - 2 * left - gap) / 2
    page.insert_text((left, 70), "Columns Around a Table", fontname="hebo", fontsize=20)

    def column(x: float, y: float, text: str) -> None:
        for line in _wrap(text, col):
            page.insert_text((x, y), line, fontname="helv", fontsize=10)
            y += 13

    column(left, 110, COLUMN_TEXT[0])
    column(left + col + gap, 110, COLUMN_TEXT[2])
    top = 190
    for r in range(4):
        page.draw_line((left, top + r * 18), (WIDTH - left, top + r * 18))
    for x in (left, left + 160, left + 320, WIDTH - left):
        page.draw_line((x, top), (x, top + 54))
    for r, row in enumerate([["Hive", "District", "Colonies"], ["North", "Harbour", "12"], ["South", "Old Town", "7"]]):
        for c, cell in enumerate(row):
            page.insert_text((left + 4 + c * 160, top + 13 + r * 18), cell, fontname="hebo" if r == 0 else "helv",
                             fontsize=10)
    column(left, 280, COLUMN_TEXT[1])
    column(left + col + gap, 280, COLUMN_TEXT[3])
    return doc.tobytes()


NARROW_GUTTER_SENTENCES = 96


def narrow_gutter() -> bytes:
    """A two-column paper with columns 10 points apart (LaTeX's default),
    justified, its sentences numbered in reading order."""
    gap = 10
    col = (WIDTH - 2 * MARGIN - gap) / 2
    just = ParagraphStyle("just", parent=BODY, alignment=TA_JUSTIFY, fontName="Times-Roman", fontSize=10, leading=12)
    head = ParagraphStyle("tex-head", parent=H3, fontName="Times-Bold", fontSize=12)
    frames = [Frame(MARGIN, HEIGHT - MARGIN - 30 * mm, WIDTH - 2 * MARGIN, 30 * mm, id="title"),
              Frame(MARGIN, MARGIN, col, HEIGHT - 2 * MARGIN - 30 * mm, id="left"),
              Frame(MARGIN + col + gap, MARGIN, col, HEIGHT - 2 * MARGIN - 30 * mm, id="right")]
    numbers = iter(range(1, NARROW_GUTTER_SENTENCES + 1))

    def para(k: int) -> Paragraph:
        return Paragraph(" ".join(f"Sentence {next(numbers):03d} keeps the reading order honest here."
                                  for _ in range(k)), just)

    story: list = [
        Paragraph("A Study of Narrow Gutters", ParagraphStyle("tex-title", parent=H1, fontName="Times-Bold", alignment=1)),
        Paragraph("Abstract. Two columns ten points apart still read one after the other.", just), FrameBreak(),
        Paragraph("1 Introduction", head), para(14), para(12),
        Paragraph("2 Method", head), para(16), para(10),
        Paragraph("3 Results", head), para(18), para(14), para(12),
    ]
    return _build(story, templates=[PageTemplate(id="tex", frames=frames)])


FORM_ROWS = [("Name", "Ada Lovelace"), ("Role", "Analyst"), ("Started", "1843"), ("Team", "Engines"),
             ("Office", "London"), ("Manager", "Charles Babbage")]


def form_labels() -> bytes:
    """Labels in a narrow column beside their values: rows, not two columns."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 80), "Application details", fontname="hebo", fontsize=15)
    y = 115
    for label, value in FORM_ROWS:
        page.insert_text((72, y), label, fontname="hebo", fontsize=10)
        page.insert_text((200, y), value, fontname="helv", fontsize=10)
        y += 16
    for line in _wrap("Applicants who list a manager must also attach a signed letter from them, dated within "
                      "the last three months, or the application is returned unread.", 450):
        page.insert_text((72, y + 12), line, fontname="helv", fontsize=10)
        y += 13
    return doc.tobytes()


OPENING_HOURS = [("Monday to Thursday", "08:00 to 18:00"), ("Friday", "08:00 to 16:00"),
                 ("Saturday", "10:00 to 14:00"), ("Sunday", "Closed"), ("Public holidays", "Closed")]


def borderless_table() -> bytes:
    """A table laid out with space alone: not found as a table, but its rows stay rows."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 80), "Opening hours", fontname="hebo", fontsize=15)
    y = 115
    for day, hours in OPENING_HOURS:
        page.insert_text((72, y), day, fontname="helv", fontsize=10)
        page.insert_text((300, y), hours, fontname="helv", fontsize=10)
        y += 15
    return doc.tobytes()


SKILLS = ["Python", "SQL", "Statistics", "Technical writing", "Mentoring"]
EXPERIENCE = ("Led a team of four analysts who rebuilt the monthly reporting pipeline, cutting the time to publish "
              "from nine days to two. Wrote the style guide that every report now follows, and trained new hires on "
              "the review process that catches errors before figures reach the board.")


def resume_sidebar() -> bytes:
    """A narrow sidebar of short lines beside a column of running text."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((57, 70), "Jane Placeholder", fontname="hebo", fontsize=20)
    y = 110
    page.insert_text((57, y), "Skills", fontname="hebo", fontsize=12)
    for skill in SKILLS:
        y += 15
        page.insert_text((57, y), skill, fontname="helv", fontsize=10)
    y = 110
    page.insert_text((230, y), "Experience", fontname="hebo", fontsize=12)
    for line in _wrap(EXPERIENCE, 300):
        y += 15
        page.insert_text((230, y), line, fontname="helv", fontsize=10)
    return doc.tobytes()


def indented_paragraphs() -> bytes:
    """Book paragraphs: an indented first line and no space between them, one word hyphenated across lines."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    y = 90
    paragraphs = [
        ["The first paragraph begins with an indent, as books set them, and its",
         "second line returns to the margin without any space above the next para-",
         "graph, which also begins with an indent."],
        ["The second paragraph is that next one. It runs to two lines before the", "page ends."],
    ]
    for lines in paragraphs:
        for i, line in enumerate(lines):
            page.insert_text((72 + (18 if i == 0 else 0), y), line, fontname="tiro", fontsize=11)
            y += 14
    return doc.tobytes()


def inline_styles() -> bytes:
    return _build([Paragraph("Some words are <b>bold</b>, some are <i>italic</i>, and one is <b><i>both</i></b>. "
                             "A price of 5 * 3 stays as it is.", BODY)])


def wrapped_link() -> bytes:
    return _build([Paragraph('Before you begin, read <a href="https://example.com/a-long-guide" color="blue">the long '
                             'installation guide that wraps onto the next line of this narrow paragraph</a> and then '
                             'carry on.', BODY)])


def unsafe_link() -> bytes:
    """A link to a script: its text is kept, the link is not."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 100), "Click here to continue reading.", fontsize=11)
    page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(72, 88, 200, 104), "uri": "javascript:alert(1)"})
    return doc.tobytes()


def turned_page() -> bytes:
    """Content drawn sideways and turned upright for the reader by /Rotate 90."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.show_pdf_page(page.rect, fitz.open(stream=headings(), filetype="pdf"), 0, rotate=90)
    page.set_rotation(90)
    return doc.tobytes()


def sideways_table() -> bytes:
    """A page with a ruled table printed sideways on a portrait page, with no /Rotate."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.show_pdf_page(page.rect, fitz.open(stream=ruled_table(), filetype="pdf"), 0, rotate=90)
    return doc.tobytes()


def watermarked() -> bytes:
    """A diagonal watermark over body text: the watermark is left out."""
    doc = fitz.open(stream=headings(), filetype="pdf")
    page = doc[0]
    page.insert_text((150, 600), "DRAFT COPY", fontsize=60, morph=(fitz.Point(150, 600), fitz.Matrix(-45)),
                     color=(0.85, 0.85, 0.85))
    return doc.tobytes()


def markdown_lookalikes() -> bytes:
    """Lines that would turn into Markdown structure if copied as they are."""
    doc = fitz.open()
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.insert_text((72, 100), "# is the symbol on the hash key of most phones.", fontsize=11)
    page.insert_text((72, 140), "> greater-than signs start quoted lines in email.", fontsize=11)
    page.insert_text((72, 180), "Use <script> tags with care.", fontsize=11)
    return doc.tobytes()


# ── Refusals ─────────────────────────────────────────────────────────────────

def blank_pages() -> bytes:
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    return doc.tobytes()


def encrypted() -> bytes:
    doc = fitz.open(stream=headings(), filetype="pdf")
    return doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")


def no_pages() -> bytes:
    import pikepdf

    out = io.BytesIO()
    pikepdf.new().save(out)
    return out.getvalue()


def damaged() -> bytes:
    return b"%PDF-1.7\n" + b"\x00garbage\xff" * 300


def many_pages(count: int, text: str = "A short line of text on every page.") -> bytes:
    doc = fitz.open()
    for _ in range(count):
        doc.new_page(width=200, height=200).insert_text((20, 40), text, fontsize=9)
    return doc.tobytes(garbage=3, deflate=True)


# ── Everything at once: the before-and-after sample ──────────────────────────

def sample_report() -> bytes:
    """Two pages that use every structure above, for comparing outputs side by side."""
    gap = 8 * mm
    col = (WIDTH - 2 * MARGIN - gap) / 2
    full = Frame(MARGIN, MARGIN, WIDTH - 2 * MARGIN, HEIGHT - 2 * MARGIN - 6 * mm, id="full")
    left = Frame(MARGIN, MARGIN, col, HEIGHT - 2 * MARGIN - 6 * mm, id="left")
    right = Frame(MARGIN + col + gap, MARGIN, col, HEIGHT - 2 * MARGIN - 6 * mm, id="right")

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(MARGIN, HEIGHT - 12 * mm, RUNNING_HEADER)
        canvas.drawRightString(WIDTH - MARGIN, 10 * mm, f"Page {doc.page} of 2")
        canvas.restoreState()

    data = [[Paragraph(c, CELL_HEAD) for c in TABLE_HEADER]] + [[Paragraph(c, CELL) for c in row] for row in TABLE_ROWS]
    table = Table(data, colWidths=[55 * mm, 55 * mm, 30 * mm])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.6, colors.black)]))
    story: list = [
        Paragraph("Quarterly Engineering Notes", H1),
        Paragraph("This sample brings together the structures a converter has to keep.", BODY),
        Paragraph("Team", H2), table, Spacer(1, 8),
        Paragraph("Checklist", H2),
        _bullets([ListItem([Paragraph("Review the roster", BODY),
                            _bullets([ListItem(Paragraph("Confirm start dates", BODY))], "–")]),
                  ListItem(Paragraph("Send the newsletter", BODY))], "•"),
        Paragraph("Code", H2), Paragraph(CODE_INTRO, BODY), Preformatted(CODE_BLOCK, CODE),
        Paragraph(f'Questions go to <a href="{LINK_URL}" color="blue">the setup guide</a> first.', BODY),
        NextPageTemplate("columns"), PageBreak(),
        Paragraph("Rooftop hives", H2), *[Paragraph(p, BODY) for p in COLUMN_PARAGRAPHS[:2]],
        FrameBreak(),
        Paragraph("City forage", H2), *[Paragraph(p, BODY) for p in COLUMN_PARAGRAPHS[2:]],
    ]
    return _build(story, templates=[
        PageTemplate(id="full", frames=[full], onPage=decorate),
        PageTemplate(id="columns", frames=[left, right], onPage=decorate),
    ])
