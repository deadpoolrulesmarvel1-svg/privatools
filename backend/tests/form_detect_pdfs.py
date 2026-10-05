"""Synthetic PDFs for Form Creator's field detection, each with its answer.

Every PDF here is drawn by this module with PyMuPDF, the way word processors
and form designers draw forms that are printed or sent as PDFs without
fillable fields: labels followed by drawn lines, by thin filled bars (how Word
exports underlined blanks) or by typed underscores; empty boxes and rounded
boxes; tables whose empty cells are the blanks; cells with a small caption in
their top corner; checkbox squares and box characters; signature blocks with
captions under the lines; character boxes; dotted leaders; shaded areas; and
the same forms on pages stored turned (/Rotate) or with a CropBox that does
not start at 0,0. None is a real document.

Each builder returns a Sample: the bytes and the fields a person would place,
as Truth records in Form Creator's numbers (points from the top-left corner
of the page's visible area, before /Rotate, as the route takes them). A field
that sits on a line is the strip above the line, as tall as
`writing_height()` gives for its label's size.

The non-forms (a report with rules and tables, an invoice, a letter with a
signature line) have no fields: anything found on them is a false positive.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import fitz  # PyMuPDF
from PIL import Image

LETTER = (612.0, 792.0)
BLACK = (0, 0, 0)
GREY = (0.45, 0.45, 0.45)
LIGHT = (0.92, 0.94, 0.97)


@dataclass(frozen=True)
class Truth:
    page: int  # counted from 1
    rect: tuple[float, float, float, float]  # x0, y0, x1, y1
    type: str  # text, checkbox, signature or date


@dataclass
class Sample:
    name: str
    data: bytes
    fields: list[Truth]
    form: bool = True
    layouts: tuple[str, ...] = ()


def writing_height(size: float) -> float:
    """How tall a field on a line is: room to write at the label's size."""
    return min(22.0, max(14.0, 1.6 * size))


def _font(name: str) -> str:
    return {"sans": "helv", "sans-bold": "hebo", "serif": "tiro", "serif-bold": "tibo", "mono": "cour"}[name]


class Sheet:
    """One page being drawn, and the fields placed on it, in its own numbers."""

    def __init__(self, doc: fitz.Document, width: float = LETTER[0], height: float = LETTER[1]):
        self.page = doc.new_page(width=width, height=height)
        self.shape = self.page.new_shape()
        self.fields: list[tuple[tuple[float, float, float, float], str]] = []
        # Box characters typed on the page: (x, baseline, character); their
        # fields are read back from the saved file (_glyph_boxes).
        self.glyphs: list[tuple[float, float, str]] = []
        self.finished = False

    # ── drawing ──────────────────────────────────────────────────────────
    def text(self, x: float, y: float, s: str, size: float = 10.5, font: str = "sans",
             color=BLACK) -> float:
        """Text with its baseline at y; returns its width."""
        self.page.insert_text((x, y), s, fontname=_font(font), fontsize=size, color=color)
        return fitz.get_text_length(s, fontname=_font(font), fontsize=size)

    def uni(self, x: float, y: float, s: str, size: float = 10.5) -> float:
        """Text with characters outside WinAnsi (box characters), through
        MuPDF's fallback fonts."""
        writer = fitz.TextWriter(self.page.rect)
        font = fitz.Font("helv")
        writer.append((x, y), s, font=font, fontsize=size)
        writer.write_text(self.page)
        return font.text_length(s, fontsize=size)

    def line(self, x0: float, y0: float, x1: float, y1: float, width: float = 0.75, color=BLACK) -> None:
        self.shape.draw_line((x0, y0), (x1, y1))
        self.shape.finish(color=color, width=width, closePath=False)

    def rect(self, r, width: float = 0.75, color=BLACK, fill=None, radius=None) -> None:
        self.shape.draw_rect(fitz.Rect(r), radius=radius)
        self.shape.finish(color=color, fill=fill, width=width)

    def bar(self, r, fill=BLACK) -> None:
        """A filled rectangle with no outline, as Word draws an underline."""
        self.shape.draw_rect(fitz.Rect(r))
        self.shape.finish(color=None, fill=fill, width=0)

    def field(self, rect, kind: str) -> None:
        self.fields.append((tuple(float(v) for v in rect), kind))

    def finish(self) -> None:
        if not self.finished:
            self.shape.commit()
            self.finished = True

    # ── blanks ───────────────────────────────────────────────────────────
    def labelled_blank(self, x: float, y: float, label: str, x_end: float, *, size: float = 10.5,
                       style: str = "line", kind: str = "text", gap: float = 6, font: str = "sans") -> float:
        """A label with its baseline at y, then a blank to x_end; returns where
        the blank ends."""
        x0 = x + self.text(x, y, label, size, font) + gap
        return self.blank(x0, y, x_end, size=size, style=style, kind=kind)

    def blank(self, x0: float, y: float, x_end: float, *, size: float = 10.5, style: str = "line",
              kind: str = "text") -> float:
        """A blank from x0 to x_end on the baseline y (no label)."""
        if style == "line":
            line_y = y + 2
            self.line(x0, line_y, x_end, line_y, 0.75)
            x1 = x_end
        elif style == "bar":
            line_y = y + 2
            self.bar((x0, line_y - 0.3, x_end, line_y + 0.3))
            x1 = x_end
        elif style == "underscores":
            unit = fitz.get_text_length("_", fontname="helv", fontsize=size)
            count = max(3, int((x_end - x0) / unit))
            self.text(x0, y, "_" * count, size)
            x1 = x0 + count * unit
            line_y = y + 0.15 * size
        elif style == "dots":
            unit = fitz.get_text_length(".", fontname="helv", fontsize=size)
            count = max(6, int((x_end - x0) / unit))
            self.text(x0, y, "." * count, size)
            x1 = x0 + count * unit
            line_y = y + 0.05 * size
        else:
            raise ValueError(style)
        self.field((x0, line_y - writing_height(size), x1, line_y), kind)
        return x1

    def box(self, r, kind: str = "text", *, width: float = 0.75, radius=None, fill=None,
            outline=True) -> None:
        r = fitz.Rect(r)
        if outline:
            self.rect(r, width=width, radius=radius, fill=fill)
        else:
            self.bar(r, fill=fill or LIGHT)
        self.field((r.x0 + 1, r.y0 + 1, r.x1 - 1, r.y1 - 1), kind)

    def square(self, x: float, y: float, side: float = 10, *, label: str | None = None, size: float = 10,
               width: float = 0.75) -> float:
        """A checkbox drawn as a square with its top at y, and its label to the
        right; returns where the label ends."""
        r = fitz.Rect(x, y, x + side, y + side)
        self.rect(r, width=width)
        self.field(tuple(r), "checkbox")
        end = r.x1
        if label:
            end = r.x1 + 5 + self.text(r.x1 + 5, y + side * 0.5 + size * 0.35, label, size)
        return end

    def glyph_box(self, x: float, y: float, glyph: str = "☐", *, label: str | None = None,
                  size: float = 10.5) -> float:
        """A checkbox typed as a box character on the baseline y; returns where
        its label ends. Its field is the box as drawn, read back afterwards."""
        width = self.uni(x, y, glyph, size)
        self.glyphs.append((x, y, glyph))
        end = x + width
        if label:
            end = x + width + 4 + self.text(x + width + 4, y, label, size)
        return end

    def dingbat_box(self, x: float, y: float, *, label: str | None = None, size: float = 10.5) -> float:
        """A checkbox typed as ZapfDingbats "o" (a box), as older form tools
        wrote them; MuPDF reads it back as the letter."""
        self.page.insert_text((x, y), "o", fontname="zadb", fontsize=size + 0.5)
        self.glyphs.append((x, y, "o"))
        end = x + 12
        if label:
            end = x + 18 + self.text(x + 18, y, label, size)
        return end


