"""Every PDF route answers a damaged or locked PDF with a 4xx, never a 500.

A PDF cut short by an interrupted download made 47 PDF routes answer 500,
"Processing failed. Please try again.", and so offer a retry that can never
work; 29 answered a password-locked PDF that way too. The sweep that found
them sent a four-page PDF cut at 24 points (5 % to 99 %, in the classic and
the object-stream layouts) to every route. These are four of those cuts, one
for each way the libraries fail, and a locked file:

- classic-5: no library can open it (pikepdf's PdfError, MuPDF's FileDataError,
  pypdf's PdfStreamError);
- classic-10: cut after the page list, so MuPDF opens it but cannot count its
  pages ("code=7: Invalid number of pages");
- objstm-10: MuPDF's repair finds no page in it;
- objstm-20: an object stream cut through, so MuPDF opens it with every page
  but fails on objects it lost ("corrupt object stream", "not a dict (null)"),
  while pikepdf cannot open it at all;
- locked: needs a password (AES-128, as the conftest fixture makes it).

A route may still finish its work on a damaged file; what it may not do is
blame the server. A locked file is either done (tools that do not read the
pages) or refused with the password advice.
"""

from __future__ import annotations

import base64
import io
import json
import shutil

import fitz  # PyMuPDF
import pikepdf
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from PIL import Image
from starlette.datastructures import UploadFile

from backend.app import main
from backend.app.utils.cleanup import _DAMAGED_PDF


def _classic() -> bytes:
    doc = fitz.open()
    for i in range(4):
        doc.new_page().insert_text((72, 100), f"Page {i + 1}. " + "A secret contract. " * 8, fontsize=11)
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _object_streams() -> bytes:
    buf = io.BytesIO()
    with pikepdf.open(io.BytesIO(_classic())) as pdf:
        pdf.save(buf, object_stream_mode=pikepdf.ObjectStreamMode.generate, deterministic_id=True)
    return buf.getvalue()


def _good() -> bytes:
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"A secret meeting on page {i + 1}.", fontsize=14)
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _signature() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (60, 20), (20, 40, 160)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


