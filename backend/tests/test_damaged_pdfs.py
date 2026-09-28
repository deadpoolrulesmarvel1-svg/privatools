"""A PDF cut short is processed the way it can still be read.

A download that stops early leaves a PDF whose last objects are missing.
MuPDF repairs it well enough to draw its pages, but keeps references to the
lost objects, and PyMuPDF's insert_pdf refuses to copy a page from it
("source object number out of range"). Split in Half, Deskew, and PDF to
Image and Invert Colors on their multi-page paths copy pages that way, so
they answered such a file with a 500 ("Processing failed. Please try
again."), while Auto Crop, N-Up and PDF to EPUB, which only read it, worked.
Now, when copying fails that way, qpdf rebuilds the file, which drops those
references, and the tool runs once more on the rebuilt copy; a file qpdf
cannot rebuild either is refused with a 400 that says it is damaged. qpdf
leaves out the pages whose page object was lost. A page whose object
survived but whose content was cut short is kept with what could be read,
which can be nothing: a blank page.

Nothing is checked before the tool runs. A first version scanned every
object for references to lost objects: its pattern went quadratic on a long
run of digits (a 40 KB upload held a worker for 23 s), and its loop took time
in proportion to the highest object number, which a 346-byte file can set to
8 million (71 s). The timing tests below hold both files to a few seconds.
"""

from __future__ import annotations

import io
import re
import time
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


def _copies_pages(tool: str, pages: int) -> bool:
    """Whether the tool copies pages for a file this long (the untilted
    fixtures included: Deskew copies a page it leaves straight)."""
    return {"split-in-half": True, "deskew-pdf": True, "invert-colors": pages > 2, "pdf-to-png": pages > 3}[tool]


@pytest.mark.parametrize("damaged", sorted(DAMAGED))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_cut_short_is_processed(client, tool, damaged):
    data = DAMAGED[damaged]()
    shown = len(fitz.open(stream=data, filetype="pdf"))  # MuPDF's repair
    kept = _surviving_pages(data)  # qpdf's rebuild
    assert 0 < kept < shown  # some pages were lost
    # A tool that copies pages fails on MuPDF's repair and runs on qpdf's
    # rebuild; one that only draws them works on MuPDF's repair, as before.
    pages = kept if _copies_pages(tool, shown) else shown
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


def test_process_pdf_rebuilds_only_when_copying_fails():
    from backend.app.utils.cleanup import process_pdf

    def copy_all(doc):
        seen.append((doc.is_repaired, len(doc)))
        fitz.open().insert_pdf(doc)
        return "copied"

    seen: list = []
    assert process_pdf(_whole(2), copy_all) == "copied"
    assert seen == [(False, 2)]  # an intact file: one run, nothing rebuilt

    seen.clear()
    damaged = _cut(_whole(3), 0.5)
    assert process_pdf(damaged, copy_all) == "copied"
    # MuPDF's repair shows 3 pages and cannot be copied; qpdf's rebuild keeps
    # the 2 whose page object survived, and copies.
    assert [pages for _, pages in seen] == [3, _surviving_pages(damaged)] == [3, 2]

    seen.clear()

    def other_failure(doc):
        seen.append(doc.is_repaired)
        raise RuntimeError("something else")

    with pytest.raises(RuntimeError, match="something else"):
        process_pdf(damaged, other_failure)
    assert seen == [True]  # not retried: only a lost object is


def test_a_file_qpdf_cannot_rebuild_is_refused_as_damaged(monkeypatch):
    from backend.app.utils import cleanup
    from backend.app.utils.exceptions import PdfCorruptError

    monkeypatch.setattr(cleanup, "_rebuilt_by_qpdf", lambda source: None)
    with pytest.raises(PdfCorruptError, match="damaged"):
        cleanup.process_pdf(_cut(_whole(3), 0.5), lambda doc: fitz.open().insert_pdf(doc))


# ── crafted files: no work beyond what opening them takes ─────────────────

_HEAD = (
    b"%PDF-1.7\n"
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
    b"4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello) Tj ET\nendstream\nendobj\n"
)
_TAIL = b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"

CRAFTED = {
    # No xref table, so MuPDF repairs it; one object is 100,000 digits. The
    # scan's pattern took 8 s on 20,000 digits and four times as long for
    # twice as many (about 200 s for these).
    "digit-run": lambda: _HEAD + b"5 0 obj\n(" + b"1234567890" * 10_000 + b")\nendobj\n" + _TAIL,
    # One object numbered 2,000,000, so MuPDF's table has 2,000,001 entries:
    # the scan visited each (about 18 s); 8 million took 71 s.
    "high-object-number": lambda: _HEAD + b"2000000 0 obj\nnull\nendobj\n" + _TAIL,
}


@pytest.mark.parametrize("crafted", sorted(CRAFTED))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_crafted_files_cost_no_more_than_opening_them(client, tool, crafted):
    data = CRAFTED[crafted]()
    assert fitz.open(stream=data, filetype="pdf").is_repaired
    route, form = ROUTES[tool]
    started = time.perf_counter()
    resp = client.post(route, files={"file": ("crafted.pdf", data, "application/pdf")}, data=form)
    took = time.perf_counter() - started
    assert resp.status_code == 200, (tool, crafted, resp.status_code, resp.text[:200])
    # Generous for a loaded CI runner: each takes well under a second here.
    assert took < 10, (tool, crafted, took)
