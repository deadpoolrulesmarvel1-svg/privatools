"""Bates numbering: continuous multi-file sequences, suffixes, and removal.

The competitor audit found ours exposed prefix, start, digits and 6 positions,
while Adobe and Foxit also have a suffix, a page range, removal, and — the one
that matters — a single continuous sequence across a multi-file production.

Our own code comment admitted it: "each PDF gets its own sequence starting at
`start_number`". For the audience Bates numbering exists for, a production set
numbered per-file is not a smaller feature, it is the wrong output.
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz  # PyMuPDF
import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.bates_numbering_service import (
    add_bates_numbering,
    add_bates_numbering_batch,
    format_bates,
    remove_bates_numbering,
)


def _pdf(path: Path, pages: int = 3, body: str = "Body text") -> str:
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 300), f"{body} {i + 1}", fontsize=12)
    doc.save(str(path))
    doc.close()
    return str(path)


def _page_texts(pdf_path: str) -> list[str]:
    doc = fitz.open(pdf_path)
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def _all_text(pdf_path: str) -> str:
    return "\n".join(_page_texts(pdf_path))


# ── stamping ────────────────────────────────────────────────────────────────

def test_stamps_every_page_in_sequence(tmp_path):
    out, nxt = add_bates_numbering(_pdf(tmp_path / "a.pdf", 3), prefix="ABC", digits=6)
    texts = _page_texts(out)

    assert "ABC000001" in texts[0]
    assert "ABC000002" in texts[1]
    assert "ABC000003" in texts[2]
    assert nxt == 4


def test_suffix_is_appended(tmp_path):
    out, _ = add_bates_numbering(
        _pdf(tmp_path / "a.pdf", 2), prefix="SMITH", suffix="-CONF", digits=4
    )
    assert "SMITH0001-CONF" in _all_text(out)


def test_page_range_restricts_which_pages_are_stamped(tmp_path):
    out, nxt = add_bates_numbering(_pdf(tmp_path / "a.pdf", 4), prefix="X", pages="2-3")
    texts = _page_texts(out)

    assert "X000001" not in texts[0]
    assert "X000001" in texts[1]
    assert "X000002" in texts[2]
    assert "X000002" not in texts[3]
    # The counter advances only for stamped pages, so the sequence stays dense.
    assert nxt == 3


def test_font_size_is_clamped_rather_than_rejected(tmp_path):
    out, _ = add_bates_numbering(_pdf(tmp_path / "a.pdf", 1), prefix="F", font_size=9999)
    assert "F000001" in _all_text(out)


@pytest.mark.parametrize("position", [
    "bottom-right", "bottom-left", "bottom-center",
    "top-right", "top-left", "top-center",
])
def test_every_position_renders(tmp_path, position):
    out, _ = add_bates_numbering(
        _pdf(tmp_path / f"{position}.pdf", 1), prefix="P", position=position
    )
    assert "P000001" in _all_text(out)


# ── the batch behaviour this was built for ──────────────────────────────────

def test_batch_numbers_files_as_one_continuous_sequence(tmp_path):
    """The headline fix: file 2 continues from file 1 instead of restarting."""
    a = _pdf(tmp_path / "a.pdf", 3)
    b = _pdf(tmp_path / "b.pdf", 2)
    c = _pdf(tmp_path / "c.pdf", 4)

    outputs, manifest = add_bates_numbering_batch([a, b, c], prefix="PROD", digits=6)

    assert "PROD000001" in _page_texts(outputs[0])[0]
    assert "PROD000003" in _page_texts(outputs[0])[2]
    # File 2 must start at 4, not back at 1.
    assert "PROD000004" in _page_texts(outputs[1])[0]
    assert "PROD000005" in _page_texts(outputs[1])[1]
    assert "PROD000006" in _page_texts(outputs[2])[0]
    assert "PROD000009" in _page_texts(outputs[2])[3]


def test_batch_never_reuses_a_number(tmp_path):
    paths = [_pdf(tmp_path / f"f{i}.pdf", 2) for i in range(5)]
    outputs, _ = add_bates_numbering_batch(paths, prefix="N", digits=5)

    seen = []
    for out in outputs:
        for text in _page_texts(out):
            seen.extend(
                token for token in text.split() if token.startswith("N0")
            )
    assert len(seen) == len(set(seen)), f"duplicate Bates numbers: {seen}"
    assert len(seen) == 10


def test_batch_manifest_records_the_range_on_each_file(tmp_path):
    a = _pdf(tmp_path / "a.pdf", 3)
    b = _pdf(tmp_path / "b.pdf", 2)
    _, manifest = add_bates_numbering_batch([a, b], prefix="M", digits=4)

    assert manifest[0] == {
        "index": 0, "pages": 3, "firstBates": "M0001", "lastBates": "M0003",
    }
    assert manifest[1] == {
        "index": 1, "pages": 2, "firstBates": "M0004", "lastBates": "M0005",
    }


def test_batch_honours_the_starting_number(tmp_path):
    a = _pdf(tmp_path / "a.pdf", 2)
    b = _pdf(tmp_path / "b.pdf", 2)
    _, manifest = add_bates_numbering_batch([a, b], prefix="S", start_number=500, digits=6)

    assert manifest[0]["firstBates"] == "S000500"
    assert manifest[1]["firstBates"] == "S000502"


def test_batch_of_one_matches_the_single_file_path(tmp_path):
    a = _pdf(tmp_path / "a.pdf", 2)
    outputs, manifest = add_bates_numbering_batch([a], prefix="Q")
    assert manifest[0]["firstBates"] == "Q000001"
    assert "Q000002" in _all_text(outputs[0])


# ── removal ─────────────────────────────────────────────────────────────────

def test_removal_takes_out_the_stamps_we_added(tmp_path):
    stamped, _ = add_bates_numbering(
        _pdf(tmp_path / "a.pdf", 3), prefix="DEL", digits=6
    )
    assert "DEL000001" in _all_text(stamped)

    cleaned, removed = remove_bates_numbering(stamped, prefix="DEL", digits=6)
    assert removed == 3
    assert "DEL000001" not in _all_text(cleaned)


def test_removal_leaves_the_body_text_alone(tmp_path):
    stamped, _ = add_bates_numbering(
        _pdf(tmp_path / "a.pdf", 2, body="Important content"), prefix="KEEP", digits=6
    )
    cleaned, _ = remove_bates_numbering(stamped, prefix="KEEP", digits=6)
    text = _all_text(cleaned)
    assert "Important content" in text


def test_removal_ignores_bates_shaped_text_in_the_body(tmp_path):
    """A caption reading 000123 mid-page must survive.

    Removal is confined to the margin band precisely so that matching on shape
    alone can't eat real content.
    """
    path = tmp_path / "tricky.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 400), "000123", fontsize=12)   # mid-page, Bates-shaped
    doc.save(str(path))
    doc.close()

    cleaned, removed = remove_bates_numbering(str(path), digits=6)
    assert removed == 0
    assert "000123" in _all_text(cleaned)


def test_removal_reports_zero_when_nothing_matches(tmp_path):
    cleaned, removed = remove_bates_numbering(_pdf(tmp_path / "plain.pdf", 2), prefix="ZZZ")
    assert removed == 0


def test_removal_round_trips_with_a_suffix(tmp_path):
    stamped, _ = add_bates_numbering(
        _pdf(tmp_path / "a.pdf", 2), prefix="AB", suffix="-X", digits=4
    )
    assert "AB0001-X" in _all_text(stamped)
    cleaned, removed = remove_bates_numbering(stamped, prefix="AB", suffix="-X", digits=4)
    assert removed == 2
    assert "AB0001-X" not in _all_text(cleaned)


# ── formatting ──────────────────────────────────────────────────────────────

def test_format_bates_pads_and_affixes():
    assert format_bates("ABC", 7, 6) == "ABC000007"
    assert format_bates("", 42, 4, "-END") == "0042-END"
    assert format_bates("", 1, 1) == "1"


# ── HTTP endpoints ──────────────────────────────────────────────────────────

import io  # noqa: E402
import json  # noqa: E402
import zipfile  # noqa: E402


def test_single_endpoint_reports_the_next_number(client, tmp_path):
    """X-Bates-Next lets a caller chain documents and keep one sequence."""
    data = Path(_pdf(tmp_path / "a.pdf", 3)).read_bytes()
    res = client.post(
        "/api/bates-numbering",
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"prefix": "H", "digits": "4", "start_number": "10"},
    )
    assert res.status_code == 200
    assert res.headers["X-Bates-First"] == "H0010"
    assert res.headers["X-Bates-Next"] == "13"


def test_batch_endpoint_returns_a_zip_with_a_manifest(client, tmp_path):
    a = Path(_pdf(tmp_path / "a.pdf", 2)).read_bytes()
    b = Path(_pdf(tmp_path / "b.pdf", 3)).read_bytes()
    res = client.post(
        "/api/bates-numbering-batch",
        files=[
            ("files", ("a.pdf", a, "application/pdf")),
            ("files", ("b.pdf", b, "application/pdf")),
        ],
        data={"prefix": "SET", "digits": "5"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"

    manifest = json.loads(res.headers["X-Bates-Manifest"])
    assert manifest[0]["firstBates"] == "SET00001"
    assert manifest[0]["lastBates"] == "SET00002"
    # Continuous: the second file starts at 3, not back at 1.
    assert manifest[1]["firstBates"] == "SET00003"
    assert manifest[1]["lastBates"] == "SET00005"

    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        names = zf.namelist()
        assert "bates-manifest.json" in names
        assert len([n for n in names if n.endswith(".pdf")]) == 2
        assert json.loads(zf.read("bates-manifest.json")) == manifest


def test_batch_endpoint_rejects_a_non_pdf(client, tmp_path):
    a = Path(_pdf(tmp_path / "a.pdf", 1)).read_bytes()
    res = client.post(
        "/api/bates-numbering-batch",
        files=[
            ("files", ("a.pdf", a, "application/pdf")),
            ("files", ("notes.txt", b"hello", "text/plain")),
        ],
    )
    assert res.status_code == 400


def test_endpoint_rejects_an_over_long_prefix(client, tmp_path):
    data = Path(_pdf(tmp_path / "a.pdf", 1)).read_bytes()
    res = client.post(
        "/api/bates-numbering",
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"prefix": "X" * 40},
    )
    assert res.status_code == 400


def test_remove_endpoint_reports_how_many_it_took_out(client, tmp_path):
    stamped, _ = add_bates_numbering(_pdf(tmp_path / "a.pdf", 3), prefix="RM", digits=6)
    res = client.post(
        "/api/bates-remove",
        files={"file": ("a.pdf", Path(stamped).read_bytes(), "application/pdf")},
        data={"prefix": "RM", "digits": "6"},
    )
    assert res.status_code == 200
    assert res.headers["X-Bates-Removed"] == "3"


def test_remove_endpoint_reports_zero_rather_than_failing(client, tmp_path):
    """A no-match must not look like an error — the UI says so explicitly."""
    data = Path(_pdf(tmp_path / "plain.pdf", 2)).read_bytes()
    res = client.post(
        "/api/bates-remove",
        files={"file": ("plain.pdf", data, "application/pdf")},
        data={"prefix": "NOPE"},
    )
    assert res.status_code == 200
    assert res.headers["X-Bates-Removed"] == "0"
