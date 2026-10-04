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

import fitz  # PyMuPDF
import pikepdf
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from PIL import Image
from starlette.datastructures import UploadFile

from backend.app import main


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
    "/api/add-attachment", "/api/add-hyperlinks", "/api/add-shapes", "/api/annotate-pdf",
    "/api/batch-compress-pdf", "/api/bates-remove", "/api/compare", "/api/extract-images",
    "/api/extract-tables", "/api/flatten", "/api/grayscale", "/api/header-footer",
    "/api/hidden-text-checker", "/api/ocr", "/api/organize-pages/thumbnails", "/api/page-numbers",
    "/api/pdf-to-excel", "/api/pdf-to-html", "/api/pdf-to-markdown", "/api/pdf-to-pdfa",
    "/api/pdf-to-rtf", "/api/pdf-to-text", "/api/pdf-to-word", "/api/redact",
    "/api/remove-watermark/apply", "/api/remove-watermark/detect", "/api/split-by-text",
    "/api/web-optimize", "/api/whiteout-pdf",
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
