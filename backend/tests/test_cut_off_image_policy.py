"""Every worker refuses a cut-off picture, before and after WeasyPrint loads.

WeasyPrint sets PIL.ImageFile.LOAD_TRUNCATED_IMAGES for the whole process
when it is first imported. After the first HTML or URL to PDF request in a
worker, a cut-off upload converted with a 200 and blank pixels where its data
stopped (a HEIC came back wholly black), while a fresh worker answered 400.
Pillow's default, which refuses it, now holds in every worker: WeasyPrint is
only imported through utils.weasyprint_loader, which puts the default back.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageFile

from backend.app import main
from backend.app.services import html_to_pdf_service as html_service
from backend.app.services import url_to_pdf_service as url_service

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _cut_off_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 30, 30)).save(buf, "PNG")
    data = buf.getvalue()
    return data[: len(data) // 2]


def _weasyprint_renders() -> None:
    if html_service._weasyprint_ok is not True:
        pytest.skip("WeasyPrint's native libraries are not available here")


def test_a_cut_off_upload_is_refused_after_a_weasyprint_conversion(quiet_client):
    rendered = quiet_client.post("/api/html-to-pdf", data={"html_content": "<h1>Rendered by WeasyPrint</h1>"})
    assert rendered.status_code == 200, rendered.text
    _weasyprint_renders()

    response = quiet_client.post(
        "/api/image-converter", files={"file": ("cut.png", _cut_off_png(), "image/png")}, data={"target_format": "jpeg"},
    )
    assert response.status_code == 400, response.text
    assert "stops early or is broken" in response.json()["detail"]
    assert ImageFile.LOAD_TRUNCATED_IMAGES is False


def test_nothing_imports_weasyprint_but_the_loader():
    importing = re.compile(r"^\s*(import weasyprint|from weasyprint\b)", re.MULTILINE)
    loader = BACKEND / "app" / "utils" / "weasyprint_loader.py"
    offenders = [
        str(path.relative_to(BACKEND))
        for path in sorted(BACKEND.rglob("*.py"))
        if path != loader and importing.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], f"import WeasyPrint through utils.weasyprint_loader: {offenders}"


def test_a_cut_off_png_in_html_is_left_out_and_the_page_still_converts(tmp_path, monkeypatch):
    """WeasyPrint decodes a PNG while it writes the PDF, outside the code that
    leaves out a picture it cannot read: with the default restored, one
    cut-off PNG failed the whole conversion, and the OSError also marked
    WeasyPrint unavailable for the rest of the worker's life."""
    monkeypatch.setattr(html_service, "_weasyprint_ok", None)
    uri = "data:image/png;base64," + base64.b64encode(_cut_off_png()).decode()
    output = tmp_path / "page.pdf"
    try:
        html_service._weasyprint_html_to_pdf(f'<h1>Before</h1><img src="{uri}"><p>After</p>', str(output))
    except (ImportError, OSError) as exc:
        if html_service._weasyprint_ok is False and isinstance(exc, ImportError):
            pytest.skip(f"WeasyPrint's native libraries are not available here: {exc}")
        raise
    assert html_service._weasyprint_ok is True
    with fitz.open(output) as document:
        text = document[0].get_text()
        assert "Before" in text and "After" in text
        assert not document[0].get_images()


def test_a_cut_off_png_on_a_web_page_is_left_out(tmp_path, monkeypatch):
    from backend.app.utils import cleanup

    cut = _cut_off_png()

    def serve(url, **kwargs):
        if url.endswith("/picture.png"):
            return html_service._FetchResult(url, "image/png", None, cut)
        return html_service._FetchResult(
            url, "text/html", "utf-8", b'<h1>Public page</h1><img src="/picture.png"><p>Footer</p>')

    monkeypatch.setattr(html_service, "safe_url_fetch", serve)
    monkeypatch.setattr(cleanup, "TEMP_DIR", tmp_path)
    try:
        output = url_service.url_to_pdf("http://93.184.216.34/page")
    except Exception as exc:  # no native WeasyPrint here
        if "WeasyPrint is not available" in str(exc):
            pytest.skip(str(exc))
        raise
    with fitz.open(output) as document:
        text = document[0].get_text()
        assert "Public page" in text and "Footer" in text
        assert not document[0].get_images()


def test_a_rendering_error_does_not_switch_the_worker_to_pymupdf(monkeypatch):
    """Only a WeasyPrint that cannot load means it is unavailable; one page
    that fails to render must not send every later page to PyMuPDF."""
    from backend.app.utils.weasyprint_loader import load_weasyprint

    try:
        weasyprint = load_weasyprint()
    except (ImportError, OSError) as exc:
        pytest.skip(f"WeasyPrint's native libraries are not available here: {exc}")

    def broken_render(self, *args, **kwargs):
        raise OSError("a rendering error")

    monkeypatch.setattr(html_service, "_weasyprint_ok", None)
    monkeypatch.setattr(weasyprint.HTML, "write_pdf", broken_render)
    output = html_service.html_to_pdf("<p>This page falls back to PyMuPDF.</p>")
    Path(output).unlink(missing_ok=True)
    assert html_service._weasyprint_ok is not False


def _png_with_broken_data() -> bytes:
    """A PNG whose chunks and checksums are whole but whose compressed pixel
    data is not: verify() passes it, decoding it fails."""
    import struct
    import zlib

    width, height = 64, 48
    rows = b"".join(b"\x00" + bytes((200, 30, 30)) * width for _ in range(height))
    data = bytearray(zlib.compress(rows))
    for i in range(10, len(data) - 4, 7):
        data[i] ^= 0x5A

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", bytes(data)) + chunk(b"IEND", b"")


def test_a_png_whose_data_is_broken_is_left_out_too(tmp_path, monkeypatch):
    """Its chunks are whole, so verify() let it through and WeasyPrint failed
    the page when it decoded it (HTML to PDF's PyMuPDF fallback then failed
    too, a 500; URL to PDF answered 500)."""
    monkeypatch.setattr(html_service, "_weasyprint_ok", None)
    uri = "data:image/png;base64," + base64.b64encode(_png_with_broken_data()).decode()
    output = tmp_path / "page.pdf"
    try:
        html_service._weasyprint_html_to_pdf(f'<h1>Before</h1><img src="{uri}"><p>After</p>', str(output))
    except ImportError as exc:
        pytest.skip(f"WeasyPrint's native libraries are not available here: {exc}")
    with fitz.open(output) as document:
        assert "Before" in document[0].get_text() and "After" in document[0].get_text()
        assert not document[0].get_images()
