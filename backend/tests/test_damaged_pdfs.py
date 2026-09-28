"""A PDF cut short is processed the way it can still be read.

A download that stops early leaves a PDF whose last objects are missing.
MuPDF repairs it well enough to draw its pages, but keeps references to the
lost objects, and PyMuPDF's insert_pdf refuses to copy a page from it
("source object number out of range"). Split in Half, Deskew, and PDF to
Image and Invert Colors on their multi-page paths copy pages that way, so
they answered such a file with a 500 ("Processing failed. Please try
again."), while Auto Crop, N-Up and PDF to EPUB, which only read it, worked.
Now a file with such references is rebuilt with qpdf first, which drops
them, and one qpdf cannot rebuild either is refused with a 400 that says it
is damaged. The rebuilt file keeps the pages that still exist, so a tool
works on those rather than on blank stand-ins for the pages that were lost.
"""

from __future__ import annotations

import io
import re
import zipfile

import fitz  # PyMuPDF
import pikepdf
import pytest
from PIL import Image


def _whole(pages: int, *, scanned: bool = False) -> bytes:
    doc = fitz.open()
    for n in range(pages):
        page = doc.new_page(width=612, height=792)
        if scanned:
            img = Image.new("L", (400, 520), 255)
            for x in range(40, 360, 8):
                for y in range(40 + n * 3, 480, 16):
                    img.putpixel((x, y), 0)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=70)
            page.insert_image(page.rect, stream=buf.getvalue())
        else:
            for i in range(30):
                page.insert_text((72, 72 + 20 * i), f"Page {n + 1}, line {i + 1}: synthetic text.", fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def _cut(data: bytes, fraction: float) -> bytes:
    """The file as a download that stopped after that share of its objects
    would leave it: complete objects, then nothing."""
    ends = [m.end() for m in re.finditer(rb"endobj\s", data)]
    return data[: ends[int(len(ends) * fraction)]]


DAMAGED = {
    "text-3p-cut-at-half": lambda: _cut(_whole(3), 0.5),
    "text-10p-cut-at-60pc": lambda: _cut(_whole(10), 0.6),
    "scan-5p-cut-at-60pc": lambda: _cut(_whole(5, scanned=True), 0.6),
}


def _surviving_pages(data: bytes) -> int:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        return len(pdf.pages)

ROUTES = {
    "split-in-half": ("/api/split-in-half", {"direction": "vertical"}),
    "pdf-to-png": ("/api/pdf-to-image", {"format": "png", "dpi": "36"}),
    "invert-colors": ("/api/invert-colors", {"dpi": "72"}),
    "deskew-pdf": ("/api/deskew", {}),
}


def test_the_fixtures_are_what_breaks_copying():
    """MuPDF opens each one (repairing it) but cannot copy its pages."""
    for name, make in DAMAGED.items():
        doc = fitz.open(stream=make(), filetype="pdf")
        assert doc.is_repaired and len(doc) > 0, name
        with pytest.raises(RuntimeError, match="object number out of range"):
            fitz.open().insert_pdf(doc)


@pytest.mark.parametrize("damaged", sorted(DAMAGED))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_cut_short_is_processed(client, tool, damaged):
    data = DAMAGED[damaged]()
    pages = _surviving_pages(data)
    assert 0 < pages < len(fitz.open(stream=data, filetype="pdf"))  # some were lost
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 200, (tool, damaged, resp.status_code, resp.text[:200])
    if resp.content[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            assert len(zf.namelist()) == pages
    elif resp.content[:4] == b"%PDF":
        expected = 2 * pages if tool == "split-in-half" else pages
        assert len(fitz.open(stream=resp.content, filetype="pdf")) == expected
    else:  # a single image
        assert pages == 1


@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_too_damaged_to_rebuild_is_refused_as_damaged(client, tool):
    # The header, the start of one object, and a reference to one that is gone.
    data = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n3 0 obj\n<< /Length 99 >>\nstream\nq"
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 400, (tool, resp.status_code, resp.text[:200])
    assert "damaged" in resp.json()["detail"] or "corrupt" in resp.json()["detail"]


def test_open_pdf_document_rebuilds_only_when_copying_would_fail():
    from backend.app.utils.cleanup import open_pdf_document

    damaged = _cut(_whole(3), 0.5)
    as_read = open_pdf_document(damaged)
    assert as_read.is_repaired  # left as MuPDF repaired it: fine for reading
    copyable = open_pdf_document(damaged, copying=True)
    fitz.open().insert_pdf(copyable)  # no longer raises
    intact = _whole(2)
    doc = open_pdf_document(intact, copying=True)
    assert len(doc) == 2 and not doc.is_repaired
