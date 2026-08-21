"""Watermark detection.

Grounded in what PrivaTools' own `/watermark` tool actually emits, which is not
what the design spec assumed. Inspecting real output showed:

  * each page gets its OWN Form XObject xref (13, 14, 15…), not one shared
    object — so "same xref on every page" would have detected nothing;
  * `page.get_texttrace()` exposes exactly the right signals directly:
    the watermark span carries opacity 0.3 and dir (0.707, -0.707) — a 45°
    rotation — while body text is opacity 1.0, dir (1.0, 0.0).

Detection therefore keys on a per-span signature (text, opacity, direction)
repeated across pages, not on object identity.

The round-trip is the strongest available test: watermark a document with the
shipping tool, then detect it.
"""

from __future__ import annotations

import fitz
import pytest

from app.services import watermark_service
from app.services.watermark_detect_service import detect_watermarks


def _doc_with_text(tmp_path, pages: int = 3, body: str = "Real body content"):
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 100), f"{body} page {i + 1}", fontsize=14)
    path = tmp_path / "plain.pdf"
    doc.save(str(path))
    doc.close()
    return str(path)


@pytest.fixture
def watermarked(tmp_path):
    src = _doc_with_text(tmp_path)
    return watermark_service.add_watermark(src, text="CONFIDENTIAL", opacity=0.3)


# ── the round trip ────────────────────────────────────────────────────────
def test_finds_a_watermark_applied_by_our_own_tool(watermarked):
    result = detect_watermarks(watermarked)
    assert result["candidates"], "our own watermark went undetected"
    top = result["candidates"][0]
    assert top["confidence"] >= 0.5
    assert "CONFIDENTIAL" in top["label"]


def test_reports_the_watermark_on_every_page(watermarked):
    top = detect_watermarks(watermarked)["candidates"][0]
    assert top["pages"] == [1, 2, 3]
    assert top["page_count"] == 3


def test_text_watermarks_are_removable_losslessly(watermarked):
    assert detect_watermarks(watermarked)["candidates"][0]["removal"] == "lossless"


def test_candidate_carries_a_bbox(watermarked):
    bbox = detect_watermarks(watermarked)["candidates"][0]["bbox"]
    assert len(bbox) == 4
    x0, y0, x1, y1 = bbox
    assert x1 > x0 and y1 > y0


# ── false positives are the expensive failure ─────────────────────────────
def test_plain_document_has_no_watermark(tmp_path):
    assert detect_watermarks(_doc_with_text(tmp_path))["candidates"] == []


def test_repeated_header_is_not_a_watermark(tmp_path):
    """Opaque, unrotated, small, in the margin — a running head, not a mark."""
    doc = fitz.open()
    for i in range(4):
        page = doc.new_page()
        page.insert_text((72, 40), "ACME CORP — INTERNAL", fontsize=8)
        page.insert_text((72, 300), f"Body {i}", fontsize=14)
    path = tmp_path / "header.pdf"
    doc.save(str(path))
    doc.close()
    assert detect_watermarks(str(path))["candidates"] == []


def test_page_numbers_are_not_watermarks(tmp_path):
    doc = fitz.open()
    for i in range(5):
        page = doc.new_page()
        page.insert_text((300, 800), str(i + 1), fontsize=9)
        page.insert_text((72, 300), f"Body {i}", fontsize=14)
    path = tmp_path / "numbered.pdf"
    doc.save(str(path))
    doc.close()
    assert detect_watermarks(str(path))["candidates"] == []


def test_body_text_repeated_on_every_page_is_not_a_watermark(tmp_path):
    """Identical opaque horizontal text is boilerplate, not a mark."""
    path = _doc_with_text(tmp_path, pages=4, body="Same sentence everywhere")
    assert detect_watermarks(path)["candidates"] == []


def test_never_reports_a_pages_only_content(tmp_path):
    """A one-page doc that is JUST the mark — removing it leaves nothing."""
    doc = fitz.open()
    doc.new_page()
    path = tmp_path / "empty.pdf"
    doc.save(str(path))
    doc.close()
    marked = watermark_service.add_watermark(str(path), text="SAMPLE", opacity=0.3)
    assert detect_watermarks(marked)["candidates"] == []


# ── shape of the payload ──────────────────────────────────────────────────
def test_result_is_json_serialisable(watermarked):
    import json

    json.dumps(detect_watermarks(watermarked))


def test_reports_page_count_and_caps_candidates(watermarked):
    result = detect_watermarks(watermarked)
    assert result["page_count"] == 3
    assert len(result["candidates"]) <= 20


def test_candidate_ids_are_stable_across_runs(watermarked):
    a = [c["id"] for c in detect_watermarks(watermarked)["candidates"]]
    b = [c["id"] for c in detect_watermarks(watermarked)["candidates"]]
    assert a == b, "ids must be stable — apply() re-detects and matches by id"


def test_handles_a_single_page_document(tmp_path):
    src = _doc_with_text(tmp_path, pages=1)
    marked = watermark_service.add_watermark(src, text="DRAFT", opacity=0.3)
    result = detect_watermarks(marked)
    assert result["page_count"] == 1
    assert result["candidates"], "a one-page watermark over real content is still a watermark"