def _glyph_boxes(page: fitz.Page, glyphs: list) -> list[tuple[tuple[float, float, float, float], str]]:
    """Where each box character was drawn: its ink box, made square."""
    found = []
    flags = fitz.TEXTFLAGS_RAWDICT | fitz.TEXT_ACCURATE_BBOXES
    chars = [c for b in page.get_text("rawdict", flags=flags)["blocks"] for l in b.get("lines", [])
             for s in l["spans"] for c in s["chars"]]
    for x, y, glyph in glyphs:
        match = min((c for c in chars if c["c"] == glyph),
                    key=lambda c: abs(c["origin"][0] - x) + abs(c["origin"][1] - y))
        r = fitz.Rect(match["bbox"])
        side = max(r.width, r.height)
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        found.append(((cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), "checkbox"))
    return found


def _save(doc: fitz.Document, sheets: list[Sheet]) -> tuple[bytes, list[Truth]]:
    for sheet in sheets:
        sheet.finish()
    data = doc.tobytes(garbage=0, deflate=True)
    reread = fitz.open("pdf", data)
    truth: list[Truth] = []
    for number, sheet in enumerate(sheets, start=1):
        placed = list(sheet.fields) + _glyph_boxes(reread[number - 1], sheet.glyphs)
        truth += [Truth(number, rect, kind) for rect, kind in placed]
    reread.close()
    doc.close()
    return data, truth


def _heading(sheet: Sheet, title: str, subtitle: str | None = None) -> float:
    sheet.text(54, 64, title, 17, "sans-bold")
    y = 64
    if subtitle:
        y = 84
        sheet.text(54, y, subtitle, 9, color=GREY)
    return y + 30


def _section(sheet: Sheet, y: float, title: str, *, band: bool = False) -> float:
    """A section heading: a dark band with white text, or bold text over a rule."""
    if band:
        sheet.bar((54, y - 12, 558, y + 5), fill=(0.15, 0.2, 0.3))
        sheet.text(60, y, title, 10.5, "sans-bold", color=(1, 1, 1))
        return y + 30
    sheet.text(54, y, title, 12, "sans-bold")
    sheet.line(54, y + 5, 558, y + 5, 1.2)
    return y + 32


# ═══ Forms ═══════════════════════════════════════════════════════════════════

