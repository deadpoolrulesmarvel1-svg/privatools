"""A page too large for the render cap is drawn at the largest size that fits.

safe_get_pixmap refuses a render over MAX_PIXMAP_PIXELS (100 MP) before it
allocates, which protects the workers' memory. PDF to PNG and the other PDF to
Image pages, Invert Colors and Deskew met it with a 500 ("Processing failed.
Please try again."), and nothing the visitor could change would help: a 24 MP
phone photo made into a PDF page the size of its pixels, which is what Image
to PDF's default "Auto" page size does, is 6000 x 4000 points, 104 MP at
150 DPI. Those pages are now rendered at the largest resolution that fits
the cap; every other page is rendered exactly as before. The multi-page TIFF,
which holds every page in memory at once, still refuses such a page, now
with a 400 that says so.

The cap is lowered here so the renders stay small; the services read it when
they run.
"""

from __future__ import annotations

import io
import zipfile

import fitz  # PyMuPDF
import pytest
from PIL import Image

from backend.app.utils import render

CAP = 3_000_000  # pixels, for these tests: above a Letter page at 150 DPI (2.1 MP)


@pytest.fixture
def small_cap(monkeypatch):
    monkeypatch.setattr(render, "MAX_PIXMAP_PIXELS", CAP)
    return CAP


def _pdf(pages: int, width: float, height: float, *, tilt: float = 0.0) -> bytes:
    doc = fitz.open()
    for n in range(pages):
        page = doc.new_page(width=width, height=height)
        for i in range(12):
            y = 60 + i * (height - 120) / 12
            page.insert_text((60, y), f"Page {n + 1} line {i + 1} " * 3, fontsize=max(10, width / 60),
                             morph=(fitz.Point(60, y), fitz.Matrix(tilt)) if tilt else None)
    data = doc.tobytes()
    doc.close()
    return data


def _post(client, route, data, form):
    return client.post(route, files={"file": ("photos.pdf", data, "application/pdf")}, data=form)


def test_fitted_zoom_leaves_normal_pages_alone_and_fits_large_ones(small_cap):
    doc = fitz.open()
    doc.new_page(width=400, height=300)
    doc.new_page(width=4000, height=3000)
    small, large = doc[0], doc[1]
    assert render.fitted_zoom(small, 150 / 72) == 150 / 72  # 833 x 625 = 0.52 MP
    z = render.fitted_zoom(large, 150 / 72)
    assert z < 150 / 72
    assert 0.99 * CAP <= (4000 * z) * (3000 * z) <= CAP


@pytest.mark.parametrize("pages", [1, 4])  # one page, and the parallel path
@pytest.mark.parametrize("fmt", ["png", "jpeg"])
def test_pdf_to_image_renders_an_oversized_page_within_the_cap(client, small_cap, fmt, pages):
    resp = _post(client, "/api/pdf-to-image", _pdf(pages, 1500, 1000), {"format": fmt, "dpi": "150"})
    assert resp.status_code == 200, resp.text[:200]
    if pages == 1:
        images = [resp.content]
    else:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            images = [zf.read(name) for name in sorted(zf.namelist())]
    assert len(images) == pages
    for data in images:
        w, h = Image.open(io.BytesIO(data)).size
        assert 0.98 * CAP <= w * h <= CAP * 1.01, (w, h)
        assert w / h == pytest.approx(1.5, rel=0.01)


def test_pdf_to_image_renders_normal_pages_as_before(client, small_cap):
    resp = _post(client, "/api/pdf-to-image", _pdf(1, 612, 792), {"format": "png", "dpi": "150"})
    assert resp.status_code == 200
    assert Image.open(io.BytesIO(resp.content)).size == (1275, 1650)


def test_the_multi_page_tiff_still_refuses_an_oversized_page_with_a_400(client, small_cap):
    resp = _post(client, "/api/pdf-to-image", _pdf(2, 1500, 1000), {"format": "tiff", "dpi": "200"})
    assert resp.status_code == 400, resp.text[:200]
    assert "too large to render" in resp.json()["detail"]


def _embedded_pixels(pdf: bytes) -> list[int]:
    doc = fitz.open(stream=pdf, filetype="pdf")
    sizes = []
    for page in doc:
        for info in page.get_images(full=True):
            sizes.append(info[2] * info[3])
    return sizes


@pytest.mark.parametrize("pages", [1, 3])  # sequential and parallel paths
def test_invert_colors_renders_an_oversized_page_within_the_cap(client, small_cap, pages):
    resp = _post(client, "/api/invert-colors", _pdf(pages, 1500, 1000), {"dpi": "150"})
    assert resp.status_code == 200, resp.text[:200]
    sizes = _embedded_pixels(resp.content)
    assert len(sizes) == pages
    assert all(0.98 * CAP <= s <= CAP * 1.01 for s in sizes), sizes


@pytest.mark.parametrize("pages", [1, 3])  # the 200 DPI and 100 DPI paths
def test_deskew_straightens_an_oversized_tilted_page_within_the_cap(client, small_cap, pages):
    resp = _post(client, "/api/deskew", _pdf(pages, 2200, 1600, tilt=3), {})
    assert resp.status_code == 200, resp.text[:200]
    sizes = _embedded_pixels(resp.content)
    assert len(sizes) == pages  # every page was tilted, so every page became a picture
    assert all(s <= CAP * 1.2 for s in sizes), sizes  # the turned picture is a little larger than the render
