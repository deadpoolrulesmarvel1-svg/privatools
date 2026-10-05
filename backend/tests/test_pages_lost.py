"""A PDF that lost pages to damage is refused with its counts, never answered
with the pages that survived.

A PDF cut short opens repaired: qpdf leaves out each page whose object was
lost, and MuPDF lists it but shows it blank. On v2.7.27 a three-page PDF cut
to 60 % of its bytes came back from Grayscale with two pages, and Split PDF,
Alternate & Mix and Overlay returned 4 of a file's 6 pages, each as a
success. A sweep of the 84 PDF routes over PDFs in seven layouts, cut at
every 1 % or 2 % from 5 % to 99 %, found 2,497 such answers in 38 routes.
The file's own page count is now read from its bytes (utils.declared_pages),
and a repaired file that kept fewer pages than it declares is refused: "This
PDF is damaged: only N of its M pages could be read. Download it again, or
use Repair PDF to save the pages that survive." Repair PDF saves those pages
and says how many of how many. A repaired file that kept every page, as
valid files with a damaged cross-reference table do, goes on as before.
"""

from __future__ import annotations

import base64
import io
import json
import re
import zlib
from pathlib import Path

import fitz  # PyMuPDF
import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main
from backend.app.routes.remove_blank_pages import CUT_SHORT_MESSAGE
from backend.app.services.repair_service import CANNOT_TELL_MESSAGE
from backend.app.utils import declared_pages
from backend.app.utils.cleanup import MIXED_UP_MESSAGE, pages_lost_message
from backend.app.utils.declared_pages import readable_page_count


def _six() -> bytes:
    doc = fitz.open()
    for i in range(6):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"Page {i + 1}. A secret contract.", fontsize=12)
        page.draw_rect(fitz.Rect(72, 200, 300, 260), color=(0, 0, 1))
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


WHOLE = _six()


