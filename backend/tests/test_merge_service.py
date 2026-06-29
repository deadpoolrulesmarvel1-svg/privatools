"""Regression test for the merge-output cross-user leak (deep-research D1).

merge_service used a FIXED output path (`get_temp_path("merged.pdf")`), so two
concurrent /merge requests over the shared temp dir wrote/served the same file —
user A could receive user B's merged PDF, and A's cleanup could delete B's file
mid-download. Output paths must be unique per call.
"""

import sys
from pathlib import Path

import fitz  # PyMuPDF

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.merge_service import merge_pdfs


def _pdf(path: Path, text: str) -> None:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), text, fontsize=12)
    doc.save(str(path))
    doc.close()


def test_merge_output_paths_are_unique_per_call(tmp_path):
    a, b = tmp_path / "a.pdf", tmp_path / "b.pdf"
    _pdf(a, "AAA")
    _pdf(b, "BBB")

    out1 = merge_pdfs([str(a), str(b)])
    out2 = merge_pdfs([str(a), str(b)])
    try:
        assert out1 != out2, (
            "merge reused a fixed output path — concurrent requests would clobber "
            "each other (cross-user PDF leak)"
        )
        for o in (out1, out2):
            d = fitz.open(o)
            assert d.page_count == 2  # both inputs merged
            d.close()
    finally:
        for o in (out1, out2):
            Path(o).unlink(missing_ok=True)
