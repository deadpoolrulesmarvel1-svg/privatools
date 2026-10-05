"""A second, randomised corpus for Form Creator's field detection.

form_detect_pdfs.py draws one form per layout, and the detector was written
against it. This module draws forms the detector was not written against:
each is laid out at random, from a fixed seed, by reportlab (another library,
so other drawing operators) in Helvetica, Times or Courier at 8 to 12 points,
with random gaps, line weights, line positions, box sizes and label
placements, and some pages turned (/Rotate) or several pages long. The
non-forms are random reports, letters, invoices, contents pages and
statements with rules, ruled tables of data, charts and dotted leaders.

Each sample's fields are recorded as it is drawn, in Form Creator's numbers
(points from the top-left corner of the page, before /Rotate), with the
type its label says: a date where the label names a date, a signature where
it names a signature.
"""

from __future__ import annotations

import io
import random

import fitz  # PyMuPDF
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

from backend.tests.form_detect_pdfs import Sample, Truth, _turned, writing_height

TEXT_LABELS = [
    "Full name", "First name", "Last name", "Surname", "Address", "Street", "City", "Town", "County", "State",
    "Postcode", "ZIP code", "Country", "Phone", "Mobile", "Email", "Occupation", "Employer", "Job title",
    "Department", "Reference number", "Account number", "Student ID", "Policy number", "Vehicle make",
    "Registration", "Emergency contact", "Relationship", "Nationality", "Passport number", "Company", "Website",
    "Amount", "Reason for visit", "Allergies", "Current medication", "Doctor's name", "Insurance provider",
    "Membership type", "Course", "Teacher", "Room number", "Number of guests", "Previous school",
]
DATE_LABELS = ["Date", "Date of birth", "Start date", "End date", "Date of issue", "Expiry date",
               "Arrival date", "Departure date", "Date signed", "Appointment date"]
SIGNATURE_LABELS = ["Signature", "Applicant signature", "Signature of parent or guardian", "Customer signature",
                    "Sign here", "Signature of witness", "Authorised signature"]
QUESTIONS = [
    ("Are you over 18?", ["Yes", "No"]), ("Gender:", ["Male", "Female", "Other"]),
    ("Preferred contact method:", ["Email", "Phone", "Post"]), ("Have you visited before?", ["Yes", "No"]),
    ("Payment method:", ["Card", "Cash", "Cheque", "Transfer"]), ("Do you need parking?", ["Yes", "No"]),
    ("Employment type:", ["Full-time", "Part-time", "Casual"]), ("Session:", ["Morning", "Afternoon", "Evening"]),
]
LIST_OPTIONS = ["Swimming", "Tennis", "Chess club", "Choir", "Drama", "Robotics", "Gardening", "Cycling",
                "First aid course", "Photography", "Volunteering", "Library helper"]
SENTENCES = [
    "Please complete every section in block capitals.",
    "Return the completed form to the front desk or post it to the address overleaf.",
    "We use this information only to process your application.",
    "Incomplete forms may delay your application.",
    "Ask a member of staff if you need help filling in this form.",
]
FONTS = [("Helvetica", "Helvetica-Bold"), ("Times-Roman", "Times-Bold"), ("Courier", "Courier-Bold")]


