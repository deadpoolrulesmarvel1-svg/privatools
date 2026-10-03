"""Word to PDF sets the text of each body paragraph in Helvetica.

It reads that text with python-docx, not LibreOffice. Word keeps an equation
(OMML, an m:oMath element) beside the text runs of its paragraph, so the text
python-docx gives leaves it out, and so does the PDF: "Before x/y after." comes
out as "Before after.". The guide has to say so, and the answer says how many
equations a document had, so the page can tell the visitor. All documents are
synthetic.
"""
from __future__ import annotations

import io

import docx
import fitz
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

from backend.app.services import word_to_pdf_service
from backend.app.tool_content import TOOL_FAQ, TOOL_HOWTO

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FRACTION = (
    f'<m:oMath {nsdecls("m")}><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num>'
    '<m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath>'
)
INLINE = object()   # an x/y equation inside a line of text
DISPLAY = object()  # an x/y equation on a line of its own, as Word writes it (m:oMathPara)


def word_document(*paragraphs: list) -> bytes:
    """A .docx with one paragraph per list of parts: text, INLINE or DISPLAY."""
    document = docx.Document()
    for parts in paragraphs:
        paragraph = document.add_paragraph()
        for part in parts:
            if part is INLINE:
                paragraph._p.append(parse_xml(FRACTION))
            elif part is DISPLAY:
                paragraph._p.append(parse_xml(f'<m:oMathPara {nsdecls("m")}>{FRACTION}</m:oMathPara>'))
            else:
                paragraph.add_run(part)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def pdf_text(path: str) -> str:
    with fitz.open(path) as pdf:
        return " ".join(page.get_text() for page in pdf).strip()


def converted(tmp_path, content: bytes) -> str:
    source = tmp_path / "equation.docx"
    source.write_bytes(content)
    path, _ = word_to_pdf_service.word_to_pdf(str(source))
    return path


def test_an_equation_is_left_out_and_the_guide_says_so(tmp_path):
    text = pdf_text(converted(tmp_path, word_document(["Before ", INLINE, " after."])))
    assert text == "Before after."

    steps = " ".join(step["text"] for step in TOOL_HOWTO["word-to-pdf"])
    assert "equations" in steps
    faq = {item["q"]: item["a"] for item in TOOL_FAQ["word-to-pdf"]}
    assert "equations" in faq["Will the PDF look exactly like my Word document?"]
    [answer] = [a for q, a in faq.items() if "equation" in q.lower()]
    assert "Before after." in answer and "Office to PDF" in answer


def test_the_answer_says_how_many_equations_were_left_out(client):
    document = word_document(["Before ", INLINE, " after."], ["Shown on its own:"], [DISPLAY],
                             ["Two at once: ", INLINE, " and ", INLINE, "."])
    res = client.post("/api/word-to-pdf", files={"file": ("maths.docx", document, DOCX)})
    assert res.status_code == 200, res.text
    assert res.headers["X-Equations-Left-Out"] == "4"
    assert res.content.startswith(b"%PDF-")


def test_a_document_without_equations_says_none_were_left_out(client):
    res = client.post("/api/word-to-pdf", files={"file": ("plain.docx", word_document(["Plain text."]), DOCX)})
    assert res.status_code == 200, res.text
    assert res.headers["X-Equations-Left-Out"] == "0"
