"""Every PDF route answers a damaged or locked PDF with a 4xx, never a 500.

A PDF cut short by an interrupted download made 49 of the 84 PDF routes answer
500, "Processing failed. Please try again.", and so offer a retry that can
never work; 29 answered a password-locked PDF that way too. The sweep that
found them sent a four-page PDF cut at 24 points (5 % to 99 %, in the classic
and the object-stream layouts) to every route. These are four of those cuts,
one for each way the libraries fail, and a locked file:

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


@pytest.mark.parametrize("sample", sorted(DAMAGED))
@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_damaged_pdf_is_never_a_server_error(quiet_client, route, sample):
    response = _post(quiet_client, route, DAMAGED[sample])
    assert response.status_code < 500, response.text


@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_locked_pdf_is_done_or_refused_with_the_password_advice(quiet_client, locked_pdf, route):
    response = _post(quiet_client, route, locked_pdf)
    if response.status_code != 200:
        assert response.status_code == 400, response.text
        assert "password" in response.json()["detail"].lower(), response.text


# ── Bytes overwritten rather than cut ───────────────────────────────────────
# Two of the #340 review's byte-overwrites, which qpdf reports as a plain
# RuntimeError rather than a PdfError, so 63 answers of its sweep were 500s:
# - page-tree: the /Count key of the page tree and its first page reference
#   overwritten. pikepdf cannot open it ("/Count is wrong after flattening
#   pages tree"); MuPDF finds no page in it.
# - content: ten bytes of the first page's compressed content overwritten.
#   The tools that lay a stamp or a signature over a page fail when they save
#   ("error while getting stream data for 20 0 R: ... errors while decoding
#   content stream").
def _content_overwritten() -> bytes:
    start = CLASSIC.index(b"stream\n", CLASSIC.index(b"\n6 0 obj")) + len(b"stream\n")
    return CLASSIC[:start + 2] + b"A" * 10 + CLASSIC[start + 12:]


# - page-object: one byte of the first page object overwritten, so it no
#   longer parses ("invalid key in dict"). MuPDF opens the file without
#   repairing it and shows that page blank; the tools that write to the page
#   failed with "not a dict (null)" (utils.cleanup._has_unreadable_page).
OVERWRITTEN = {
    "page-tree": CLASSIC.replace(b"/Count 4/Kids[4 0 R", b"/Cxunt 4/Kids[4 02R"),
    "content": _content_overwritten(),
    "page-object": CLASSIC.replace(b"/Contents[6 0 R]>>", b"/Contents[6 0 R]>y"),
}
# Sanitize and Hidden Text read the file in worker processes of their own,
# which count only some library errors as damage (Sanitize pikepdf's PdfError,
# Hidden Text MuPDF's errors on a file it repaired) and report anything else
# as their own failure.
STILL_A_SERVER_ERROR = {("/api/sanitize", "page-tree"), ("/api/hidden-text-checker", "page-object")}


@pytest.mark.parametrize("route,sample", [
    pytest.param(route, sample, marks=pytest.mark.xfail(strict=True, reason="its worker's own classification"))
    if (route, sample) in STILL_A_SERVER_ERROR else (route, sample)
    for route in sorted(ROUTES) for sample in sorted(OVERWRITTEN)
])
def test_a_pdf_with_bytes_overwritten_is_never_a_server_error(quiet_client, route, sample):
    if (route, sample) == ("/api/web-optimize", "content") and shutil.which("qpdf") is None:
        pytest.skip("pikepdf opens it, so the qpdf command runs: CI and the image have it")
    response = _post(quiet_client, route, OVERWRITTEN[sample])
    assert response.status_code < 500, response.text


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
# to work on: no table, not the watermark asked for. PDF to Word and PDF to
# Excel are not here: a damaged file in which they find no text is damaged,
# not a scan (see below).
FOUND_NOTHING = {
    "/api/extract-tables": "No tables found",
    "/api/remove-watermark/apply": "Unknown watermark selection",
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


# ── PDF to Word and PDF to Excel: a damaged file, or a scan? ────────────────
# Both answer a PDF in which they find no text with the scan advice: "run OCR
# PDF first", "try OCR first". objstm-20 was told that too: MuPDF repairs it
# with all four pages, but every page object was lost, so every page is blank.
# OCR finds nothing on a blank page. A scan draws a picture on its pages; a
# file whose pages draw nothing, and which MuPDF had to repair, is damaged.

WORD_AND_EXCEL = ["/api/pdf-to-word", "/api/pdf-to-excel"]


def _scan(pages: int = 4) -> bytes:
    """A scan: each page draws one picture and holds no text."""
    doc = fitz.open()
    for i in range(pages):
        picture = io.BytesIO()
        Image.new("RGB", (400, 200), (255, 255, 255 - 40 * i)).save(picture, "PNG")
        doc.new_page().insert_image(fitz.Rect(72, 72, 472, 272), stream=picture.getvalue())
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


SCAN = _scan()


@pytest.mark.parametrize("sample", ["objstm-20", "scan-30"])
@pytest.mark.parametrize("route", WORD_AND_EXCEL)
def test_word_and_excel_call_a_file_whose_pages_were_lost_damaged(quiet_client, route, sample):
    data = DAMAGED["objstm-20"] if sample == "objstm-20" else SCAN[: len(SCAN) * 30 // 100]
    if sample == "scan-30":
        # A scan cut short: its first page still lists its picture, but the
        # content that drew it was lost, so no page draws anything.
        doc = fitz.open(stream=data, filetype="pdf")
        assert doc.is_repaired and doc[0].get_images() and not any(page.get_image_info() for page in doc)
    response = _post(quiet_client, route, data)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == _DAMAGED_PDF


def _drawing() -> bytes:
    """A page that draws only vector paths, as an outlined-text or CAD export does."""
    doc = fitz.open()
    doc.new_page().draw_rect(fitz.Rect(72, 72, 300, 300), color=(0, 0, 1), fill=(1, 0, 0))
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _blank() -> bytes:
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


AFTER_END = b"\n" + bytes(range(256)) * 40  # valid, with bytes after its end: MuPDF opens it repaired


@pytest.mark.parametrize("sample", ["intact", "repaired", "cut-90", "drawing-repaired", "blank-intact"])
@pytest.mark.parametrize("route", WORD_AND_EXCEL)
def test_word_and_excel_still_send_a_scan_to_ocr(quiet_client, route, sample):
    data = {
        "intact": SCAN,
        "repaired": SCAN + AFTER_END,
        # Cut short, but three pages still draw their pictures.
        "cut-90": SCAN[: len(SCAN) * 90 // 100],
        # Opened repaired, but its page draws: never called damaged.
        "drawing-repaired": _drawing() + AFTER_END,
        # A file MuPDF did not repair is never called damaged, blank or not.
        "blank-intact": _blank(),
    }[sample]
    assert fitz.open(stream=data, filetype="pdf").is_repaired == (sample not in ("intact", "blank-intact"))
    response = _post(quiet_client, route, data)
    assert response.status_code == 400, response.text
    assert "OCR" in response.json()["detail"], response.text


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


# ── The capped workers: Hidden Text Checker and PDF to Markdown ─────────────
# Each runs in a process of its own, which answered "failed" (a 500) when its
# work raised on a file MuPDF had repaired: the page count of a file cut after
# its page list ("code=7: Invalid number of pages"), or a page's object lost.

WORKER_ROUTES = ["/api/hidden-text-checker", "/api/pdf-to-markdown"]
CORRUPT = "This PDF appears to be corrupt or invalid."


@pytest.mark.parametrize("route", WORKER_ROUTES)
def test_a_worker_says_a_file_cut_after_its_page_list_is_damaged(quiet_client, route):
    response = _post(quiet_client, route, DAMAGED["classic-10"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == CORRUPT


def _worker_that_fails(tmp_path, monkeypatch, route: str) -> None:
    """The real worker, with its work replaced by a fault of the checker's own."""
    from pathlib import Path

    from backend.app.services import hidden_text_service, pdf_to_markdown_service

    service, module, work = {
        "/api/hidden-text-checker": (hidden_text_service, "_hidden_text_worker", "analyse"),
        "/api/pdf-to-markdown": (pdf_to_markdown_service, "_pdf_markdown_worker", "convert"),
    }[route]
    stub = tmp_path / f"stub_{module}.py"
    stub.write_text(
        "import sys\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parents[2])!r})\n"
        f"from backend.app.services import {module} as worker\n"
        "def fails(*args, **kwargs):\n"
        "    raise RuntimeError('a fault in the worker itself')\n"
        f"worker.{work} = fails\n"
        "worker.main()\n"
    )
    monkeypatch.setattr(service, "_WORKER", stub)


