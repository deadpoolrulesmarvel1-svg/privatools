"""Edit-PDF service — draw branches render into the output content stream.

Each case builds a one-page PDF, applies one edit type, and asserts the
output both survives a strict reparse and gained a visible content stream.
Pen and arrow are the newest branches; the older types get a smoke row so a
regression in the shared canvas plumbing is caught here too.
"""
import io

import pikepdf
import pytest

from backend.app.services import edit_pdf_service
from backend.app.routes.edit_pdf import _sanitize_edits


def _blank_pdf(tmp_path):
    path = tmp_path / "blank.pdf"
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(612, 792))
    pdf.save(str(path))
    return str(path)


def _page_stream_len(path: str) -> int:
    with pikepdf.open(path) as pdf:
        page = pdf.pages[0]
        contents = page.obj.get("/Contents")
        if contents is None:
            return 0
        if isinstance(contents, pikepdf.Array):
            return sum(len(bytes(c.read_bytes())) for c in contents)
        return len(bytes(contents.read_bytes()))


@pytest.mark.parametrize(
    "edit",
    [
        {"type": "text", "page": 1, "x": 50, "y": 700, "text": "hello", "font_size": 14,
         "color": "#000000", "font_family": "Helvetica"},
        {"type": "line", "page": 1, "x1": 10, "y1": 10, "x2": 200, "y2": 120,
         "color": "#2563eb", "stroke_width": 2},
        {"type": "arrow", "page": 1, "x1": 40, "y1": 40, "x2": 300, "y2": 220,
         "color": "#dc2626", "stroke_width": 3},
        {"type": "pen", "page": 1, "color": "#16a34a", "stroke_width": 3,
         "points": [[10, 10], [40, 60], [90, 55], [140, 120], [180, 90]]},
    ],
    ids=["text", "line", "arrow", "pen"],
)
def test_edit_types_render(tmp_path, edit):
    src = _blank_pdf(tmp_path)
    out = edit_pdf_service.edit_pdf(src, [edit])
    assert _page_stream_len(out) > _page_stream_len(src)
    with pikepdf.open(out) as pdf:  # strict reparse — output is a valid PDF
        assert len(pdf.pages) == 1


def test_pen_ignores_malformed_points(tmp_path):
    src = _blank_pdf(tmp_path)
    edit = {"type": "pen", "page": 1, "color": "#000000", "stroke_width": 2,
            "points": [[10, 10], "junk", [None, 5], [60, 80], [110, 40]]}
    out = edit_pdf_service.edit_pdf(src, [edit])
    assert _page_stream_len(out) > 0  # the valid points still draw


def test_pen_single_point_is_a_noop(tmp_path):
    # One point can't make a stroke; the service must not crash on it.
    src = _blank_pdf(tmp_path)
    out = edit_pdf_service.edit_pdf(src, [{"type": "pen", "page": 1, "points": [[10, 10]]}])
    with pikepdf.open(out) as pdf:
        assert len(pdf.pages) == 1


def test_sanitize_accepts_pen_and_arrow():
    edits = [
        {"type": "arrow", "x1": 0, "y1": 0, "x2": 10, "y2": 10},
        {"type": "pen", "points": [[1, 2], [3, 4]]},
    ]
    assert len(_sanitize_edits(edits)) == 2


def test_sanitize_drops_pen_without_points():
    assert _sanitize_edits([{"type": "pen"}]) == []
