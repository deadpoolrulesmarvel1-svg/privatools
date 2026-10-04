"""Hidden Text Checker: every hiding technique is found, ordinary content is not.

The fixtures in hidden_text_pdfs.py are all generated here. Each hidden case
holds a visible line and a hidden payload; each control must give no findings.
The engine is tested directly (fast), and the route end to end through the
worker process it runs.
"""

from __future__ import annotations

import io
import time
from decimal import Decimal
from pathlib import Path

import fitz
import pikepdf
import pytest

from backend.app.services import _hidden_text_worker as worker
from backend.app.services import hidden_text_service
from backend.app.utils import cleanup
from backend.app.utils.page_space import rotation_as_shown
from backend.tests.hidden_text_pdfs import (
    CONTROL_CASES, HIDDEN_CASES, LINES, OCR_CONTROLS, PAYLOAD, PDFTEX_PROMPT, REDACTED_NAMES, REVIEW_CASES,
    REVIEW_CONTROLS, SECRET, VISIBLE, black_shading_tight, encrypted, many_pages, pdftex_prompt,
    soft_mask_black, type3_tag_characters, unreadable_only_page, unreadable_second_page,
    white_prompt_many_strokes,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
COMMITTED_PDFS = [
    REPO_ROOT / "frontend/public/samples/sample.pdf",
    REPO_ROOT / "frontend/public/api-starters/sample-first.pdf",
    REPO_ROOT / "frontend/public/api-starters/sample-second.pdf",
]


def check(data: bytes) -> dict:
    return worker.analyse(fitz.open("pdf", data))


# ── The engine ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", sorted(HIDDEN_CASES))
def test_each_hiding_technique_is_found_with_its_reason(name):
    builder, reason, payload = HIDDEN_CASES[name]
    report = check(builder())
    hits = [f for f in report["findings"] if f["reason"] == reason and payload in f["text"]]
    assert hits, report["findings"]
    assert report["summary"]["byReason"][reason] >= 1
    assert all(f["page"] == 1 and f["boxes"] and f["detail"] for f in report["findings"])
    # The visible line is never reported, whatever else is.
    assert not [f for f in report["findings"] if VISIBLE in f["text"]]


@pytest.mark.parametrize("name", sorted(CONTROL_CASES))
def test_ordinary_content_is_not_reported(name):
    report = check(CONTROL_CASES[name]())
    assert report["findings"] == []
    assert report["summary"]["findings"] == 0
    assert bool(report["ocr"]) == (name in OCR_CONTROLS)


@pytest.mark.parametrize("path", COMMITTED_PDFS, ids=lambda p: p.name)
def test_the_sample_pdfs_the_site_ships_are_clean(path):
    report = check(path.read_bytes())
    assert report["findings"] == [] and report["ocr"] == []


def test_every_box_is_a_fraction_of_the_page():
    for name, (builder, _reason, _payload) in HIDDEN_CASES.items():
        for finding in check(builder())["findings"]:
            for x0, y0, x1, y1 in finding["boxes"]:
                assert 0 <= x0 <= x1 <= 1 and 0 <= y0 <= y1 <= 1, (name, finding)


def test_boxes_follow_the_page_as_shown_when_it_is_turned():
    """/Rotate 90 shows the line of hidden text running down the page."""
    _builder, _reason, payload = HIDDEN_CASES["turned-page-white"]
    finding = next(f for f in check(HIDDEN_CASES["turned-page-white"][0]())["findings"] if payload in f["text"])
    (x0, y0, x1, y1), = finding["boxes"]
    assert y1 - y0 > 5 * (x1 - x0)
    # Unturned, the line starts 72 pt from the left and 200 pt from the top;
    # turned clockwise, that is 72 pt from the top and 592 pt from the left.
    assert y0 == pytest.approx(72 / 612, abs=0.01)
    assert x0 == pytest.approx((792 - 200) / 792, abs=0.02)


def test_text_placed_off_the_page_is_marked_at_the_nearest_edge():
    finding = next(f for f in check(HIDDEN_CASES["off-page"][0]())["findings"] if f["reason"] == "off-page")
    (x0, _y0, x1, _y1), = finding["boxes"]
    assert x1 == pytest.approx(1.0) and 0 < x1 - x0 < 0.02


def test_only_the_words_under_the_box_are_reported():
    """A redaction box over part of a line hides those words, not the line."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 200), f"Name: {SECRET}. Filed in March.", fontsize=11)
    box = page.search_for(SECRET)[0]
    page.draw_rect(box + (-1, -1, 1, 1), color=None, fill=(0, 0, 0))
    findings = check(doc.tobytes())["findings"]
    assert [f["reason"] for f in findings] == ["covered"]
    assert findings[0]["text"].strip(" .") == SECRET


def test_the_layer_that_hides_text_is_named():
    finding = check(HIDDEN_CASES["hidden-layer"][0]())["findings"][0]
    assert "Reviewer notes" in finding["detail"]


def test_an_ocr_layer_is_listed_apart_from_hidden_text():
    report = check(CONTROL_CASES["ocr-scan"]())
    assert report["findings"] == []
    assert report["summary"]["ocrPages"] == [1]
    ocr = report["ocr"][0]
    assert ocr["page"] == 1 and ocr["words"] >= 20 and "quick brown fox" in ocr["text"]


def test_a_prompt_over_the_blank_margin_of_a_scan_is_hidden_text_not_ocr():
    report = check(HIDDEN_CASES["scan-with-prompt"][0]())
    assert [f["reason"] for f in report["findings"]] == ["invisible"]
    assert PAYLOAD in report["findings"][0]["text"]
    assert PAYLOAD not in report["ocr"][0]["text"]


def test_a_page_image_over_text_reports_only_the_words_it_blacks_out():
    report = check(HIDDEN_CASES["screenshot-redaction"][0]())
    assert [f["text"] for f in report["findings"]] == [SECRET]
    assert "dark bar" in report["findings"][0]["detail"]
    assert "Dear Sir or Madam" in report["ocr"][0]["text"]


def test_counts_add_up_by_reason_and_page():
    doc = fitz.open()
    for colour, payload in (((1, 1, 1), "white words on page one"), ((0, 0, 0), None)):
        page = doc.new_page()
        page.insert_text((72, 90), VISIBLE, fontsize=11)
        if payload:
            page.insert_text((72, 200), payload, fontsize=11, color=colour)
    doc[1].insert_text((72, 200), "invisible words on page two", fontsize=11, render_mode=3)
    doc[1].insert_text((72, 300), "tiny words on page two", fontsize=0.8)
    report = check(doc.tobytes())
    summary = report["summary"]
    assert summary["findings"] == 3
    assert {k: v for k, v in summary["byReason"].items() if v} == {"same-colour": 1, "invisible": 1, "tiny": 1}
    assert summary["wordsByReason"]["invisible"] == 5
    assert summary["pagesWithFindings"] == [1, 2]
    assert report["pages"] == report["pagesChecked"] == 2


def test_a_file_with_no_text_says_so():
    doc = fitz.open()
    page = doc.new_page()
    page.draw_rect(fitz.Rect(72, 72, 300, 300), color=None, fill=(0.2, 0.4, 0.6))
    report = check(doc.tobytes())
    assert report["findings"] == []
    assert any("No text was found" in note for note in report["notes"])


def test_a_page_drawing_too_many_shapes_is_checked_for_the_rest_and_says_so():
    shapes = b"0 0 1 rg\n" + b"10 10 2 2 re f\n" * (worker.MAX_PAGE_DRAWINGS + 1)
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(612, 792))
    page = pdf.pages[0]
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)
    page.obj.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=pdf.make_indirect(font)))
    page.obj.Contents = pdf.make_stream(shapes + b"BT /F1 11 Tf 3 Tr 72 600 Td (still found) Tj ET\n")
    out = io.BytesIO()
    pdf.save(out)
    report = check(out.getvalue())
    assert [f["reason"] for f in report["findings"]] == ["invisible"]
    assert report["summary"]["pagesPartlyChecked"] == [1]
    assert any("text under shapes was not checked" in note for note in report["notes"])


def test_findings_quote_long_text_only_up_to_the_limit():
    doc = fitz.open()
    page = doc.new_page()
    words = "hidden words " * 400
    rect = fitz.Rect(40, 40, 570, 750)
    page.insert_textbox(rect, words, fontsize=6, color=(1, 1, 1))
    finding = check(doc.tobytes())["findings"][0]
    assert finding["truncated"] is True
    assert len(finding["text"]) == worker.MAX_FINDING_TEXT
    assert finding["words"] == 800


def test_a_long_finding_marks_at_most_the_box_limit():
    """One box per line, up to the limit, so the report stays within its size."""
    doc = fitz.open()
    page = doc.new_page()
    for line in range(worker.MAX_FINDING_BOXES + 20):
        page.insert_text((40, 20 + 9 * line), f"hidden line {line}", fontsize=6, color=(1, 1, 1))
    finding = check(doc.tobytes())["findings"][0]
    assert finding["words"] == 3 * (worker.MAX_FINDING_BOXES + 20)
    assert len(finding["boxes"]) == worker.MAX_FINDING_BOXES


# ── Cases from the first review, each missed or mislabelled before ──────────

@pytest.mark.parametrize("name", sorted(REVIEW_CASES))
def test_each_case_from_the_review_is_found(name):
    builder, reason, needle = REVIEW_CASES[name]
    report = check(builder())
    hits = [f for f in report["findings"] if needle in f["text"] and reason in ("any", f["reason"])]
    assert hits, report["findings"]
    visible = [f for f in report["findings"] if VISIBLE in f["text"] or LINES[0] in f["text"]]
    assert not visible


@pytest.mark.parametrize("name", sorted(REVIEW_CONTROLS))
def test_ordinary_content_from_the_review_is_not_reported(name):
    report = check(REVIEW_CONTROLS[name]())
    assert report["findings"] == [] and report["ocr"] == []
    assert report["summary"]["pagesNotChecked"] == [] and report["summary"]["pagesPartlyChecked"] == []


def test_every_name_under_tight_black_shading_is_reported_whole():
    """The shading starts at each name's first letter and ends at its last, the way Word and
    Chromium draw a black background: its anti-aliased edge must not count as the words' ink."""
    findings = check(black_shading_tight())["findings"]
    assert sorted(f["text"] for f in findings) == sorted(REDACTED_NAMES)
    assert {f["reason"] for f in findings} == {"same-colour"}


def test_a_page_that_cannot_be_read_is_named_and_no_clean_note_is_given():
    report = check(unreadable_second_page())
    assert report["pages"] == 2 and report["pagesChecked"] == 1
    assert report["summary"]["pagesNotChecked"] == [2]
    assert any("Page 2 could not be read" in note for note in report["notes"])
    assert not any("No text was found" in note for note in report["notes"])


def test_a_pdf_whose_pages_cannot_be_read_is_refused():
    with pytest.raises(worker.Refusal) as refused:
        check(unreadable_only_page())
    assert refused.value.kind == "unreadable"


def test_a_page_past_the_drawing_limit_is_checked_for_colour_and_named_as_partly_checked():
    report = check(white_prompt_many_strokes())
    assert [f["reason"] for f in report["findings"]] == ["same-colour"]
    assert report["summary"]["pagesPartlyChecked"] == [1]
    assert any("text under shapes was not checked" in note for note in report["notes"])


def test_words_set_apart_by_kerning_keep_their_spaces():
    finding = check(pdftex_prompt())["findings"][0]
    assert finding["text"] == PDFTEX_PROMPT
    assert finding["words"] == 12


def test_tag_characters_are_decoded_so_the_hidden_words_can_be_read():
    finding = check(type3_tag_characters())["findings"][0]
    assert finding["text"] == PAYLOAD
    assert "tag characters" in finding["detail"]


def test_text_hidden_by_a_soft_mask_is_not_said_to_be_on_a_black_background():
    finding = check(soft_mask_black())["findings"][0]
    assert "black" not in finding["detail"]


def test_rotation_is_read_as_the_preview_reads_it():
    """The worker cannot import page_space; its twin must give the same answers."""
    for raw in (None, 0, 90, 180, 270, -90, 450, 80, 90.0, -270.0, 1e300, True, "90"):
        assert worker.rotation_as_shown(raw) == rotation_as_shown(raw), raw
    assert rotation_as_shown(Decimal("90")) == worker.rotation_as_shown(90.0)


def test_the_service_names_the_workers_page_limit():
    assert hidden_text_service.MAX_PAGES == worker.MAX_PAGES


# ── The route ────────────────────────────────────────────────────────────────

def post(client, data: bytes, name: str = "in.pdf"):
    return client.post("/api/hidden-text-checker", files={"file": (name, data, "application/pdf")})


def test_the_route_reports_hidden_text_and_is_not_cached(client):
    resp = post(client, HIDDEN_CASES["white-on-white"][0]())
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-store"
    body = resp.json()
    assert "ok" not in body
    assert body["summary"]["byReason"]["same-colour"] == 1
    assert body["findings"][0]["text"] == PAYLOAD


def test_the_route_finds_text_in_a_layer_that_is_switched_off(client):
    """Through the worker process, which reads the upload from its file."""
    resp = post(client, HIDDEN_CASES["hidden-layer-indirect"][0]())
    assert resp.status_code == 200
    finding = resp.json()["findings"][0]
    assert finding["reason"] == "hidden-layer" and finding["text"] == PAYLOAD
    assert "Reviewer notes" in finding["detail"]


def test_the_route_keeps_no_copy_of_the_upload(client):
    before = set(cleanup.TEMP_DIR.glob("hidden_text_*")) if cleanup.TEMP_DIR.exists() else set()
    assert post(client, HIDDEN_CASES["black-box"][0]()).status_code == 200
    after = set(cleanup.TEMP_DIR.glob("hidden_text_*")) if cleanup.TEMP_DIR.exists() else set()
    assert after <= before


@pytest.mark.parametrize("name, data, words", [
    ("notes.txt", b"%PDF-1.7 not really", "not a PDF"),
    ("in.pdf", b"", "empty"),
    ("in.pdf", b"PK\x03\x04 a zip file", "does not appear to be a PDF"),
])
def test_the_route_refuses_what_is_not_a_pdf(client, name, data, words):
    resp = post(client, data, name)
    assert resp.status_code == 400
    assert words in resp.json()["detail"]


def test_a_password_protected_pdf_is_refused(client):
    resp = post(client, encrypted())
    assert resp.status_code == 400
    assert "password" in resp.json()["detail"]


def test_an_unreadable_pdf_is_refused(client):
    resp = post(client, b"%PDF-1.7\n1 0 obj\n" + b"\x00garbage\xff" * 200)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "corrupt" in detail or "no pages" in detail


def test_a_pdf_whose_pages_cannot_be_read_is_answered_with_a_400(client):
    resp = post(client, unreadable_only_page())
    assert resp.status_code == 400
    assert "could not be read" in resp.json()["detail"]


def test_the_time_limit_grows_with_the_file_up_to_the_most_allowed():
    """A small file gets a short limit, so one cannot hold a heavy slot for long."""
    small, large = hidden_text_service.time_limit(80_000), hidden_text_service.time_limit(8_000_000)
    assert 20 <= small < 25
    assert large == hidden_text_service.TIME_LIMIT_MAX_SECONDS == 90


def test_too_many_pages_is_refused_with_the_count_and_the_limit(client):
    started = time.monotonic()
    resp = post(client, many_pages(worker.MAX_PAGES + 1))
    assert resp.status_code == 413
    detail = resp.json()["detail"]
    assert f"{worker.MAX_PAGES + 1:,} pages" in detail and f"at most {worker.MAX_PAGES:,}" in detail
    assert "Split PDF" in detail
    assert time.monotonic() - started < 30


def _stub_worker(tmp_path, monkeypatch, body: str) -> None:
    stub = tmp_path / "stub_hidden_text_worker.py"
    stub.write_text(body)
    monkeypatch.setattr(hidden_text_service, "_WORKER", stub)


def test_a_check_that_never_finishes_is_stopped(client, monkeypatch, tmp_path):
    _stub_worker(tmp_path, monkeypatch, "import time\ntime.sleep(600)\n")
    monkeypatch.setattr(hidden_text_service, "time_limit", lambda size: 1)
    started = time.monotonic()
    resp = post(client, HIDDEN_CASES["tiny"][0]())
    # The global handler words every 5xx itself; the page explains the limit.
    assert resp.status_code == 504
    assert time.monotonic() - started < 15


@pytest.mark.parametrize("body", [
    "import os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n",
    "print('not json')\n",
    "print('{\"ok\": false, \"error\": \"too_many_pages\"}')\n",
], ids=["killed", "garbage", "refusal-without-counts"])
def test_a_check_that_fails_gives_a_500(client, monkeypatch, tmp_path, body):
    _stub_worker(tmp_path, monkeypatch, body)
    resp = post(client, HIDDEN_CASES["tiny"][0]())
    assert resp.status_code == 500


def test_a_check_that_runs_out_of_memory_is_a_413(client, monkeypatch, tmp_path):
    _stub_worker(tmp_path, monkeypatch, "print('{\"ok\": false, \"error\": \"too_large\"}')\n")
    resp = post(client, HIDDEN_CASES["tiny"][0]())
    assert resp.status_code == 413
    assert "Split PDF" in resp.json()["detail"]


def test_the_v1_api_serves_the_same_check(client):
    from backend.app.api_v1 import catalog, quota
    from backend.app.main import app

    paths = {route.path for route in catalog.public_routes(app)}
    assert "/api/v1/hidden-text-checker" in paths
    assert quota.cost_for("/api/v1/hidden-text-checker") == quota.HEAVY_COST
    assert catalog.metadata("/api/v1/hidden-text-checker")["response_media"] == ["application/json"]
