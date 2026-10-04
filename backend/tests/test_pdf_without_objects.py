"""A file with a PDF header and no object after it is a 400 on every PDF route.

A download that stops after its first line, or before its first object, and
bytes that only start like a PDF passed the shared sniff (validate_pdf_content
looked only for the header) and reached the parsers. pikepdf answers a file of
just "%PDF-1.7\\n" with OSError 22 ("Invalid argument"), MuPDF says "no objects
found", and the routes' catch-alls turned both into "Processing failed. Please
try again.": on main, 62 of these 83 routes answered a header-only file with a
500, and 44 a file cut before its first object or garbage after a header. The
sniff now refuses such a file with the words the other PDF tools use, before
any parser runs. Batch Compress had a check of its own that looked only at
the first five bytes; it uses the shared sniff now.
"""

from __future__ import annotations

import base64
import io
import json

import fitz  # PyMuPDF
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main


def _pdf() -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), "A secret meeting.", fontsize=14)
    data = doc.tobytes()
    doc.close()
    return data


def _signature() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (60, 20), (20, 40, 160)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


GOOD = _pdf()
SIG = _signature()
BOX = {"x": 60, "y": 80, "width": 120, "height": 30}
PDF_SECOND = [("file2", ("b.pdf", GOOD, "application/pdf"))]

# route -> (the field the damaged PDF goes in, other files, form fields)
ROUTES: dict[str, tuple[str, list, dict]] = {
    "/api/merge": ("files", [("files", ("b.pdf", GOOD, "application/pdf"))], {}),
    "/api/split": ("file", [], {"mode": "individual"}),
    "/api/compress": ("files", [], {}),
    "/api/pdf-to-image": ("file", [], {}),
    "/api/rotate": ("file", [], {"angle": "90"}),
    "/api/protect": ("files", [], {"password": "pw123456"}),
    "/api/unlock": ("files", [], {"password": "pw123456"}),
    "/api/watermark": ("file", [], {"text": "DRAFT"}),
    "/api/pdf-to-word": ("file", [], {}),
    "/api/page-numbers": ("file", [], {}),
    "/api/metadata": ("file", [], {}),
    "/api/metadata/update": ("file", [], {}),
    "/api/extract-pages": ("file", [], {"pages": "1"}),
    "/api/delete-pages": ("file", [], {"pages": "1"}),
    "/api/pdf-to-text": ("file", [], {}),
    "/api/pdf-to-excel": ("file", [], {}),
    "/api/pdf-to-pptx": ("file", [], {}),
    "/api/strip-metadata": ("files", [], {}),
    "/api/delete-annotations": ("file", [], {}),
    "/api/repair": ("file", [], {}),
    "/api/crop": ("file", [], {"top": "10"}),
    "/api/resize": ("file", [], {"page_size": "A4"}),
    "/api/flatten": ("file", [], {}),
    "/api/header-footer": ("file", [], {"header_text": "H"}),
    "/api/bates-numbering": ("file", [], {}),
    "/api/bates-numbering-batch": ("files", [], {}),
    "/api/bates-remove": ("file", [], {}),
    "/api/grayscale": ("file", [], {}),
    "/api/bookmarks": ("file", [], {"bookmarks": json.dumps([{"title": "A", "page": 1}])}),
    "/api/pdf-to-pdfa": ("file", [], {}),
    "/api/extract-images": ("file", [], {}),
    "/api/organize-pages/thumbnails": ("file", [], {}),
    "/api/organize-pages": ("file", [], {"page_order": json.dumps([1])}),
    "/api/alternate-mix": ("file1", PDF_SECOND, {}),
    "/api/split-by-bookmarks": ("file", [], {}),
    "/api/split-by-size": ("file", [], {"max_size_mb": "1"}),
    "/api/nup": ("file", [], {}),
    "/api/overlay": ("base_file", [("overlay_file", ("b.pdf", GOOD, "application/pdf"))], {}),
    "/api/fill-form/fields": ("file", [], {}),
    "/api/fill-form": ("file", [], {"field_values": "{}"}),
    "/api/compare": ("file1", PDF_SECOND, {}),
    "/api/deskew": ("file", [], {}),
    "/api/sign-pdf": ("file", [], {"signature_data": SIG}),
    "/api/redact": ("file", [], {"redactions": json.dumps([{"page": 0, **BOX}])}),
    "/api/edit-pdf": ("file", [], {"edits": json.dumps([{"type": "text", "page": 1, "x": 72, "y": 600,
                                                        "text": "E", "font_size": 12}])}),
    "/api/qr-code": ("embed_in_pdf", [], {"data": "hello"}),
    "/api/remove-blank-pages": ("file", [], {}),
    "/api/auto-crop": ("file", [], {}),
    "/api/invert-colors": ("file", [], {}),
    "/api/pdfa-validator": ("file", [], {}),
    "/api/verify-signature": ("file", [], {}),
    "/api/sanitize": ("file", [], {}),
    "/api/pdf-to-epub": ("file", [], {}),
    "/api/add-hyperlinks": ("file", [], {}),
    "/api/form-creator": ("file", [], {"form_fields": json.dumps([{"name": "f", "type": "text", "page": 1, **BOX}])}),
    "/api/transparent-background": ("file", [], {}),
    "/api/stamp-pdf": ("file", [], {}),
    "/api/esign-pdf": ("file", [], {"signature": SIG}),
    "/api/extract-tables": ("file", [], {}),
    "/api/pdf-to-markdown": ("file", [], {}),
    "/api/whiteout-pdf": ("file", [], {"regions": json.dumps([{"page": 1, **BOX}])}),
    "/api/add-attachment": ("file", [("attachment", ("note.txt", b"hello", "text/plain"))], {}),
    "/api/set-permissions": ("file", [], {"owner_password": "owner123"}),
    "/api/annotate-pdf": ("file", [], {"annotations": json.dumps([{"type": "highlight", "page": 1, **BOX}])}),
    "/api/add-shapes": ("file", [], {"shapes": json.dumps([{"type": "rectangle", "page": 1, **BOX}])}),
    "/api/batch-compress-pdf": ("files", [], {}),
    "/api/reverse-pdf": ("file", [], {}),
    "/api/booklet": ("file", [], {}),
    "/api/split-in-half": ("file", [], {}),
    "/api/highlight": ("file", [], {"query": "secret"}),
    "/api/pdf-to-svg": ("file", [], {}),
    "/api/smart-redact": ("file", [], {"needles": json.dumps(["secret"])}),
    "/api/pdf-to-long-image": ("file", [], {}),
    "/api/web-optimize": ("file", [], {}),
    "/api/split-by-text": ("file", [], {"search": "secret"}),
    "/api/pdf-to-html": ("file", [], {}),
    "/api/pdf-to-rtf": ("file", [], {}),
    "/api/remove-watermark/detect": ("file", [], {}),
    "/api/remove-watermark/apply": ("file", [], {"candidate_ids": json.dumps(["x"])}),
    "/api/pipeline": ("file", [], {"steps": json.dumps(["compress-pdf"])}),
    "/api/accessibility-check": ("file", [], {}),
    "/api/hidden-text-checker": ("file", [], {}),
    "/api/ocr": ("file", [], {}),
}