@pytest.mark.parametrize("route", WORKER_ROUTES)
def test_a_workers_own_fault_on_an_intact_file_stays_a_500(quiet_client, monkeypatch, tmp_path, route):
    _worker_that_fails(tmp_path, monkeypatch, route)
    assert _post(quiet_client, route, GOOD).status_code == 500


@pytest.mark.parametrize("route", WORKER_ROUTES)
def test_a_worker_failing_on_a_file_mupdf_repaired_says_it_is_damaged(quiet_client, monkeypatch, tmp_path, route):
    # Every page is there; only the end of the file, its cross-reference
    # table, is missing, so MuPDF had to repair it.
    _worker_that_fails(tmp_path, monkeypatch, route)
    response = _post(quiet_client, route, CLASSIC[: len(CLASSIC) * 95 // 100])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == CORRUPT


# ── Split by Text searches with MuPDF and copies with qpdf ──────────────────
# Of a PDF cut short the two can recover different pages: MuPDF 4 and qpdf 2
# of the classic file cut at 40 % and 60 %, and the copy then failed with an
# IndexError (a 500). A locked file got MuPDF's "document closed or encrypted".

SPLIT_BY_TEXT = "/api/split-by-text"


@pytest.mark.parametrize("percent", [40, 60])
def test_split_by_text_says_a_pdf_its_readers_disagree_about_is_damaged(quiet_client, percent):
    cut = CLASSIC[: len(CLASSIC) * percent // 100]
    assert len(fitz.open(stream=cut, filetype="pdf")) != len(pikepdf.open(io.BytesIO(cut)).pages)
    response = _post(quiet_client, SPLIT_BY_TEXT, cut)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == _DAMAGED_PDF


def test_split_by_text_asks_for_the_password(quiet_client, locked_pdf):
    response = _post(quiet_client, SPLIT_BY_TEXT, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


def test_split_by_text_still_splits_an_intact_pdf(quiet_client):
    response = _post(quiet_client, SPLIT_BY_TEXT, GOOD)
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"PK")


# ── Remove Watermark, apply: detection reads with MuPDF, removal with qpdf ──
# A file MuPDF can read but qpdf cannot, or a locked one, failed at the
# removal with ProcessingError("This PDF could not be opened."), a 500.

def _detected(monkeypatch):
    from backend.app.services import watermark_remove_service

    candidate = {"id": "wm_1", "text": "DRAFT"}
    monkeypatch.setattr(watermark_remove_service, "detect_watermarks", lambda path: {"candidates": [candidate]})


def _apply(client, data: bytes):
    return client.post("/api/remove-watermark/apply", files=[("file", ("doc.pdf", data, "application/pdf"))],
                       data={"candidate_ids": json.dumps(["wm_1"])})


def test_removing_a_watermark_from_a_pdf_qpdf_cannot_read_says_it_is_damaged(quiet_client, monkeypatch):
    _detected(monkeypatch)
    response = _apply(quiet_client, DAMAGED["objstm-20"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == CORRUPT


def test_removing_a_watermark_from_a_locked_pdf_asks_for_the_password(quiet_client, monkeypatch, locked_pdf):
    _detected(monkeypatch)
    response = _apply(quiet_client, locked_pdf)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PASSWORD


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


# ── A PDF with no page ──────────────────────────────────────────────────────
# Not damaged, but nothing these tools can work on. open_pdf_document refuses
# it as "This PDF has no pages.", a ToolError that most of these routes turned
# into a 500 (page numbers, flatten, thumbnails, batch compress and 9 more on
# main) or never raised (an empty ZIP, HTML or OCR text came back). The routes
# that now open the upload with open_pdf_document let it through.

def _no_pages() -> bytes:
    out = io.BytesIO()
    pikepdf.new().save(out)
    return out.getvalue()


# These open the upload with pikepdf, which opens a PDF with no page without
# complaint, and answered it with a 500: Bookmarks pointed its bookmark at a
# page that isn't there, Booklet raised a ValueError and QR Code its own "out
# of range" refusal, each into a catch-all, and qpdf would not linearize it for
# Web Optimize. They count the pages first now.
PIKEPDF_NO_PAGE = ["/api/booklet", "/api/bookmarks", "/api/qr-code", WEB_OPTIMIZE]


@pytest.mark.parametrize("route", sorted(
    # Grayscale converts with pikepdf, which returns a PDF with no page as it
    # is; only its raster fallback opens the file with MuPDF.
    set(CHANGES_PAGES + READS_PAGES + PIKEPDF_NO_PAGE + [SPLIT_BY_TEXT, THUMBNAILS]) - {"/api/grayscale"}
))
def test_a_pdf_with_no_page_is_refused_in_the_standard_words(quiet_client, route):
    response = _post(quiet_client, route, _no_pages())
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This PDF has no pages."
