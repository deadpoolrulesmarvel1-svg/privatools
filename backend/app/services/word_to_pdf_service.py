from docx import Document
from docx.oxml.ns import qn
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from ..utils.filenames import temp_output

# Word writes a text box twice, as a DrawingML choice and a VML fallback, so an
# equation in one appears in both. python-docx maps no prefix for this namespace.
_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


def word_to_pdf(input_path: str) -> tuple[str, int]:
    """Convert a .docx file to PDF using python-docx + reportlab.

    Returns the PDF's path and how many Word equations the body holds. None
    of them is drawn: Word keeps an equation (OMML, m:oMath) beside its
    paragraph's text runs, and python-docx's paragraph text leaves it out, so
    the page says how many the PDF is missing.
    """
    output_path = temp_output("word", "pdf")

    doc = Document(input_path)
    equations = sum(
        1 for m in doc.element.body.iter(qn("m:oMath"))
        if not any(a.tag == _FALLBACK for a in m.iterancestors())
    )
    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4
    margin = 72  # 1 inch
    usable_width = width - 2 * margin
    y = height - margin
    line_height = 14
    font_size = 11

    c.setFont("Helvetica", font_size)

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            y -= line_height * 0.5
            if y < margin:
                c.showPage()
                c.setFont("Helvetica", font_size)
                y = height - margin
            continue

        # Detect heading styles
        if para.style and para.style.name.startswith("Heading"):
            level = 1
            try:
                level = int(para.style.name.replace("Heading", "").strip())
            except ValueError:
                level = 1
            heading_sizes = {1: 18, 2: 15, 3: 13}
            hs = heading_sizes.get(level, 13)
            c.setFont("Helvetica-Bold", hs)
            y -= hs * 0.3

            if y < margin:
                c.showPage()
                c.setFont("Helvetica-Bold", hs)
                y = height - margin

            c.drawString(margin, y, text)
            y -= hs + 6
            c.setFont("Helvetica", font_size)
            continue

        # Check for bold/italic in runs
        is_bold = any(run.bold for run in para.runs if run.bold is not None)
        is_italic = any(run.italic for run in para.runs if run.italic is not None)

        if is_bold and is_italic:
            c.setFont("Helvetica-BoldOblique", font_size)
        elif is_bold:
            c.setFont("Helvetica-Bold", font_size)
        elif is_italic:
            c.setFont("Helvetica-Oblique", font_size)
        else:
            c.setFont("Helvetica", font_size)

        # Word wrap
        words = text.split()
        line = ""
        for word in words:
            test_line = f"{line} {word}".strip()
            if c.stringWidth(test_line, c._fontname, font_size) < usable_width:
                line = test_line
            else:
                if y < margin:
                    c.showPage()
                    c.setFont("Helvetica", font_size)
                    y = height - margin
                c.drawString(margin, y, line)
                y -= line_height
                line = word

        if line:
            if y < margin:
                c.showPage()
                c.setFont("Helvetica", font_size)
                y = height - margin
            c.drawString(margin, y, line)
            y -= line_height

        c.setFont("Helvetica", font_size)

    c.save()
    return str(output_path), equations
