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
import time

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


def test_json_with_a_number_too_long_to_read_is_refused_in_plain_words(client):
    """Python's own words ("use sys.set_int_max_str_digits()") reached the page."""
    detail = _refusal(_post(client, "json-to-pdf", "big-number.json", b"[" + b"7" * 5_000 + b"]"), 400)
    assert detail == "This JSON has a number more than 4,300 digits long, which JSON to PDF cannot read."


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
    # The service's wording, not read_upload's "too large", which the page
    # rewrites into advice to compress the file. The route reads only 5 MB + 1.
    assert detail == "This JSON file is bigger than 5 MB, the most JSON to PDF takes."


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
    "declared",
    [
        pytest.param("ISO-8859-1", id="declares iso-8859-1"),
        pytest.param("windows-1252", id="declares windows-1252"),
        # What Python's own xml.etree writes when asked for encoding="utf8".
        pytest.param("utf8", id="declares utf8"),
        pytest.param("UTF-16", id="declares utf-16 but has no byte order mark"),
    ],
)
def test_xml_whose_bytes_are_utf8_is_read_as_utf8_whatever_it_declares(client, declared):
    """A declaration that names the wrong encoding is common, and valid UTF-8
    bytes are almost never meant as anything else: followed literally, the
    first two garbled "Café" into "CafÃ©" and the last two were refused."""
    text = _pdf_text(_post(client, "xml-to-pdf", "catalog.xml", CATALOG.format(encoding=declared).encode("utf-8")))
    assert "Café crème" in text


@pytest.mark.parametrize(
    ("encoded", "declared"),
    [
        # Not valid UTF-8 (\xe9), so the declaration is what the text would have to be read by.
        pytest.param(b'<?xml version="1.0" encoding="x-no-such-charset"?>\n<a>caf\xe9</a>\n', "x-no-such-charset", id="unknown"),
        # pyexpat reads UTF-8, UTF-16 and single-byte encodings, not these.
        pytest.param('<?xml version="1.0" encoding="Shift_JIS"?>\n<a>東京</a>\n'.encode("shift_jis"), "Shift_JIS", id="multi-byte"),
    ],
)
def test_xml_in_an_encoding_the_parser_cannot_read_is_refused_with_400(client, encoded, declared):
    detail = _refusal(_post(client, "xml-to-pdf", "odd.xml", encoded), 400)
    assert detail == f"XML to PDF cannot read text in {declared}, the encoding this file declares. Save it as UTF-8 and try again."


def test_xml_with_an_unknown_encoding_label_but_utf8_text_converts(client):
    xml = '<?xml version="1.0" encoding="x-no-such-charset"?>\n<a>Café</a>\n'.encode("utf-8")
    assert "Café" in _pdf_text(_post(client, "xml-to-pdf", "odd.xml", xml))


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


def _nested(depth: int) -> bytes:
    return b"<a>" * depth + b"x" + b"</a>" * depth


def test_xml_nested_60_levels_deep_converts(client):
    assert "x" in _pdf_text(_post(client, "xml-to-pdf", "deep.xml", _nested(60)))


@pytest.mark.parametrize("depth", [61, 1_000, 100_000])
def test_xml_nested_deeper_than_60_levels_is_refused_with_400(client, depth):
    """From about 990 levels this answered 500, when pretty-printing ran out
    of recursion; beyond 60 the lines would start past the right margin."""
    detail = _refusal(_post(client, "xml-to-pdf", "deep.xml", _nested(depth)), 400)
    assert detail.startswith("This XML nests more than 60 levels deep.")


def test_xml_with_more_elements_than_it_can_print_is_refused_before_building_them(client):
    """The reviewer's 5 MB file of 1.3 million empty elements took 38 s and
    600 MB and printed 21,000 pages."""
    flat = b"<r>" + b"<i/>" * 1_300_000 + b"</r>"
    detail = _refusal(_post(client, "xml-to-pdf", "flat.xml", flat), 400)
    assert detail == ("This XML has more than 50,000 elements, and XML to PDF prints at most 50,000 lines, "
                      "about 800 pages. Split it into smaller files.")


