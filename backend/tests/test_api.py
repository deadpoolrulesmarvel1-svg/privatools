"""Live HTTP tests against a running server on localhost:8000.

These SKIP unless something is listening, and `.github/workflows/test.yml`
starts no server — so this whole module (40 tests) has never executed in CI.
Two consequences, both real, both found the first time it was actually run:

  * `/protect` and `/unlock` moved to multi-file (`files`, plural) at some
    point and these tests still sent `file`. They 422'd silently for however
    long, because nothing ran them.
  * Running all 40 sequentially trips the per-IP cap — `/compress` and friends
    carry EXPENSIVE_RATE_LIMIT (5/minute). To run this module, raise it:
        RATE_LIMIT_EXPENSIVE=1000/minute RATE_LIMIT=1000/minute \
            uvicorn backend.app.main:app --port 8000
    then `pytest backend/tests/test_api.py`.
"""

import io
import json
import time
import pytest
import fitz  # PyMuPDF
import requests
from PIL import Image

BASE_URL = "http://localhost:8000/api"


# Autouse fixture: probe the server once per session; if down, skip every test
# in this module instead of letting them each fail with a ConnectionError.
@pytest.fixture(scope="module", autouse=True)
def _require_running_server():
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=1.5)
        if r.status_code >= 500:
            pytest.skip(f"backend health returned {r.status_code} — skipping HTTP tests")
    except requests.RequestException as exc:
        pytest.skip(f"backend not reachable at {BASE_URL} ({exc}) — skipping HTTP tests")


# ── Fixtures ──

@pytest.fixture(scope="module")
def small_pdf():
    """A 2-page PDF with text content."""
    doc = fitz.open()
    for i in range(2):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {i+1}\nTest content line two", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture(scope="module")
def jpeg_image():
    img = Image.new("RGB", (200, 150), (30, 60, 120))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture(scope="module")
def fillable_pdf():
    """PDF with form fields for fill-form testing."""
    doc = fitz.open()
    page = doc.new_page()
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.field_name = "name"
    w.rect = fitz.Rect(72, 80, 300, 100)
    w.field_value = ""
    page.add_widget(w)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def request_with_retry(method, url, *, files=None, data=None, timeout=30, retries=5):
    """Retry on 429 to avoid false negatives from local rate limiting middleware."""
    for attempt in range(retries):
        response = requests.request(method, url, files=files, data=data, timeout=timeout)
        if response.status_code != 429:
            return response
        time.sleep(2 ** attempt)
    return response


def post(endpoint, files=None, data=None, timeout=30):
    return request_with_retry("POST", f"{BASE_URL}/{endpoint}", files=files, data=data or {}, timeout=timeout)


# ── Health ──

def test_health():
    r = request_with_retry("GET", f"{BASE_URL}/health", timeout=5)
    assert r.status_code == 200


# ── Compress ──

def test_compress_returns_valid_pdf(small_pdf):
    # /compress now takes `files: list[UploadFile]` + `level` (named preset:
    # light / recommended / extreme / custom). A single-file payload still
    # returns a raw PDF; >1 file gets a ZIP.
    r = post(
        "compress",
        files=[("files", ("test.pdf", small_pdf, "application/pdf"))],
        data={"level": "recommended"},
    )
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_compress_multiple_returns_zip(small_pdf):
    r = post(
        "compress",
        files=[
            ("files", ("a.pdf", small_pdf, "application/pdf")),
            ("files", ("b.pdf", small_pdf, "application/pdf")),
        ],
        data={"level": "recommended"},
    )
    assert r.status_code == 200
    assert r.content[:2] == b"PK"  # ZIP magic number


# ── Split ──

def test_split_pages(small_pdf):
    r = post("split", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"mode": "pages", "pages": "1"})
    assert r.status_code == 200


def test_split_pages_with_end_keyword(small_pdf):
    r = post("split", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"mode": "pages", "pages": "1-end"})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


# ── Organize ──

def test_organize_pages_reorders(small_pdf):
    r = post("organize-pages", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"page_order": json.dumps([2, 1])})
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    assert len(doc) == 2
    doc.close()