SAMPLES = {
    "header-only": b"%PDF-1.7\n",
    "cut-before-the-first-object": GOOD[: GOOD.find(b"obj") - 1],
    "garbage-after-a-header": b"%PDF-1.4\n" + bytes(range(256)) * 16,
}


@pytest.fixture(scope="module")
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _posted_paths() -> set[str]:
    paths: set[str] = set()

    def visit(route, prefix: str = "") -> None:
        if isinstance(route, APIRoute) and "POST" in (route.methods or set()):
            paths.add(f"{prefix}{route.path}")
        original = getattr(route, "original_router", None)
        if original is not None:
            child_prefix = f"{prefix}{getattr(getattr(route, 'include_context', None), 'prefix', '')}"
            for child in original.routes:
                visit(child, child_prefix)

    for route in main.app.routes:
        visit(route)
    return paths


def test_every_route_in_the_list_still_exists():
    assert not set(ROUTES) - _posted_paths()


@pytest.mark.parametrize("sample", sorted(SAMPLES))
@pytest.mark.parametrize("route", sorted(ROUTES))
def test_a_pdf_header_with_no_object_after_it_is_a_400(quiet_client, route, sample):
    field, extra, form = ROUTES[route]
    files = [(field, ("doc.pdf", SAMPLES[sample], "application/pdf"))]
    response = quiet_client.post(route, files=files + extra, data=form)
    assert response.status_code == 400, response.text
    # Repair PDF reads every file itself, and words its refusal its own way.
    assert "corrupt" in response.json()["detail"]
