"""Watermark PDF, E-Sign and Stamp PDF answer a damaged PDF with a 400 that says so.

Each route turned every error it did not expect into a 500, so the page said
"Processing failed. Please try again." and offered a retry that can never
work. Watermark PDF's catch-all swallowed safe_open_pdf's refusal ("This PDF
appears to be corrupt or invalid."). E-Sign and Stamp PDF opened the upload
with a bare fitz.open, so a file MuPDF cannot read at all (FileDataError), and
one it repairs but then cannot change ("invalid key in dict", "truncated
object", "corrupt object stream"), reached their catch-alls too. On main, the
four-page PDF below, cut at 12 points from 5 % to 99 % of its length in two
layouts, gave 500 on 13 of the 24 cuts from Watermark PDF, 13 from E-Sign and
14 from Stamp PDF.

Now each answers with the words the other PDF tools use. E-Sign and Stamp PDF
open the file with process_pdf and never retry on qpdf's rebuild: it leaves
out the pages whose object was lost, so the page a visitor chose to sign or
stamp could move.
"""

from __future__ import annotations

import base64
import io
import re

import fitz  # PyMuPDF
import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main
from backend.app.utils.cleanup import _DAMAGED_PDF, process_pdf
from backend.app.utils.exceptions import PdfCorruptError, PdfEncryptedError

# What the other PDF tools say about a file they cannot use.
STANDARD = {
    "This PDF appears to be corrupt or invalid.",
    _DAMAGED_PDF,
    "This PDF has no pages.",
}
# And about one that lost pages to damage, with how many survived.
PAGES_LOST = re.compile(r"This PDF is damaged: only [\d,]+ of its [\d,]+ pages could be read\. "
                        r"Download it again, or use Repair PDF to save the pages that survive\.")


def _signature() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (60, 20), (20, 40, 160)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


ROUTES = {
    "/api/watermark": {"text": "DRAFT"},
    "/api/esign-pdf": {"signature": _signature()},
    "/api/stamp-pdf": {"stamp_type": "draft"},
}


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _classic() -> bytes:
    doc = fitz.open()
    for i in range(4):
        doc.new_page().insert_text((72, 100), f"Page {i + 1}. " + "Words of the contract. " * 8, fontsize=11)
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _object_streams() -> bytes:
    """The same pages as PDF 1.5 writes them: objects packed into object
    streams, found through a cross-reference stream."""
    buf = io.BytesIO()
    with pikepdf.open(io.BytesIO(_classic())) as pdf:
        pdf.save(buf, object_stream_mode=pikepdf.ObjectStreamMode.generate, deterministic_id=True)
    return buf.getvalue()


CUTS = (5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99)
FLAVOURS = {"classic": _classic, "object-streams": _object_streams}


@pytest.mark.parametrize("route", sorted(ROUTES))
@pytest.mark.parametrize("flavour", sorted(FLAVOURS))
def test_a_pdf_cut_short_is_done_or_refused_as_damaged_never_a_500(quiet_client, route, flavour):
    whole = FLAVOURS[flavour]()
    answers = {}
    for percent in CUTS:
        cut = whole[: len(whole) * percent // 100]
        response = quiet_client.post(route, files={"file": ("contract.pdf", cut, "application/pdf")},
                                     data=ROUTES[route])
        answers[percent] = (response.status_code, response.json().get("detail")
                            if response.status_code != 200 else None)
    failures = {p: a for p, a in answers.items() if a[0] not in (200, 400)
                or (a[0] == 400 and a[1] not in STANDARD and not PAGES_LOST.fullmatch(a[1]))}
    assert not failures, failures


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_garbage_after_a_pdf_header_is_refused_as_corrupt(quiet_client, route):
    # Bytes no PDF library can read, behind a PDF header and the start of an
    # object, so the shared sniff (validate_pdf_content) lets them through to
    # the route: neither pikepdf nor MuPDF finds a trailer or a page in them.
    # MuPDF "repairs" them into a file with no page, which E-Sign and Stamp
    # PDF call damaged; Watermark's pikepdf calls them corrupt.
    garbage = b"%PDF-1.4\n1 0 obj\n" + bytes((i * 73 + 41) % 251 for i in range(4000)).replace(b"obj", b"ob_")
    response = quiet_client.post(route, files={"file": ("contract.pdf", garbage, "application/pdf")},
                                 data=ROUTES[route])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] in STANDARD


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_pdf_that_needs_a_password_says_so(quiet_client, locked_pdf, route):
    response = quiet_client.post(route, files={"file": ("contract.pdf", locked_pdf, "application/pdf")},
                                 data=ROUTES[route])
    assert response.status_code == 400, response.text
    assert "password-protected" in response.json()["detail"]


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_an_intact_pdf_is_still_done(quiet_client, route):
    response = quiet_client.post(route, files={"file": ("contract.pdf", _classic(), "application/pdf")},
                                 data=ROUTES[route])
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")