def _mupdf_reads(data: bytes) -> int | None:
    """The pages MuPDF can read of a file it repaired, or None when it does
    not open it repaired."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except fitz.FileDataError:
        return None
    return readable_page_count(doc) if doc.is_repaired else None


def _qpdf_reads(data: bytes, password: str = "") -> int | None:
    try:
        with pikepdf.open(io.BytesIO(data), password=password) as pdf:
            return len(pdf.pages)
    except pikepdf.PdfError:
        return None


def _cut_losing_pages(whole: bytes) -> bytes:
    """The first cut from 40 % on that both libraries open with some, not
    all, of the six pages."""
    for percent in range(40, 95):
        data = whole[: len(whole) * percent // 100]
        mupdf, qpdf = _mupdf_reads(data), _qpdf_reads(data)
        if mupdf and qpdf and mupdf < 6 and qpdf < 6:
            return data
    raise AssertionError("no cut loses pages for both libraries")


CUT = _cut_losing_pages(WHOLE)
MUPDF_READ, QPDF_READ = _mupdf_reads(CUT), _qpdf_reads(CUT)


def _signature() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (60, 20), (20, 40, 160)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _second() -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "The other PDF.", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


SECOND = ("b.pdf", _second(), "application/pdf")

# A sample of the routes by the library that reads the upload, and the shared
# helper it goes through. route -> (library, the file's field, other files, form)
ROUTES: dict[str, tuple[str, str, list, dict]] = {
    # qpdf: safe_open_pdf
    "/api/split": ("qpdf", "file", [], {"mode": "individual"}),
    "/api/merge": ("qpdf", "files", [("files", SECOND)], {}),
    "/api/rotate": ("qpdf", "file", [], {"angle": "90"}),
    "/api/compress": ("qpdf", "files", [], {}),
    "/api/alternate-mix": ("qpdf", "file1", [("file2", SECOND)], {}),
    "/api/overlay": ("qpdf", "base_file", [("overlay_file", SECOND)], {}),
    "/api/sign-pdf": ("qpdf", "file", [], {"signature_data": _signature()}),
    # qpdf: open_pikepdf
    "/api/grayscale": ("qpdf", "file", [], {}),
    "/api/metadata/update": ("qpdf", "file", [], {"title": "T"}),
    "/api/delete-annotations": ("qpdf", "file", [], {}),
    "/api/web-optimize": ("qpdf", "file", [], {}),
    "/api/accessibility-check": ("qpdf", "file", [], {}),
    # qpdf, in the Sanitize worker's process
    "/api/sanitize": ("qpdf", "file", [], {}),
    # MuPDF: open_pdf_document and process_pdf
    "/api/pdf-to-image": ("mupdf", "file", [], {"dpi": "36"}),
    "/api/page-numbers": ("mupdf", "file", [], {}),
    "/api/flatten": ("mupdf", "file", [], {}),
    "/api/split-in-half": ("mupdf", "file", [], {}),
    "/api/pdf-to-word": ("mupdf", "file", [], {}),
    "/api/extract-images": ("mupdf", "file", [], {}),
    "/api/esign-pdf": ("mupdf", "file", [], {"signature": _signature()}),
    # MuPDF, in the workers' processes
    "/api/hidden-text-checker": ("mupdf", "file", [], {}),
    "/api/pdf-to-markdown": ("mupdf", "file", [], {}),
}


@pytest.fixture(scope="module")
def quiet_client():
    return TestClient(main.app, raise_server_exceptions=False)


def _post(client, route: str, data: bytes):
    _, field, extra, form = ROUTES[route]
    return client.post(route, files=[(field, ("doc.pdf", data, "application/pdf")), *extra], data=form)


def test_the_cut_loses_pages_for_both_libraries():
    assert 0 < MUPDF_READ < 6 and 0 < QPDF_READ < 6
    with fitz.open(stream=CUT, filetype="pdf") as doc:
        assert len(doc) == 6  # MuPDF lists every page; it cannot read them all


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_pdf_that_lost_pages_is_refused_with_its_counts(quiet_client, route):
    response = _post(quiet_client, route, CUT)
    assert response.status_code == 400, response.text[:300]
    read = QPDF_READ if ROUTES[route][0] == "qpdf" else MUPDF_READ
    assert response.json()["detail"] == pages_lost_message(read, 6)


@pytest.mark.parametrize("route", ["/api/rotate", "/api/grayscale", "/api/extract-images"])
def test_a_count_out_of_time_refuses_nothing(quiet_client, monkeypatch, route):
    # The count of declared or readable pages gives up after its time
    # (utils.declared_pages._MAX_SECONDS) and is then unknown: the tool goes
    # on as it did before the count was read, never refusing on a guess.
    # Here, in qpdf's helpers and MuPDF's open_pdf_document; the workers run
    # in processes of their own, and process_pdf's rebuild compares what
    # qpdf kept with what MuPDF listed, which needs no count.
    monkeypatch.setattr(declared_pages, "_MAX_SECONDS", -1.0)
    response = _post(quiet_client, route, CUT)
    assert response.status_code == 200, response.text[:300]


def test_a_readable_count_out_of_time_refuses_nothing(quiet_client, monkeypatch):
    # The declared count is read, but MuPDF's pages cannot be looked up in
    # time (its reading, and readable_page_count, answer None): the tool goes
    # on, and Repair says nothing of pages, rather than count them as none.
    from backend.app.services import repair_service

    def out_of_time(doc, enough=None):
        return None

    monkeypatch.setattr(declared_pages, "mupdf_reading", out_of_time)
    monkeypatch.setattr(repair_service, "readable_page_count", out_of_time)
    response = _post(quiet_client, "/api/extract-images", CUT)
    assert response.status_code == 200, response.text[:300]
    repaired = quiet_client.post("/api/repair", files=[("file", ("doc.pdf", CUT, "application/pdf"))])
    assert repaired.status_code == 200, repaired.text[:300]
    assert "X-Repair-Pages" not in repaired.headers


def _junk_after_the_end(data: bytes) -> bytes:
    return data + b"\n" + bytes(range(256)) * 16


def _no_startxref(data: bytes) -> bytes:
    return re.sub(rb"startxref\s+\d+\s+%%EOF\s*$", b"%%EOF\n", data)


def _offsets_shifted(data: bytes) -> bytes:
    """Seven bytes after the header: every offset in the xref is off by 7."""
    first_line = data.index(b"\n") + 1
    return data[:first_line] + b"%junk!\n" + data[first_line:]


VALID_BUT_REPAIRED = {
    "junk-after-the-end": _junk_after_the_end,
    "no-startxref": _no_startxref,
    "xref-offsets-shifted": _offsets_shifted,
}


def _pages_out(response) -> int | None:
    body = response.content
    if body[:5] == b"%PDF-":
        with fitz.open(stream=body, filetype="pdf") as doc:
            return len(doc)
    return None


@pytest.mark.parametrize("defect", sorted(VALID_BUT_REPAIRED))
@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_valid_pdf_that_needed_repair_goes_on_as_before(quiet_client, route, defect):
    data = VALID_BUT_REPAIRED[defect](WHOLE)
    assert fitz.open(stream=data, filetype="pdf").is_repaired or _qpdf_warns(data)
    intact = _post(quiet_client, route, WHOLE)
    response = _post(quiet_client, route, data)
    assert response.status_code == intact.status_code == 200, response.text[:300]
    assert _pages_out(response) == _pages_out(intact)


def _qpdf_warns(data: bytes) -> bool:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        return bool(pdf.get_warnings())


def _carrying(inner: bytes) -> bytes:
    """One page, carrying `inner`, a whole PDF, as an attachment written
    without compression; its objects reuse the outer file's numbers."""
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), "The covering page.", fontsize=12)
    outer = doc.tobytes(garbage=0)
    doc.close()
    with pikepdf.open(io.BytesIO(outer)) as pdf:
        spec = pikepdf.AttachedFileSpec(pdf, inner, filename="inner.pdf")
        pdf.attachments["inner.pdf"] = spec
        out = io.BytesIO()
        pdf.save(out, compress_streams=False, stream_decode_level=pikepdf.StreamDecodeLevel.none,
                 object_stream_mode=pikepdf.ObjectStreamMode.disable)
    data = out.getvalue()
    assert inner in data  # stored as it is
    return data


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_valid_pdf_carrying_a_pdf_goes_on_as_before(quiet_client, route):
    whole = _carrying(WHOLE)
    data = _junk_after_the_end(whole)
    assert fitz.open(stream=data, filetype="pdf").is_repaired
    intact = _post(quiet_client, route, whole)
    response = _post(quiet_client, route, data)
    assert intact.status_code == 200, intact.text[:300]
    if route == "/api/web-optimize" and response.status_code == 400:
        # The output is the qpdf command's, which rebuilds the file again on
        # its own: qpdf 11.9 (in CI) read the stored PDF's objects as this
        # file's and wrote its six pages, a success until v2.7.32. That output
        # is refused now (web_optimize_service._check_output). qpdf 12's
        # library, which reads the upload, keeps the file's one page.
        assert response.json()["detail"] == MIXED_UP_MESSAGE
        return
    assert response.status_code == 200, response.text[:300]
    assert _pages_out(response) == _pages_out(intact)