class Painter:
    """A reportlab canvas measured from the top-left corner, recording fields."""

    def __init__(self, rng: random.Random, size):
        self.rng = rng
        self.buffer = io.BytesIO()
        self.width, self.height = size
        self.canvas = rl_canvas.Canvas(self.buffer, pagesize=size)
        self.page = 1
        self.fields: list[Truth] = []
        self.ticks: list[tuple[int, float, float, str]] = []  # page, x, baseline, char (ZapfDingbats)
        self.font, self.bold = rng.choice(FONTS)
        self.size = rng.choice([8, 9, 9.5, 10, 10.5, 11, 12])
        self.margin = rng.choice([40, 54, 72])
        self.y = self.margin + 20

    # ── primitives, y from the top ──────────────────────────────────────
    def text(self, x: float, y: float, s: str, size: float | None = None, bold: bool = False) -> float:
        size = size or self.size
        font = self.bold if bold else self.font
        self.canvas.setFillColorRGB(0, 0, 0)
        self.canvas.setFont(font, size)
        self.canvas.drawString(x, self.height - y, s)
        return stringWidth(s, font, size)

    def width_of(self, s: str, size: float | None = None) -> float:
        return stringWidth(s, self.font, size or self.size)

    def line(self, x0: float, y0: float, x1: float, y1: float, width: float = 0.75) -> None:
        self.canvas.setStrokeColorRGB(0, 0, 0)
        self.canvas.setLineWidth(width)
        self.canvas.line(x0, self.height - y0, x1, self.height - y1)

    def rect(self, x0: float, y0: float, x1: float, y1: float, width: float = 0.75, *, fill=None,
             stroke: bool = True, radius: float = 0) -> None:
        c = self.canvas
        c.setLineWidth(width)
        c.setStrokeColorRGB(0, 0, 0)
        if fill is not None:
            c.setFillColorRGB(*fill)
        if radius:
            c.roundRect(x0, self.height - y1, x1 - x0, y1 - y0, radius, stroke=int(stroke), fill=int(fill is not None))
        else:
            c.rect(x0, self.height - y1, x1 - x0, y1 - y0, stroke=int(stroke), fill=int(fill is not None))
        c.setFillColorRGB(0, 0, 0)

    def field(self, rect, kind: str) -> None:
        self.fields.append(Truth(self.page, tuple(float(v) for v in rect), kind))

    def room(self, need: float) -> None:
        if self.y + need > self.height - self.margin:
            self.canvas.showPage()
            self.page += 1
            self.y = self.margin + 20

    # ── rows ─────────────────────────────────────────────────────────────
    def pick_label(self, fit: float | None = None, size: float | None = None) -> tuple[str, str]:
        """A label and the type it names; with `fit`, one that fits in that
        width (as a designer would choose a shorter one or wrap it)."""
        for _ in range(50):
            r = self.rng.random()
            if r < 0.15:
                label, kind = self.rng.choice(DATE_LABELS), "date"
            elif r < 0.22:
                label, kind = self.rng.choice(SIGNATURE_LABELS), "signature"
            else:
                label, kind = self.rng.choice(TEXT_LABELS), "text"
            if fit is None or stringWidth(label, self.bold, size or self.size) <= fit:
                return label, kind
        return "Name", "text"

    def colon(self, label: str) -> str:
        return label + ":" if self.rng.random() < 0.7 else label

    def blank_after(self, x: float, y: float, label: str, kind: str, x_end: float, style: str) -> float:
        """A label on baseline y, then a blank to x_end; returns where the blank ends."""
        gap = self.rng.choice([3, 5, 6, 8, 12, 20])
        x0 = x + self.text(x, y, label) + gap
        if x_end - x0 < 40:
            x_end = x0 + 60
        if style == "line":
            offset = self.rng.choice([0.5, 1, 2, 3])
            self.line(x0, y + offset, x_end, y + offset, self.rng.choice([0.4, 0.6, 0.75, 1.0, 1.2]))
            line_y = y + offset
            x1 = x_end
        elif style == "bar":
            line_y = y + self.rng.choice([1, 2])
            thickness = self.rng.choice([0.5, 0.7, 1.0])
            self.rect(x0, line_y - thickness / 2, x_end, line_y + thickness / 2, stroke=False, fill=(0, 0, 0))
            x1 = x_end
        else:  # underscores
            unit = self.width_of("_")
            count = max(4, int((x_end - x0) / unit))
            self.text(x0, y, "_" * count)
            x1 = x0 + count * unit
            line_y = y + 0.15 * self.size
        self.field((x0, line_y - writing_height(self.size), x1, line_y), kind)
        return x1

    def row_lines(self) -> None:
        style = self.rng.choice(["line", "line", "bar", "underscores"])
        per_row = self.rng.choice([1, 1, 2, 2, 3])
        right = self.width - self.margin
        span = (right - self.margin) / per_row
        self.room(34)
        y = self.y + self.size
        for i in range(per_row):
            # A label short enough to leave a blank of 60 points in its share of the row.
            label, kind = self.pick_label(fit=span - 14 - 20 - 60)
            x = self.margin + i * span
            self.blank_after(x, y, self.colon(label), kind, x + span - 14, style)
        self.y += self.rng.choice([26, 30, 34, 40])

    def row_box(self) -> None:
        label, kind = self.pick_label()
        height = self.rng.choice([16, 18, 20, 24, 28])
        above = self.rng.random() < 0.5
        width = self.rng.choice([0.5, 0.75, 1.0, 1.5])
        radius = self.rng.choice([0, 0, 0, 3, 5])
        right = self.width - self.margin - self.rng.choice([0, 40, 120])
        if above:
            self.room(height + 30)
            small = max(7, self.size - 2)
            self.text(self.margin, self.y + small, label, size=small)
            top = self.y + small + self.rng.choice([3, 4, 6])
            x0 = self.margin
        else:
            self.room(height + 14)
            top = self.y
            label = self.colon(label)
            x0 = self.margin + max(self.rng.choice([110, 140, 170]), self.width_of(label) + self.rng.choice([6, 12, 30]))
            self.text(self.margin, top + height / 2 + 0.35 * self.size, label)
        self.rect(x0, top, right, top + height, width, radius=radius)
        inset = width / 2 + 0.5
        self.field((x0 + inset, top + inset, right - inset, top + height - inset), kind)
        self.y = top + height + self.rng.choice([12, 16, 22])

    def row_question(self) -> None:
        question, options = self.rng.choice(QUESTIONS)
        self.room(26)
        y = self.y + self.size
        x = self.margin + self.text(self.margin, y, question) + self.rng.choice([8, 14, 30])
        side = self.rng.choice([8, 9, 10, 11, 12])
        for option in options:
            if self.rng.random() < 0.6:
                top = y - 0.35 * self.size - side / 2
                self.rect(x, top, x + side, top + side, self.rng.choice([0.5, 0.75, 1.0]))
                self.field((x, top, x + side, top + side), "checkbox")
                x += side
            else:
                self.ticks.append((self.page, x, y, self.rng.choice("oq")))
                x += 10
            x += 4 + self.text(x + 4, y, option) + self.rng.choice([12, 16, 24])
        self.y += self.rng.choice([22, 26, 30])

    def row_list(self) -> None:
        self.room(24 + 20 * 4)
        self.text(self.margin, self.y + self.size, self.rng.choice(["Activities:", "Tick all that apply:",
                                                                     "Which of these interest you?"]))
        self.y += self.size + 10
        side = self.rng.choice([8, 10, 12])
        for option in self.rng.sample(LIST_OPTIONS, self.rng.choice([3, 4, 5])):
            self.room(20)
            top = self.y
            x = self.margin + 12
            self.rect(x, top, x + side, top + side, 0.75)
            self.field((x, top, x + side, top + side), "checkbox")
            self.text(x + side + 6, top + side / 2 + 0.35 * self.size, option)
            self.y += side + self.rng.choice([6, 8, 10])
        self.y += 10

    def row_grid(self) -> None:
        columns = self.rng.choice([2, 4])
        rows = self.rng.choice([2, 3, 4])
        height = self.rng.choice([20, 22, 26])
        self.room(rows * height + 20)
        total = self.width - 2 * self.margin
        widths = [total * 0.3, total * 0.7] if columns == 2 else [total * 0.18, total * 0.32] * 2
        xs = [self.margin]
        for w in widths:
            xs.append(xs[-1] + w)
        ys = [self.y + i * height for i in range(rows + 1)]
        stroke = self.rng.choice([0.5, 0.75, 1.0])
        for y in ys:
            self.line(xs[0], y, xs[-1], y, stroke)
        for x in xs:
            self.line(x, ys[0], x, ys[-1], stroke)
        for r in range(rows):
            for c in range(0, columns, 2):
                label, kind = self.pick_label(fit=xs[c + 1] - xs[c] - 8)
                self.text(xs[c] + 4, ys[r] + height / 2 + 0.35 * self.size, label, bold=self.rng.random() < 0.5)
                self.field((xs[c + 1] + 1, ys[r] + 1, xs[c + 2] - 1, ys[r + 1] - 1), kind)
        self.y = ys[-1] + 20

    def row_caption_cells(self) -> None:
        count = self.rng.choice([1, 2, 3])
        height = self.rng.choice([30, 34, 40])
        self.room(height + 16)
        total = self.width - 2 * self.margin
        xs = [self.margin + total * i / count for i in range(count + 1)]
        top, bottom = self.y, self.y + height
        self.line(xs[0], top, xs[-1], top, 0.6)
        self.line(xs[0], bottom, xs[-1], bottom, 0.6)
        for x in xs:
            self.line(x, top, x, bottom, 0.6)
        small = self.rng.choice([6.5, 7, 7.5])
        for i in range(count):
            label, kind = self.pick_label(fit=xs[i + 1] - xs[i] - 26, size=small)
            self.text(xs[i] + 3, top + small + 1.5, f"{self.rng.randint(1, 30)}. {label}", size=small)
            self.field((xs[i] + 1, top + small + 4, xs[i + 1] - 1, bottom - 1), kind)
        self.y = bottom + 16

    def row_signature(self) -> None:
        self.room(70)
        y = self.y + 40
        left = self.margin
        count = self.rng.choice([2, 3])
        span = (self.width - 2 * self.margin) / count
        small = max(7, self.size - 2)
        fitting = [s for s in SIGNATURE_LABELS if self.width_of(s, small) <= span - 24] or ["Signature"]
        options = [(self.rng.choice(fitting), "signature"), ("Date", "date"), ("Print name", "text")]
        for i, (caption, kind) in enumerate(options[:count]):
            x0, x1 = left + i * span, left + (i + 1) * span - 20
            self.line(x0, y, x1, y, self.rng.choice([0.5, 0.75, 1.0]))
            self.text(x0, y + 10, caption, size=max(7, self.size - 2))
            self.field((x0, y - writing_height(10.5), x1, y), kind)
        self.y = y + 30

    def row_answer(self) -> None:
        count = self.rng.choice([2, 3, 4])
        spacing = self.rng.choice([18, 20, 22, 26])
        self.room(spacing * count + 30)
        question = self.rng.choice(["Describe your experience:", "Additional information:", "Comments:",
                                    "Reason for your application:", "Any other details?"])
        self.text(self.margin, self.y + self.size, question)
        first = self.y + self.size + spacing
        x1 = self.width - self.margin
        for i in range(count):
            self.line(self.margin, first + spacing * i, x1, first + spacing * i, 0.6)
        self.field((self.margin, first - writing_height(self.size), x1, first + spacing * (count - 1)), "text")
        self.y = first + spacing * count + 8

    def row_comb(self) -> None:
        label = self.rng.choice(["Tax number", "Membership no.", "Postcode", "Account number", "ID number"])
        count = self.rng.choice([4, 6, 8, 9])
        side = self.rng.choice([14, 16, 18])
        self.room(side + 20)
        x0 = self.margin + self.text(self.margin, self.y + side / 2 + 0.35 * self.size, self.colon(label)) + 10
        for i in range(count):
            self.rect(x0 + side * i, self.y, x0 + side * (i + 1), self.y + side, 0.6)
        self.field((x0 + 1, self.y + 1, x0 + side * count - 1, self.y + side - 1), "text")
        self.y += side + 16

    def row_label_on_line(self) -> None:
        """Small labels written on the left end of their own lines."""
        count = self.rng.choice([1, 2])
        span = (self.width - 2 * self.margin) / count
        small = self.rng.choice([7, 7.5, 8, 9])
        self.room(30)
        line_y = self.y + 20
        for i in range(count):
            label, kind = self.pick_label(fit=span * 0.4, size=small)
            x0, x1 = self.margin + i * span, self.margin + (i + 1) * span - 16
            self.line(x0, line_y, x1, line_y, self.rng.choice([0.5, 0.75]))
            width = self.text(x0 + 2, line_y - self.rng.choice([1, 1.5, 2]), label, size=small)
            self.field((x0 + 2 + width + 4, line_y - writing_height(small), x1, line_y), kind)
        self.y = line_y + self.rng.choice([14, 18, 24])

    def row_date_hint(self) -> None:
        """A date box with its pattern printed in it."""
        label, _ = self.rng.choice([(lbl, "date") for lbl in DATE_LABELS])
        self.room(34)
        top = self.y
        x0 = self.margin + max(120, self.width_of(label + ":") + 12)
        height = self.rng.choice([18, 20, 22])
        self.text(self.margin, top + height / 2 + 0.35 * self.size, self.colon(label))
        self.rect(x0, top, x0 + 130, top + height, 0.75)
        self.canvas.setFillColorRGB(0.6, 0.6, 0.6)
        self.canvas.setFont(self.font, max(7, self.size - 1.5))
        self.canvas.drawString(x0 + 5, self.height - (top + height / 2 + 3), self.rng.choice(
            ["DD/MM/YYYY", "MM/DD/YYYY", "DD / MM / YY", "YYYY-MM-DD"]))
        self.canvas.setFillColorRGB(0, 0, 0)
        self.field((x0 + 0.875, top + 0.875, x0 + 130 - 0.875, top + height - 0.875), "date")
        self.y = top + height + 14

    def row_x_signature(self) -> None:
        self.room(50)
        y = self.y + 28
        width = self.text(self.margin, y, "X", size=self.rng.choice([12, 14, 16]))
        x0, x1 = self.margin + width + 4, self.margin + self.rng.choice([200, 260, 320])
        self.line(x0, y + 2, x1, y + 2, 0.75)
        self.field((x0, y + 2 - writing_height(self.size), x1, y + 2), "signature")
        self.y = y + 22

    def row_text(self) -> None:
        self.room(30)
        self.text(self.margin, self.y + self.size, self.rng.choice(SENTENCES))
        self.y += self.size + 14

    def row_section(self) -> None:
        self.room(40)
        title = self.rng.choice(["Your details", "Contact information", "About your visit", "Payment",
                                 "Declaration", "Office use only", "Medical history"])
        self.y += 8
        self.text(self.margin, self.y + 12, title, size=12, bold=True)
        if self.rng.random() < 0.6:
            self.line(self.margin, self.y + 16, self.width - self.margin, self.y + 16, self.rng.choice([0.75, 1.5]))
        self.y += 30

    def finish(self) -> bytes:
        self.canvas.save()
        data = self.buffer.getvalue()
        if not self.ticks:
            return data
        doc = fitz.open("pdf", data)
        for page, x, y, char in self.ticks:
            doc[page - 1].insert_text((x, y), char, fontname="zadb", fontsize=self.size + 0.5)
        data = doc.tobytes(garbage=0, deflate=True)
        flags = fitz.TEXTFLAGS_RAWDICT | fitz.TEXT_ACCURATE_BBOXES
        reread = fitz.open("pdf", data)
        for page, x, y, char in self.ticks:
            chars = [c for b in reread[page - 1].get_text("rawdict", flags=flags)["blocks"]
                     for l in b.get("lines", []) for s in l["spans"] if "Dingbats" in s["font"] for c in s["chars"]]
            c = min(chars, key=lambda c: abs(c["origin"][0] - x) + abs(c["origin"][1] - y))
            r = fitz.Rect(c["bbox"])
            side = max(r.width, r.height)
            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            self.fields.append(Truth(page, (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), "checkbox"))
        return data


