"""End-to-end: upload a watermarked PDF, detect, confirm, get a clean PDF back."""

from __future__ import annotations

import json

import fitz
import pytest

from app.services import watermark_service


@pytest.fixture
def watermarked_bytes(tmp_path) -> bytes:
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 100), f"Real body content {i + 1}", fontsize=14)
    src = tmp_path / "plain.pdf"
    doc.save(str(src))
    doc.close()
    out = watermark_service.add_watermark(str(src), text="CONFIDENTIAL", opacity=0.3)
    return open(out, "rb").read()


def _detect(client, data: bytes):
    return client.post(
        "/api/remove-watermark/detect",
        files={"file": ("marked.pdf", data, "application/pdf")},
    )


def test_detect_returns_candidates(client, watermarked_bytes):
    resp = _detect(client, watermarked_bytes)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["page_count"] == 3
    assert body["candidates"]
    assert "CONFIDENTIAL" in body["candidates"][0]["label"]


def test_detect_never_returns_the_file(client, watermarked_bytes):
    """Detection is analysis only — the response is JSON, not a document."""
    resp = _detect(client, watermarked_bytes)
    assert resp.headers["content-type"].startswith("application/json")


def test_detect_rejects_a_non_pdf(client):
    resp = client.post(
        "/api/remove-watermark/detect",
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400


def test_full_round_trip(client, watermarked_bytes):
    ids = [c["id"] for c in _detect(client, watermarked_bytes).json()["candidates"]]
    resp = client.post(
        "/api/remove-watermark/apply",
        files={"file": ("marked.pdf", watermarked_bytes, "application/pdf")},
        data={"candidate_ids": json.dumps(ids)},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content[:5] == b"%PDF-"

    doc = fitz.open(stream=resp.content, filetype="pdf")
    try:
        text = "\n".join(p.get_text() for p in doc)
    finally:
        doc.close()
    assert "CONFIDENTIAL" not in text
    assert "Real body content 1" in text
    assert "Real body content 3" in text


def test_apply_requires_a_selection(client, watermarked_bytes):
    resp = client.post(
        "/api/remove-watermark/apply",
        files={"file": ("marked.pdf", watermarked_bytes, "application/pdf")},
        data={"candidate_ids": json.dumps([])},
    )
    assert resp.status_code == 400


def test_apply_rejects_malformed_ids(client, watermarked_bytes):
    resp = client.post(
        "/api/remove-watermark/apply",
        files={"file": ("marked.pdf", watermarked_bytes, "application/pdf")},
        data={"candidate_ids": "not json"},
    )
    assert resp.status_code == 400


def test_apply_response_is_no_store(client, watermarked_bytes):
    ids = [c["id"] for c in _detect(client, watermarked_bytes).json()["candidates"]]
    resp = client.post(
        "/api/remove-watermark/apply",
        files={"file": ("marked.pdf", watermarked_bytes, "application/pdf")},
        data={"candidate_ids": json.dumps(ids)},
    )
    assert "no-store" in resp.headers.get("cache-control", "")