def test_xml_that_would_print_more_than_50000_lines_is_refused(client):
    text = b"<r>" + b"line\n" * 60_000 + b"</r>"
    detail = _refusal(_post(client, "xml-to-pdf", "lines.xml", text), 400)
    assert detail.startswith("This XML would print as 60,00")
    assert detail.endswith("and XML to PDF prints at most 50,000, about 800 pages. Split it into smaller files.")


def _sitemap(entries: int, *, indented: bool) -> bytes:
    """A sitemap whose entries have all four fields, as generators write them."""
    nl, one, two = (b"\n", b"  ", b"    ") if indented else (b"", b"", b"")
    entry = (one + b"<url>" + nl
             + two + b"<loc>https://example.com/p%d</loc>" + nl
             + two + b"<lastmod>2026-09-01</lastmod>" + nl
             + two + b"<changefreq>weekly</changefreq>" + nl
             + two + b"<priority>0.5</priority>" + nl
             + one + b"</url>" + nl)
    return (b'<?xml version="1.0" encoding="UTF-8"?>' + nl
            + b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + nl
            + b"".join(entry % i for i in range(entries)) + b"</urlset>" + nl)


def _page_count(response) -> int:
    assert response.status_code == 200, response.text
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        return doc.page_count


def test_an_indented_file_prints_on_as_many_pages_as_the_same_file_unindented(client):
    """Re-indenting an indented file left its old indentation behind as two
    whitespace-only lines around every element, each printed 0.3 of a line
    high: the output looked double-spaced and took 1.6 times the pages."""
    indented = _page_count(_post(client, "xml-to-pdf", "indented.xml", _sitemap(1_000, indented=True)))
    flat = _page_count(_post(client, "xml-to-pdf", "flat.xml", _sitemap(1_000, indented=False)))
    assert indented == flat == 97  # 6,003 lines at 62 a page


def test_a_full_sitemap_at_the_line_cap_prints_about_800_pages(client):
    """What the refusals and the FAQ promise: 50,000 lines are about 800
    pages. 8,300 indented entries are 49,803 lines; they printed as 1,300
    pages while blank lines took space."""
    assert 790 <= _page_count(_post(client, "xml-to-pdf", "sitemap.xml", _sitemap(8_300, indented=True))) <= 810


def test_a_full_sitemap_past_the_line_cap_is_refused(client):
    """The FAQ's figure: entries with all four fields take six lines each, so
    about 8,300 fit."""
    detail = _refusal(_post(client, "xml-to-pdf", "sitemap.xml", _sitemap(8_400, indented=True)), 400)
    assert detail.startswith("This XML would print as 50,403 lines")


def test_blank_lines_print_no_pages(client):
    """200,000 line breaks inside one element printed about 980 empty pages,
    and nothing counted them against the line cap."""
    assert _page_count(_post(client, "xml-to-pdf", "blank.xml", b"<r>" + b"\n" * 200_000 + b"x</r>")) == 1


def test_a_real_document_near_the_line_cap_converts(client):
    """9,000 sitemap entries with three fields print as 45,003 lines, about
    730 pages."""
    urls = b"".join(b"<url><loc>https://example.com/p%d</loc><lastmod>2026-09-01</lastmod><priority>0.5</priority></url>" % i
                    for i in range(9_000))
    response = _post(client, "xml-to-pdf", "sitemap.xml", b'<?xml version="1.0"?><urlset>' + urls + b"</urlset>")
    assert response.status_code == 200, response.text
    with fitz.open(stream=response.content, filetype="pdf") as doc:
        assert 700 < doc.page_count < 760


def test_xml_with_a_very_long_line_converts_quickly(client):
    """Lines were cut to fit by dropping one character at a time and measuring
    the rest again: 43 s for a 32,000-character line, days for 5 MB."""
    started = time.monotonic()
    text = _pdf_text(_post(client, "xml-to-pdf", "long.xml", b"<r>" + b"x" * 40_000 + b"</r>"))
    assert time.monotonic() - started < 10
    assert "<r>xxxxxxxx" in text


def test_xml_over_5_mb_is_refused_as_too_large(client):
    big = b"<root>" + b"<i>x</i>" * (700 * 1024) + b"</root>"
    detail = _refusal(_post(client, "xml-to-pdf", "big.xml", big), 413)
    assert detail == "This XML file is bigger than 5 MB, the most XML to PDF takes."
