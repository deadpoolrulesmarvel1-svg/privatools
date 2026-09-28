"""PDF to EPUB writes a book an e-reader can open.

An EPUB's pages are XHTML, which a reader parses as XML. PyMuPDF's page HTML
leaves <img> open, so any page with a picture made the whole book fail to
parse (epubcheck 5.4.0: FATAL RSC-016). Every page's HTML also has id="page0",
the package had no dcterms:modified and no navigation document (both
required by EPUB 3), and every book had the same identifier, the literal text
"urn:uuid:{uuid.uuid4()}", so a library that files books by it takes two
converted PDFs for one book.
"""

from __future__ import annotations

import io
import re
import time
import uuid
import zipfile
from xml.etree import ElementTree as ET

import fitz  # PyMuPDF
import pytest
from PIL import Image

OPF = "{http://www.idpf.org/2007/opf}"
XHTML = "{http://www.w3.org/1999/xhtml}"


def _text_pdf(pages: int = 3) -> bytes:
    doc = fitz.open()
    for n in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Chapter {n + 1}", fontsize=20)
        page.insert_text((72, 110), "Tom & Jerry <said> \"hello\" caf\u00e9", fontsize=11)
        page.insert_text((72, 140), "\u4e2d\u6587", fontsize=11, fontname="china-s")  # PyMuPDF's own CJK font
    return doc.tobytes()


def _picture_pdf() -> bytes:
    img = Image.new("RGB", (120, 80), (30, 120, 200))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    doc = fitz.open()
    for n in range(2):
        page = doc.new_page()
        page.insert_text((72, 72), f"Figure page {n + 1}", fontsize=14)
        page.insert_image(fitz.Rect(72, 100, 312, 260), stream=buf.getvalue())
    return doc.tobytes()


def _convert(client, data: bytes) -> zipfile.ZipFile:
    resp = client.post("/api/pdf-to-epub", files={"file": ("book.pdf", data, "application/pdf")})
    assert resp.status_code == 200, resp.text[:300]
    return zipfile.ZipFile(io.BytesIO(resp.content))


@pytest.mark.parametrize("make", [_text_pdf, _picture_pdf], ids=["text", "pictures"])
def test_every_xhtml_file_parses_and_its_ids_are_unique(client, make):
    book = _convert(client, make())
    for name in ("content.xhtml", "nav.xhtml"):
        root = ET.fromstring(book.read(name))  # raises on anything not well-formed
        ids = [el.get("id") for el in root.iter() if el.get("id")]
        assert len(ids) == len(set(ids)), (name, ids)


def test_pictures_are_kept(client):
    book = _convert(client, _picture_pdf())
    root = ET.fromstring(book.read("content.xhtml"))
    images = [el for el in root.iter(f"{XHTML}img")]
    assert len(images) == 2
    assert all(el.get("src", "").startswith("data:image/") for el in images)


def test_the_package_has_what_epub_3_requires(client):
    book = _convert(client, _text_pdf(3))
    names = book.namelist()
    assert names[0] == "mimetype" and book.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
    opf = ET.fromstring(book.read("content.opf"))
    modified = [m for m in opf.iter(f"{OPF}meta") if m.get("property") == "dcterms:modified"]
    assert len(modified) == 1 and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", modified[0].text)
    navs = [item for item in opf.iter(f"{OPF}item") if "nav" in (item.get("properties") or "").split()]
    assert len(navs) == 1 and navs[0].get("href") == "nav.xhtml"
    nav = ET.fromstring(book.read("nav.xhtml"))
    links = [a.get("href") for a in nav.iter(f"{XHTML}a")]
    assert links == ["content.xhtml#page1", "content.xhtml#page2", "content.xhtml#page3"]


def test_each_book_has_its_own_identifier(client):
    ids = []
    for _ in range(2):
        opf = ET.fromstring(_convert(client, _text_pdf(1)).read("content.opf"))
        text = next(el.text for el in opf.iter("{http://purl.org/dc/elements/1.1/}identifier"))
        assert text.startswith("urn:uuid:")
        ids.append(uuid.UUID(text[len("urn:uuid:"):]))
    assert ids[0] != ids[1]


def test_text_comes_through_escaped(client):
    book = _convert(client, _text_pdf(1))
    text = "".join(ET.fromstring(book.read("content.xhtml")).itertext())
    assert "Tom & Jerry <said>" in text and "caf\u00e9" in text and "\u4e2d\u6587" in text


def test_a_page_whose_html_does_not_parse_falls_back_to_plain_xhtml():
    from backend.app.routes.pdf_extra import _page_xhtml

    class Page:
        def get_text(self, kind):
            if kind == "html":
                return '<div id="page0"><p>Broken&nbsp;entity</p></div>'
            return '<div id="page0"><p>Broken entity</p></div>'

    xhtml = _page_xhtml(Page(), 7)
    ET.fromstring(f'<div xmlns="http://www.w3.org/1999/xhtml">{xhtml}</div>')
    assert 'id="page7-body"' in xhtml and "Broken entity" in xhtml


def test_img_tags_are_closed_in_one_pass():
    from backend.app.routes.pdf_extra import _close_img_tags

    cases = {
        '<p>a</p><img src="x">': '<p>a</p><img src="x"/>',
        '<img src="x"/>': '<img src="x"/>',
        '<img src="x" />': '<img src="x"/>',
        '<img\nstyle="s"\nsrc="data:image/png;base64,\nAAAA/BBB=">': '<img\nstyle="s"\nsrc="data:image/png;base64,\nAAAA/BBB="/>',
        "<imgx>kept</imgx>": "<imgx>kept</imgx>",
        "text <img src=unfinished": "text <img src=unfinished",
    }
    for given, expected in cases.items():
        assert _close_img_tags(given) == expected, given
    # Crafted: the regular expression it replaces took 24 s on the first.
    for crafted in ("<img" + " " * 200_000, "<img" * 50_000, "<img " + "/ " * 100_000):
        started = time.perf_counter()
        _close_img_tags(crafted)
        assert time.perf_counter() - started < 2