def contact_details() -> Sample:
    """Labels followed by drawn lines, one per row, with a date and a signature."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Membership Application", "Please print clearly in black ink.")
    for label, kind in [("Full name:", "text"), ("Street address:", "text"), ("City:", "text"),
                        ("Postcode:", "text"), ("Telephone:", "text"), ("Email address:", "text"),
                        ("Date of birth:", "date")]:
        s.labelled_blank(54, y, label, 540, kind=kind)
        y += 34
    y += 20
    s.text(54, y, "I confirm that the details above are correct.", 10.5)
    y += 40
    s.labelled_blank(54, y, "Signature:", 330, kind="signature")
    s.labelled_blank(350, y, "Date:", 540, kind="date")
    data, truth = _save(doc, [s])
    return Sample("contact-details", data, truth, layouts=("label-and-underline", "signature-block"))


def typed_underscores() -> Sample:
    """Blanks typed as underscores, several on a line, and a date split by slashes."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Volunteer Registration")
    s.labelled_blank(54, y, "Name:", 400, style="underscores")
    y += 30
    end = s.labelled_blank(54, y, "City:", 230, style="underscores")
    end = s.labelled_blank(end + 14, y, "State:", end + 100, style="underscores")
    s.labelled_blank(end + 14, y, "ZIP:", 540, style="underscores")
    y += 30
    s.labelled_blank(54, y, "Phone:", 280, style="underscores")
    s.labelled_blank(300, y, "Email:", 540, style="underscores")
    y += 30
    # "Date of birth: ____/____/________" is one date field.
    x = 54 + s.text(54, y, "Date of birth:", 10.5) + 6
    start = x
    for count, sep in [(4, "/"), (4, "/"), (8, "")]:
        x += s.text(x, y, "_" * count, 10.5)
        if sep:
            x += s.text(x, y, sep, 10.5)
    line_y = y + 0.15 * 10.5
    s.field((start, line_y - writing_height(10.5), x, line_y), "date")
    y += 30
    s.labelled_blank(54, y, "Emergency contact:", 540, style="underscores")
    y += 30
    s.labelled_blank(54, y, "Relationship:", 300, style="underscores")
    data, truth = _save(doc, [s])
    return Sample("typed-underscores", data, truth, layouts=("label-and-underline",))


def word_bars() -> Sample:
    """Underlined blanks as thin filled bars, as Word exports them, in Times."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "New Employee Details")
    for label, kind, end in [("Employee name", "text", 520), ("Department", "text", 380),
                             ("Line manager", "text", 520), ("Start date", "date", 300),
                             ("Payroll number", "text", 300)]:
        s.labelled_blank(54, y, label, end, style="bar", kind=kind, font="serif", gap=12)
        y += 36
    y += 24
    s.text(54, y, "Return this form to Human Resources within five working days.", 10, "serif")
    y += 50
    s.labelled_blank(54, y, "Employee signature", 360, style="bar", kind="signature", font="serif", gap=12)
    data, truth = _save(doc, [s])
    return Sample("word-bars", data, truth, layouts=("label-and-underline", "signature-block"))


def boxes_label_left() -> Sample:
    """Empty boxes with their labels to the left, and a tall comments box."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Equipment Loan Request")
    for label in ["Borrower", "Team", "Item requested", "Asset tag"]:
        s.text(54, y + 13, label, 10.5)
        s.box((170, y, 520, y + 20))
        y += 32
    s.text(54, y + 13, "Return date", 10.5)
    s.box((170, y, 300, y + 20), "date")
    y += 40
    s.text(54, y + 13, "Comments", 10.5)
    s.box((170, y, 520, y + 90))
    data, truth = _save(doc, [s])
    return Sample("boxes-label-left", data, truth, layouts=("boxed-inputs",))


def boxes_label_above() -> Sample:
    """Small captions above boxes, in two columns."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Course Enrolment")
    rows = [("First name", "Last name"), ("Student number", "Course code"), ("Phone", "Email")]
    for left, right in rows:
        s.text(54, y, left, 8.5, color=GREY)
        s.box((54, y + 4, 290, y + 26))
        s.text(318, y, right, 8.5, color=GREY)
        s.box((318, y + 4, 558, y + 26))
        y += 46
    s.text(54, y, "Start date", 8.5, color=GREY)
    s.box((54, y + 4, 200, y + 26), "date")
    data, truth = _save(doc, [s])
    return Sample("boxes-label-above", data, truth, layouts=("boxed-inputs", "two-column"))


def rounded_boxes() -> Sample:
    """Rounded input boxes, as form designers draw them."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Event Booking")
    for label, kind in [("Contact name", "text"), ("Organisation", "text"), ("Event date", "date"),
                        ("Number of guests", "text")]:
        s.text(54, y, label, 9.5)
        s.box((54, y + 5, 400, y + 29), kind, radius=0.25)
        y += 50
    s.text(54, y, "Special requirements", 9.5)
    s.box((54, y + 5, 558, y + 75), radius=0.1)
    data, truth = _save(doc, [s])
    return Sample("rounded-boxes", data, truth, layouts=("boxed-inputs",))


def _grid(s: Sheet, x0: float, y0: float, widths: list[float], heights: list[float], width: float = 0.6):
    """Ruled lines for a table, drawn line by line; returns the cell edges."""
    xs = [x0]
    for w in widths:
        xs.append(xs[-1] + w)
    ys = [y0]
    for h in heights:
        ys.append(ys[-1] + h)
    for y in ys:
        s.line(xs[0], y, xs[-1], y, width)
    for x in xs:
        s.line(x, ys[0], x, ys[-1], width)
    return xs, ys


