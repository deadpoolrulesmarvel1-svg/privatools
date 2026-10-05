"""A PDF cut short is processed the way it can still be read.

A download that stops early leaves a PDF whose last objects are missing.
MuPDF repairs it well enough to draw its pages, but keeps references to the
lost objects, and PyMuPDF's insert_pdf refuses to copy a page from it
("source object number out of range"). Split in Half, Deskew, and PDF to
Image and Invert Colors on their multi-page paths copy pages that way, so
they answered such a file with a 500 ("Processing failed. Please try
again."), while Auto Crop, N-Up and PDF to EPUB, which only read it, worked.
Now, when a tool fails on MuPDF's repair of such a file, qpdf rebuilds the
file, which drops those references, and the tool runs once more on the
rebuilt copy; a file qpdf cannot rebuild either is refused with a 400 that
says it is damaged. A page whose object survived but whose content was cut
short is kept with what could be read, which can be nothing: a blank page.

qpdf leaves out the pages whose page object was lost, and the tools then
answered with fewer pages than they were sent, and said nothing. A file that
lost pages is refused before the tool runs, with how many of its pages could
be read (utils.cleanup.refuse_if_misread; every route, test_pages_lost.py),
so the rebuild runs only for a file whose pages all survived.

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

from backend.app.utils.cleanup import pages_lost_message
from backend.app.utils.declared_pages import readable_page_count


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
# Cut in the last page's content: every page object survived, so no page
# was lost, but some of what the pages draw was.
CONTENT_LOST = {
    "text-3p-cut-at-80pc": lambda: _cut(_whole(3), 0.8),
}


def _surviving_pages(data: bytes) -> int:
    """The pages of qpdf's rebuild, which a tool runs on when it fails on
    MuPDF's repair."""
    from backend.app.utils.cleanup import _rebuilt_by_qpdf

    with pikepdf.open(io.BytesIO(_rebuilt_by_qpdf(data))) as pdf:
        return len(pdf.pages)


def _ink(page) -> float:
    """How dark the page is drawn, on average (0 for a blank page)."""
    pix = page.get_pixmap(dpi=24, colorspace=fitz.csGRAY)
    return 255 - sum(pix.samples) / len(pix.samples)


ROUTES = {
    "split-in-half": ("/api/split-in-half", {"direction": "vertical"}),
    "pdf-to-png": ("/api/pdf-to-image", {"format": "png", "dpi": "36"}),
    "invert-colors": ("/api/invert-colors", {"dpi": "72"}),
    "deskew-pdf": ("/api/deskew", {}),
}


def test_the_fixtures_are_what_breaks_copying():
    """MuPDF opens each one (repairing it) but cannot copy its pages."""
    for name, make in {**DAMAGED, **CONTENT_LOST}.items():
        doc = fitz.open(stream=make(), filetype="pdf")
        assert doc.is_repaired and len(doc) > 0, name
        with pytest.raises(RuntimeError, match="object number out of range"):
            fitz.open().insert_pdf(doc)
    for name, make in DAMAGED.items():  # some page objects were lost
        doc = fitz.open(stream=make(), filetype="pdf")
        assert 0 < readable_page_count(doc) < len(doc), name
    for name, make in CONTENT_LOST.items():  # none were
        doc = fitz.open(stream=make(), filetype="pdf")
        assert readable_page_count(doc) == len(doc) == _surviving_pages(make()), name


@pytest.mark.parametrize("damaged", sorted(DAMAGED))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_cut_short_that_lost_pages_is_refused_with_its_counts(client, tool, damaged):
    # These answered 200 with the pages that survived: qpdf's rebuild for the
    # tools that copy pages, MuPDF's blank stand-ins for the others.
    data = DAMAGED[damaged]()
    whole = int(re.search(r"(\d+)p", damaged).group(1))
    read = readable_page_count(fitz.open(stream=data, filetype="pdf"))
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 400, (tool, damaged, resp.status_code, resp.text[:200])
    assert resp.json()["detail"] == pages_lost_message(read, whole)


