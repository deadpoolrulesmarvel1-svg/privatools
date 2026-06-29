"""Tests for the fitz pixmap OOM guard (safe_get_pixmap).

A PDF MediaBox is attacker-controlled (up to 14400×14400 pt). Without an
output-size guard, one crafted page rendered at a normal DPI allocates tens of
GB and OOM-kills a worker. safe_get_pixmap must reject the render before
allocating, while leaving legitimate high-res renders alone.
"""

import sys
from pathlib import Path

import fitz  # PyMuPDF
import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.utils.exceptions import ValidationError
from backend.app.utils.render import (
    MAX_PIXMAP_PIXELS,
    estimate_pixmap_pixels,
    safe_get_pixmap,
)


def test_rejects_oversized_page_via_dpi_and_matrix():
    doc = fitz.open()
    # 8000×8000 pt page: at dpi=150 → ~277 MP; at matrix 2× → 256 MP. Both > cap.
    page = doc.new_page(width=8000, height=8000)
    try:
        with pytest.raises(ValidationError):
            safe_get_pixmap(page, dpi=150)
        with pytest.raises(ValidationError):
            safe_get_pixmap(page, matrix=fitz.Matrix(2, 2))
    finally:
        doc.close()


def test_allows_normal_high_res_page():
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4
    try:
        pix = safe_get_pixmap(page, dpi=300)  # ~8.7 MP, well under the cap
        assert pix.width > 0 and pix.height > 0
    finally:
        doc.close()


def test_estimate_tracks_dpi_and_matrix_scale():
    doc = fitz.open()
    page = doc.new_page(width=720, height=720)
    try:
        assert estimate_pixmap_pixels(page, dpi=72) == pytest.approx(720 * 720, rel=0.02)
        assert estimate_pixmap_pixels(page, matrix=fitz.Matrix(2, 2)) == pytest.approx(
            1440 * 1440, rel=0.02
        )
        assert estimate_pixmap_pixels(page, dpi=150) < MAX_PIXMAP_PIXELS
    finally:
        doc.close()