def test_delete_pages_reduces_count(small_pdf):
    r = post("delete-pages", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"pages": "2"})
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    assert len(doc) == 1
    doc.close()


# ── Edit ──

def test_watermark(small_pdf):
    r = post("watermark", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"text": "CONFIDENTIAL", "position": "center", "opacity": "0.3"})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_watermark_with_image(small_pdf, jpeg_image):
    r = request_with_retry(
        "POST",
        f"{BASE_URL}/watermark",
        files={
            "file": ("test.pdf", small_pdf, "application/pdf"),
            "watermark_image": ("wm.jpg", jpeg_image, "image/jpeg"),
        },
        data={"position": "center", "opacity": "0.4", "image_scale": "0.2"},
        timeout=30,
    )
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_bookmarks_added(small_pdf):
    bm = json.dumps([{"title": "Ch1", "page": 1}])
    r = post("bookmarks", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"bookmarks": bm})
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    toc = doc.get_toc()
    assert len(toc) >= 1
    doc.close()


# ── Security ──

def test_protect_and_unlock(small_pdf):
    # NB: /protect takes `files` (plural) — it is multi-file. Sending `file`
    # yields a 422, which went unnoticed for as long as this module never ran.
    r1 = post("protect", files={"files": ("test.pdf", small_pdf, "application/pdf")}, data={"password": "secret123"})
    assert r1.status_code == 200
    r2 = post("unlock", files={"files": ("p.pdf", r1.content, "application/pdf")}, data={"password": "secret123"})
    assert r2.status_code == 200
    assert r2.content[:5] == b"%PDF-"


def test_redact(small_pdf):
    rects = json.dumps([{"page": 0, "x0": 50, "y0": 50, "x1": 200, "y1": 100}])
    r = post("redact", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"redactions": rects, "color": "#000000"})
    assert r.status_code == 200


def test_metadata_read(small_pdf):
    r = post("metadata", files={"file": ("test.pdf", small_pdf, "application/pdf")})
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


# ── Conversions ──

def test_pdf_to_text_extracts_content(small_pdf):
    r = post("pdf-to-text", files={"file": ("test.pdf", small_pdf, "application/pdf")})
    assert r.status_code == 200
    text = r.content.decode("utf-8", errors="replace")
    assert len(text) > 10


def test_ocr_searchable_pdf_output(small_pdf):
    r = post(
        "ocr",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"lang": "eng", "output": "searchable_pdf"},
        timeout=60,
    )
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_pdf_to_image(small_pdf):
    r = post("pdf-to-image", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"format": "png", "dpi": "72"})
    assert r.status_code == 200
    assert len(r.content) > 100


def test_image_to_pdf(jpeg_image):
    r = post("image-to-pdf", files=[("files", ("test.jpg", jpeg_image, "image/jpeg"))])
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_html_to_pdf():
    r = request_with_retry("POST", f"{BASE_URL}/html-to-pdf", data={"html_content": "<h1>Hello</h1>"}, timeout=10)
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_csv_to_pdf():
    r = post("csv-to-pdf", files={"file": ("test.csv", b"Name,Age\nAlice,30\n", "text/csv")})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_form_creator_adds_fields(small_pdf):
    form_fields = json.dumps([
        {
            "name": "full_name",
            "type": "text",
            "page": 1,
            "x": 72,
            "y": 72,
            "width": 220,
            "height": 24,
            "required": True,
            "value": "",
            "multiline": False,
        }
    ])
    r = post(
        "form-creator",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"form_fields": form_fields},
    )
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    widgets = list(doc[0].widgets() or [])
    doc.close()
    assert any(w.field_name == "full_name" for w in widgets)


# ── Optimize ──

def test_rotate(small_pdf):
    r = post("rotate", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"angle": "90"})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_crop(small_pdf):
    r = post("crop", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"top": "50", "bottom": "50", "left": "30", "right": "30"})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_invert_output_size(small_pdf):
    """Verifies the invert colors perf fix — output should be <500KB for a 2-page PDF."""
    r = post("invert-colors", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"dpi": "72"}, timeout=15)
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) < 500_000, f"Invert output too large: {len(r.content)} bytes"