def grid_label_value() -> Sample:
    """A ruled table of label cells and empty value cells."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Vehicle Inspection Record")
    rows = [("Registration", "Make"), ("Model", "Colour"), ("Odometer", "Fuel level"),
            ("Inspector", "Inspection date")]
    xs, ys = _grid(s, 54, y, [100, 152, 100, 152], [24] * len(rows))
    for i, (a, b) in enumerate(rows):
        s.text(xs[0] + 5, ys[i] + 16, a, 9.5, "sans-bold")
        s.text(xs[2] + 5, ys[i] + 16, b, 9.5, "sans-bold")
        s.field((xs[1] + 1, ys[i] + 1, xs[2] - 1, ys[i + 1] - 1), "text")
        s.field((xs[3] + 1, ys[i] + 1, xs[4] - 1, ys[i + 1] - 1), "date" if "date" in b else "text")
    y = ys[-1] + 40
    s.text(54, y, "Defects found", 10.5, "sans-bold")
    xs, ys = _grid(s, 54, y + 8, [140, 364], [22, 22, 22])
    for i, label in enumerate(["Brakes", "Lights", "Tyres"]):
        s.text(xs[0] + 5, ys[i] + 15, label, 9.5)
        s.field((xs[1] + 1, ys[i] + 1, xs[2] - 1, ys[i + 1] - 1), "text")
    data, truth = _save(doc, [s])
    return Sample("grid-label-value", data, truth, layouts=("grid",))


def grid_caption_cells() -> Sample:
    """Cells with a small numbered caption in their top corner, written in below it."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Application for a Parking Permit", "Section A: about you")
    captions = [["1. Surname", "2. Given names"], ["3. Date of birth", "4. Telephone"],
                ["5. Residential address"], ["6. Vehicle registration", "7. Permit zone"]]
    top = y
    for row in captions:
        widths = [504 / len(row)] * len(row)
        xs, ys = _grid(s, 54, top, widths, [34])
        for i, caption in enumerate(row):
            s.text(xs[i] + 4, top + 9, caption, 7)
            kind = "date" if "date" in caption.lower() else "text"
            s.field((xs[i] + 1, top + 11, xs[i + 1] - 1, top + 33), kind)
        top += 34
    data, truth = _save(doc, [s])
    return Sample("grid-caption-cells", data, truth, layouts=("grid",))


def checkbox_squares() -> Sample:
    """Drawn checkbox squares: a list down the page and a row across it."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Service Request")
    s.text(54, y, "Which services do you need? Tick all that apply.", 10.5)
    y += 14
    for label in ["Plumbing", "Electrical work", "Painting and decorating", "Garden maintenance",
                  "Window cleaning"]:
        s.square(60, y, 10, label=label)
        y += 20
    y += 16
    x = 54 + s.text(54, y + 8, "Preferred contact:", 10.5) + 10
    for label in ["Email", "Phone", "Post"]:
        x = s.square(x, y, 10, label=label) + 18
    y += 40
    s.labelled_blank(54, y, "Name:", 330)
    s.labelled_blank(350, y, "Phone:", 558)
    data, truth = _save(doc, [s])
    return Sample("checkbox-squares", data, truth, layouts=("checkbox-list",))


def checkbox_glyphs() -> Sample:
    """Questions answered with box characters: ☐ and □."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Health Questionnaire")
    for question in ["Do you smoke?", "Do you take regular medication?", "Have you had surgery in the last year?"]:
        x = 54 + s.text(54, y, question, 10.5) + 14
        x = s.glyph_box(x, y, "☐", label="Yes") + 16
        s.glyph_box(x, y, "☐", label="No")
        y += 26
    y += 12
    s.text(54, y, "Activities you do each week:", 10.5)
    y += 22
    for label in ["Walking", "Cycling", "Swimming", "Team sports"]:
        s.glyph_box(66, y, "□", label=label, size=11)
        y += 20
    data, truth = _save(doc, [s])
    return Sample("checkbox-glyphs", data, truth, layouts=("checkbox-list",))


def signature_captions() -> Sample:
    """A declaration ending in lines with captions under them."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Declaration")
    for sentence in ["I declare that the information I have given is true and complete.",
                     "I understand that giving false information may lead to my application being refused."]:
        s.text(54, y, sentence, 10.5)
        y += 16
    y += 60
    for x0, x1, caption, kind in [(54, 300, "Signature of applicant", "signature"), (340, 540, "Date", "date")]:
        s.line(x0, y, x1, y)
        s.text(x0, y + 12, caption, 8.5, color=GREY)
        s.field((x0, y - writing_height(10.5), x1, y), kind)
    y += 70
    for x0, x1, caption, kind in [(54, 300, "Print name", "text"), (340, 540, "Witness signature", "signature")]:
        s.line(x0, y, x1, y)
        s.text(x0, y + 12, caption, 8.5, color=GREY)
        s.field((x0, y - writing_height(10.5), x1, y), kind)
    data, truth = _save(doc, [s])
    return Sample("signature-captions", data, truth, layouts=("signature-block",))


def two_columns() -> Sample:
    """Two columns of labels and lines side by side."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Patient Intake")
    left = [("Surname", "text"), ("First name", "text"), ("Date of birth", "date"), ("Sex", "text"),
            ("Doctor", "text")]
    right = [("Address", "text"), ("Suburb", "text"), ("Phone", "text"), ("Mobile", "text"),
             ("Next of kin", "text")]
    for (a, ka), (b, kb) in zip(left, right):
        s.labelled_blank(54, y, a + ":", 290, kind=ka, size=10)
        s.labelled_blank(318, y, b + ":", 558, kind=kb, size=10)
        y += 30
    data, truth = _save(doc, [s])
    return Sample("two-columns", data, truth, layouts=("label-and-underline", "two-column"))


def _turned(sample: Sample, rotate: int, name: str) -> Sample:
    """The sample's pages stored turned, with /Rotate set so they show upright."""
    src = fitz.open("pdf", sample.data)
    out = fitz.open()
    for number in range(len(src)):
        width, height = src[number].rect.width, src[number].rect.height
        if rotate in (90, 270):
            page = out.new_page(width=height, height=width)
        else:
            page = out.new_page(width=width, height=height)
        page.show_pdf_page(page.rect, src, number, rotate=rotate)
        page.set_rotation(rotate)
    data = out.tobytes(garbage=0, deflate=True)
    reread = fitz.open("pdf", data)
    fields = []
    for t in sample.fields:
        page = reread[t.page - 1]
        r = fitz.Rect(t.rect) * page.derotation_matrix
        fields.append(Truth(t.page, (r.x0, r.y0, r.x1, r.y1), t.type))
    return Sample(name, data, fields, layouts=sample.layouts + ("rotated",))


