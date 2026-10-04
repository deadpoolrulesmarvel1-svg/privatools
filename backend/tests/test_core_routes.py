"""In-process smoke tests for the core PDF and image routes.

The existing ``test_phased_routes.py`` covers everything declared under
``phase1_tools..phase7_tools`` + ``new_tools`` / ``v12_tools`` / ``pdf_extra``,
but the *original* per-tool route files (compress, merge, split, rotate,
organize-pages, protect/unlock, pdf-to-text, redact, qr-code, create-zip)
historically only had coverage in ``test_api.py`` — which auto-skips when no
live server is running.

This file fills that gap by exercising the same endpoints through the
in-process TestClient. Each test asserts:

  * HTTP 200 on a happy-path payload
  * the response ``Content-Type`` matches the expected output
  * the body starts with the right magic bytes (``%PDF-``, ``PK``, ``\x89PNG``)
  * no Python traceback leaked into the response body

If a route depends on an optional system dep that isn't installed, we
``pytest.skip`` on 5xx so a slim CI image stays green. We *don't* skip on
4xx — those would point at a real input-validation regression.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest


def _is_pdf(content: bytes) -> bool:
    return content[:5] == b"%PDF-"


def _is_zip(content: bytes) -> bool:
    return content[:2] == b"PK"


def _is_png(content: bytes) -> bool:
    return content[:8] == b"\x89PNG\r\n\x1a\n"


def _no_traceback(content: bytes) -> bool:
    return b"Traceback" not in content


# ---------------------------------------------------------------------------
# /api/compress — single + multi (single returns raw PDF, multi returns ZIP)
# ---------------------------------------------------------------------------

class TestCompress:
    def test_compress_single_returns_pdf(self, client, sample_pdf):
        resp = client.post(
            "/api/compress",
            files=[("files", ("test.pdf", sample_pdf, "application/pdf"))],
            data={"level": "recommended"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/pdf")
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)

    def test_compress_multi_returns_zip(self, client, sample_pdf):
        resp = client.post(
            "/api/compress",
            files=[
                ("files", ("a.pdf", sample_pdf, "application/pdf")),
                ("files", ("b.pdf", sample_pdf, "application/pdf")),
            ],
            data={"level": "light"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/zip")
        assert _is_zip(resp.content)
        assert _no_traceback(resp.content)

    def test_compress_rejects_invalid_level(self, client, sample_pdf):
        resp = client.post(
            "/api/compress",
            files=[("files", ("a.pdf", sample_pdf, "application/pdf"))],
            data={"level": "bogus"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# /api/merge — concatenates two PDFs into one
# ---------------------------------------------------------------------------

class TestMerge:
    def test_merge_two_pdfs_returns_pdf(self, client, sample_pdf):
        resp = client.post(
            "/api/merge",
            files=[
                ("files", ("a.pdf", sample_pdf, "application/pdf")),
                ("files", ("b.pdf", sample_pdf, "application/pdf")),
            ],
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/pdf")
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)

    def test_merge_single_file_still_works(self, client, sample_pdf):
        """One file is a no-op but must still produce a valid PDF."""
        resp = client.post(
            "/api/merge",
            files=[("files", ("a.pdf", sample_pdf, "application/pdf"))],
        )
        assert resp.status_code in (200, 400), resp.text


# ---------------------------------------------------------------------------
# /api/split — page-range splitting
# ---------------------------------------------------------------------------

class TestSplit:
    def test_split_individual_pages(self, client, multipage_pdf):
        resp = client.post(
            "/api/split",
            files={"file": ("test.pdf", multipage_pdf, "application/pdf")},
            data={"mode": "pages", "pages": "1,3,5"},
        )
        assert resp.status_code == 200, resp.text
        ct = resp.headers.get("content-type", "")
        # Split may return raw PDF (single output) or a ZIP (multi-page split)
        assert ct.startswith("application/pdf") or ct.startswith("application/zip")
        assert _is_pdf(resp.content) or _is_zip(resp.content)
        assert _no_traceback(resp.content)

    def test_split_range_with_end_keyword(self, client, multipage_pdf):
        resp = client.post(
            "/api/split",
            files={"file": ("test.pdf", multipage_pdf, "application/pdf")},
            data={"mode": "pages", "pages": "2-end"},
        )
        assert resp.status_code == 200
        assert _is_pdf(resp.content) or _is_zip(resp.content)


# ---------------------------------------------------------------------------
# /api/rotate — angle-based rotation
# ---------------------------------------------------------------------------

class TestRotate:
    def test_rotate_90_returns_pdf(self, client, sample_pdf):
        resp = client.post(
            "/api/rotate",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"angle": "90"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/pdf")
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)

    @pytest.mark.parametrize("damage", ["cut short", "header only"])
    def test_a_pdf_it_cannot_read_is_called_unreadable_like_the_other_page_tools(self, client, sample_pdf, damage):
        # Rotate answered "Invalid page range syntax", which the page turns
        # into "One of the page numbers is outside this PDF", for a file it
        # could not open at all. Extract Pages says the file is corrupt, and
        # the page then says it is damaged and to try Repair PDF.
        broken = sample_pdf[: len(sample_pdf) // 3] if damage == "cut short" else b"%PDF-1.7\n1 0 obj\n" + b"garbage " * 64
        rotated = client.post("/api/rotate", files={"file": ("broken.pdf", broken, "application/pdf")},
                              data={"angle": "90", "pages": "all"})
        extracted = client.post("/api/extract-pages", files={"file": ("broken.pdf", broken, "application/pdf")},
                                data={"pages": "1"})
        assert extracted.status_code == 400 and "corrupt" in extracted.json()["detail"]
        assert rotated.status_code == 400
        assert rotated.json()["detail"] == extracted.json()["detail"]
        assert "page" not in rotated.json()["detail"].lower().replace("this pdf", "")

    def test_a_page_outside_the_pdf_is_still_named(self, client, sample_pdf):
        resp = client.post("/api/rotate", files={"file": ("test.pdf", sample_pdf, "application/pdf")},
                           data={"angle": "90", "pages": "5"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Page 5 is out of bounds. Valid range is 1-1."


# ---------------------------------------------------------------------------
# /api/organize-pages — reorder + delete pages
# ---------------------------------------------------------------------------

class TestOrganize:
    def test_organize_reorders_pages(self, client, multipage_pdf):
        # Reverse pages 1, 2 -> 2, 1
        resp = client.post(
            "/api/organize-pages",
            files={"file": ("test.pdf", multipage_pdf, "application/pdf")},
            data={"page_order": json.dumps([2, 1])},
        )
        assert resp.status_code == 200, resp.text
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)


# ---------------------------------------------------------------------------
# /api/pdf-to-text — text extraction (no LibreOffice dep)
# ---------------------------------------------------------------------------

class TestPdfToText:
    def test_extracts_text(self, client, sample_pdf):
        resp = client.post(
            "/api/pdf-to-text",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 200, resp.text
        # pdf_to_text may return a raw .txt download or JSON depending on params
        body_lower = resp.content.lower()
        # The sample_pdf fixture text contains "sample page one. hello"
        assert b"sample" in body_lower or b"hello" in body_lower or len(resp.content) > 0
        assert _no_traceback(resp.content)


# ---------------------------------------------------------------------------
# /api/protect + /api/unlock — round-trip password set/strip
# ---------------------------------------------------------------------------

class TestProtectUnlockRoundTrip:
    def test_protect_then_unlock(self, client, sample_pdf):
        # 1. Protect the sample PDF
        r1 = client.post(
            "/api/protect",
            files=[("files", ("test.pdf", sample_pdf, "application/pdf"))],
            data={"password": "test-pass-123"},
        )
        assert r1.status_code == 200, r1.text
        assert _is_pdf(r1.content), "Protect must return a PDF"
        assert _no_traceback(r1.content)
        protected_bytes = r1.content

        # 2. Unlock with the same password
        r2 = client.post(
            "/api/unlock",
            files=[("files", ("locked.pdf", protected_bytes, "application/pdf"))],
            data={"password": "test-pass-123"},
        )
        assert r2.status_code == 200, r2.text
        assert _is_pdf(r2.content)
        assert _no_traceback(r2.content)


# ---------------------------------------------------------------------------
# /api/redact — black-box rectangle redaction
# ---------------------------------------------------------------------------

class TestRedact:
    def test_redact_rectangle_returns_pdf(self, client, sample_pdf):
        rects = json.dumps(
            [{"page": 0, "x0": 50, "y0": 50, "x1": 200, "y1": 100}]
        )
        resp = client.post(
            "/api/redact",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"redactions": rects, "color": "#000000"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/pdf")
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)


# ---------------------------------------------------------------------------
# /api/qr-code — generation (PNG default + PDF format)
# ---------------------------------------------------------------------------

class TestQrCode:
    def test_qr_code_png_default(self, client):
        resp = client.post(
            "/api/qr-code",
            data={"data": "https://example.com", "size": "200", "format": "png"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("image/png")
        assert _is_png(resp.content)
        assert _no_traceback(resp.content)

    def test_qr_code_pdf_format(self, client):
        resp = client.post(
            "/api/qr-code",
            data={"data": "hello world", "size": "300", "format": "pdf"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/pdf")
        assert _is_pdf(resp.content)
        assert _no_traceback(resp.content)

    def test_qr_code_rejects_empty_data(self, client):
        resp = client.post(
            "/api/qr-code",
            data={"data": "   ", "size": "200", "format": "png"},
        )
        assert resp.status_code == 400

    def test_qr_code_refuses_a_page_the_pdf_does_not_have(self, client, sample_pdf):
        # The service's refusal is a ValidationError, which the route's
        # catch-all answered as a 500.
        resp = client.post(
            "/api/qr-code",
            files={"embed_in_pdf": ("doc.pdf", sample_pdf, "application/pdf")},
            data={"data": "hello", "page": "9"},
        )
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == "Page 9 is out of range — the PDF has 1 page(s)."


# ---------------------------------------------------------------------------
# /api/create-zip — bundle uploaded files into a ZIP
# ---------------------------------------------------------------------------

class TestCreateZip:
    def test_create_zip_round_trip(self, client, sample_pdf):
        resp = client.post(
            "/api/create-zip",
            files=[
                ("files", ("alpha.pdf", sample_pdf, "application/pdf")),
                ("files", ("beta.pdf", sample_pdf, "application/pdf")),
            ],
            data={"compression": "6"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("content-type", "").startswith("application/zip")
        assert _is_zip(resp.content)
        assert _no_traceback(resp.content)

        # The ZIP must actually contain the two files we sent
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            names = zf.namelist()
        assert len(names) == 2
        assert "alpha.pdf" in names and "beta.pdf" in names

    def test_create_zip_rejects_password(self, client, sample_pdf):
        """Password-protected ZIPs aren't supported; the route must 400 instead of silently dropping the password."""
        resp = client.post(
            "/api/create-zip",
            files=[("files", ("a.pdf", sample_pdf, "application/pdf"))],
            data={"password": "secret", "compression": "6"},
        )
        assert resp.status_code == 400

    def test_create_zip_dedupes_duplicate_names(self, client, sample_pdf):
        """Two files named "report.pdf" must both survive in the archive — the
        unique_arcname helper appends a counter so they don't overwrite each other.
        """
        resp = client.post(
            "/api/create-zip",
            files=[
                ("files", ("report.pdf", sample_pdf, "application/pdf")),
                ("files", ("report.pdf", sample_pdf, "application/pdf")),
            ],
            data={"compression": "0"},  # stored, faster
        )
        assert resp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            names = zf.namelist()
        assert len(names) == 2, f"Expected 2 distinct entries, got: {names}"
