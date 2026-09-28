"""Auto Crop keeps what is on the page, whatever the page's geometry.

It found the text and images on a page in PyMuPDF's coordinates, which are
the page before /Rotate, measured from the visible area's top-left corner;
clamped them to page.rect, which is the page after /Rotate; and handed the
result to set_cropbox, which reads its rectangle from the MediaBox's top. On
a scan stored with /Rotate 90 or 270, or a page whose MediaBox does not start
at 0,0, the box fell outside the MediaBox: "CropBox not in MediaBox", a 500
("Processing failed. Please try again."), three times over, as the page
retries a 500. Where the numbers happened to fit, the crop was shifted by the
CropBox's offset and could cut text off.
"""

from __future__ import annotations

import io

import fitz  # PyMuPDF
import pikepdf
import pytest

from backend.tests.test_split_in_half import CASES, _visible

MARGIN = 20


def _paragraph_pdf(media, crop, rotate, inherited, *, image=False) -> bytes:
    """A few lines of text (or one picture) well inside the visible area."""
    x0, y0, x1, y1 = _visible(media, crop)
    ops = []
    if image:
        ops.append(f"q {x1 - x0 - 200} 0 0 {y1 - y0 - 240} {x0 + 100} {y0 + 120} cm /Im1 Do Q")
    else:
        for n in range(4):
            ops.append(f"BT /F1 14 Tf {x0 + 150} {y0 + 400 - 20 * n} Td (Line {n + 1} of the paragraph) Tj ET")
    with pikepdf.new() as pdf:
        font = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
        resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        if image:
            resources.XObject = pikepdf.Dictionary(Im1=pdf.make_stream(
                bytes([90, 90, 90]) * 4, Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=2,
                Height=2, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8))
        page = pdf.add_blank_page(page_size=(612, 792))
        page.obj.MediaBox = pikepdf.Array(media)
        if crop is not None:
            page.obj.CropBox = pikepdf.Array(crop)
        page.obj.Resources = resources
        page.obj.Contents = pdf.make_stream("\n".join(ops).encode())
        if rotate is not None:
            if inherited:
                pdf.Root.Pages.Rotate = rotate
            else:
                page.obj.Rotate = rotate
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


def _content_in_user_space(data: bytes) -> tuple[float, float, float, float]:
    """The union of the page's text and image blocks, in PDF user space.
    PyMuPDF measures them on the page before /Rotate, from the visible
    area's top-left corner."""
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc[0]
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pg = pdf.pages[0]
        media = [float(v) for v in pg.mediabox]
        crop = [float(v) for v in pg.cropbox]
    vx0, vy0, vx1, vy1 = _visible(tuple(media), tuple(crop))
    union = None
    for block in page.get_text("dict")["blocks"]:
        r = fitz.Rect(block["bbox"])
        union = r if union is None else union | r
    return (vx0 + union.x0, vy1 - union.y1, vx0 + union.x1, vy1 - union.y0)


def _cropbox(data: bytes) -> tuple[float, float, float, float]:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pg = pdf.pages[0]
        media = [float(v) for v in pg.mediabox]
        crop = [float(v) for v in pg.cropbox]
    return _visible(tuple(media), tuple(crop))


def _auto_crop(client, data: bytes) -> bytes:
    resp = client.post("/api/auto-crop", files={"file": ("scan.pdf", data, "application/pdf")})
    assert resp.status_code == 200, resp.text[:300]
    return resp.content


@pytest.mark.parametrize("image", [False, True], ids=["text", "picture"])
@pytest.mark.parametrize("case", sorted(CASES))
def test_the_crop_is_the_content_plus_the_margin_on_every_geometry(client, case, image):
    data = _paragraph_pdf(*CASES[case], image=image)
    content = _content_in_user_space(data)
    before = _visible(*CASES[case][:2])
    after = _cropbox(_auto_crop(client, data))
    expected = (
        max(before[0], content[0] - MARGIN), max(before[1], content[1] - MARGIN),
        min(before[2], content[2] + MARGIN), min(before[3], content[3] + MARGIN),
    )
    assert after == pytest.approx(expected, abs=0.01), (case, after, expected)


@pytest.mark.parametrize("case", sorted(CASES))
def test_nothing_is_cut_off_and_the_page_keeps_its_turn(client, case):
    data = _paragraph_pdf(*CASES[case])
    out = fitz.open(stream=_auto_crop(client, data), filetype="pdf")
    src = fitz.open(stream=data, filetype="pdf")
    page = out[0]
    assert page.rotation == src[0].rotation
    # Every line is still there, fully inside what shows.
    words = page.get_text("words")
    assert " ".join(w[4] for w in words) == " ".join(w[4] for w in src[0].get_text("words"))
    width, height = page.rect.width, page.rect.height
    if page.rotation in (90, 270):
        width, height = height, width
    for x0, y0, x1, y1, *_ in words:
        assert -0.01 <= x0 and x1 <= width + 0.01 and -0.01 <= y0 and y1 <= height + 0.01, (case, (x0, y0, x1, y1), width, height)


def test_a_scanned_spread_stored_turned_is_accepted(client):
    """The shape that failed on privatools.me: a full-page picture on a page
    stored portrait and shown landscape with /Rotate 90."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=_jpeg(), keep_proportion=False)  # a scan fills its page
    page.set_rotation(90)
    out = fitz.open(stream=_auto_crop(client, doc.tobytes()), filetype="pdf")
    # A full-page picture leaves nothing to trim.
    assert tuple(round(v) for v in out[0].cropbox) == (0, 0, 595, 842)
    assert out[0].rotation == 90


def test_pages_with_nothing_found_are_left_as_they_were(client):
    doc = fitz.open()
    doc.new_page(width=612, height=792)  # blank
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 100), "Only line", fontsize=12)
    out = fitz.open(stream=_auto_crop(client, doc.tobytes()), filetype="pdf")
    assert tuple(out[0].cropbox) == (0, 0, 612, 792)
    assert out[1].cropbox.width < 612


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 40), (200, 200, 200)).save(buf, "JPEG")
    return buf.getvalue()
