"""N-Up answers a PDF without pages as every other tool does.

It answered 500 ("Processing failed. Please try again.") for 2-up side by
side and the larger layouts, where its service found no page to lay out, and
a 400 in its own words for 2-up stacked. The other tools answer 400 "This PDF
has no pages.", which the page shows as "This PDF has no pages. Pick a
different file."
"""

from __future__ import annotations

import io

import pikepdf
import pytest


def _zero_pages() -> bytes:
    # A valid PDF whose page tree holds no pages.
    with pikepdf.new() as pdf:
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


@pytest.mark.parametrize("form", [{"pages_per_sheet": "2"}, {"pages_per_sheet": "2", "orientation": "stack"},
                                  {"pages_per_sheet": "4"}], ids=["2-side", "2-stack", "4"])
def test_nup_refuses_a_pdf_without_pages_like_the_other_tools(client, form):
    """N-Up answered 500 to a PDF with no pages (2-side and 4-up) or a 400 in
    its own words (2-stack); the other tools answer "This PDF has no pages."."""
    resp = client.post("/api/nup", files={"file": ("empty.pdf", _zero_pages(), "application/pdf")}, data=form)
    assert resp.status_code == 400, (form, resp.status_code, resp.text[:200])
    assert resp.json()["detail"] == "This PDF has no pages."
    same = client.post("/api/split-in-half", files={"file": ("empty.pdf", _zero_pages(), "application/pdf")},
                       data={"direction": "vertical"})
    assert (same.status_code, same.json()["detail"]) == (400, "This PDF has no pages.")
