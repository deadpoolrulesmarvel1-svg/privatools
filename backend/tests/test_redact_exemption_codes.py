"""Redaction with statutory exemption codes, and the withholding log.

A plain black box answers "hide this". A FOIA or Privacy Act production has to
answer "under what authority" — the released page carries the citation, and the
producing party keeps an accounting of what was withheld under which exemption.
Adobe is the only competitor that does this; everyone else stops at the box.

There were no redaction tests at all before this file, so the basics are
covered here too: content under a rect must actually be gone, not covered.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz  # PyMuPDF

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.redact_service import (
    _readable_text_color,
    redact_pdf,
)


def _pdf(path: Path, pages: int = 1, secret: str = "CLASSIFIED SECRET") -> str:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page()
        page.insert_text((72, 100), secret, fontsize=12)
        page.insert_text((72, 300), "Public information", fontsize=12)
    doc.save(str(path))
    doc.close()
    return str(path)


def _text(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


# The rect covering the secret line in _pdf().
_SECRET_RECT = {"page": 0, "x0": 60, "y0": 85, "x1": 300, "y1": 110}


# ── the basics, which nothing covered before ────────────────────────────────

def test_redaction_actually_removes_the_content(tmp_path):
    out, _ = redact_pdf(_pdf(tmp_path / "a.pdf"), [dict(_SECRET_RECT)])
    text = _text(out)
    assert "CLASSIFIED SECRET" not in text
    assert "Public information" in text


def test_redaction_leaves_other_pages_alone(tmp_path):
    out, _ = redact_pdf(_pdf(tmp_path / "a.pdf", pages=3), [dict(_SECRET_RECT)])
    doc = fitz.open(out)
    try:
        assert "CLASSIFIED SECRET" not in doc[0].get_text()
        assert "CLASSIFIED SECRET" in doc[1].get_text()
        assert "CLASSIFIED SECRET" in doc[2].get_text()
    finally:
        doc.close()


def test_out_of_range_pages_are_skipped_not_fatal(tmp_path):
    out, report = redact_pdf(
        _pdf(tmp_path / "a.pdf", pages=1),
        [dict(_SECRET_RECT), {"page": 99, "x0": 0, "y0": 0, "x1": 10, "y1": 10}],
    )
    assert report["totalRedactions"] == 1
    assert Path(out).exists()


# ── exemption codes ─────────────────────────────────────────────────────────

def test_the_exemption_code_is_stamped_onto_the_page(tmp_path):
    out, _ = redact_pdf(
        _pdf(tmp_path / "a.pdf"),
        [{**_SECRET_RECT, "code": "(b)(6)"}],
    )
    text = _text(out)
    assert "(b)(6)" in text, "exemption code was not written into the redacted area"
    assert "CLASSIFIED SECRET" not in text


def test_the_code_survives_as_flattened_content_not_an_annotation(tmp_path):
    """A citation someone can peel off is not a citation."""
    out, _ = redact_pdf(_pdf(tmp_path / "a.pdf"), [{**_SECRET_RECT, "code": "(b)(7)(C)"}])
    doc = fitz.open(out)
    try:
        page = doc[0]
        assert "(b)(7)(C)" in page.get_text()
        assert len(list(page.annots() or [])) == 0, "left a live annotation behind"
    finally:
        doc.close()


def test_over_long_codes_are_truncated_rather_than_overflowing(tmp_path):
    out, report = redact_pdf(
        _pdf(tmp_path / "a.pdf"),
        [{**_SECRET_RECT, "code": "X" * 100}],
    )
    assert Path(out).exists()
    code = next(iter(report["codes"]))
    assert len(code) <= 32


# ── the withholding log ─────────────────────────────────────────────────────

def test_report_counts_redactions_per_code(tmp_path):
    _, report = redact_pdf(
        _pdf(tmp_path / "a.pdf", pages=2),
        [
            {"page": 0, "x0": 60, "y0": 85, "x1": 200, "y1": 110, "code": "(b)(6)"},
            {"page": 0, "x0": 60, "y0": 290, "x1": 200, "y1": 310, "code": "(b)(6)"},
            {"page": 1, "x0": 60, "y0": 85, "x1": 200, "y1": 110, "code": "(b)(7)(C)"},
        ],
    )
    assert report["totalRedactions"] == 3
    assert report["codes"] == {"(b)(6)": 2, "(b)(7)(C)": 1}
    assert report["uncoded"] == 0


def test_report_breaks_down_by_page(tmp_path):
    _, report = redact_pdf(
        _pdf(tmp_path / "a.pdf", pages=2),
        [
            {"page": 0, "x0": 60, "y0": 85, "x1": 200, "y1": 110, "code": "(b)(6)"},
            {"page": 1, "x0": 60, "y0": 85, "x1": 200, "y1": 110, "code": "(b)(6)"},
            {"page": 1, "x0": 60, "y0": 290, "x1": 200, "y1": 310, "code": "(b)(5)"},
        ],
    )
    pages = {row["page"]: row for row in report["pages"]}
    # Reported 1-indexed, the way a person cites a page.
    assert pages[1]["count"] == 1
    assert pages[2]["count"] == 2
    assert pages[2]["codes"] == {"(b)(6)": 1, "(b)(5)": 1}


def test_uncoded_redactions_are_counted_separately(tmp_path):
    """Mixing coded and uncoded is a real state — the log has to show it."""
    _, report = redact_pdf(
        _pdf(tmp_path / "a.pdf"),
        [
            {**_SECRET_RECT, "code": "(b)(6)"},
            {"page": 0, "x0": 60, "y0": 290, "x1": 200, "y1": 310},
        ],
    )
    assert report["totalRedactions"] == 2
    assert report["uncoded"] == 1
    assert report["codes"] == {"(b)(6)": 1}


def test_report_is_json_serialisable(tmp_path):
    """It travels as a response header, so it has to survive json.dumps."""
    _, report = redact_pdf(_pdf(tmp_path / "a.pdf"), [{**_SECRET_RECT, "code": "(b)(6)"}])
    assert json.loads(json.dumps(report)) == report


# ── legibility ──────────────────────────────────────────────────────────────

def test_code_colour_contrasts_with_the_box():
    """An unreadable citation is the same as no citation."""
    assert _readable_text_color((0.0, 0.0, 0.0)) == (1.0, 1.0, 1.0)   # white on black
    assert _readable_text_color((1.0, 1.0, 1.0)) == (0.0, 0.0, 0.0)   # black on white
    # Green is perceptually bright, so it takes dark text despite being a colour.
    assert _readable_text_color((0.0, 1.0, 0.0)) == (0.0, 0.0, 0.0)
    assert _readable_text_color((0.0, 0.0, 1.0)) == (1.0, 1.0, 1.0)   # dark blue


def test_a_white_box_still_stamps_a_readable_code(tmp_path):
    out, _ = redact_pdf(
        _pdf(tmp_path / "a.pdf"), [{**_SECRET_RECT, "code": "(b)(5)"}], color="#FFFFFF"
    )
    assert "(b)(5)" in _text(out)


# ── HTTP ────────────────────────────────────────────────────────────────────

def test_endpoint_returns_the_withholding_log(client, tmp_path):
    data = Path(_pdf(tmp_path / "a.pdf")).read_bytes()
    res = client.post(
        "/api/redact",
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"redactions": json.dumps([{**_SECRET_RECT, "code": "(b)(6)"}])},
    )
    assert res.status_code == 200
    report = json.loads(res.headers["X-Redaction-Report"])
    assert report["codes"] == {"(b)(6)": 1}
    assert report["totalRedactions"] == 1


def test_endpoint_rejects_a_non_string_code(client, tmp_path):
    data = Path(_pdf(tmp_path / "a.pdf")).read_bytes()
    res = client.post(
        "/api/redact",
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"redactions": json.dumps([{**_SECRET_RECT, "code": 42}])},
    )
    assert res.status_code == 400


def test_endpoint_rejects_an_over_long_code(client, tmp_path):
    data = Path(_pdf(tmp_path / "a.pdf")).read_bytes()
    res = client.post(
        "/api/redact",
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"redactions": json.dumps([{**_SECRET_RECT, "code": "X" * 100}])},
    )
    assert res.status_code == 400
