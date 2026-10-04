"""Stamp PDF takes the page ranges its page suggests, and refuses a page the PDF lacks.

The page's Pages box suggests "all · 1,3,5-8", but the route accepted only
"all" or a list of single numbers: "5-8" got 400 "pages must be 'all' or
comma-separated page numbers like '1,2,5'", which the page turned into "One
of the page numbers is outside this PDF". The service already read ranges
with the shared parser (utils.page_range), which Rotate, Extract Pages and
the other page tools use; only the route's own pattern was in the way.

The service also stamped every page when the parser refused the pages it was
given: page 0, or page 12 of a 10-page PDF, stamped all 10 with a 200. Now
such a request is a 400 that says which pages the PDF has.
"""

from __future__ import annotations

import fitz  # PyMuPDF
import pytest
from fastapi.testclient import TestClient

from backend.app import main


@pytest.fixture(scope="module")
def quiet_client():
    return TestClient(main.app, raise_server_exceptions=False)


def _pdf(pages: int = 10) -> bytes:
    doc = fitz.open()
    for n in range(pages):
        doc.new_page().insert_text((72, 72), f"Page {n + 1}", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def _stamp(client, pages: str, pdf: bytes | None = None):
    return client.post("/api/stamp-pdf", files={"file": ("doc.pdf", pdf or _pdf(), "application/pdf")},
                       data={"stamp_type": "draft", "pages": pages})


def _stamped(content: bytes) -> list[int]:
    with fitz.open(stream=content, filetype="pdf") as doc:
        return [n + 1 for n, page in enumerate(doc) if "DRAFT" in page.get_text()]


@pytest.mark.parametrize("pages,expected", [
    ("1,3,5-8", [1, 3, 5, 6, 7, 8]),  # the page's own example
    ("5-8", [5, 6, 7, 8]),
    ("8-", [8, 9, 10]),
    ("-2", [1, 2]),
    ("9-end", [9, 10]),
    ("end", [10]),
    (" 2 , 4 ", [2, 4]),
    ("1,2", [1, 2]),
    ("all", list(range(1, 11))),
    ("", list(range(1, 11))),
])
def test_the_pages_named_are_the_pages_stamped(quiet_client, pages, expected):
    response = _stamp(quiet_client, pages)
    assert response.status_code == 200, response.text
    assert _stamped(response.content) == expected


@pytest.mark.parametrize("pages,detail", [
    ("12", "Page 12 is out of bounds. Valid range is 1-10."),
    ("9-12", "Page 12 is out of bounds. Valid range is 1-10."),
    ("0", "Page 0 is out of bounds. Valid range is 1-10."),
    ("abc", "Invalid page number 'abc'."),
    ("3-1", "Invalid range '3-1': start page must be <= end page."),
    (",", "Page range ',' selected zero pages."),
])
def test_pages_the_pdf_does_not_have_are_refused_not_all_stamped(quiet_client, pages, detail):
    response = _stamp(quiet_client, pages)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == detail


def test_a_page_range_mistake_on_a_repaired_pdf_is_not_called_damage(quiet_client):
    # MuPDF opens this file repaired (its cross-reference table is cut off);
    # the page range is the problem, not the file.
    whole = _pdf()
    response = _stamp(quiet_client, "12", whole[: len(whole) * 97 // 100])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Page 12 is out of bounds. Valid range is 1-10."