def _repaired() -> bytes:
    """A four-page PDF MuPDF opens repaired, every page there."""
    whole = _classic()
    return whole[: len(whole) * 95 // 100]


def test_a_tool_that_changes_pages_in_place_is_never_run_on_a_rebuild():
    seen: list[int] = []

    def fails_part_way(doc):
        seen.append(len(doc))
        raise fitz.mupdf.FzErrorSyntax("invalid key in dict")

    with pytest.raises(PdfCorruptError) as refused:
        process_pdf(_repaired(), fails_part_way, rebuild=False)
    assert refused.value.detail == _DAMAGED_PDF
    assert seen == [4]  # once, on MuPDF's repair: no rebuild that could drop or move pages


def test_mupdfs_own_errors_on_a_repaired_file_count_as_damage():
    # MuPDF's errors reach Python outside RuntimeError and ValueError; they
    # used to escape process_pdf as a 500 instead of a rebuild and a retry.
    seen: list[int] = []

    def fails_once(doc):
        seen.append(len(doc))
        if len(seen) == 1:
            raise fitz.mupdf.FzErrorFormat("corrupt object stream 1")
        return "done"

    assert process_pdf(_repaired(), fails_once) == "done"
    assert len(seen) == 2


def test_mupdfs_own_errors_on_an_intact_file_are_not_called_damage():
    def fails(doc):
        raise fitz.mupdf.FzErrorSyntax("a fault of the server's own making")

    with pytest.raises(fitz.mupdf.FzErrorBase):
        process_pdf(_classic(), fails)


def test_an_encrypted_pdf_is_refused_before_any_work(locked_pdf):
    with pytest.raises(PdfEncryptedError):
        process_pdf(locked_pdf, lambda doc: pytest.fail("work ran on a locked PDF"), rebuild=False)


def _cut_after_the_page_list() -> bytes:
    """A download that stopped after the page list (/Type/Pages) and before
    the pages it names: MuPDF opens it, then cannot count its pages."""
    whole = _classic()
    return whole[: whole.index(b"endobj", whole.index(b"/Type/Pages")) + len(b"endobj")]


# Every route whose service opens the upload with open_pdf_document or
# process_pdf. They answered this file with a 500: len(doc) raised
# RuntimeError("code=7: Invalid number of pages") inside the helper.
OPENED_BY_THE_HELPER = {
    "/api/esign-pdf": ROUTES["/api/esign-pdf"],
    "/api/stamp-pdf": ROUTES["/api/stamp-pdf"],
    "/api/highlight": {"query": "contract"},
    "/api/smart-redact": {"needles": '["contract"]'},
    "/api/pdf-to-svg": {},
    "/api/split-in-half": {},
    "/api/pdf-to-long-image": {},
    "/api/invert-colors": {},
    "/api/deskew": {},
    "/api/pdf-to-image": {},
    "/api/nup": {},
    "/api/auto-crop": {},
    "/api/pdf-to-pptx": {},
}


def test_the_sample_is_one_mupdf_cannot_count():
    doc = fitz.open(stream=_cut_after_the_page_list(), filetype="pdf")
    with pytest.raises(RuntimeError, match="Invalid number of pages"):
        len(doc)


@pytest.mark.parametrize("route", sorted(OPENED_BY_THE_HELPER))
def test_a_pdf_cut_after_its_page_list_is_refused_as_damaged(quiet_client, route):
    response = quiet_client.post(route, files={"file": ("contract.pdf", _cut_after_the_page_list(), "application/pdf")},
                                 data=OPENED_BY_THE_HELPER[route])
    assert response.status_code == 400, response.text
    # N-Up's route words its own refusal ("PDF appears corrupt or unreadable").
    assert "damaged" in response.json()["detail"] or "corrupt" in response.json()["detail"]
