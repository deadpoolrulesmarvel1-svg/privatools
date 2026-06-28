"""Tests for the PDF → Long Image tool (stitch all pages into one image)."""
import io

from PIL import Image

_ENDPOINT = "/api/pdf-to-long-image"


def test_stitches_pages_into_one_tall_png(client, multipage_pdf):
    resp = client.post(
        _ENDPOINT,
        files={"file": ("doc.pdf", multipage_pdf, "application/pdf")},
        data={"format": "png", "dpi": "72"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    body = resp.content
    assert body[:8] == b"\x89PNG\r\n\x1a\n"  # PNG signature
    img = Image.open(io.BytesIO(body))
    # 10 portrait pages stacked vertically → clearly taller than it is wide.
    assert img.height > img.width


def test_jpeg_output(client, multipage_pdf):
    resp = client.post(
        _ENDPOINT,
        files={"file": ("doc.pdf", multipage_pdf, "application/pdf")},
        data={"format": "jpg", "dpi": "72"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content[:3] == b"\xff\xd8\xff"  # JPEG SOI marker


def test_rejects_non_pdf(client):
    resp = client.post(
        _ENDPOINT,
        files={"file": ("x.txt", b"not a pdf", "text/plain")},
    )
    assert resp.status_code == 400