ROWS = ["row_lines", "row_lines", "row_lines", "row_box", "row_box", "row_question", "row_list", "row_grid",
        "row_caption_cells", "row_signature", "row_answer", "row_comb", "row_text", "row_section",
        "row_label_on_line", "row_date_hint", "row_x_signature"]


def varied_form(seed: int) -> Sample:
    rng = random.Random(seed)
    size = rng.choice([LETTER, A4])
    p = Painter(rng, size)
    p.text(p.margin, p.y, rng.choice(["Application Form", "Registration", "Enrolment Form", "Request Form",
                                      "Booking Form", "Consent Form"]), size=16, bold=True)
    p.y += 28
    for _ in range(rng.randint(6, 14)):
        getattr(p, rng.choice(ROWS))()
    data = p.finish()
    sample = Sample(f"varied-form-{seed}", data, p.fields)
    turn = rng.random()
    if turn < 0.12:
        return _turned(sample, rng.choice([90, 180, 270]), sample.name)
    return sample


# ── Not forms ────────────────────────────────────────────────────────────────

WORDS = ("the of and to in a is that for it as was with be by on not he this are or his from at which but have an "
         "they you were her all she there would their we him been has when who will more no if out so said what up "
         "its about into than them can only other new some could time these two may then do first any my now such "
         "like our over man me even most made after also did many before must through back years where much your way "
         "well down should because each just those people how too little state good very make world still own see "
         "men work long get here between both life being under never day same another know while last might us great "
         "old year off come since against go came right used take three").split()