def turned_90() -> Sample:
    return _turned(contact_details(), 90, "turned-90")


def turned_270() -> Sample:
    return _turned(grid_label_value(), 270, "turned-270")


def turned_180() -> Sample:
    return _turned(checkbox_squares(), 180, "turned-180")


def answer_lines() -> Sample:
    """A question answered on several lines: one field over the lines."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Incident Report")
    s.labelled_blank(54, y, "Reported by:", 330)
    s.labelled_blank(350, y, "Date:", 558, kind="date")
    y += 40
    for question, count in [("Describe what happened:", 4), ("Names of any witnesses:", 2)]:
        s.text(54, y, question, 10.5)
        first = y + 24
        for i in range(count):
            s.line(54, first + 22 * i, 558, first + 22 * i)
        s.field((54, first - writing_height(10.5), 558, first + 22 * (count - 1)), "text")
        y = first + 22 * count + 24
    data, truth = _save(doc, [s])
    return Sample("answer-lines", data, truth, layouts=("label-and-underline",))


def character_boxes() -> Sample:
    """A row of boxes, one per character, is one field."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Tax Number Declaration")
    for label, count in [("Tax file number", 9), ("Postcode", 4)]:
        s.text(54, y + 13, label, 10.5)
        x0 = 180
        for i in range(count):
            s.rect((x0 + 16 * i, y, x0 + 16 * (i + 1), y + 18), width=0.6)
        s.field((x0 + 1, y + 1, x0 + 16 * count - 1, y + 17), "text")
        y += 36
    s.labelled_blank(54, y + 10, "Name:", 400)
    data, truth = _save(doc, [s])
    return Sample("character-boxes", data, truth, layouts=("boxed-inputs",))


def dotted_leaders() -> Sample:
    """Blanks drawn as rows of dots after the label."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Library Card Application")
    for label, kind in [("Name", "text"), ("Address", "text"), ("Date of birth", "date"),
                        ("School or workplace", "text")]:
        s.labelled_blank(54, y, label, 520, style="dots", kind=kind)
        y += 30
    y += 30
    s.labelled_blank(54, y, "Signature", 330, style="dots", kind="signature")
    s.labelled_blank(350, y, "Date", 520, style="dots", kind="date")
    data, truth = _save(doc, [s])
    return Sample("dotted-leaders", data, truth, layouts=("label-and-underline",))


def shaded_inputs() -> Sample:
    """Input areas shaded light grey, without an outline."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Customer Feedback")
    for label in ["Your name", "Order number", "Product"]:
        s.text(54, y + 14, label, 10.5)
        s.box((160, y, 520, y + 22), outline=False)
        y += 34
    s.text(54, y + 14, "Your comments", 10.5)
    s.box((160, y, 520, y + 80), outline=False)
    data, truth = _save(doc, [s])
    return Sample("shaded-inputs", data, truth, layouts=("boxed-inputs",))


def cropped_page() -> Sample:
    """A form on a page whose visible area (CropBox) does not start at 0,0."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Key Collection Slip")
    s.labelled_blank(72, y + 20, "Collected by:", 520)
    s.labelled_blank(72, y + 54, "Key number:", 300)
    s.text(72, y + 100, "Returned", 10.5)
    s.square(140, y + 92, 10)
    s.text(72, y + 126, "Notes", 9)
    s.box((72, y + 130, 400, y + 152))
    s.finish()
    s.shape = s.page.new_shape()  # nothing more is drawn
    crop = fitz.Rect(36, 48, 576, 744)
    s.page.set_cropbox(crop)
    s.fields = [((r[0] - crop.x0, r[1] - crop.y0, r[2] - crop.x0, r[3] - crop.y0), k) for r, k in s.fields]
    data, truth = _save(doc, [s])
    return Sample("cropped-page", data, truth, layouts=("label-and-underline", "boxed-inputs"))


def application_two_pages() -> Sample:
    """A two-page application: details and choices, then history and declaration."""
    doc = fitz.open()
    one = Sheet(doc)
    y = _heading(one, "Allotment Garden Application", "Complete both pages and return to the parks office.")
    y = _section(one, y, "Section 1. Applicant", band=True)
    for label, kind in [("Full name:", "text"), ("Address:", "text"), ("Phone:", "text"), ("Email:", "text"),
                        ("Date of birth:", "date")]:
        one.labelled_blank(54, y, label, 558, kind=kind)
        y += 30
    y = _section(one, y + 10, "Section 2. Plot size", band=True)
    x = 60
    for label in ["Quarter plot", "Half plot", "Full plot"]:
        x = one.square(x, y - 8, 10, label=label) + 24
    y += 30
    one.text(54, y, "Have you held an allotment before?", 10.5)
    x = 260
    for label in ["Yes", "No"]:
        x = one.glyph_box(x, y, "☐", label=label) + 16
    one.finish()  # a new page invalidates the last one's Page object
    two = Sheet(doc)
    y = _heading(two, "Allotment Garden Application (continued)")
    y = _section(two, y, "Section 3. Gardening experience", band=True)
    two.text(54, y, "Tell us about your gardening experience:", 10.5)
    first = y + 24
    for i in range(3):
        two.line(54, first + 22 * i, 558, first + 22 * i)
    two.field((54, first - writing_height(10.5), 558, first + 44), "text")
    y = first + 90
    y = _section(two, y, "Section 4. Declaration", band=True)
    two.text(54, y, "I agree to keep the plot cultivated and to follow the site rules.", 10.5)
    y += 50
    two.labelled_blank(54, y, "Signature:", 330, kind="signature")
    two.labelled_blank(350, y, "Date:", 558, kind="date")
    data, truth = _save(doc, [one, two])
    return Sample("application-two-pages", data, truth,
                  layouts=("label-and-underline", "checkbox-list", "signature-block"))


def existing_fields() -> Sample:
    """A form that is already partly fillable: only the blanks without a field
    are proposed."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Change of Address")
    blanks = []
    for label in ["Name:", "Old address:", "New address:", "Moving date:"]:
        end = s.labelled_blank(54, y, label, 540, kind="date" if "date" in label else "text")
        blanks.append((s.fields[-1][0], label))
        y += 34
    s.finish()
    # The first two blanks already have fields.
    for rect, label in blanks[:2]:
        widget = fitz.Widget()
        widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
        widget.field_name = label.rstrip(":").lower().replace(" ", "_")
        widget.rect = fitz.Rect(rect)
        s.page.add_widget(widget)
    s.fields = s.fields[2:]
    s.shape = s.page.new_shape()
    data, truth = _save(doc, [s])
    return Sample("existing-fields", data, truth, layouts=("label-and-underline",))


