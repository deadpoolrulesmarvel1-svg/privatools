"""Purpose-named compression profiles and target-size compression.

Adobe, Nitro and Foxit all ship saveable optimisation profiles; we shipped one
button with three intensity levels. And "make this fit under 10 MB" is the form
of the question people actually have — ihatepdf.cv answers it free, Smallpdf and
iLovePDF put it behind a paid tier.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import fitz  # PyMuPDF
import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

import pikepdf  # noqa: E402

from backend.app.services.compress_service import (
    _PRESETS,
    _TARGET_LADDER,
    PROFILE_LABELS,
    compress_pdf,
    compress_to_target,
)


def _image_pdf(path: Path, pages: int = 3, side: int = 900) -> str:
    """A PDF with real image content, so compression has something to work on."""
    doc = fitz.open()
    for p in range(pages):
        page = doc.new_page()
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, side, side))
        # A gradient compresses far less than flat colour, which keeps the
        # test honest — a blank page would "compress" to nothing regardless.
        for x in range(0, side, 3):
            for y in range(0, side, 3):
                pix.set_pixel(x, y, ((x + p * 7) % 256, (y * 3) % 256, (x * y) % 256))
        page.insert_image(page.rect, pixmap=pix)
    doc.save(str(path), deflate=True)
    doc.close()
    return str(path)


def _filters(pdf_path: str) -> set[str]:
    with pikepdf.open(pdf_path) as pdf:
        found = set()
        for page in pdf.pages:
            xobjects = page.get("/Resources", {}).get("/XObject")
            if not xobjects:
                continue
            for key in xobjects.keys():
                found.add(str(xobjects[key].get("/Filter", "?")))
        return found


# ── the Flate regression ────────────────────────────────────────────────────

def test_flate_encoded_images_actually_compress(tmp_path):
    """Regression: /FlateDecode images were skipped entirely.

    _recompress_image opened the *raw stream bytes* with PIL. For /DCTDecode
    those bytes are a whole JPEG so it worked; for /FlateDecode they are
    zlib-compressed samples with no container, so PIL raised, the image was
    skipped, and the file came back the size it went in — while the UI
    reported a successful compression.

    Measured on the same generated page at `extreme`: DCTDecode 0.18, Flate
    1.00. Flate is how screenshots, PNG exports and much scanner output is
    stored, so this was not an edge case.
    """
    src = _image_pdf(tmp_path / "flate.pdf", pages=1)
    assert "/FlateDecode" in _filters(src), "fixture is not exercising the Flate path"

    before = os.path.getsize(src)
    after = os.path.getsize(compress_pdf(src, level="extreme"))
    assert after < before * 0.9, (
        f"Flate-encoded images did not compress: {before} -> {after}"
    )


def test_image_masks_are_left_alone(tmp_path):
    """A 1-bit stencil mask is a shape, not a picture — JPEG would break it."""
    path = tmp_path / "mask.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "text beside a mask", fontsize=12)
    doc.save(str(path))
    doc.close()
    out = compress_pdf(str(path), level="extreme")
    doc = fitz.open(out)
    try:
        assert "text beside a mask" in doc[0].get_text()
    finally:
        doc.close()


# ── profiles ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("profile", ["email", "print", "archive", "web"])
def test_every_purpose_profile_produces_a_readable_pdf(tmp_path, profile):
    out = compress_pdf(_image_pdf(tmp_path / f"{profile}.pdf", pages=1), level=profile)
    doc = fitz.open(out)
    try:
        assert doc.page_count == 1
    finally:
        doc.close()


def test_every_profile_has_a_human_label():
    for name in _PRESETS:
        assert name in PROFILE_LABELS, f"{name} has no label for the picker"


def test_email_squeezes_harder_than_print(tmp_path):
    src = _image_pdf(tmp_path / "src.pdf", pages=2)
    email = os.path.getsize(compress_pdf(src, level="email"))
    printed = os.path.getsize(compress_pdf(src, level="print"))
    assert email < printed, "the email profile should produce a smaller file than print"


def test_an_unknown_profile_falls_back_rather_than_raising(tmp_path):
    """The route validates names; the service must not explode on a stray one."""
    out = compress_pdf(_image_pdf(tmp_path / "a.pdf", pages=1), level="not-a-profile")
    assert Path(out).exists()


# ── target size ─────────────────────────────────────────────────────────────

def test_target_search_reports_the_result_honestly(tmp_path):
    src = _image_pdf(tmp_path / "src.pdf", pages=2)
    original = os.path.getsize(src)
    out, info = compress_to_target(src, target_bytes=original // 2)

    assert Path(out).exists()
    assert info["outputBytes"] == os.path.getsize(out)
    assert info["inputBytes"] == original
    assert isinstance(info["met"], bool)
    # met must describe the file we actually returned, not the intent.
    assert info["met"] == (info["outputBytes"] <= info["targetBytes"])


def test_target_search_is_bounded(tmp_path):
    """Each pass is a full re-compression; an unbounded search is a timeout."""
    src = _image_pdf(tmp_path / "src.pdf", pages=1)
    _, info = compress_to_target(src, target_bytes=1, max_attempts=4)
    assert info["attempts"] <= 4


def test_an_impossible_target_still_returns_a_file_and_says_it_missed(tmp_path):
    src = _image_pdf(tmp_path / "src.pdf", pages=2)
    out, info = compress_to_target(src, target_bytes=100)  # 100 bytes: not happening

    assert Path(out).exists(), "must return the smallest achievable file, not nothing"
    assert info["met"] is False


def test_a_generous_target_is_met_without_over_squeezing(tmp_path):
    """Binary search should settle on a light rung, not grind to the bottom."""
    src = _image_pdf(tmp_path / "src.pdf", pages=2)
    out, info = compress_to_target(src, target_bytes=os.path.getsize(src) * 10)

    assert info["met"] is True
    assert Path(out).exists()
    # A generous target must not land on the harshest rung.
    assert info["jpegQuality"] > _TARGET_LADDER[-1][1]


def test_target_search_cleans_up_the_passes_it_discarded(tmp_path):
    """Each rung writes a temp file; only the winner should survive."""
    src = _image_pdf(tmp_path / "src.pdf", pages=1)
    out, info = compress_to_target(src, target_bytes=os.path.getsize(src) // 3)

    temp_dir = Path(out).parent
    leftovers = [
        p for p in temp_dir.glob("compressed_*.pdf")
        if str(p) != out and p.stat().st_mtime >= Path(src).stat().st_mtime
    ]
    assert not leftovers, f"left {len(leftovers)} discarded compression passes behind"


# ── HTTP ────────────────────────────────────────────────────────────────────

def test_endpoint_accepts_a_purpose_profile(client, tmp_path):
    data = Path(_image_pdf(tmp_path / "a.pdf", pages=1)).read_bytes()
    res = client.post(
        "/api/compress",
        files=[("files", ("a.pdf", data, "application/pdf"))],
        data={"level": "email"},
    )
    assert res.status_code == 200


def test_endpoint_reports_whether_the_target_was_met(client, tmp_path):
    data = Path(_image_pdf(tmp_path / "a.pdf", pages=1)).read_bytes()
    res = client.post(
        "/api/compress",
        files=[("files", ("a.pdf", data, "application/pdf"))],
        data={"level": "custom", "target_size_mb": "0.0001"},
    )
    assert res.status_code == 200
    assert res.headers["X-Target-Met"] == "false"


def test_endpoint_rejects_an_absurd_target(client, tmp_path):
    data = Path(_image_pdf(tmp_path / "a.pdf", pages=1)).read_bytes()
    res = client.post(
        "/api/compress",
        files=[("files", ("a.pdf", data, "application/pdf"))],
        data={"level": "recommended", "target_size_mb": "99999"},
    )
    assert res.status_code == 400