def _catalog_last(pages: int = 6) -> bytes:
    """A PDF whose pages and content come first and whose page tree and
    catalog come last, as Chrome, LibreOffice and Ghostscript write them."""
    out, offsets = b"%PDF-1.7\n", {}

    def put(number: int, body: bytes) -> None:
        nonlocal out
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)

    for i in range(pages):
        text = b"BT /F1 24 Tf 72 700 Td (Stored page %d) Tj ET" % (i + 1)
        put(3 + 2 * i, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R >>" % (4 + 2 * i))
        put(4 + 2 * i, b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text))
    kids = b" ".join(b"%d 0 R" % (3 + 2 * i) for i in range(pages))
    put(2, b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, pages))
    put(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    size = 3 + 2 * pages
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    out += b"".join(b"%010d 00000 n \n" % offsets[n] for n in range(1, size))
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (size, xref)


def _carrying_with_a_wrong_length(inner: bytes) -> bytes:
    """_carrying(inner), its stream's /Length 10 bytes short: a defect valid
    files carry, which the readers recover from."""
    data = _carrying(inner)
    right, wrong = b"/Length %d" % len(inner), b"/Length %d" % (len(inner) - 10)
    assert data.count(right) == 1 and len(right) == len(wrong)
    return data.replace(right, wrong)


@pytest.mark.parametrize("route", ["/api/grayscale", "/api/rotate", "/api/sanitize"])
def test_a_valid_pdf_carrying_a_pdf_its_stream_does_not_end_at_goes_on_as_before(quiet_client, route):
    # The stored PDF writes its catalog last, and the stream's /Length is
    # off: its own first "endstream" is not the stream's end. Read as this
    # file's, its page tree made a one-page file declare 6, and qpdf's
    # routes refused it once it had bytes after its end.
    whole = _carrying_with_a_wrong_length(_catalog_last())
    data = _junk_after_the_end(whole)
    assert _qpdf_warns(data)
    intact = _post(quiet_client, route, whole)
    response = _post(quiet_client, route, data)
    assert response.status_code == intact.status_code == 200, response.text[:300]
    assert _pages_out(response) == _pages_out(intact)


def _root_rewritten_without_its_type(data: bytes, keep: int = 3) -> bytes:
    """`data` with an incremental update that rewrites its page tree's root
    with only its first `keep` pages, and without /Type /Pages: a required
    key both libraries do without."""
    with pikepdf.open(io.BytesIO(data)) as pdf:
        root = pdf.Root.Pages.objgen[0]
        kids = [kid.objgen[0] for kid in pdf.Root.Pages.Kids][:keep]
        size = int(pdf.trailer.Size)
    prev = int(data.rsplit(b"startxref", 1)[1].split()[0])
    at = len(data)
    body = b"<< /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % kid for kid in kids), keep)
    update = b"%d 0 obj\n%s\nendobj\n" % (root, body)
    xref = at + len(update)
    catalog = data.split(b"/Root", 1)[1].split()[0]
    return (data + update + b"xref\n%d 1\n%010d 00000 n \n" % (root, at)
            + b"trailer\n<< /Size %d /Root %s 0 R /Prev %d >>\nstartxref\n%d\n%%%%EOF\n" % (size, catalog, prev, xref))


@pytest.mark.parametrize("route", ["/api/grayscale", "/api/rotate", "/api/split-in-half"])
def test_an_update_that_rewrites_the_root_without_its_type_goes_on_as_before(quiet_client, route):
    # The update leaves three of the six pages; both libraries read it. The
    # count read the base's typed root, six pages, and qpdf's routes refused
    # even the intact file, "only 3 of its 6 pages" (the #349 re-review's
    # RS1); MuPDF's refused it once it had bytes after its end.
    whole = _root_rewritten_without_its_type(WHOLE)
    data = _junk_after_the_end(whole)
    assert _qpdf_reads(whole) == 3 and _qpdf_warns(whole)
    assert fitz.open(stream=data, filetype="pdf").is_repaired
    for upload in (whole, data):
        response = _post(quiet_client, route, upload)
        assert response.status_code == 200, response.text[:300]
        assert _pages_out(response) == (6 if route == "/api/split-in-half" else 3)


# ── A valid PDF carrying a PDF, read as that PDF ────────────────────────────
#
# A valid PDF that carries a PDF attached without compression, with a common
# cross-reference defect (offsets shifted, bytes after its end), opens
# repaired, and the libraries' repairs took the attachment's objects for the
# file's own: on v2.7.32 most tools answered with the attachment's pages, or
# a mix, as a success (qpdf's rebuild reads every "N G obj" in the bytes,
# stream data and all; MuPDF's ends a stream whose /Length it cannot use at
# the stored PDF's own first "endstream"). The library's reading is now
# compared with the page tree the file declares (declared_pages.misread),
# and refused when it is another document's, in the words of
# MIXED_UP_MESSAGE; a library that reads the file's own goes on.

def _stored_catalog_last(pages: int = 6) -> bytes:
    """A whole PDF whose pages say "Stored page <n>", its page tree and
    catalog written last, as Chrome, LibreOffice and Ghostscript write them."""
    out, offsets = b"%PDF-1.7\n", {}

    def put(number: int, body: bytes) -> None:
        nonlocal out
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)

    for i in range(pages):
        text = b"BT /F1 24 Tf 72 700 Td (Stored page %d) Tj ET" % (i + 1)
        put(4 + 2 * i, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> "
                       b"/Contents %d 0 R >>" % (5 + 2 * i))
        put(5 + 2 * i, b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text))
    put(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    put(2, b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % (4 + 2 * i) for i in range(pages)), pages))
    put(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    size = 4 + 2 * pages
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    out += b"".join(b"%010d 00000 n \n" % offsets[n] for n in range(1, size))
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (size, xref)


def _one_page(text: str) -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), text, fontsize=12)
    data = doc.tobytes(garbage=0)
    doc.close()
    return data


