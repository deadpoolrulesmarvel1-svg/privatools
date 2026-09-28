"""JSON to PDF and XML to PDF, through the routes the website calls.

Until 2026-09-28 both answered every refusal with 500 "Processing failed.
Please try again.": their services raise ValidationError, which the routes'
catch-all turned into a 500. Retrying could never help, and analytics counted
each refusal as a server fault. Both also read files as bare UTF-8, so a
valid file saved with a byte order mark, in UTF-16 or, for XML, in the
encoding its declaration names was refused.
"""

from __future__ import annotations

import codecs
import json

import fitz
import pytest

SIMPLE = {"name": "Example order", "id": 1042, "items": [{"sku": "A-1", "qty": 2}], "paid": True}
CATALOG = (
    '<?xml version="1.0" encoding="{encoding}"?>\n'
    "<catalog><book id=\"b1\"><title>Café crème</title><price>12.50</price></book></catalog>\n"
)

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


def _pdf_text(response) -> str:
    assert response.status_code == 200, response.text
    assert response.content[:5] == b"%PDF-"
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        return "".join(page.get_text() for page in doc)


# ── JSON ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "encoded",
    [
        pytest.param(codecs.BOM_UTF8 + json.dumps(SIMPLE).encode("utf-8"), id="utf-8 with a byte order mark"),
        pytest.param(json.dumps(SIMPLE).encode("utf-16"), id="utf-16 with a byte order mark"),
        pytest.param(json.dumps(SIMPLE).encode("utf-16-le"), id="utf-16 without one"),
        pytest.param(json.dumps(SIMPLE).encode("utf-32"), id="utf-32"),
    ],
)
def test_json_in_any_encoding_json_allows_converts(client, encoded):
    text = _pdf_text(_post(client, "json-to-pdf", "order.json", encoded))
    assert '"name": "Example order"' in text


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


@pytest.mark.parametrize(
    "encoded",
    [
        pytest.param(CATALOG.format(encoding="UTF-8").encode("utf-8"), id="utf-8"),
        pytest.param(codecs.BOM_UTF8 + CATALOG.format(encoding="UTF-8").encode("utf-8"), id="utf-8 with a byte order mark"),
        pytest.param(CATALOG.format(encoding="UTF-16").encode("utf-16"), id="utf-16"),
        pytest.param(CATALOG.format(encoding="ISO-8859-1").encode("latin-1"), id="iso-8859-1"),
        pytest.param(CATALOG.format(encoding="windows-1252").encode("cp1252"), id="windows-1252"),
    ],
)
def test_xml_in_the_encoding_it_declares_converts(client, encoded):
    text = _pdf_text(_post(client, "xml-to-pdf", "catalog.xml", encoded))
    assert "Café crème" in text


@pytest.mark.parametrize(
    ("encoded", "declared"),
    [
        pytest.param(b'<?xml version="1.0" encoding="x-no-such-charset"?>\n<a>b</a>\n', "x-no-such-charset", id="unknown"),
        # pyexpat reads UTF-8, UTF-16 and single-byte encodings, not these.
        pytest.param('<?xml version="1.0" encoding="Shift_JIS"?>\n<a>東京</a>\n'.encode("shift_jis"), "Shift_JIS", id="multi-byte"),
    ],
)
def test_xml_in_an_encoding_the_parser_cannot_read_is_refused_with_400(client, encoded, declared):
    detail = _refusal(_post(client, "xml-to-pdf", "odd.xml", encoded), 400)
    assert detail == f"XML to PDF cannot read text in {declared}, the encoding this file declares. Save it as UTF-8 and try again."


def test_malformed_xml_is_refused_with_400_saying_where(client):
    detail = _refusal(_post(client, "xml-to-pdf", "broken.xml", b"<root><a></root>"), 400)
    # Columns count from 1, as editors show them: "root" of </root> starts at 12.
    assert detail == "This XML could not be read: mismatched tag, at line 1, column 12."


def test_xml_that_declares_entities_is_refused_with_400(client):
    xml = b'<?xml version="1.0"?>\n<!DOCTYPE note [<!ENTITY co "Example Co">]>\n<note><from>&co;</from></note>\n'
    detail = _refusal(_post(client, "xml-to-pdf", "entity.xml", xml), 400)
    assert "entities" in detail


def test_xml_cannot_pull_in_a_local_file_through_an_entity(client, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET-FILE-CONTENT")
    xml = f'<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY x SYSTEM "{secret.as_uri()}">]>\n<r>&x;</r>\n'
    response = _post(client, "xml-to-pdf", "xxe.xml", xml.encode())
    assert response.status_code == 400
    assert "SECRET-FILE-CONTENT" not in response.text


def test_xml_that_names_an_outside_dtd_does_not_get_it_read(client, tmp_path):
    dtd = tmp_path / "note.dtd"
    dtd.write_text('<!ENTITY greeting "TEXT-FROM-THE-DTD">')
    xml = f'<?xml version="1.0"?>\n<!DOCTYPE note SYSTEM "{dtd.as_uri()}">\n<note>&greeting;</note>\n'
    # The DTD is never read, so the reference is dropped: with an outside DTD
    # an undeclared entity is not an error, since the DTD might declare it.
    text = _pdf_text(_post(client, "xml-to-pdf", "dtd.xml", xml.encode()))
    assert "<note/>" in text
    assert "TEXT-FROM-THE-DTD" not in text


def test_xml_over_5_mb_is_refused_as_too_large(client):
    big = b"<root>" + b"<i>x</i>" * (700 * 1024) + b"</root>"
    detail = _refusal(_post(client, "xml-to-pdf", "big.xml", big), 413)
    assert "5 MB" in detail
