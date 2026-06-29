"""Regression tests for split_by_size — page-integrity invariant.

The size-bounded splitter trims pages off an oversized sample window one at a
time. A prior bug seeded the next chunk with only the LAST popped page
(`current = [popped]`), silently dropping every other trimmed page — so the
user got a ZIP missing pages with no error. These tests assert the core
invariant: the pages across all output chunks must equal the input pages
exactly, with no loss and no duplication, including the multi-page-trim path.
"""

import io
import os
import sys
import zipfile
from pathlib import Path

import fitz  # PyMuPDF
import pytest
from PIL import Image

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.split_by_size_service import split_by_size


def _noise_png(side: int = 256) -> bytes:
    """An incompressible (random-noise) PNG so each PDF page is reliably large
    (~200 KB), forcing a small size cap to trim multiple pages per window."""
    img = Image.frombytes("RGB", (side, side), os.urandom(side * side * 3))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_heavy_pdf(path: Path, n_pages: int) -> None:
    doc = fitz.open()
    png = _noise_png()  # one shared image is fine — fitz still stores per page
    for _ in range(n_pages):
        page = doc.new_page(width=300, height=300)
        page.insert_image(fitz.Rect(0, 0, 300, 300), stream=png)
    doc.save(str(path))
    doc.close()


def _total_pages_in_zip(zip_path: str) -> int:
    total = 0
    with zipfile.ZipFile(zip_path) as zf:
        parts = [n for n in zf.namelist() if n.endswith(".pdf")]
        assert parts, "split produced no PDF chunks"
        for name in parts:
            part = fitz.open(stream=zf.read(name), filetype="pdf")
            total += part.page_count
            part.close()
    return total


def test_split_by_size_preserves_all_pages_when_trimming_multiple(tmp_path):
    """A cap that fits ~1 page forces the 5-page sample window to trim 3+ pages
    at once — the case the old `current = [popped]` bug dropped. Every page must
    still appear in exactly one output chunk."""
    n = 8
    src = tmp_path / "heavy.pdf"
    _make_heavy_pdf(src, n)

    zip_path = split_by_size(str(src), max_size_mb=0.25)
    try:
        assert _total_pages_in_zip(zip_path) == n
    finally:
        Path(zip_path).unlink(missing_ok=True)


def test_split_by_size_preserves_pages_with_generous_cap(tmp_path):
    """Sanity: a cap large enough that no trimming happens still returns every
    page (guards against an off-by-one in the non-overshoot path)."""
    n = 6
    src = tmp_path / "heavy2.pdf"
    _make_heavy_pdf(src, n)

    zip_path = split_by_size(str(src), max_size_mb=50.0)
    try:
        assert _total_pages_in_zip(zip_path) == n
    finally:
        Path(zip_path).unlink(missing_ok=True)