STORED_SIX = _stored_catalog_last()
# The intact files, and which library reads each, once damaged, as the PDF it
# carries.
INTACT = {
    "qpdf": _carrying(_one_page("The stored PDF's page.")),
    "mupdf": _carrying_with_a_wrong_length(STORED_SIX),
}
MISREAD_BY = {
    # One page carrying one page, its offsets shifted: qpdf's rebuild reads
    # the stored page as the file's (one page for one); MuPDF reads the file's.
    "qpdf": _offsets_shifted(INTACT["qpdf"]),
    # A stored PDF whose catalog comes last, its stream's /Length wrong, and
    # bytes after the file's end: MuPDF reads the stored page tree, six pages
    # for one; qpdf finds the file's table and reads its one page.
    "mupdf": _junk_after_the_end(INTACT["mupdf"]),
}
# Both libraries read it as the stored PDF.
READ_AS_ATTACHMENT_BY_BOTH = _offsets_shifted(_carrying_with_a_wrong_length(STORED_SIX))
# Routes that read the upload with both libraries: Accessibility checks the
# structure with qpdf and the pages' content with MuPDF, and a report on the
# stored PDF's pages is as wrong as their output.
READ_BY_BOTH = {"/api/accessibility-check"}


def _text_of(response) -> str:
    """What an answer shows: its PDF's pages' text, its archive's entries, or
    its own text."""
    body = response.content
    if body[:5] == b"%PDF-":
        with fitz.open(stream=body, filetype="pdf") as doc:
            return " ".join(page.get_text() for page in doc)
    if body[:2] == b"PK":
        import zipfile

        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            return " ".join(archive.read(name).decode("latin-1") for name in archive.namelist())
    return response.text


def test_the_files_are_read_as_the_pdf_they_carry():
    def mupdf_texts(data):
        with fitz.open(stream=data, filetype="pdf") as doc:
            return doc.is_repaired, [page.get_text().strip() for page in doc]

    def qpdf_texts(data):
        with pikepdf.open(io.BytesIO(data)) as pdf:
            out = io.BytesIO()
            pdf.save(out)
        return mupdf_texts(out.getvalue())[1]

    assert mupdf_texts(MISREAD_BY["qpdf"]) == (True, ["The covering page."])
    assert qpdf_texts(MISREAD_BY["qpdf"]) == ["The stored PDF's page."]
    repaired, texts = mupdf_texts(MISREAD_BY["mupdf"])
    assert repaired and len(texts) == 6 and "Stored page 6" in texts
    assert qpdf_texts(MISREAD_BY["mupdf"]) == ["The covering page."]
    assert "The covering page." not in mupdf_texts(READ_AS_ATTACHMENT_BY_BOTH)[1]
    assert "Stored page 6" in qpdf_texts(READ_AS_ATTACHMENT_BY_BOTH)  # a mix: the stored pages, and the file's


@pytest.mark.parametrize("misreader", sorted(MISREAD_BY))
@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_pdf_read_as_the_pdf_it_carries_is_refused_never_answered_with_its_pages(quiet_client, route, misreader):
    response = _post(quiet_client, route, MISREAD_BY[misreader])
    if route == "/api/web-optimize" and misreader == "mupdf" and response.status_code == 400:
        # qpdf 11.9's command (in CI) misses this file's table behind the
        # bytes after its end and rebuilds it as the stored PDF; its output is
        # refused (web_optimize_service._check_output).
        assert response.json()["detail"] == MIXED_UP_MESSAGE
        return
    if ROUTES[route][0] == misreader or route in READ_BY_BOTH:
        assert response.status_code == 400, response.text[:300]
        assert response.json()["detail"] == MIXED_UP_MESSAGE
    else:
        assert response.status_code == 200, response.text[:300]
        shown = _text_of(response)
        assert "Stored page" not in shown and "stored PDF" not in shown
        assert _pages_out(response) == _pages_out(_post(quiet_client, route, INTACT[misreader]))