@pytest.mark.parametrize("damaged", sorted(CONTENT_LOST))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_cut_short_that_kept_its_pages_is_processed(client, tool, damaged):
    # A tool that copies pages fails on MuPDF's repair and runs on qpdf's
    # rebuild, which keeps every page; one that only draws them works on
    # MuPDF's repair, as before.
    data = CONTENT_LOST[damaged]()
    pages = len(fitz.open(stream=data, filetype="pdf"))
    assert pages == _surviving_pages(data) == 3
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 200, (tool, damaged, resp.status_code, resp.text[:200])
    if resp.content[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            assert len(zf.namelist()) == pages
    else:
        expected = 2 * pages if tool == "split-in-half" else pages
        assert len(fitz.open(stream=resp.content, filetype="pdf")) == expected


@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_too_damaged_to_rebuild_is_refused_as_damaged(client, tool):
    # The header, the start of one object, and a reference to one that is gone.
    data = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n3 0 obj\n<< /Length 99 >>\nstream\nq"
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 400, (tool, resp.status_code, resp.text[:200])
    assert "damaged" in resp.json()["detail"] or "corrupt" in resp.json()["detail"]


def test_process_pdf_rebuilds_a_repaired_file_only_after_a_library_failure():
    from backend.app.utils.cleanup import process_pdf
    from backend.app.utils.exceptions import PdfCorruptError, ValidationError

    def copy_all(doc):
        seen.append((doc.is_repaired, len(doc)))
        fitz.open().insert_pdf(doc)
        return "copied"

    seen: list = []
    assert process_pdf(_whole(2), copy_all) == "copied"
    assert seen == [(False, 2)]  # an intact file: one run, nothing rebuilt

    seen.clear()
    damaged = CONTENT_LOST["text-3p-cut-at-80pc"]()
    assert process_pdf(damaged, copy_all) == "copied"
    # MuPDF's repair shows 3 pages and cannot be copied; qpdf's rebuild keeps
    # all 3, every page object having survived, and copies.
    assert [pages for _, pages in seen] == [3, _surviving_pages(damaged)] == [3, 3]

    seen.clear()
    lost = _cut(_whole(3), 0.5)
    with pytest.raises(PdfCorruptError, match=re.escape(pages_lost_message(2, 3))):
        process_pdf(lost, copy_all)
    # A page object lost: refused before the work, which would have run on
    # the 2 pages qpdf keeps.
    assert seen == []

    def library_failure(doc):
        seen.append(len(doc))
        doc.xref_object(10**7)  # PyMuPDF's own RuntimeError, "bad xref"

    with pytest.raises(PdfCorruptError, match="damaged"):
        process_pdf(damaged, library_failure)
    assert seen == [3, 3]  # once more on qpdf's rebuild, then refused as damaged

    seen.clear()
    with pytest.raises(RuntimeError, match="bad xref"):
        process_pdf(_whole(2), library_failure)
    assert seen == [2]  # an intact file is never retried

    seen.clear()

    def own_failure(doc):
        seen.append(len(doc))
        raise RuntimeError("the tool's own fault")

    with pytest.raises(RuntimeError, match="the tool's own fault"):
        process_pdf(damaged, own_failure)
    assert seen == [3]  # not PyMuPDF's: never retried nor called damage

    seen.clear()

    def refusal(doc):
        seen.append(len(doc))
        raise ValidationError("an answer, not damage")

    with pytest.raises(ValidationError):
        process_pdf(damaged, refusal)
    assert seen == [3]  # a ToolError is never retried


def _first_page_object_unreadable(data: bytes) -> bytes:
    """One byte of the first page object overwritten, so that it no longer
    parses: MuPDF opens the file without repairing it and shows the page
    blank."""
    doc = fitz.open(stream=data, filetype="pdf")
    xref = doc[0].xref
    doc.close()
    start = data.index(b"\n%d 0 obj" % xref)
    end = data.index(b">>\nendobj", start)
    return data[:end + 1] + b"y" + data[end + 2:]


def test_process_pdf_counts_a_page_object_mupdf_cannot_read_as_damage():
    from backend.app.utils.cleanup import process_pdf
    from backend.app.utils.exceptions import PdfCorruptError

    whole = _whole(2)
    broken = _first_page_object_unreadable(whole)
    doc = fitz.open(stream=broken, filetype="pdf")
    assert not doc.is_repaired and len(doc) == 2
    doc.close()

    def write(doc):
        doc[0].insert_text((72, 72), "x")  # "not a dict (null)" on the unreadable page
        return "written"

    assert process_pdf(whole, write, rebuild=False) == "written"
    with pytest.raises(PdfCorruptError, match="damaged"):
        process_pdf(broken, write, rebuild=False)

    def own_bad_argument(doc):
        doc.xref_set_key(doc[0].xref, "Resources/Font", "5")  # the tool's own mistake
        doc[0].insert_text((72, 72), "x")  # "not a dict (string)", from MuPDF

    # Every page object of an intact file reads, so the same MuPDF error from
    # the tool's own mistake stays its own: a logged 500, not "damaged".
    with pytest.raises(fitz.mupdf.FzErrorArgument):
        process_pdf(whole, own_bad_argument, rebuild=False)


def test_a_file_qpdf_cannot_rebuild_is_refused_as_damaged(monkeypatch):
    from backend.app.utils import cleanup
    from backend.app.utils.exceptions import PdfCorruptError

    monkeypatch.setattr(cleanup, "_rebuilt_by_qpdf", lambda source: None)
    with pytest.raises(PdfCorruptError, match="damaged"):
        cleanup.process_pdf(CONTENT_LOST["text-3p-cut-at-80pc"](), lambda doc: fitz.open().insert_pdf(doc))


def test_a_rebuild_that_left_out_a_page_mupdf_listed_is_refused_with_the_counts(monkeypatch):
    # MuPDF read every page; if qpdf's rebuild then kept fewer, the work would
    # run on fewer pages than the visitor sent.
    from backend.app.utils import cleanup
    from backend.app.utils.exceptions import PdfCorruptError

    monkeypatch.setattr(cleanup, "_rebuilt_by_qpdf", lambda source: _whole(2))
    ran: list = []

    def copy_all(doc):
        ran.append(len(doc))
        fitz.open().insert_pdf(doc)

    with pytest.raises(PdfCorruptError, match=re.escape(pages_lost_message(2, 3))):
        cleanup.process_pdf(CONTENT_LOST["text-3p-cut-at-80pc"](), copy_all)
    assert ran == [3]  # MuPDF's repair only; never the short rebuild


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


# ── the last page's object lost, the pages before it whole ────────────────
# Cut right after the objects of page 2, so page 3's object is gone while the
# page tree still lists it. MuPDF's repair shows it as a blank Letter page,
# and copies it, but reading anything of it fails with "bad xref". Split in
# Half reads each page's /Rotate, and answered 400 "bad xref" where main
# answered 200; any library failure on a repaired file now gets one more run
# on qpdf's rebuild, not only a failed copy. The rebuild leaves page 3 out.
LOST_PAGE = {"scan-3p-cut-at-70pc": lambda: _cut(_whole(3, scanned=True), 0.7)}


def test_the_lost_page_fixture_copies_but_its_last_page_cannot_be_read():
    from backend.app.utils.page_space import settle_rotation

    for name, make in LOST_PAGE.items():
        doc = fitz.open(stream=make(), filetype="pdf")
        assert doc.is_repaired and len(doc) == 3, name
        fitz.open().insert_pdf(doc)  # the copy is fine
        settle_rotation(doc[0], {})
        settle_rotation(doc[1], {})
        with pytest.raises(ValueError, match="bad xref"):
            settle_rotation(doc[2], {})


def test_the_rebuild_keeps_the_object_the_file_ends_with():
    """qpdf's reconstruction dropped the last object of a file that ends right
    after it, here page 2's content: page 2 came out blank. Given the file
    with an end-of-file line after it, qpdf keeps it."""
    from backend.app.utils.cleanup import _rebuilt_by_qpdf

    data = LOST_PAGE["scan-3p-cut-at-70pc"]()
    assert data.endswith(b"endobj\n")
    repaired = fitz.open(stream=data, filetype="pdf")
    rebuilt = fitz.open(stream=_rebuilt_by_qpdf(data), filetype="pdf")
    assert len(rebuilt) == 2
    for n in range(2):
        assert _ink(rebuilt[n]) > 1, n
        assert abs(_ink(rebuilt[n]) - _ink(repaired[n])) < 0.5, n


def test_the_rebuild_reads_a_copy_on_disk_and_removes_it(monkeypatch, tmp_path):
    """The copy that carries the end-of-file line is a temporary file, so an
    upload is not held in memory; it is removed whether qpdf can rebuild the
    file or not."""
    from backend.app.utils import cleanup

    monkeypatch.setattr(cleanup, "TEMP_DIR", tmp_path)
    upload = tmp_path / "upload.pdf"
    upload.write_bytes(LOST_PAGE["scan-3p-cut-at-70pc"]())
    rebuilt = cleanup._rebuilt_by_qpdf(str(upload))
    assert rebuilt is not None and len(fitz.open(stream=rebuilt, filetype="pdf")) == 2
    assert cleanup._rebuilt_by_qpdf(b"%PDF-1.7\nnothing a PDF needs\n") is None
    assert [p.name for p in tmp_path.iterdir()] == ["upload.pdf"]


@pytest.mark.parametrize("damaged", sorted(LOST_PAGE))
@pytest.mark.parametrize("tool", sorted(ROUTES))
def test_a_pdf_whose_last_page_object_was_lost_is_refused_with_its_counts(client, tool, damaged):
    # Split in Half answered with the 2 whole pages of qpdf's rebuild, the
    # others with MuPDF's blank page 3: neither said page 3 was gone.
    data = LOST_PAGE[damaged]()
    assert _surviving_pages(data) == 2
    route, form = ROUTES[tool]
    resp = client.post(route, files={"file": ("download.pdf", data, "application/pdf")}, data=form)
    assert resp.status_code == 400, (tool, damaged, resp.status_code, resp.text[:200])
    assert resp.json()["detail"] == pages_lost_message(2, 3)
