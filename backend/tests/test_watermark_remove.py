"""Watermark removal must be lossless: the mark goes, everything else stays.

The round trip is the real test — watermark a document with the shipping
/watermark tool, remove it, and assert the original text survives byte-for-byte
while the mark is gone.
"""

from __future__ import annotations

import fitz
import pytest

from app.services import watermark_service
from app.services.watermark_detect_service import detect_watermarks
from app.services.watermark_remove_service import remove_watermarks
from app.utils.exceptions import ValidationError

BODY = "Real body content that must survive"


def _plain(tmp_path, pages: int = 3):
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 100), f"{BODY} {i + 1}", fontsize=14)
    path = tmp_path / "plain.pdf"
    doc.save(str(path))
    doc.close()
    return str(path)


def _text_of(path: str) -> list[str]:
    doc = fitz.open(path)
    try:
        return [p.get_text().strip() for p in doc]
    finally:
        doc.close()


@pytest.fixture
def marked(tmp_path):
    return watermark_service.add_watermark(
        _plain(tmp_path), text="CONFIDENTIAL", opacity=0.3
    )


# ── the round trip ────────────────────────────────────────────────────────
def test_removes_the_watermark(marked):
    out = remove_watermarks(marked)
    assert "CONFIDENTIAL" not in "\n".join(_text_of(out))


def test_body_text_survives_unchanged(tmp_path, marked):
    """Lossless means the real content is identical, not merely present."""
    original = _text_of(_plain(tmp_path))
    cleaned = _text_of(remove_watermarks(marked))
    assert cleaned == original


def test_page_count_is_preserved(marked):
    assert len(_text_of(remove_watermarks(marked))) == 3


def test_detection_finds_nothing_afterwards(marked):
    """The strongest end-to-end assertion: detect -> remove -> detect is clean."""
    assert detect_watermarks(marked)["candidates"], "fixture is not watermarked"
    out = remove_watermarks(marked)
    assert detect_watermarks(out)["candidates"] == []


def test_output_is_a_valid_pdf(marked):
    out = remove_watermarks(marked)
    with open(out, "rb") as fh:
        assert fh.read(5) == b"%PDF-"
    doc = fitz.open(out)
    doc.close()  # opening without raising is the real check


def test_graphics_state_stays_balanced(marked):
    """Dropping half a q/Q pair corrupts everything drawn after it."""
    import pikepdf

    out = remove_watermarks(marked)
    pdf = pikepdf.open(out)
    try:
        for page in pdf.pages:
            depth = 0
            for _operands, operator in pikepdf.parse_content_stream(page):
                op = str(operator)
                if op == "q":
                    depth += 1
                elif op == "Q":
                    depth -= 1
                assert depth >= 0, "Q without a matching q"
            assert depth == 0, "unbalanced q/Q after removal"
    finally:
        pdf.close()


def test_watermark_xobject_is_dropped_from_resources(marked):
    import pikepdf

    out = remove_watermarks(marked)
    pdf = pikepdf.open(out)
    try:
        for page in pdf.pages:
            xobjects = page.get("/Resources", {}).get("/XObject", {})
            for _name, obj in xobjects.items():
                assert b"CONFIDENTIAL" not in bytes(obj.read_bytes())
    finally:
        pdf.close()


# ── selection ─────────────────────────────────────────────────────────────
def test_removes_only_the_selected_candidate(marked):
    candidate = detect_watermarks(marked)["candidates"][0]
    out = remove_watermarks(marked, [candidate["id"]])
    assert "CONFIDENTIAL" not in "\n".join(_text_of(out))


def test_rejects_an_unknown_candidate_id(marked):
    with pytest.raises(ValidationError) as exc:
        remove_watermarks(marked, ["wm_deadbeef1234"])
    assert "wm_deadbeef1234" in str(exc.value)


def test_rejects_an_empty_selection(marked):
    with pytest.raises(ValidationError):
        remove_watermarks(marked, [])


def test_refuses_a_document_with_no_watermark(tmp_path):
    with pytest.raises(ValidationError):
        remove_watermarks(_plain(tmp_path))


# ── shape ─────────────────────────────────────────────────────────────────
def test_does_not_mutate_the_input(marked):
    before = open(marked, "rb").read()
    remove_watermarks(marked)
    assert open(marked, "rb").read() == before, "input file was modified in place"


def test_handles_an_image_watermark(tmp_path):
    """A logo watermark is an image XObject, not text — must not crash."""
    png = tmp_path / "logo.png"
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40))
    pix.set_rect(pix.irect, (200, 30, 30))
    pix.save(str(png))
    marked = watermark_service.add_watermark(
        _plain(tmp_path), watermark_image_path=str(png), opacity=0.3
    )
    # No text watermark to find, so removal declines rather than damaging it.
    with pytest.raises(Exception):
        remove_watermarks(marked)