def test_repair_saves_the_files_own_pages_when_qpdf_reads_the_pdf_it_carries(quiet_client):
    # qpdf's rebuild, which Repair saves first, read the stored page: MuPDF's
    # reading, the file's own, is saved instead.
    response = _repair(quiet_client, MISREAD_BY["qpdf"])
    assert response.status_code == 200, response.text[:300]
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        assert [page.get_text().strip() for page in doc] == ["The covering page."]
    assert response.headers["X-Repair-Pages"] == "1/1"
    assert _post(quiet_client, "/api/rotate", response.content).status_code == 200


def test_repair_refuses_a_pdf_both_libraries_read_as_the_pdf_it_carries(quiet_client):
    # Neither reading is the file's: saving either would hand the visitor the
    # attachment's pages as theirs, and Repair cannot tell them apart.
    response = _repair(quiet_client, READ_AS_ATTACHMENT_BY_BOTH)
    assert response.status_code == 400, response.text[:300]
    assert response.json()["detail"] == CANNOT_TELL_MESSAGE
    assert CANNOT_TELL_MESSAGE.endswith("Download it again.")


def test_pdf_to_text_refuses_a_pdf_pypdf_reads_as_the_pdf_it_carries(quiet_client):
    # pypdf rebuilds the table as qpdf does, and gave the stored page's text.
    def text(data):
        return quiet_client.post("/api/pdf-to-text", files=[("file", ("doc.pdf", data, "application/pdf"))])

    response = text(MISREAD_BY["qpdf"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == MIXED_UP_MESSAGE
    response = text(MISREAD_BY["mupdf"])
    assert response.status_code == 200, response.text
    assert response.json()["text"].strip() == "The covering page."


def _printing_a_pdf_listing() -> bytes:
    """One page whose content prints a PDF listing as text, its offsets
    shifted: pypdf's rebuild takes the "1 0 obj" in the page's text for an
    object, and cannot list the pages."""
    lines = [b"1 0 obj", b"<< /Type /Catalog /Pages 2 0 R >>", b"endobj", b"2 0 obj",
             b"<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>", b"endobj"]
    shown = b"BT /F1 10 Tf 72 600 Td 12 TL " + b" ".join(b"(" + line + b") '" for line in lines) + b" ET"
    out, offsets = b"%PDF-1.7\n", {}
    for number, body in (
        (1, b"<< /Type /Catalog /Pages 2 0 R >>"),
        (2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        (3, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> "
            b"/Contents 5 0 R >>"),
        (4, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        (5, b"<< /Length %d >>\nstream\n%s\nendstream" % (len(shown), shown)),
    ):
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % offsets[n] for n in range(1, 6))
    return _offsets_shifted(out + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref)


def test_pdf_to_text_answers_a_pdf_pypdf_cannot_list_the_pages_of_as_before(quiet_client):
    # pypdf's error for pages it cannot list reaches the route as it always
    # did (400). Caught while its reading was compared, it left the object it
    # failed on marked as being read, and the route then met "Detected loop
    # with self reference" instead, which it answered with a 500.
    import pypdf

    data = _printing_a_pdf_listing()
    with pytest.raises(pypdf.errors.PdfReadError):
        len(pypdf.PdfReader(io.BytesIO(data)).pages)
    response = quiet_client.post("/api/pdf-to-text", files=[("file", ("doc.pdf", data, "application/pdf"))])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This PDF appears to be corrupt or invalid."


def test_the_page_counter_does_not_count_the_pages_of_the_pdf_a_file_carries(quiet_client):
    files = [("files", ("mupdf.pdf", MISREAD_BY["mupdf"], "application/pdf")),
             ("files", ("qpdf.pdf", MISREAD_BY["qpdf"], "application/pdf"))]
    response = quiet_client.post("/api/pdf-page-counter", files=files)
    assert response.status_code == 200, response.text
    assert [f["pages"] for f in response.json()["files"]] == [-1, 1]  # MuPDF counts the pages


@pytest.mark.parametrize("misreader", sorted(MISREAD_BY))
def test_organize_pages_draws_no_page_of_the_pdf_a_file_carries(quiet_client, misreader):
    # Poppler draws the thumbnails, and rebuilds a damaged file as qpdf does:
    # it drew the stored page where MuPDF, which checks the file first, read
    # the file's own. qpdf, which then reorders the pages, stands in for it.
    # MuPDF's misreading is neither's: those thumbnails are the file's.
    def thumbnails(data):
        return quiet_client.post("/api/organize-pages/thumbnails", files=[("file", ("doc.pdf", data, "application/pdf"))])

    response = thumbnails(MISREAD_BY[misreader])
    whole = thumbnails(INTACT[misreader])
    assert whole.status_code == 200 and len(whole.json()["thumbnails"]) == 1
    if misreader == "qpdf":
        assert response.status_code == 400, response.text[:300]
        assert response.json()["detail"] == MIXED_UP_MESSAGE
    else:
        assert response.status_code == 200, response.text[:300]
        assert response.json() == whole.json()


def _five_then_two() -> bytes:
    """Five pages ("Page <n>"), then an incremental update that keeps the
    first two under a new page tree root: the update's catalog, root and two
    pages sit in an object stream, and its cross-reference table is a stream
    that names the base's (/Prev), as PDF 1.5 savers write an update."""
    out, offsets = b"%PDF-1.7\n", {}

    def put(number: int, body: bytes) -> None:
        nonlocal out
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)

    def page(number: int, parent: int) -> bytes:
        return (b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> "
                b"/Contents %d 0 R >>" % (parent, number + 1))

    for i in range(5):
        text = b"BT /F1 24 Tf 72 700 Td (Page %d) Tj ET" % (i + 1)
        put(4 + 2 * i, page(4 + 2 * i, 2))
        put(5 + 2 * i, b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text))
    put(3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    put(2, b"<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R 12 0 R] /Count 5 >>")
    put(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    base_xref = len(out)
    out += b"xref\n0 14\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % offsets[n] for n in range(1, 14))
    out += b"trailer\n<< /Size 14 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % base_xref
    members = [(1, b"<< /Type /Catalog /Pages 60 0 R >>"), (60, b"<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>"),
               (4, page(4, 60)), (6, page(6, 60))]
    body, places = b"", []
    for number, text in members:
        places.append(b"%d %d" % (number, len(body)))
        body += text + b"\n"
    head = b" ".join(places) + b"\n"
    packed = zlib.compress(head + body)
    stream_at = len(out)
    out += (b"61 0 obj\n<< /Type /ObjStm /N 4 /First %d /Filter /FlateDecode /Length %d >>\nstream\n"
            % (len(head), len(packed)) + packed + b"\nendstream\nendobj\n")
    xref_at = len(out)
    entries = {61: (1, stream_at, 0), 62: (1, xref_at, 0), **{n: (2, 61, i) for i, (n, _) in enumerate(members)}}
    rows = b"".join(bytes([kind]) + a.to_bytes(4, "big") + b.to_bytes(2, "big")
                    for _, (kind, a, b) in sorted(entries.items()))
    index = b" ".join(b"%d 1" % n for n in sorted(entries))
    table = zlib.compress(rows)
    out += (b"62 0 obj\n<< /Type /XRef /Size 63 /W [1 4 2] /Index [%s] /Root 1 0 R /Prev %d /Filter /FlateDecode "
            b"/Length %d >>\nstream\n" % (index, base_xref, len(table)) + table + b"\nendstream\nendobj\n")
    return out + b"startxref\n%d\n%%%%EOF\n" % xref_at


def test_an_update_read_as_the_revision_before_it_is_refused_and_repaired(quiet_client):
    # qpdf's rebuild of an updated file whose offsets are off read the
    # revision before the update: five pages where the file has two, and on
    # v2.7.32 qpdf's tools answered with all five. MuPDF reads the update.
    whole = _five_then_two()
    data = _offsets_shifted(whole)
    assert _qpdf_reads(whole) == 2 and _qpdf_reads(data) == 5
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert doc.is_repaired and [page.get_text().strip() for page in doc] == ["Page 1", "Page 2"]
    response = _post(quiet_client, "/api/rotate", data)
    assert response.status_code == 400, response.text[:300]
    assert response.json()["detail"] == MIXED_UP_MESSAGE
    response = _post(quiet_client, "/api/page-numbers", data)
    assert response.status_code == 200 and _pages_out(response) == 2
    repaired = _repair(quiet_client, data)
    assert repaired.status_code == 200 and _pages_out(repaired) == 2
    assert repaired.headers["X-Repair-Pages"] == "2/2"


def test_a_rebuild_that_takes_the_pdf_a_file_carries_for_the_file_is_refused():
    # process_pdf rebuilds a file with qpdf when a tool fails on MuPDF's
    # repair of it; a rebuild made of the stored PDF's objects is never used.
    from backend.app.utils.cleanup import _rebuilt_by_qpdf
    from backend.app.utils.exceptions import PdfCorruptError

    with pytest.raises(PdfCorruptError) as refused:
        _rebuilt_by_qpdf(MISREAD_BY["qpdf"])
    assert refused.value.detail == MIXED_UP_MESSAGE
    rebuilt = _rebuilt_by_qpdf(MISREAD_BY["mupdf"])  # qpdf reads the file's own
    with fitz.open(stream=rebuilt, filetype="pdf") as doc:
        assert [page.get_text().strip() for page in doc] == ["The covering page."]


# ── PDF to Text reads with pypdf ────────────────────────────────────────────

def test_pdf_to_text_refuses_a_pdf_pypdf_read_only_some_pages_of(quiet_client):
    # Linearized: the first page's objects and a cross-reference table for
    # them come first, the page tree near the end, and the page count in the
    # first object. Cut before the page tree, pypdf reads the first page.
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(WHOLE)) as pdf:
        pdf.save(out, linearize=True, deterministic_id=True)
    linear = out.getvalue()

    def pypdf_reads(data: bytes) -> int:
        import pypdf

        try:
            return len(pypdf.PdfReader(io.BytesIO(data)).pages)
        except Exception:  # noqa: BLE001 - pypdf's errors for a file it cannot read
            return 0

    cut = next(data for data in (linear[: len(linear) * p // 100] for p in range(60, 99))
               if 0 < pypdf_reads(data) < 6)
    response = quiet_client.post("/api/pdf-to-text", files=[("file", ("doc.pdf", cut, "application/pdf"))])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == pages_lost_message(pypdf_reads(cut), 6)


# ── Remove Blank Pages: a page left blank by the cut is not a blank page ─────

def _pages_first(data: bytes) -> bytes:
    """As qpdf writes it: every page object first, the content after."""
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pdf.save(out, object_stream_mode=pikepdf.ObjectStreamMode.disable, deterministic_id=True)
    return out.getvalue()


def test_remove_blank_pages_does_not_drop_pages_a_cut_left_blank(quiet_client):
    # Every page object survived, the content of the later pages did not:
    # they come out blank, and were removed as blank pages, 200. The answer
    # sends the visitor to the whole file, not to Repair PDF, which keeps
    # such pages blank (6 of 6 saved) for this tool to remove after all.
    whole = _pages_first(WHOLE)
    cut = next(data for data in (whole[: len(whole) * p // 100] for p in range(30, 90))
               if _qpdf_reads(data) == 6 and _mupdf_reads(data) == 6
               and not fitz.open(stream=data, filetype="pdf")[5].get_text().strip())
    response = quiet_client.post("/api/remove-blank-pages", files=[("file", ("doc.pdf", cut, "application/pdf"))])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == CUT_SHORT_MESSAGE
    assert CUT_SHORT_MESSAGE.startswith("Download this PDF again")
    assert "Repair PDF can't bring that content back" in CUT_SHORT_MESSAGE


def test_remove_blank_pages_still_removes_the_blank_pages_of_a_valid_pdf_that_needed_repair(quiet_client):
    doc = fitz.open(stream=WHOLE, filetype="pdf")
    doc.new_page(width=612, height=792)  # page 7, blank
    data = _junk_after_the_end(doc.tobytes(garbage=0, deflate=True))
    assert fitz.open(stream=data, filetype="pdf").is_repaired
    response = quiet_client.post("/api/remove-blank-pages", files=[("file", ("doc.pdf", data, "application/pdf"))])
    assert response.status_code == 200, response.text
    assert _pages_out(response) == 6


# ── Page Counter ────────────────────────────────────────────────────────────

def test_the_page_counter_does_not_count_the_pages_of_a_pdf_that_lost_some(quiet_client):
    files = [("files", ("cut.pdf", CUT, "application/pdf")),
             ("files", ("whole.pdf", WHOLE, "application/pdf")),
             ("files", ("repaired.pdf", _junk_after_the_end(WHOLE), "application/pdf"))]
    response = quiet_client.post("/api/pdf-page-counter", files=files)
    assert response.status_code == 200, response.text
    assert [f["pages"] for f in response.json()["files"]] == [-1, 6, 6]  # -1: shown as "invalid"
    assert response.json()["total_pages"] == 12


# ── Repair PDF saves the pages that survive, and says how many ──────────────

def _repair(client, data: bytes):
    return client.post("/api/repair", files=[("file", ("doc.pdf", data, "application/pdf"))])


def test_repair_saves_the_pages_that_survive_and_says_how_many_of_how_many(quiet_client):
    response = _repair(quiet_client, CUT)
    assert response.status_code == 200, response.text
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        saved = len(doc)
        assert saved == readable_page_count(doc) == QPDF_READ
        assert "Page 1." in doc[0].get_text()
    assert response.headers["X-Repair-Pages"] == f"{saved}/6"
    assert response.headers["X-Repair-Status"] == "partial"


@pytest.mark.parametrize("sample", ["intact", "junk-after-the-end"])
def test_repair_says_every_page_was_saved_of_a_file_that_lost_none(quiet_client, sample):
    data = WHOLE if sample == "intact" else _junk_after_the_end(WHOLE)
    response = _repair(quiet_client, data)
    assert response.status_code == 200, response.text
    assert response.headers["X-Repair-Pages"] == "6/6"
    assert response.headers["X-Repair-Status"] != "partial"


def _objstm_cut_qpdf_cannot_open() -> bytes:
    """Six pages written with object streams, cut where qpdf cannot open the
    file and MuPDF lists every page but can read only some."""
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(WHOLE)) as pdf:
        pdf.save(out, object_stream_mode=pikepdf.ObjectStreamMode.generate, deterministic_id=True)
    whole = out.getvalue()
    for percent in range(5, 60):
        data = whole[: len(whole) * percent // 100]
        mupdf = _mupdf_reads(data)
        if _qpdf_reads(data) is None and mupdf and mupdf < len(fitz.open(stream=data, filetype="pdf")):
            return data
    raise AssertionError("no such cut")


def test_repair_leaves_out_the_pages_mupdf_lists_but_cannot_read(quiet_client):
    # qpdf cannot open it, so Repair saves MuPDF's reading of it, which
    # listed blank stand-ins for the pages whose object was lost: a repaired
    # file must not hold pages that are not there.
    data = _objstm_cut_qpdf_cannot_open()
    read = _mupdf_reads(data)
    response = _repair(quiet_client, data)
    assert response.status_code == 200, response.text
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        assert not doc.is_repaired
        assert len(doc) == readable_page_count(doc) == read
    assert response.headers["X-Repair-Pages"] == f"{read}/6"


def test_a_repaired_file_is_taken_by_the_other_tools(quiet_client):
    repaired = _repair(quiet_client, CUT).content
    response = _post(quiet_client, "/api/split", repaired)
    assert response.status_code == 200, response.text[:300]


def test_repair_says_nothing_of_pages_when_the_file_does_not_say_how_many(quiet_client):
    # The page tree was written last and lost with the end of the file, but
    # every page object survived: MuPDF finds the pages without it.
    objects = b"".join(
        b"%d 0 obj\n<< /Type /Page /Parent 9 0 R /MediaBox [0 0 612 792] >>\nendobj\n" % n for n in (3, 4))
    data = b"%PDF-1.7\n" + objects
    response = _repair(quiet_client, data)
    if response.status_code == 200:
        assert "X-Repair-Pages" not in response.headers
    else:
        assert response.status_code == 400


def test_repair_says_nothing_of_pages_when_mupdf_cannot_count_its_output(quiet_client, monkeypatch):
    # MuPDF's own errors are not RuntimeError, ValueError or OSError: one
    # from counting the repaired file reached the route's catch-all, which
    # answered "This PDF appears to be corrupt or invalid." (400) for a file
    # it had repaired.
    from backend.app.services import repair_service

    def fails(doc, enough=None):
        raise fitz.mupdf.FzErrorFormat("cannot count")

    monkeypatch.setattr(repair_service, "readable_page_count", fails)
    response = _repair(quiet_client, CUT)
    assert response.status_code == 200, response.text[:300]
    assert "X-Repair-Pages" not in response.headers


# ── The end of a PDF cut short ──────────────────────────────────────────────

def test_the_end_of_a_pdf_cut_short_is_missing(tmp_path):
    from backend.app.utils.cleanup import end_is_missing

    eof = WHOLE.rindex(b"%%EOF")
    cases = {
        "whole": (WHOLE, False),
        "junk-after-the-end": (_junk_after_the_end(WHOLE), False),
        "no-startxref": (_no_startxref(WHOLE), False),
        "cut-in-the-objects": (WHOLE[: len(WHOLE) * 60 // 100], True),
        "cut-after-the-last-object": (WHOLE[: WHOLE.rindex(b"endobj") + 7], True),
        "cut-between-startxref-and-eof": (WHOLE[:eof], True),
        "cut-before-any-object": (WHOLE[:12], True),
    }
    for name, (data, missing) in cases.items():
        assert end_is_missing(data) is missing, name
        path = tmp_path / f"{name}.pdf"
        path.write_bytes(data)
        assert end_is_missing(str(path)) is missing, name


# ── The workers and the API answer in the same words ────────────────────────

def test_the_message_names_both_counts_and_both_ways_out():
    assert pages_lost_message(4, 6) == (
        "This PDF is damaged: only 4 of its 6 pages could be read. "
        "Download it again, or use Repair PDF to save the pages that survive.")
    assert pages_lost_message(1, 1200) == (
        "This PDF is damaged: only 1 of its 1,200 pages could be read. "
        "Download it again, or use Repair PDF to save the pages that survive.")


def test_the_count_reads_an_uploads_bytes_where_they_are():
    # A BytesIO made from the upload and never written to gives back the
    # upload itself, so reading the count from one copies nothing.
    from backend.app.utils.cleanup import _scannable

    data = bytes(WHOLE)
    assert _scannable(io.BytesIO(data)) is data


def test_a_workers_page_counts_are_checked_before_they_are_said():
    from backend.app.utils.cleanup import _DAMAGED_PDF, pages_lost_error

    assert pages_lost_error(4, 6).detail == pages_lost_message(4, 6)
    for survived, declared in ((0, 6), (6, 6), (7, 6), ("4", 6), (None, None), (True, 6)):
        assert pages_lost_error(survived, declared).detail == _DAMAGED_PDF


def test_the_jobs_call_it_damage():
    from backend.app.utils.exceptions import PdfCorruptError
    from backend.app.utils.pdf_errors import pdf_read_error

    message = pages_lost_message(4, 6)
    assert pdf_read_error(PdfCorruptError(message)) == (400, message)


def test_the_site_shows_these_words_as_they_are():
    # friendlyError (frontend/src/lib/utils.ts) turns a damaged PDF's answer
    # into "Try the Repair PDF tool first, then come back." These two it
    # keeps, by rules that must go on matching what the server says.
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "utils.ts").read_text()
    lost = re.search(r"if \(/(only .+? pages could be read)/\.test\(m\)\)", source).group(1)
    for survived, declared in ((4, 6), (1, 1200)):
        assert re.search(lost, pages_lost_message(survived, declared).lower())
    cut_short = re.search(r'startsWith\("(download this pdf again[^"]*)"\)', source).group(1)
    assert CUT_SHORT_MESSAGE.lower().startswith(cut_short)
    # A file read as the PDF it carries: Repair's own refusal sends the
    # visitor to download it again, and must not become "Try Repair PDF".
    mixed = re.search(r'm\.includes\("(up with a file attached inside it)"\)', source).group(1)
    assert mixed in MIXED_UP_MESSAGE.lower() and mixed in CANNOT_TELL_MESSAGE.lower()


def test_a_json_answer_carries_the_words(quiet_client):
    response = _post(quiet_client, "/api/accessibility-check", CUT)
    assert response.status_code == 400
    assert json.loads(response.text)["detail"].startswith("This PDF is damaged: only ")