def ruled_sections() -> Sample:
    """Section headings underlined across the page, which are not blanks."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Club Renewal")
    y = _section(s, y, "Member")
    s.labelled_blank(54, y, "Member name:", 400)
    y += 30
    s.labelled_blank(54, y, "Membership number:", 300)
    y += 40
    y = _section(s, y, "Payment")
    s.text(54, y, "Fees are due by the end of the month. Late renewals pay a reinstatement fee.", 10)
    y += 30
    s.labelled_blank(54, y, "Amount paid:", 300)
    y += 40
    y = _section(s, y, "Office use only")
    s.labelled_blank(54, y, "Received by:", 300)
    data, truth = _save(doc, [s])
    return Sample("ruled-sections", data, truth, layouts=("label-and-underline",))


def timesheet() -> Sample:
    """A landscape timesheet: a grid of empty cells under column headings."""
    doc = fitz.open()
    s = Sheet(doc, 792, 612)
    s.text(54, 64, "Weekly Timesheet", 17, "sans-bold")
    s.labelled_blank(54, 100, "Employee:", 360)
    s.labelled_blank(400, 100, "Week starting:", 600)
    heads = ["Day", "Start", "Finish", "Break", "Hours"]
    widths = [140, 120, 120, 120, 120]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    xs, ys = _grid(s, 54, 130, widths, [22] + [26] * len(days))
    for i, head in enumerate(heads):
        s.text(xs[i] + 6, ys[0] + 15, head, 10, "sans-bold")
    for r, day in enumerate(days, start=1):
        s.text(xs[0] + 6, ys[r] + 17, day, 10)
        for c in range(1, len(heads)):
            s.field((xs[c] + 1, ys[r] + 1, xs[c + 1] - 1, ys[r + 1] - 1), "text")
    data, truth = _save(doc, [s])
    return Sample("timesheet", data, truth, layouts=("grid",))


def dingbat_boxes() -> Sample:
    """Checkboxes typed in a symbol font (ZapfDingbats), as older form tools wrote them."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Room Preferences")
    s.text(54, y, "Choose your room type:", 10.5)
    y += 24
    for label in ["Single", "Double", "Twin", "Family"]:
        s.dingbat_box(66, y, label=label)
        y += 20
    y += 20
    s.text(54, y, "Breakfast:", 10.5)
    x = 130
    for label in ["Yes", "No"]:
        x = s.dingbat_box(x, y, label=label) + 20
    data, truth = _save(doc, [s])
    return Sample("dingbat-boxes", data, truth, layouts=("checkbox-list",))


def labels_on_lines() -> Sample:
    """Small labels written on the left end of their own lines, under bold
    headings that have a rule of their own (not blanks), and a signature line
    that starts with an X."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Visitor Pass")
    y = _section(s, y, "Visitor")
    for label, kind in [("Name", "text"), ("Company", "text"), ("Arrival date", "date"),
                        ("Phone number", "text")]:
        line_y = y + 2
        s.line(54, line_y, 400, line_y)
        width = s.text(56, y, label, 8, color=GREY)
        s.field((56 + width + 4, line_y - writing_height(8), 400, line_y), kind)
        y += 30
    y = _section(s, y + 10, "Host")
    s.labelled_blank(54, y, "Host name:", 400)
    y += 46
    width = s.text(54, y, "X", 14)
    s.line(54 + width + 4, y + 2, 300, y + 2)
    s.field((54 + width + 4, y + 2 - writing_height(14), 300, y + 2), "signature")
    s.text(54 + width + 4, y + 14, "Visitor", 8, color=GREY)
    data, truth = _save(doc, [s])
    return Sample("labels-on-lines", data, truth, layouts=("label-and-underline", "signature-block"))


def date_hints() -> Sample:
    """Boxes with the date's pattern printed faintly inside them."""
    doc = fitz.open()
    s = Sheet(doc)
    y = _heading(s, "Leave Request")
    s.text(54, y + 14, "Employee", 10.5)
    s.box((160, y, 520, y + 22))
    y += 34
    for label, hint in [("First day", "DD/MM/YYYY"), ("Last day", "DD / MM / YYYY"), ("Return to work", "MM/DD/YY")]:
        s.text(54, y + 14, label, 10.5)
        s.box((160, y, 300, y + 22), "date")
        s.text(166, y + 14.5, hint, 9, color=(0.6, 0.6, 0.6))
        y += 34
    s.text(54, y + 14, "Reason", 10.5)
    s.box((160, y, 520, y + 60))
    data, truth = _save(doc, [s])
    return Sample("date-hints", data, truth, layouts=("boxed-inputs",))


