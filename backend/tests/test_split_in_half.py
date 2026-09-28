"""Split in Half cuts the page as it is shown.

The service took each page's MediaBox as stored and set the halves with
PyMuPDF's set_cropbox, which reads its rectangle from the top of the MediaBox
and then checks it against the MediaBox's own numbers. On a page whose
MediaBox does not start at y 0 (what cropping tools and some scanners write)
that check failed, and the visitor read "CropBox not in MediaBox": a 400 for
every such file, on privatools.me too. Where it worked, it cut the MediaBox
rather than the visible page, ignoring a CropBox, and cut the page as stored,
so a spread stored with /Rotate 90 came back as its top and bottom halves; a
horizontal cut gave the bottom half first, though the page promises top, then
bottom.

These fixtures put a label in each corner of the page as shown, on every
geometry a real file has: MediaBox origins that are not 0,0, CropBoxes inside
and beyond the MediaBox, and /Rotate 90, 180, 270, written as -90, and
inherited from the page tree.
"""

from __future__ import annotations

import io

import fitz  # PyMuPDF
import pikepdf
import pytest
from PIL import Image, ImageChops, ImageStat

# name: (MediaBox, CropBox or None, /Rotate as written, /Rotate on the page tree instead)
CASES = {
    "plain": ((0, 0, 612, 792), None, None, False),
    "mediabox-starts-above-0": ((0, 100, 612, 892), None, None, False),
    "mediabox-negative-origin": ((-20, -30, 592, 762), None, None, False),
    "cropbox-inside": ((0, 0, 612, 792), (36, 50, 560, 740), None, False),
    "cropbox-beyond-mediabox": ((0, 0, 612, 792), (-10, -10, 700, 900), None, False),
    "rotate-90": ((0, 0, 612, 792), None, 90, False),
    "rotate-180": ((0, 0, 612, 792), None, 180, False),
    "rotate-270": ((0, 0, 612, 792), None, 270, False),
    "rotate-minus-90": ((0, 0, 612, 792), None, -90, False),
    "rotate-90-inherited": ((0, 0, 612, 792), None, 90, True),
    "rotate-90-offset-boxes": ((0, 100, 612, 892), (20, 130, 600, 880), 90, False),
}

# The user-space corner of the visible area that shows at each corner of the
# page, for each /Rotate (clockwise): (x side, y side) as "min" or "max".
_SHOWN_CORNERS = {
    0: {"TL": ("min", "max"), "TR": ("max", "max"), "BL": ("min", "min"), "BR": ("max", "min")},
    90: {"TL": ("min", "min"), "TR": ("min", "max"), "BL": ("max", "min"), "BR": ("max", "max")},
    180: {"TL": ("max", "min"), "TR": ("min", "min"), "BL": ("max", "max"), "BR": ("min", "max")},
    270: {"TL": ("max", "max"), "TR": ("max", "min"), "BL": ("min", "max"), "BR": ("min", "min")},
}


def _visible(media, crop):
    if crop is None:
        return media
    x0, y0 = max(media[0], crop[0]), max(media[1], crop[1])
    x1, y1 = min(media[2], crop[2]), min(media[3], crop[3])
    return (x0, y0, x1, y1)


def _labelled_pdf(media, crop, rotate, inherited) -> bytes:
    """One page: a label near each corner as shown, and a grey grid over the
    whole visible area so renders have something to compare."""
    x0, y0, x1, y1 = _visible(media, crop)
    shown = (rotate or 0) % 360
    inset = 40
    ops = ["0.6 g"]
    step = 24
    x = x0
    while x < x1:  # vertical stripes of varying width
        ops.append(f"{x} {y0} {step / 3 + (x - x0) % 7} {y1 - y0} re f")
        x += step
    ops.append("0 g")
    for label, (xs, ys) in _SHOWN_CORNERS[shown].items():
        px = x0 + inset if xs == "min" else x1 - inset
        py = y0 + inset if ys == "min" else y1 - inset
        ops.append(f"BT /F1 18 Tf {px} {py} Td ({label}) Tj ET")
    with pikepdf.new() as pdf:
        font = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
        page = pdf.add_blank_page(page_size=(612, 792))
        page.obj.MediaBox = pikepdf.Array(media)
        if crop is not None:
            page.obj.CropBox = pikepdf.Array(crop)
        page.obj.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        page.obj.Contents = pdf.make_stream("\n".join(ops).encode())
        if rotate is not None:
            if inherited:
                pdf.Root.Pages.Rotate = rotate
            else:
                page.obj.Rotate = rotate
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


