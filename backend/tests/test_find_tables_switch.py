"""Table detection leaves PyMuPDF's process-wide glyph-height switch off.

PyMuPDF 1.28's Page.find_tables turns TOOLS.set_small_glyph_heights on, then
reads the page's rotation, and only after that enters the try block whose
finally turns the switch back. On a page whose rotation it cannot read, as in a
damaged PDF, the switch stayed on for every later text extraction in the
process: word boxes came out one font size tall, and on text turned 180
degrees, beside the text, which is what Redact covers. CI saw it as two failures
of test_page_contract after test_damaged_pdfs_everywhere had sent cut-short
PDFs to Extract Tables and PDF to Excel (on x86_64; the dev VM's ARM build read
those pages without failing).

The tests make the rotation step fail the way a damaged page does, in
PyMuPDF's own find_tables.
"""

from __future__ import annotations

import fitz  # PyMuPDF
import pymupdf.table
import pytest

from backend.app.services import pdf_to_excel_service, table_extractor_service


@pytest.fixture
def turned_pdf(tmp_path):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "A table that is not one", fontsize=12)
    page.set_rotation(180)
    path = tmp_path / "turned.pdf"
    doc.save(path)
    doc.close()
    return str(path)


@pytest.fixture
def rotation_fails(monkeypatch):
    """find_tables meets a page whose rotation cannot be read, after it has
    turned the switch on and before its try block."""
    def fails(page):
        raise RuntimeError("code=7: Invalid number of pages")

    monkeypatch.setattr(pymupdf.table, "page_rotation_set0", fails)
    fitz.TOOLS.set_small_glyph_heights(False)
    yield
    fitz.TOOLS.set_small_glyph_heights(False)


def test_the_failure_is_one_pymupdf_leaves_the_switch_on_after(turned_pdf, rotation_fails):
    with fitz.open(turned_pdf) as doc:
        with pytest.raises(RuntimeError):
            doc[0].find_tables()
    assert fitz.TOOLS.set_small_glyph_heights(), "PyMuPDF no longer leaks it: the wrapper may go"


def test_extract_tables_leaves_the_switch_off(turned_pdf, rotation_fails):
    with pytest.raises(Exception):
        table_extractor_service.extract_tables(turned_pdf)
    assert not fitz.TOOLS.set_small_glyph_heights()


def test_pdf_to_excel_leaves_the_switch_off(turned_pdf, rotation_fails):
    # PDF to Excel falls back to the page's text when table detection fails.
    try:
        pdf_to_excel_service._build_workbook(turned_pdf)
    except Exception:  # noqa: BLE001 - only the switch is asked about here
        pass
    assert not fitz.TOOLS.set_small_glyph_heights()


def test_a_table_is_still_found(tmp_path):
    doc = fitz.open()
    page = doc.new_page()
    for row in range(4):
        for col in range(3):
            page.insert_text((80 + 120 * col, 118 + 30 * row), f"r{row}c{col}", fontsize=11)
    for y in range(100, 221, 30):
        page.draw_line((70, y), (430, y))
    for x in (70, 190, 310, 430):
        page.draw_line((x, 100), (x, 220))
    path = tmp_path / "table.pdf"
    doc.save(path)
    doc.close()
    out = table_extractor_service.extract_tables(str(path))
    with open(out, encoding="utf-8") as fh:
        assert "r3c2" in fh.read()
    assert not fitz.TOOLS.set_small_glyph_heights()