FORMS = [
    contact_details, typed_underscores, word_bars, boxes_label_left, boxes_label_above, rounded_boxes,
    grid_label_value, grid_caption_cells, checkbox_squares, checkbox_glyphs, signature_captions, two_columns,
    turned_90, turned_270, turned_180, answer_lines, character_boxes, dotted_leaders, shaded_inputs,
    cropped_page, application_two_pages, existing_fields, ruled_sections, timesheet, dingbat_boxes,
    labels_on_lines, date_hints,
]


# ═══ Not forms ═══════════════════════════════════════════════════════════════

def _paragraph(s: Sheet, x: float, y: float, text: str, width: float = 504, size: float = 10.5,
               leading: float = 14, font: str = "sans") -> float:
    """Wrapped text; returns the baseline after it."""
    words, line = text.split(), ""
    for word in words:
        trial = (line + " " + word).strip()
        if fitz.get_text_length(trial, fontname=_font(font), fontsize=size) > width and line:
            s.text(x, y, line, size, font)
            y += leading
            line = word
        else:
            line = trial
    if line:
        s.text(x, y, line, size, font)
        y += leading
    return y


LOREM = ("Rainfall across the region was close to the long-term average, though the distribution "
         "through the year was uneven. Spring brought heavy storms to the coast while inland "
         "districts stayed dry until the first weeks of summer, when the reservoirs began to recover.")


def report() -> Sample:
    """A report: headings over rules, paragraphs, a ruled data table, a table
    with rules only across, a bar chart and a footnote rule."""
    doc = fitz.open()
    one = Sheet(doc)
    one.text(54, 70, "Regional Water Report 2025", 20, "sans-bold")
    one.line(54, 80, 558, 80, 1.5)
    y = _paragraph(one, 54, 104, LOREM)
    y = _section(one, y + 14, "1. Rainfall by district")
    y = _paragraph(one, 54, y, LOREM)
    heads = ["District", "Rainfall (mm)", "Change", "Storage (%)"]
    rows = [["North", "812", "+4%", "71"], ["Coast", "1,104", "+12%", "88"], ["Inland", "433", "-9%", ""],
            ["Valley", "690", "+1%", "64"]]
    xs, ys = _grid(one, 54, y + 6, [180, 108, 108, 108], [20] * (len(rows) + 1))
    for c, head in enumerate(heads):
        one.text(xs[c] + 5, ys[0] + 14, head, 9.5, "sans-bold")
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row):
            if value:
                one.text(xs[c] + 5, ys[r] + 14, value, 9.5)
    y = ys[-1] + 30
    one.text(54, y, "Table 2. Storage at month end (rules across only)", 9, "sans-bold")
    y += 8
    one.line(54, y, 558, y, 1)
    for i, (month, value) in enumerate([("January", "64%"), ("February", "61%"), ("March", "59%")]):
        one.text(60, y + 16 + 16 * i, month, 9.5)
        one.text(480, y + 16 + 16 * i, value, 9.5)
    one.line(54, y + 22, 558, y + 22, 0.5)
    one.line(54, y + 58, 558, y + 58, 1)
    y += 90
    one.text(54, y, "Figure 1. Days of rain per month", 9, "sans-bold")
    for i, (month, days) in enumerate([("Jan", 9), ("Feb", 7), ("Mar", 12), ("Apr", 4)]):
        top = y + 12 + 20 * i
        one.text(54, top + 11, month, 9)
        one.bar((90, top, 90 + days * 22, top + 14), fill=(0.25, 0.45, 0.7))
        one.text(96 + days * 22, top + 11, str(days), 9)
    y += 110
    one.line(54, y, 200, y, 0.5)
    one.text(54, y + 12, "1. Provisional figures, subject to revision.", 8)
    one.finish()  # a new page invalidates the last one's Page object
    two = Sheet(doc)
    y = _section(two, 72, "2. Outlook")
    y = _paragraph(two, 54, y, LOREM)
    y = _paragraph(two, 54, y + 10, LOREM)
    one_box = fitz.Rect(54, y + 10, 558, y + 70)
    two.rect(one_box, fill=(0.95, 0.95, 0.95))
    _paragraph(two, 64, y + 30, "Key point: storage is expected to stay above 60% through the winter.", width=480)
    data, truth = _save(doc, [one, two])
    return Sample("report", data, truth, form=False)