CLASSIC, OBJECT_STREAMS, GOOD, SIG = _classic(), _object_streams(), _good(), _signature()
DAMAGED = {
    "classic-5": CLASSIC[: len(CLASSIC) * 5 // 100],
    "classic-10": CLASSIC[: len(CLASSIC) * 10 // 100],
    "objstm-10": OBJECT_STREAMS[: len(OBJECT_STREAMS) * 10 // 100],
    "objstm-20": OBJECT_STREAMS[: len(OBJECT_STREAMS) * 20 // 100],
}
BOX = {"x": 60, "y": 80, "width": 120, "height": 30}
SECOND_PDF = ("b.pdf", GOOD, "application/pdf")

# route -> (the field the damaged PDF goes in, other files, form fields)
ROUTES: dict[str, tuple[str, list, dict]] = {
    "/api/merge": ("files", [("files", SECOND_PDF)], {}),
    "/api/split": ("file", [], {"mode": "individual"}),
    "/api/compress": ("files", [], {}),
    "/api/pdf-to-image": ("file", [], {"dpi": "50"}),
    "/api/rotate": ("file", [], {"angle": "90"}),
    "/api/protect": ("files", [], {"password": "pw123456"}),
    "/api/unlock": ("files", [], {"password": "pw123456"}),
    "/api/watermark": ("file", [], {"text": "DRAFT"}),
    "/api/pdf-to-word": ("file", [], {}),
    "/api/page-numbers": ("file", [], {}),
    "/api/metadata": ("file", [], {}),
    "/api/metadata/update": ("file", [], {"title": "T"}),
    "/api/extract-pages": ("file", [], {"pages": "1"}),
    "/api/delete-pages": ("file", [], {"pages": "1"}),
    "/api/pdf-to-text": ("file", [], {}),
    "/api/pdf-to-excel": ("file", [], {}),
    "/api/pdf-to-pptx": ("file", [], {}),
    "/api/strip-metadata": ("files", [], {}),
    "/api/delete-annotations": ("file", [], {}),
    "/api/repair": ("file", [], {}),
    "/api/crop": ("file", [], {"top": "10", "bottom": "10", "left": "10", "right": "10"}),
    "/api/resize": ("file", [], {"page_size": "A4"}),
    "/api/flatten": ("file", [], {}),
    "/api/header-footer": ("file", [], {"header_text": "H", "footer_text": "F"}),
    "/api/bates-numbering": ("file", [], {}),
    "/api/bates-numbering-batch": ("files", [], {}),
    "/api/bates-remove": ("file", [], {}),
    "/api/grayscale": ("file", [], {}),
    "/api/bookmarks": ("file", [], {"bookmarks": json.dumps([{"title": "A", "page": 1}])}),
    "/api/pdf-to-pdfa": ("file", [], {}),
    "/api/extract-images": ("file", [], {}),
    "/api/organize-pages/thumbnails": ("file", [], {}),
    "/api/organize-pages": ("file", [], {"page_order": json.dumps([1])}),
    "/api/alternate-mix": ("file1", [("file2", SECOND_PDF)], {}),
    "/api/split-by-bookmarks": ("file", [], {}),
    "/api/split-by-size": ("file", [], {"max_size_mb": "1"}),
    "/api/nup": ("file", [], {}),
    "/api/overlay": ("base_file", [("overlay_file", SECOND_PDF)], {}),
    "/api/fill-form/fields": ("file", [], {}),
    "/api/fill-form": ("file", [], {"field_values": "{}"}),
    "/api/compare": ("file1", [("file2", SECOND_PDF)], {}),
    "/api/deskew": ("file", [], {}),
    "/api/sign-pdf": ("file", [], {"signature_data": SIG}),
    "/api/redact": ("file", [], {"redactions": json.dumps([{"page": 0, **BOX}])}),
    "/api/edit-pdf": ("file", [], {"edits": json.dumps([{"type": "text", "page": 1, "x": 72, "y": 600, "text": "E",
                                                        "font_size": 12, "color": "#000000",
                                                        "font_family": "Helvetica"}])}),
    "/api/qr-code": ("embed_in_pdf", [], {"data": "hello"}),
    "/api/remove-blank-pages": ("file", [], {}),
    "/api/auto-crop": ("file", [], {}),
    "/api/invert-colors": ("file", [], {"dpi": "50"}),
    "/api/pdfa-validator": ("file", [], {}),
    "/api/verify-signature": ("file", [], {}),
    "/api/sanitize": ("file", [], {}),
    "/api/pdf-to-epub": ("file", [], {}),
    "/api/add-hyperlinks": ("file", [], {}),
    "/api/form-creator": ("file", [], {"form_fields": json.dumps([{"name": "f", "type": "text", "page": 1, **BOX}])}),
    "/api/transparent-background": ("file", [], {"dpi": "72"}),
    "/api/stamp-pdf": ("file", [], {}),
    "/api/esign-pdf": ("file", [], {"signature": SIG}),
    "/api/extract-tables": ("file", [], {}),
    "/api/pdf-to-markdown": ("file", [], {}),
    "/api/whiteout-pdf": ("file", [], {"regions": json.dumps([{"page": 1, **BOX}])}),
    "/api/add-attachment": ("file", [("attachment", ("note.txt", b"hello", "text/plain"))], {}),
    "/api/set-permissions": ("file", [], {"owner_password": "owner123"}),
    "/api/annotate-pdf": ("file", [], {"annotations": json.dumps([{"type": "highlight", "page": 1, **BOX,
                                                                 "color": "#ffe24a", "text": ""}])}),
    "/api/add-shapes": ("file", [], {"shapes": json.dumps([{"type": "rectangle", "page": 1, **BOX, "x2": 200,
                                                          "y2": 120, "color": "#0E8A56", "fill": "#0E8A56",
                                                          "stroke_width": 2}])}),
    "/api/batch-compress-pdf": ("files", [], {}),
    "/api/pdf-page-counter": ("files", [], {}),
    "/api/reverse-pdf": ("file", [], {}),
    "/api/booklet": ("file", [], {}),
    "/api/split-in-half": ("file", [], {}),
    "/api/highlight": ("file", [], {"query": "secret"}),
    "/api/pdf-to-svg": ("file", [], {}),
    "/api/smart-redact": ("file", [], {"needles": json.dumps(["secret"])}),
    "/api/pdf-to-long-image": ("file", [], {"dpi": "50"}),
    "/api/split-by-text": ("file", [], {"search": "secret"}),
    "/api/pdf-to-html": ("file", [], {}),
    "/api/pdf-to-rtf": ("file", [], {}),
    "/api/remove-watermark/detect": ("file", [], {}),
    "/api/remove-watermark/apply": ("file", [], {"candidate_ids": json.dumps(["x"])}),
    "/api/pipeline": ("file", [], {"steps": json.dumps(["compress-pdf"])}),
    "/api/accessibility-check": ("file", [], {}),
    "/api/hidden-text-checker": ("file", [], {}),
    "/api/web-optimize": ("file", [], {}),
    "/api/ocr": ("file", [], {}),
}

# The routes that take an upload but never a PDF.
NOT_PDF = {
    # pictures
    "/api/flip-image", "/api/generate-favicon", "/api/heic-to-jpg", "/api/image-compressor",
    "/api/image-converter", "/api/image-ocr", "/api/image-palette", "/api/image-to-pdf",
    "/api/image-upscaler", "/api/image-watermark", "/api/make-collage", "/api/merge-images",
    "/api/pixelate-image", "/api/read-qr", "/api/remove-background", "/api/remove-exif",
    "/api/remove-image-watermark", "/api/resize-crop-image", "/api/rotate-image", "/api/svg-to-png",
    "/api/view-exif",
    # video and audio
    "/api/add-subtitles", "/api/audio-converter", "/api/audio-merge", "/api/audio-trim",
    "/api/compress-video", "/api/extract-audio", "/api/gif-to-mp4", "/api/mute-video",
    "/api/reverse-video", "/api/trim-media", "/api/video-converter", "/api/video-merge",
    "/api/video-resizer", "/api/video-speed", "/api/video-thumbnail", "/api/video-to-gif",
    "/api/video-to-pdf",
    # documents and data made into a PDF
    "/api/csv-to-pdf", "/api/epub-to-pdf", "/api/excel-to-pdf", "/api/json-to-pdf",
    "/api/markdown-to-pdf", "/api/office-to-pdf", "/api/pptx-to-pdf-convert", "/api/rtf-to-pdf",
    "/api/txt-to-pdf", "/api/word-to-pdf", "/api/xml-to-pdf",
    # archives
    "/api/create-zip", "/api/extract-archive",
}

# Routes still fixed in a later commit of this branch.
NOT_YET = {
    "/api/hidden-text-checker", "/api/pdf-to-markdown", "/api/split-by-text",
}


def _upload_routes() -> set[str]:
    def takes_a_file(annotation) -> bool:
        if isinstance(annotation, type) and issubclass(annotation, UploadFile):
            return True
        return any(takes_a_file(arg) for arg in getattr(annotation, "__args__", ()))

    paths: set[str] = set()

    def visit(route, prefix: str = "") -> None:
        if isinstance(route, APIRoute) and "POST" in (route.methods or set()):
            if any(takes_a_file(p.field_info.annotation) for p in route.dependant.body_params):
                paths.add(f"{prefix}{route.path}")
        original = getattr(route, "original_router", None)
        if original is not None:
            child_prefix = f"{prefix}{getattr(getattr(route, 'include_context', None), 'prefix', '')}"
            for child in original.routes:
                visit(child, child_prefix)

    for route in main.app.routes:
        visit(route)
    return {p for p in paths if p.startswith("/api/") and not p.startswith("/api/v1/")}


def test_every_route_that_takes_an_upload_is_listed_here_or_takes_no_pdf():
    uploads = _upload_routes()
    assert not set(ROUTES) - uploads, "listed here but no longer a route"
    assert not NOT_PDF - uploads, "named as taking no PDF but no longer a route"
    assert not set(ROUTES) & NOT_PDF
    assert not uploads - set(ROUTES) - NOT_PDF, "a new upload route: list it in ROUTES or NOT_PDF"


@pytest.fixture(scope="module")
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def no_tesseract(monkeypatch):
    # OCR PDF reads the PDF before Tesseract sees a page; that is what is
    # tested, so Tesseract need not be installed.
    from backend.app.services import ocr_service

    monkeypatch.setattr(ocr_service.pytesseract, "image_to_string", lambda *a, **k: "text")
    monkeypatch.setattr(ocr_service.pytesseract, "image_to_pdf_or_hocr", lambda *a, **k: GOOD)


def _post(client, route: str, data: bytes):
    field, extra, form = ROUTES[route]
    return client.post(route, files=[(field, ("doc.pdf", data, "application/pdf")), *extra], data=form)


def _not_yet(route: str):
    if route in NOT_YET:
        return pytest.param(route, marks=pytest.mark.xfail(reason="fixed later on this branch", strict=False))
    return route


@pytest.mark.parametrize("sample", sorted(DAMAGED))
@pytest.mark.parametrize("route", [_not_yet(r) for r in sorted(ROUTES)])
def test_a_damaged_pdf_is_never_a_server_error(quiet_client, route, sample):
    response = _post(quiet_client, route, DAMAGED[sample])
    assert response.status_code < 500, response.text


@pytest.mark.parametrize("route", [_not_yet(r) for r in sorted(ROUTES)])
def test_a_locked_pdf_is_done_or_refused_with_the_password_advice(quiet_client, locked_pdf, route):
    response = _post(quiet_client, route, locked_pdf)
    if response.status_code != 200:
        assert response.status_code == 400, response.text
        assert "password" in response.json()["detail"].lower(), response.text


# ── Tools that change the pages, through process_pdf ────────────────────────
# They opened the upload with a bare fitz.open, so a locked file failed on its
# first page ("document closed or encrypted"), a file repaired to no page at
# the save ("cannot save with zero pages"), and one MuPDF repaired failed on
# the objects it had lost ("not a dict (null)"); all were 500s. They open it
# with open_pdf_document now, through process_pdf (rebuild=False) or the shared
# page count, and say what is wrong in the standard words.
CHANGES_PAGES = [
    "/api/add-attachment", "/api/add-hyperlinks", "/api/add-shapes", "/api/annotate-pdf",
    "/api/batch-compress-pdf", "/api/bates-remove", "/api/edit-pdf", "/api/flatten",
    "/api/form-creator", "/api/header-footer", "/api/page-numbers", "/api/pdf-to-epub",
    "/api/pdf-to-pdfa", "/api/redact", "/api/transparent-background", "/api/whiteout-pdf",
]
STANDARD = {
    "This PDF appears to be corrupt or invalid.",
    _DAMAGED_PDF,
    "This PDF has no pages.",
}
PASSWORD = "This PDF is password-protected. Unlock it first, then try again."


@pytest.mark.parametrize("sample", sorted(DAMAGED))
@pytest.mark.parametrize("route", CHANGES_PAGES)
def test_a_tool_that_changes_pages_does_its_work_or_says_the_pdf_is_damaged(quiet_client, route, sample):
    response = _post(quiet_client, route, DAMAGED[sample])
    assert response.status_code in (200, 400), response.text
    if response.status_code == 400:
        assert response.json()["detail"] in STANDARD, response.text


@pytest.mark.parametrize("route", CHANGES_PAGES)
def test_a_tool_that_changes_pages_asks_for_the_password(quiet_client, locked_pdf, route):
    response = _post(quiet_client, route, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


@pytest.mark.parametrize("route", CHANGES_PAGES)
def test_a_tool_that_changes_pages_still_does_an_intact_pdf(quiet_client, route):
    assert _post(quiet_client, route, GOOD).status_code == 200


# ── Tools that read the pages, through open_pdf_document ────────────────────
# A locked file failed on the first page they read ("document closed or
# encrypted"): a 500 behind most of their catch-alls, MuPDF's own words on
# the rest. Grayscale's raster fallback said "No pages found in PDF" for a file
# repaired to no page (a 500), and OCR PDF failed to copy a page out of a
# repaired file ("source object number out of range", a 500).
READS_PAGES = [
    "/api/compare", "/api/extract-images", "/api/extract-tables", "/api/grayscale", "/api/ocr",
    "/api/pdf-to-excel", "/api/pdf-to-html", "/api/pdf-to-rtf", "/api/pdf-to-word",
    "/api/remove-watermark/apply", "/api/remove-watermark/detect",
]
# What a tool says, in its own words, about a file in which it found nothing
# to work on: no table, not the watermark asked for, no text.
FOUND_NOTHING = {
    "/api/extract-tables": "No tables found",
    "/api/remove-watermark/apply": "Unknown watermark selection",
    "/api/pdf-to-excel": "No tables detected",
    "/api/pdf-to-word": "no text layer",
}


@pytest.mark.parametrize("sample", sorted(DAMAGED) + ["objstm-40"])
@pytest.mark.parametrize("route", READS_PAGES)
def test_a_tool_that_reads_pages_does_its_work_or_says_the_pdf_is_damaged(quiet_client, route, sample):
    data = DAMAGED.get(sample) or OBJECT_STREAMS[: len(OBJECT_STREAMS) * 40 // 100]
    response = _post(quiet_client, route, data)
    assert response.status_code in (200, 400), response.text
    if response.status_code == 400:
        detail = response.json()["detail"]
        assert detail in STANDARD or FOUND_NOTHING.get(route, "\0") in detail, response.text


@pytest.mark.parametrize("route", READS_PAGES)
def test_a_tool_that_reads_pages_asks_for_the_password(quiet_client, locked_pdf, route):
    response = _post(quiet_client, route, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


@pytest.mark.parametrize("route", [r for r in READS_PAGES
                                   if r not in ("/api/extract-tables", "/api/remove-watermark/apply")])
def test_a_tool_that_reads_pages_still_does_an_intact_pdf(quiet_client, route):
    assert _post(quiet_client, route, GOOD).status_code == 200


# ── Organize Pages draws its thumbnails with Poppler ────────────────────────
# Poppler cannot count the pages of most PDFs cut short ("Couldn't find trailer
# dictionary"): pdf2image raised PDFPageCountError, a 500, on 23 of the 24 cuts.

THUMBNAILS = "/api/organize-pages/thumbnails"


@pytest.mark.parametrize("sample", sorted(DAMAGED))
def test_organize_pages_says_a_pdf_it_cannot_draw_is_damaged(quiet_client, sample):
    response = _post(quiet_client, THUMBNAILS, DAMAGED[sample])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] in STANDARD


def test_organize_pages_asks_for_the_password(quiet_client, locked_pdf):
    response = _post(quiet_client, THUMBNAILS, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


def test_organize_pages_still_draws_an_intact_pdf(quiet_client):
    response = _post(quiet_client, THUMBNAILS, GOOD)
    assert response.status_code == 200, response.text
    assert len(response.json()["thumbnails"]) == 3


def test_poppler_failing_on_a_pdf_mupdf_reads_intact_stays_the_servers_fault(quiet_client, monkeypatch):
    from pdf2image.exceptions import PDFPageCountError

    from backend.app.services import organize_pages_service

    def poppler_fails(*_args, **_kwargs):
        raise PDFPageCountError("Unable to get page count.\nI/O Error: Couldn't open file")

    monkeypatch.setattr(organize_pages_service, "convert_from_path", poppler_fails)
    assert _post(quiet_client, THUMBNAILS, GOOD).status_code == 500


# ── Web Optimize runs the qpdf command ──────────────────────────────────────
# qpdf exits with status 2 for a file it cannot read, which the service raised
# as ExternalToolError and the route answered 500; it gives the same status
# for a disk or permission fault, so the status alone cannot be read.

WEB_OPTIMIZE = "/api/web-optimize"


@pytest.mark.parametrize("sample", sorted(DAMAGED))
def test_web_optimize_says_a_pdf_qpdf_cannot_read_is_damaged(quiet_client, sample):
    response = _post(quiet_client, WEB_OPTIMIZE, DAMAGED[sample])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] in STANDARD


def test_web_optimize_asks_for_the_password(quiet_client, locked_pdf):
    response = _post(quiet_client, WEB_OPTIMIZE, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


@pytest.mark.skipif(shutil.which("qpdf") is None, reason="needs the qpdf command (CI and the image have it)")
def test_web_optimize_still_linearizes_an_intact_pdf(quiet_client):
    response = _post(quiet_client, WEB_OPTIMIZE, GOOD)
    assert response.status_code == 200, response.text
    with pikepdf.open(io.BytesIO(response.content)) as pdf:
        assert pdf.is_linearized


def test_qpdf_failing_on_a_pdf_its_library_reads_stays_the_servers_fault(quiet_client, monkeypatch):
    import asyncio

    class FailingQpdf:
        returncode = 2

        async def communicate(self):
            return b"", b"qpdf: open output: Permission denied"

        def kill(self):
            pass

    async def run_qpdf(*_args, **_kwargs):
        return FailingQpdf()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", run_qpdf)
    assert _post(quiet_client, WEB_OPTIMIZE, GOOD).status_code == 500


# ── PDF to Text reads with pypdf ────────────────────────────────────────────
# Its stream errors ("Stream has ended unexpectedly" on every cut the sweep
# made) and its FileNotDecryptedError were 500s.

@pytest.mark.parametrize("sample", sorted(DAMAGED))
def test_pdf_to_text_calls_a_pdf_pypdf_cannot_read_damaged(quiet_client, sample):
    response = _post(quiet_client, "/api/pdf-to-text", DAMAGED[sample])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This PDF appears to be corrupt or invalid."


def test_pdf_to_text_asks_for_the_password(quiet_client, locked_pdf):
    response = _post(quiet_client, "/api/pdf-to-text", locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This PDF is password-protected. Unlock it first, then try again."


def test_pdf_to_text_still_reads_an_intact_pdf(quiet_client):
    response = _post(quiet_client, "/api/pdf-to-text", GOOD)
    assert response.status_code == 200, response.text
    assert "A secret meeting on page 3." in response.json()["text"]