def _chart_reader():
    """A small bar chart as a picture, for reportlab to draw."""
    from PIL import Image, ImageDraw
    from reportlab.lib.utils import ImageReader

    image = Image.new("RGB", (272, 102), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for i, height in enumerate([40, 80, 60, 95, 70]):
        draw.rectangle((14 + i * 52, 100 - height, 50 + i * 52, 100), fill=(60, 110, 170))
    buf = io.BytesIO()
    image.save(buf, "PNG")
    buf.seek(0)
    return ImageReader(buf)


def _sentence(rng: random.Random, words: int) -> str:
    text = " ".join(rng.choice(WORDS) for _ in range(words))
    return text[0].upper() + text[1:] + "."


def varied_document(seed: int) -> Sample:
    rng = random.Random(10_000 + seed)
    p = Painter(rng, rng.choice([LETTER, A4]))
    right = p.width - p.margin
    kind = rng.choice(["report", "letter", "invoice", "contents", "statement"])
    p.text(p.margin, p.y, {"report": "Annual Report", "letter": "Riverside Housing Trust", "invoice": "INVOICE",
                           "contents": "Contents", "statement": "Account Statement"}[kind], size=18, bold=True)
    if rng.random() < 0.7:
        p.line(p.margin, p.y + 8, right, p.y + 8, rng.choice([0.75, 1.5]))
    p.y += 34

    def paragraph() -> None:
        words = (_sentence(rng, rng.randint(8, 18)) + " " + _sentence(rng, rng.randint(8, 18))).split()
        line = ""
        for word in words:
            trial = (line + " " + word).strip()
            if p.width_of(trial) > right - p.margin and line:
                p.room(16)
                p.text(p.margin, p.y + p.size, line)
                p.y += p.size + 4
                line = word
            else:
                line = trial
        if line:
            p.room(16)
            p.text(p.margin, p.y + p.size, line)
            p.y += p.size + 4
        p.y += 8

    def heading() -> None:
        p.room(46)
        p.y += 6
        title = rng.choice([_sentence(rng, rng.randint(2, 4)).rstrip("."), "Patient Information", "Applicant Details",
                            "Contact Information", "Your Signature"])
        p.text(p.margin, p.y + 13, title, size=13, bold=True)
        if rng.random() < 0.7:
            gap = rng.choice([4, 8, 12, 15])  # the rule, this far under the heading's baseline
            p.line(p.margin, p.y + 13 + gap, right, p.y + 13 + gap, rng.choice([0.5, 1.0]))
        p.y += 34

    def figure() -> None:
        """A framed picture under a caption, or a framed line chart beside a label."""
        p.room(150)
        if rng.random() < 0.5:
            p.text(p.margin, p.y + 9, f"Figure {rng.randint(1, 9)}: " + _sentence(rng, 3).rstrip("."), size=9, bold=True)
            top = p.y + 15
            p.rect(p.margin, top, p.margin + 280, top + 110, 0.75)
            p.canvas.drawImage(_chart_reader(), p.margin + 4, p.height - (top + 106), 272, 102)
            p.y = top + 126
        else:
            p.text(p.margin, p.y + 45, rng.choice(["Trend", "Visits", "Growth"]), size=10)
            x0, top = p.margin + 80, p.y
            p.rect(x0, top, x0 + 300, top + 80, 0.75)
            points = [(x0 + 10 + 48 * i, top + 70 - rng.randint(5, 60)) for i in range(7)]
            for a, b in zip(points, points[1:]):
                p.line(a[0], a[1], b[0], b[1], 1.2)
            p.y = top + 96

    def striped_table() -> None:
        """Rows on pale stripes, the last stripes empty."""
        rows = rng.randint(3, 6)
        p.room(22 * (rows + 3) + 20)
        p.text(p.margin + 6, p.y + 12, "Item", bold=True)
        p.text(right - 80, p.y + 12, "Count", bold=True)
        p.y += 18
        for i in range(rows + rng.randint(1, 2)):
            if i % 2 == 0:
                p.rect(p.margin, p.y, right, p.y + 20, stroke=False, fill=(0.93, 0.95, 0.97))
            if i < rows:
                p.text(p.margin + 6, p.y + 14, rng.choice(WORDS).title() + " " + rng.choice(WORDS))
                p.text(right - 80, p.y + 14, f"{rng.randint(1, 999):,}")
            p.y += 20
        p.y += 16

    def data_table() -> None:
        cols = rng.randint(3, 5)
        rows = rng.randint(3, 7)
        height = rng.choice([16, 18, 20])
        p.room(height * (rows + 1) + 20)
        xs = [p.margin + (right - p.margin) * i / cols for i in range(cols + 1)]
        ys = [p.y + height * i for i in range(rows + 2)]
        ruled = rng.random() < 0.6
        for y in (ys if ruled else [ys[0], ys[1], ys[-1]]):
            p.line(xs[0], y, xs[-1], y, 0.5)
        if ruled:
            for x in xs:
                p.line(x, ys[0], x, ys[-1], 0.5)
        for c in range(cols):
            p.text(xs[c] + 4, ys[0] + height - 5, rng.choice(["Item", "Region", "Total", "Count", "Rate", "Code"]),
                   bold=True)
        for r in range(1, rows + 1):
            for c in range(cols):
                if rng.random() < 0.08:
                    continue  # a missing value
                value = rng.choice(WORDS).title() if c == 0 else f"{rng.randint(1, 9999):,}"
                p.text(xs[c] + 4, ys[r] + height - 5, value)
        p.y = ys[-1] + 18

    def chart() -> None:
        bars = rng.randint(3, 6)
        p.room(bars * 20 + 30)
        p.text(p.margin, p.y + 10, "Figure " + str(rng.randint(1, 9)), size=9, bold=True)
        p.y += 16
        colour = rng.choice([(0.2, 0.4, 0.7), (0.8, 0.3, 0.2), (0.3, 0.6, 0.3), (0.5, 0.5, 0.5)])
        for _ in range(bars):
            p.text(p.margin, p.y + 10, rng.choice(WORDS).title(), size=9)
            length = rng.randint(40, 300)
            p.rect(p.margin + 60, p.y, p.margin + 60 + length, p.y + 13, stroke=False, fill=colour)
            p.y += 18
        p.y += 12

    def contents(amounts: bool = False) -> None:
        for i in range(rng.randint(5, 12)):
            p.room(18)
            title = _sentence(rng, rng.randint(2, 5)).rstrip(".")
            x = p.margin + p.text(p.margin, p.y + p.size, title if amounts else f"{i + 1}. {title}") + 4
            number = f"{rng.randint(1, 99999) / 100:,.2f}" if amounts else str(rng.randint(2, 120))
            end = right - p.width_of(number) - 4
            unit = p.width_of(".")
            if end - x > 20:
                p.text(x, p.y + p.size, "." * int((end - x) / unit))
            p.text(right - p.width_of(number), p.y + p.size, number)
            p.y += p.size + 8

    def signoff() -> None:
        p.room(90)
        p.text(p.margin, p.y + p.size, rng.choice(["Yours sincerely,", "Kind regards,", "With thanks,"]))
        y = p.y + 50
        p.line(p.margin, y, p.margin + rng.choice([140, 180, 220]), y, 0.6)
        p.text(p.margin, y + 12, rng.choice(["Amara Osei", "Liam Gallagher", "Priya Raman", "Tomás Ruiz"]))
        p.text(p.margin, y + 24, rng.choice(["Director", "Office Manager", "Head of Services"]))
        p.y = y + 40

    def footnote() -> None:
        p.room(30)
        p.line(p.margin, p.y, p.margin + 150, p.y, 0.5)
        p.text(p.margin, p.y + 10, "1. " + _sentence(rng, rng.randint(5, 10)), size=8)
        p.y += 24

    def address_box() -> None:
        p.room(80)
        p.rect(p.margin, p.y, p.margin + 220, p.y + 64, 0.75)
        for i, line in enumerate(["Bill to", rng.choice(WORDS).title() + " Ltd", f"{rng.randint(1, 99)} High Street",
                                  "Townsville"]):
            p.text(p.margin + 8, p.y + 14 + 13 * i, line, bold=i == 0)
        p.y += 80

    plans = {
        "report": [paragraph, heading, paragraph, data_table, chart, heading, figure, paragraph, striped_table,
                   footnote],
        "letter": [paragraph, paragraph, paragraph, signoff],
        "invoice": [address_box, data_table, paragraph],
        "contents": [contents, paragraph],
        "statement": [address_box, data_table, lambda: contents(amounts=True), striped_table, data_table, paragraph],
    }
    for step in plans[kind]:
        step()
    return Sample(f"varied-{kind}-{seed}", p.finish(), [], form=False)


VARIED_SEEDS = range(1, 41)
VARIED_DOCUMENT_SEEDS = range(1, 16)