def invoice() -> Sample:
    """An invoice: a header, an address box with text, line items in a ruled
    table and totals."""
    doc = fitz.open()
    s = Sheet(doc)
    s.bar((54, 54, 110, 100), fill=(0.2, 0.35, 0.6))
    s.text(120, 72, "Harbour Print Co.", 14, "sans-bold")
    s.text(120, 88, "12 Quay Street, Port Ellis", 9, color=GREY)
    s.text(430, 72, "INVOICE", 20, "sans-bold")
    s.text(430, 90, "No. 2025-0412", 9.5)
    s.text(430, 104, "Date: 3 March 2025", 9.5)
    s.rect((54, 130, 300, 200))
    s.text(62, 146, "Bill to", 9, "sans-bold")
    for i, line in enumerate(["Orchard Lane Bakery", "4 Mill Road", "Port Ellis 4410"]):
        s.text(62, 162 + 13 * i, line, 9.5)
    heads = ["Description", "Qty", "Unit price", "Amount"]
    rows = [["Menu cards, A5, 300 gsm", "500", "0.42", "210.00"], ["Window poster, A2", "4", "18.50", "74.00"],
            ["Design time (hours)", "2", "45.00", "90.00"], ["Delivery", "", "", "12.00"]]
    xs, ys = _grid(s, 54, 230, [260, 60, 92, 92], [22] * (len(rows) + 1))
    for c, head in enumerate(heads):
        s.text(xs[c] + 5, ys[0] + 15, head, 9.5, "sans-bold")
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row):
            if value:
                s.text(xs[c] + 5, ys[r] + 15, value, 9.5)
    y = ys[-1] + 24
    for i, (label, value) in enumerate([("Subtotal", "386.00"), ("Tax (10%)", "38.60")]):
        s.text(380, y + 16 * i, label, 9.5)
        s.text(480, y + 16 * i, value, 9.5)
    s.line(380, y + 26, 558, y + 26, 0.8)
    s.text(380, y + 42, "Total due", 10.5, "sans-bold")
    s.text(480, y + 42, "424.60", 10.5, "sans-bold")
    s.text(54, y + 90, "Payment within 14 days to account 06-0145-0332211-00. Thank you for your business.", 9)
    data, truth = _save(doc, [s])
    return Sample("invoice", data, truth, form=False)


def letter() -> Sample:
    """A letter on letterhead, signed off over a line with the name under it."""
    doc = fitz.open()
    s = Sheet(doc)
    s.text(54, 64, "Greenfield Community Trust", 14, "sans-bold")
    s.text(54, 80, "8 Station Road, Ashby  ·  01632 960 112", 9, color=GREY)
    s.line(54, 90, 558, 90, 0.8)
    s.text(54, 130, "14 April 2025", 10.5)
    s.text(54, 160, "Dear Ms Okafor,", 10.5)
    y = _paragraph(s, 54, 184, "Thank you for volunteering at the spring planting day. More than forty "
                   "people joined us, and together we planted three hundred trees along the river path.")
    y = _paragraph(s, 54, y + 8, "We would be glad to see you at the summer open day as well. Details will "
                   "follow in our newsletter next month.")
    s.text(54, y + 20, "Yours sincerely,", 10.5)
    s.line(54, y + 70, 230, y + 70, 0.6)
    s.text(54, y + 84, "Daniel Reyes", 10.5)
    s.text(54, y + 98, "Volunteer Coordinator", 10.5)
    data, truth = _save(doc, [s])
    return Sample("letter", data, truth, form=False)


def statement() -> Sample:
    """A financial statement: dotted leaders run to amounts, rules sit over
    totals, and a contents list has leaders to page numbers."""
    doc = fitz.open()
    s = Sheet(doc)
    s.text(54, 70, "Statement of Accounts", 18, "sans-bold")
    y = 110
    for label, amount in [("Opening balance", "1,204.50"), ("Membership fees", "3,880.00"),
                          ("Grants received", "12,500.00"), ("Hall hire", "(640.25)"), ("Insurance", "-312.00")]:
        x = 54 + s.text(54, y, label, 10.5) + 4
        s.blank(x, y, 460, style="dots")
        s.fields.pop()  # a leader to an amount, not a blank
        s.text(470, y, amount, 10.5)
        y += 22
    s.line(460, y - 8, 558, y - 8, 0.8)
    s.text(54, y + 6, "Closing balance", 10.5, "sans-bold")
    s.text(470, y + 6, "16,632.25", 10.5, "sans-bold")
    s.line(460, y + 10, 558, y + 10, 0.8)
    y += 60
    s.text(54, y, "Contents", 12, "sans-bold")
    y += 22
    for title, page in [("Treasurer's report", "2"), ("Accounts", "3"), ("Notes", "7")]:
        x = 54 + s.text(54, y, title, 10.5) + 4
        s.blank(x, y, 520, style="dots")
        s.fields.pop()
        s.text(530, y, page, 10.5)
        y += 20
    data, truth = _save(doc, [s])
    return Sample("statement", data, truth, form=False)


NON_FORMS = [report, invoice, letter, statement]


# ═══ Pictures of pages ═══════════════════════════════════════════════════════

def scanned(sample: Sample | None = None) -> bytes:
    """Each page of a form as a picture only, as a scanner makes it."""
    src = fitz.open("pdf", (sample or contact_details()).data)
    out = fitz.open()
    for page in src:
        pix = page.get_pixmap(dpi=100)
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        buf = io.BytesIO()
        image.save(buf, "JPEG", quality=70)
        new = out.new_page(width=page.rect.width, height=page.rect.height)
        new.insert_image(new.rect, stream=buf.getvalue())
    return out.tobytes(deflate=True)


def scan_then_form() -> bytes:
    """A scanned first page followed by a drawn form."""
    picture = fitz.open("pdf", scanned())
    form = fitz.open("pdf", contact_details().data)
    picture.insert_pdf(form)
    return picture.tobytes(deflate=True)


def many_pages(count: int) -> bytes:
    """A form repeated over `count` pages."""
    one = fitz.open("pdf", contact_details().data)
    out = fitz.open()
    for _ in range(count):
        out.insert_pdf(one)
    return out.tobytes(deflate=True)


def blank_pages(count: int = 2) -> bytes:
    out = fitz.open()
    for _ in range(count):
        out.new_page()
    return out.tobytes()


__all__ = ["FORMS", "NON_FORMS", "Sample", "Truth", "writing_height", "scanned", "scan_then_form",
           "many_pages", "blank_pages"]
