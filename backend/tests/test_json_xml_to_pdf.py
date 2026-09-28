"""JSON to PDF and XML to PDF, through the routes the website calls.

Until 2026-09-28 both answered every refusal with 500 "Processing failed.
Please try again.": their services raise ValidationError, which the routes'
catch-all turned into a 500. Retrying could never help, and analytics counted
each refusal as a server fault.
"""

from __future__ import annotations

import json

import pytest

# Words the website's generic error wording (friendlyError in
# frontend/src/lib/utils.ts) turns into advice about damaged or locked PDFs.
PDF_ADVICE_TRIGGERS = ("malformed", "corrupt", "damaged", "password", "protected", "encrypt")


def _post(client, route: str, name: str, content: bytes):
    return client.post(f"/api/{route}", files={"file": (name, content, "application/octet-stream")})


def _refusal(response, status: int) -> str:
    assert response.status_code == status, response.text
    detail = response.json()["detail"]
    assert not any(word in detail.lower() for word in PDF_ADVICE_TRIGGERS), detail
    return detail


# ── JSON ────────────────────────────────────────────────────────────────


def test_invalid_json_is_refused_with_400_saying_where(client):
    detail = _refusal(_post(client, "json-to-pdf", "broken.json", b'{"name": "broken", }'), 400)
    assert "not valid JSON" in detail
    assert "line 1, column 20" in detail


def test_json_that_is_not_text_is_refused_with_400(client):
    detail = _refusal(_post(client, "json-to-pdf", "photo.json", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"), 400)
    assert "not valid JSON" in detail


def test_empty_json_file_is_refused_with_400(client):
    _refusal(_post(client, "json-to-pdf", "empty.json", b""), 400)


def test_json_nested_too_deep_is_refused_with_400(client):
    deep = "[" * 30 + "]" * 30
    detail = _refusal(_post(client, "json-to-pdf", "deep.json", deep.encode()), 400)
    assert "25 levels" in detail


def test_json_that_would_print_too_many_lines_is_refused_with_400(client):
    rows = json.dumps(list(range(60_000))).encode()
    detail = _refusal(_post(client, "json-to-pdf", "rows.json", rows), 400)
    assert "50,000" in detail


def test_json_over_5_mb_is_refused_as_too_large(client):
    big = json.dumps({"blob": "x" * (5 * 1024 * 1024)}).encode()
    detail = _refusal(_post(client, "json-to-pdf", "big.json", big), 413)
    assert "5 MB" in detail


# ── XML ─────────────────────────────────────────────────────────────────


def test_malformed_xml_is_refused_with_400_saying_where(client):
    detail = _refusal(_post(client, "xml-to-pdf", "broken.xml", b"<root><a></root>"), 400)
    # Columns count from 1, as editors show them: "root" of </root> starts at 12.
    assert detail == "This XML could not be read: mismatched tag, at line 1, column 12."


def test_xml_that_declares_entities_is_refused_with_400(client):
    xml = b'<?xml version="1.0"?>\n<!DOCTYPE note [<!ENTITY co "Example Co">]>\n<note><from>&co;</from></note>\n'
    detail = _refusal(_post(client, "xml-to-pdf", "entity.xml", xml), 400)
    assert "entities" in detail


def test_xml_over_5_mb_is_refused_as_too_large(client):
    big = b"<root>" + b"<i>x</i>" * (700 * 1024) + b"</root>"
    detail = _refusal(_post(client, "xml-to-pdf", "big.xml", big), 413)
    assert "5 MB" in detail