def test_auto_crop(small_pdf):
    r = post("auto-crop", files={"file": ("test.pdf", small_pdf, "application/pdf")})
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_transparent_background_with_threshold(small_pdf):
    r = post(
        "transparent-background",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"threshold": "240", "dpi": "120"},
    )
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"


def test_remove_blank_pages_keeps_content(small_pdf):
    r = post("remove-blank-pages", files={"file": ("test.pdf", small_pdf, "application/pdf")}, data={"sensitivity": "85"})
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    assert len(doc) >= 1
    doc.close()


# ── Advanced ──

def test_merge_combines_pages(small_pdf):
    r = post("merge", files=[("files", ("a.pdf", small_pdf, "application/pdf")), ("files", ("b.pdf", small_pdf, "application/pdf"))])
    assert r.status_code == 200
    doc = fitz.open(stream=r.content, filetype="pdf")
    assert len(doc) == 4
    doc.close()


def test_qr_code():
    r = request_with_retry("POST", f"{BASE_URL}/qr-code", data={"data": "https://example.com", "size": "200", "format": "png"}, timeout=10)
    assert r.status_code == 200
    assert len(r.content) > 100


def test_fill_form_fields(fillable_pdf):
    r = post("fill-form/fields", files={"file": ("form.pdf", fillable_pdf, "application/pdf")})
    assert r.status_code == 200
    assert len(r.json()["fields"]) >= 1


# ── Image Tools ──

def test_image_compressor(jpeg_image):
    r = post("image-compressor", files={"file": ("test.jpg", jpeg_image, "image/jpeg")}, data={"quality": "75"})
    assert r.status_code == 200


def test_image_converter_format(jpeg_image):
    r = post("image-converter", files={"file": ("test.jpg", jpeg_image, "image/jpeg")}, data={"target_format": "png"})
    assert r.status_code == 200
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", "Output is not a valid PNG"


# ── Error Handling ──

def test_non_pdf_rejected():
    r = post(
        "compress",
        files=[("files", ("test.txt", b"hello", "text/plain"))],
        data={"level": "recommended"},
    )
    assert r.status_code == 400


def test_invalid_pdf_rejected():
    r = post(
        "compress",
        files=[("files", ("fake.pdf", b"not a pdf", "application/pdf"))],
        data={"level": "recommended"},
    )
    assert r.status_code == 400


def test_missing_required_param(small_pdf):
    r = post("bookmarks", files={"file": ("test.pdf", small_pdf, "application/pdf")})
    assert r.status_code == 422


def test_url_to_pdf_blocks_internal_hosts():
    r = request_with_retry("POST", f"{BASE_URL}/url-to-pdf", data={"url": "http://127.0.0.1/admin"}, timeout=10)
    assert r.status_code == 400
    assert "Local/internal URLs" in r.text


def test_whiteout_requires_non_empty_regions(small_pdf):
    r = post(
        "whiteout-pdf",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"regions": "[]"},
    )
    assert r.status_code == 400


def test_image_to_pdf_rejects_invalid_page_size(jpeg_image):
    r = post(
        "image-to-pdf",
        files=[("files", ("test.jpg", jpeg_image, "image/jpeg"))],
        data={"page_size": "A3"},
    )
    assert r.status_code == 400


def test_pdf_to_image_rejects_out_of_range_dpi(small_pdf):
    r = post(
        "pdf-to-image",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"format": "png", "dpi": "5"},
    )
    assert r.status_code == 422


def test_protect_rejects_blank_password(small_pdf):
    r = post(
        "protect",
        files={"files": ("test.pdf", small_pdf, "application/pdf")},
        data={"password": "   "},
    )
    assert r.status_code == 400


def test_ocr_rejects_invalid_output(small_pdf):
    r = post(
        "ocr",
        files={"file": ("test.pdf", small_pdf, "application/pdf")},
        data={"lang": "eng", "output": "xml"},
    )
    assert r.status_code == 400