def _labels(page: fitz.Page) -> set[str]:
    return {w[4] for w in page.get_text("words") if w[4] in {"TL", "TR", "BL", "BR"}}


def _render(page: fitz.Page) -> Image.Image:
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _split(client, data: bytes, direction: str) -> fitz.Document:
    resp = client.post("/api/split-in-half", files={"file": ("spread.pdf", data, "application/pdf")},
                       data={"direction": direction})
    assert resp.status_code == 200, resp.text[:300]
    return fitz.open(stream=resp.content, filetype="pdf")


@pytest.mark.parametrize("case", sorted(CASES))
def test_the_fixture_shows_each_label_in_its_corner(case):
    """The fixtures themselves: each label lands in its corner as shown.
    PyMuPDF gives word positions on the page before /Rotate; the rotation
    matrix turns them the way the page is shown."""
    doc = fitz.open(stream=_labelled_pdf(*CASES[case]), filetype="pdf")
    page = doc[0]
    rect = page.rect
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        shown = fitz.Rect(x0, y0, x1, y1) * page.rotation_matrix
        cx, cy = (shown.x0 + shown.x1) / 2, (shown.y0 + shown.y1) / 2
        assert (cx < rect.width / 2) == (word[1] == "L"), (case, word, cx, rect)
        assert (cy < rect.height / 2) == (word[0] == "T"), (case, word, cy, rect)


@pytest.mark.parametrize("direction, first, second", [
    ("vertical", {"TL", "BL"}, {"TR", "BR"}),
    ("horizontal", {"TL", "TR"}, {"BL", "BR"}),
])
@pytest.mark.parametrize("case", sorted(CASES))
def test_each_page_becomes_its_two_halves_as_shown_in_reading_order(client, case, direction, first, second):
    source = fitz.open(stream=_labelled_pdf(*CASES[case]), filetype="pdf")
    shown = source[0].rect
    out = _split(client, _labelled_pdf(*CASES[case]), direction)
    assert len(out) == 2
    assert _labels(out[0]) == first, (case, direction)
    assert _labels(out[1]) == second, (case, direction)
    # Each half is half the page as shown, the right way up.
    for half in out:
        if direction == "vertical":
            assert half.rect.width == pytest.approx(shown.width / 2, abs=0.01)
            assert half.rect.height == pytest.approx(shown.height, abs=0.01)
        else:
            assert half.rect.width == pytest.approx(shown.width, abs=0.01)
            assert half.rect.height == pytest.approx(shown.height / 2, abs=0.01)


@pytest.mark.parametrize("direction", ["vertical", "horizontal"])
@pytest.mark.parametrize("case", sorted(CASES))
def test_the_halves_look_exactly_like_the_halves_of_the_page(client, case, direction):
    data = _labelled_pdf(*CASES[case])
    whole = _render(fitz.open(stream=data, filetype="pdf")[0])
    out = _split(client, data, direction)
    w, h = whole.size
    boxes = [(0, 0, w // 2, h), (w // 2, 0, w, h)] if direction == "vertical" else [(0, 0, w, h // 2), (0, h // 2, w, h)]
    for half, box in zip(out, boxes):
        expected = whole.crop(box)
        got = _render(half)
        assert abs(got.width - expected.width) <= 1 and abs(got.height - expected.height) <= 1, (got.size, expected.size)
        got = got.crop((0, 0, min(got.width, expected.width), min(got.height, expected.height)))
        expected = expected.crop((0, 0, got.width, got.height))
        mean_difference = sum(ImageStat.Stat(ImageChops.difference(got, expected)).mean) / 3
        assert mean_difference < 1.0, (case, direction, mean_difference)


def test_every_page_is_split_in_order(client):
    doc = fitz.open()
    for n in range(3):
        page = doc.new_page(width=842, height=595)
        page.insert_text((60, 300), f"P{n + 1}-LEFT", fontsize=20)
        page.insert_text((480, 300), f"P{n + 1}-RIGHT", fontsize=20)
    out = _split(client, doc.tobytes(), "vertical")
    words = [" ".join(w[4] for w in page.get_text("words")) for page in out]
    assert words == ["P1-LEFT", "P1-RIGHT", "P2-LEFT", "P2-RIGHT", "P3-LEFT", "P3-RIGHT"]


def test_an_invalid_direction_is_refused(client):
    doc = fitz.open()
    doc.new_page()
    resp = client.post("/api/split-in-half", files={"file": ("a.pdf", doc.tobytes(), "application/pdf")},
                       data={"direction": "diagonal"})
    assert resp.status_code == 400
