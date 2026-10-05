"""Form Creator's field detection: what it finds on forms, what it leaves
alone on documents that are not forms, and how its route answers.

The engine (_form_detect_worker) is tested directly on two synthetic
corpora, each sample generated here with the fields a person would place:
form_detect_pdfs.py draws one form per layout (the detector was written
against it), and form_detect_varied.py lays forms and other documents out at
random from fixed seeds with another library. Precision and recall are
measured per field type and held above conservative floors; the documents
that are not forms must give nothing at all. The route is tested end to end
through the worker process it runs, and with stub workers for the ways a
worker can fail.
"""

from __future__ import annotations

import json
import re
import time

import fitz  # PyMuPDF
import pytest

from backend.app.services import _form_detect_worker as worker
from backend.app.services import form_detect_service
from backend.app.utils import cleanup
from backend.tests import form_detect_pdfs as corpus
from backend.tests import form_detect_varied as varied

TYPES = ("text", "checkbox", "signature", "date")
# A candidate matches a field when they overlap by this share of their union:
# a field on a line is a strip whose height is a convention.
MATCH_IOU = 0.35
# Conservative floors, well under what the corpora measure (see the PR).
MIN_PRECISION = 0.95
MIN_RECALL = 0.90


def _iou(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    inter = (x1 - x0) * (y1 - y0)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def detect(data: bytes) -> dict:
    return worker.detect(fitz.open("pdf", data))


def score(samples) -> dict[str, dict[str, int]]:
    """True and false positives and misses per type over `samples`: a
    candidate counts for its type only if it lies on a field of that type."""
    counts = {t: {"tp": 0, "fp": 0, "fn": 0} for t in TYPES}
    for sample in samples:
        report = detect(sample.data)
        truth = list(sample.fields)
        used: set[int] = set()
        for c in report["candidates"]:
            rect = (c["x"], c["y"], c["x"] + c["width"], c["y"] + c["height"])
            best, best_iou = None, 0.0
            for i, t in enumerate(truth):
                if t.page == c["page"] and i not in used and (v := _iou(rect, t.rect)) > best_iou:
                    best, best_iou = i, v
            if best is not None and best_iou >= MATCH_IOU:
                used.add(best)
                if truth[best].type == c["type"]:
                    counts[c["type"]]["tp"] += 1
                    continue
                counts[truth[best].type]["fn"] += 1
            counts[c["type"]]["fp"] += 1
        for i, t in enumerate(truth):
            if i not in used:
                counts[t.type]["fn"] += 1
    return counts


def assert_floors(counts) -> None:
    for kind, c in counts.items():
        precision = c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else 1.0
        recall = c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else 1.0
        assert c["tp"] >= 5, (kind, c)  # every type is measured, not vacuously perfect
        assert precision >= MIN_PRECISION, (kind, c, precision)
        assert recall >= MIN_RECALL, (kind, c, recall)


# ── What it finds ────────────────────────────────────────────────────────────

FORMS = [builder() for builder in corpus.FORMS]
NON_FORMS = [builder() for builder in corpus.NON_FORMS]


def test_the_corpus_has_every_layout_and_twenty_forms():
    assert len(FORMS) >= 20
    layouts = {layout for sample in FORMS for layout in sample.layouts}
    assert {"label-and-underline", "boxed-inputs", "grid", "checkbox-list", "signature-block", "two-column",
            "rotated"} <= layouts
    assert {t.type for sample in FORMS for t in sample.fields} == set(TYPES)
    assert [s.name for s in NON_FORMS] == ["report", "invoice", "letter", "statement", "clinic-report"]


def test_precision_and_recall_on_the_drawn_forms():
    assert_floors(score(FORMS + NON_FORMS))


@pytest.mark.parametrize("sample", FORMS, ids=lambda s: s.name)
def test_each_layout_is_found(sample):
    counts = score([sample])
    found = sum(c["tp"] for c in counts.values())
    wrong = sum(c["fp"] for c in counts.values())
    assert found >= 0.8 * len(sample.fields), counts
    assert wrong <= 0.2 * max(found, 1), counts


@pytest.mark.parametrize("sample", NON_FORMS, ids=lambda s: s.name)
def test_a_document_that_is_not_a_form_gives_nothing(sample):
    """Rules under headings, ruled tables of data with empty cells, a bar
    chart, a footnote rule, an address box, a signature line over a person's
    name, and leaders to amounts and page numbers."""
    assert detect(sample.data)["candidates"] == []


def test_a_framed_picture_or_chart_is_not_a_blank(monkeypatch):
    """The clinic report's framed picture under a caption and framed line
    chart beside a label look like labelled empty boxes; what is drawn in
    them says they are not."""
    sample = corpus.clinic_report()
    assert detect(sample.data)["candidates"] == []
    monkeypatch.setattr(worker.PageReader, "inked", lambda self, box: False)
    assert {c["name"] for c in detect(sample.data)["candidates"]} == {"figure_3_clinic_waiting_times", "trend"}


def test_a_bold_heading_over_a_rule_is_not_a_question():
    """"Patient Information" names a field, but in bold over a rule it is a
    heading: only a heading ending with a colon or a question mark asks."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((54, 110), "Patient Information", fontname="hebo", fontsize=13)
    page.insert_text((54, 210), "Patient information", fontname="helv", fontsize=10.5)
    page.insert_text((54, 310), "Patient Information:", fontname="hebo", fontsize=13)
    shape = page.new_shape()
    for y in (124, 224, 324):
        shape.draw_line((54, y), (558, y))
    shape.finish(color=(0, 0, 0), width=0.8, closePath=False)
    shape.commit()
    found = detect(doc.tobytes())["candidates"]
    assert [round(c["y"] + c["height"]) for c in found] == [224, 324]


def test_precision_and_recall_on_random_forms():
    forms = [varied.varied_form(seed) for seed in varied.VARIED_SEEDS]
    documents = [varied.varied_document(seed) for seed in varied.VARIED_DOCUMENT_SEEDS]
    assert_floors(score(forms + documents))
    for document in documents:
        assert detect(document.data)["candidates"] == [], document.name


def test_types_follow_what_the_label_says():
    assert worker._kind("Date of birth:") == "date"
    assert worker._kind("Signature of applicant") == "signature"
    assert worker._kind("Sign here") == "signature"
    assert worker._kind("Date signed") == "date"
    assert worker._kind("Signature / date") == "signature"
    assert worker._kind("X") == "signature"
    assert worker._kind("Full name") == "text"
    assert worker._kind("Return by") == "text"  # the label does not say date


# ── Names ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("label, name", [
    ("1. Date of birth (DD/MM/YYYY):", "date_of_birth"),
    ("Full name:", "full_name"),
    ("Doctor's name", "doctor_s_name"),
    ("Prénom", "prenom"),
    ("Имя:", "имя"),
    ("(optional)", "optional"),
    ("e.g. a.b.c", "e_g_a_b_c"),
    ("", "text"),
    ("Name of the parent or guardian who will collect the child after school", "name_of_the_parent_or_guardian_who_will"),
])
def test_a_name_is_made_from_its_label(label, name):
    assert worker.field_name(label, "text") == name


def test_names_are_unique_safe_and_short_in_every_sample():
    for sample in FORMS + [varied.varied_form(seed) for seed in range(1, 11)]:
        names = [c["name"] for c in detect(sample.data)["candidates"]]
        assert len(names) == len(set(names)), sample.name
        for name in names:
            # No dot: in a PDF form a dot makes a name part of another field's.
            assert re.fullmatch(r"[^\W_](?:\w*[^\W_])?", name) and len(name) <= 45, (sample.name, name)


def test_names_come_from_the_nearest_label():
    names = {c["name"] for c in detect(corpus.contact_details().data)["candidates"]}
    assert {"full_name", "street_address", "date_of_birth", "signature", "date"} <= names
    glyphs = [c["name"] for c in detect(corpus.checkbox_glyphs().data)["candidates"]]
    assert glyphs[:2] == ["do_you_smoke_yes", "do_you_smoke_no"]
    assert "have_you_had_surgery_in_the_last_yes" in glyphs  # the question shortened, the option kept
    grid = {c["name"] for c in detect(corpus.timesheet().data)["candidates"]}
    assert {"monday_start", "friday_hours", "week_starting"} <= grid
    captions = {c["name"] for c in detect(corpus.grid_caption_cells().data)["candidates"]}
    assert {"surname", "date_of_birth", "permit_zone"} <= captions
    assert {c["name"] for c in detect(corpus.labels_on_lines().data)["candidates"]} >= {"name", "signature"}


def test_a_candidate_carries_what_the_route_and_the_page_need():
    report = detect(corpus.contact_details().data)
    assert set(report) == {"pages", "candidates", "truncated", "scanPages", "complexPages", "pagesNotChecked",
                           "existingFields"}
    first = report["candidates"][0]
    assert set(first) == {"id", "page", "x", "y", "width", "height", "type", "name", "label", "confidence",
                          "multiline"}
    assert first["label"] == "Full name:" and first["id"] == "c1"
    assert all(worker.MIN_CONFIDENCE <= c["confidence"] <= 1 for c in report["candidates"])
    multiline = [c for c in detect(corpus.answer_lines().data)["candidates"] if c["multiline"]]
    assert [c["name"] for c in multiline] == ["describe_what_happened", "names_of_any_witnesses"]


# ── Pages and files of every kind ────────────────────────────────────────────

@pytest.mark.parametrize("builder", [corpus.turned_90, corpus.turned_180, corpus.turned_270, corpus.cropped_page])
def test_turned_and_cropped_pages_give_boxes_on_the_page_as_stored(builder):
    sample = builder()
    doc = fitz.open("pdf", sample.data)
    for c in detect(sample.data)["candidates"]:
        page = doc[c["page"] - 1]
        stored = page.rect * page.derotation_matrix
        assert c["x"] >= 0 and c["y"] >= 0, c
        assert c["x"] + c["width"] <= abs(stored.width) + 0.01 and c["y"] + c["height"] <= abs(stored.height) + 0.01, c


def test_fields_the_pdf_already_has_are_not_proposed_again():
    sample = corpus.existing_fields()
    report = detect(sample.data)
    assert report["existingFields"] == 2
    assert {c["name"] for c in report["candidates"]} == {"new_address", "moving_date"}
    widgets = [w.rect for w in fitz.open("pdf", sample.data)[0].widgets()]
    for c in report["candidates"]:
        rect = fitz.Rect(c["x"], c["y"], c["x"] + c["width"], c["y"] + c["height"])
        assert not any(abs(rect & w) > 0 for w in widgets)


def test_a_name_the_pdf_already_uses_is_not_proposed():
    doc = fitz.open("pdf", corpus.contact_details().data)
    widget = fitz.Widget()
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "full_name"
    widget.rect = fitz.Rect(400, 700, 500, 720)  # elsewhere on the page
    doc[0].add_widget(widget)
    names = [c["name"] for c in detect(doc.tobytes())["candidates"]]
    assert "full_name" not in names and "full_name_2" in names


def test_a_scan_has_nothing_to_find_and_says_which_pages_are_pictures():
    report = detect(corpus.scanned())
    assert report["candidates"] == [] and report["scanPages"] == [1]
    mixed = detect(corpus.scan_then_form())
    assert mixed["scanPages"] == [1]
    assert mixed["candidates"] and {c["page"] for c in mixed["candidates"]} == {2}


def test_a_scan_with_an_ocr_layer_is_still_a_scan_and_a_page_over_a_picture_is_not():
    scan = fitz.open("pdf", corpus.scanned())
    scan[0].insert_text((72, 100), "Full name: ____________ Date of birth: ________", fontsize=11, render_mode=3)
    report = detect(scan.tobytes())
    assert report["candidates"] == [] and report["scanPages"] == [1]
    # A page printed over a picture that fills it, with nothing to fill in, is not a scan.
    picture = fitz.open("pdf", corpus.scanned())[0].get_pixmap(dpi=30).tobytes("png")
    doc = fitz.open()
    page = doc.new_page()
    page.insert_image(page.rect, stream=picture, overlay=False)
    page.insert_text((72, 140), "Thank you for your request. Cards are posted within ten days.", fontsize=11)
    report = detect(doc.tobytes())
    assert report["candidates"] == [] and report["scanPages"] == []


def test_invisible_text_such_as_an_ocr_layer_is_not_read():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Name: ______________________", fontsize=11, render_mode=3)
    page.insert_text((72, 140), "Phone: _____________________", fontsize=11)
    names = [c["name"] for c in detect(doc.tobytes())["candidates"]]
    assert names == ["phone"]


def test_a_page_that_draws_too_much_is_named_and_its_typed_blanks_still_found():
    doc = fitz.open()
    page = doc.new_page()
    shape = page.new_shape()
    for i in range(16_000):  # a dense chart: more path operators than read
        shape.draw_line((20 + i % 500, 400), (21 + i % 500, 401 + i % 300))
    shape.finish(color=(0.5, 0.5, 0.5), width=0.1, closePath=False)
    shape.commit()
    page.insert_text((72, 100), "Name: ______________________", fontsize=11)
    report = detect(doc.tobytes())
    assert report["complexPages"] == [1]
    assert [c["name"] for c in report["candidates"]] == ["name"]


def test_a_date_hint_is_read_in_one_pass():
    for hint in ("DD/MM/YYYY", "dd.mm.yy", "JJ/MM/AAAA", "TT.MM.JJJJ", "MM-DD-YYYY", "/ /", "ddmmyyyy"):
        assert worker.DATE_HINT.match(hint), hint
    for text in ("yyy", "Name", "DD/MM/YYYY!"):
        assert not worker.DATE_HINT.match(text), text
    # A box holding a long run of y's that is not a hint: when "yy|yyyy" sat
    # under the repeat, 80 of them cost about 40 s of CPU before failing.
    doc = fitz.open()
    page = doc.new_page()
    page.draw_rect(fitz.Rect(60, 90, 560, 120), color=(0, 0, 0), width=1)
    page.insert_text((66, 110), "y" * 80 + "!", fontsize=6)
    start = time.process_time()
    detect(doc.tobytes())
    assert time.process_time() - start < 5


def test_candidates_stop_at_the_number_form_creator_takes():
    report = detect(corpus.many_pages(40))  # 9 fields a page
    assert report["truncated"] is True
    assert len(report["candidates"]) == worker.MAX_CANDIDATES == form_detect_service.MAX_CANDIDATES
    assert len({c["name"] for c in report["candidates"]}) == worker.MAX_CANDIDATES


def test_the_service_states_the_workers_limits():
    assert form_detect_service.MAX_PAGES == worker.MAX_PAGES == 50
    assert form_detect_service.CPU_SECONDS_BASE == worker.CPU_SECONDS_BASE
    assert form_detect_service.CPU_SECONDS_PER_PAGE == worker.CPU_SECONDS_PER_PAGE
    assert form_detect_service.CPU_SECONDS_MAX == worker.CPU_SECONDS_MAX
    assert form_detect_service.cpu_budget(50) == worker.cpu_budget(50) == worker.CPU_SECONDS_MAX


# ── The route ────────────────────────────────────────────────────────────────

def post(client, data: bytes, name: str = "form.pdf"):
    return client.post("/api/form-creator/detect", files={"file": (name, data, "application/pdf")})


def test_the_route_answers_with_candidates_and_is_not_cached(client):
    resp = post(client, corpus.contact_details().data)
    assert resp.status_code == 200, resp.text
    assert "no-store" in resp.headers["cache-control"]
    body = resp.json()
    assert "ok" not in body
    assert [c["name"] for c in body["candidates"]][:3] == ["full_name", "street_address", "city"]


def test_the_route_keeps_no_copy_of_the_upload(client):
    before = set(cleanup.TEMP_DIR.glob("form_detect_*")) if cleanup.TEMP_DIR.exists() else set()
    assert post(client, corpus.checkbox_squares().data).status_code == 200
    after = set(cleanup.TEMP_DIR.glob("form_detect_*")) if cleanup.TEMP_DIR.exists() else set()
    assert after <= before


def test_detected_fields_are_created_by_form_creator_and_can_be_filled(client):
    """What the page does once the visitor accepts every candidate: dates
    become text fields, and the result holds one working field for each."""
    source = corpus.application_two_pages().data
    candidates = post(client, source).json()["candidates"]
    payload = [{"name": c["name"], "type": "text" if c["type"] == "date" else c["type"], "page": c["page"],
                "x": c["x"], "y": c["y"], "width": c["width"], "height": c["height"],
                **({"multiline": True} if c["multiline"] else {})} for c in candidates]
    created = client.post("/api/form-creator", files={"file": ("form.pdf", source, "application/pdf")},
                          data={"form_fields": json.dumps(payload)})
    assert created.status_code == 200, created.text
    doc = fitz.open("pdf", created.content)
    kinds = {w.field_name: w.field_type for page in doc for w in page.widgets()}
    assert set(kinds) == {c["name"] for c in candidates}
    expected = {"text": fitz.PDF_WIDGET_TYPE_TEXT, "date": fitz.PDF_WIDGET_TYPE_TEXT,
                "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX, "signature": fitz.PDF_WIDGET_TYPE_SIGNATURE}
    assert all(kinds[c["name"]] == expected[c["type"]] for c in candidates)
    page = doc[0]
    for widget in page.widgets():
        if widget.field_name == "full_name":
            widget.field_value = "Ada Example"
            widget.update()
    refilled = fitz.open("pdf", doc.tobytes())
    assert {w.field_name: w.field_value for p in refilled for w in p.widgets()}["full_name"] == "Ada Example"


def test_too_many_pages_is_refused_with_the_count_and_the_limit(client):
    started = time.monotonic()
    resp = post(client, corpus.many_pages(worker.MAX_PAGES + 1))
    assert resp.status_code == 413
    detail = resp.json()["detail"]
    assert f"{worker.MAX_PAGES + 1} pages" in detail and f"at most {worker.MAX_PAGES}" in detail
    assert "by hand" in detail
    assert time.monotonic() - started < 30


def test_a_scan_is_a_422_that_says_to_place_fields_by_hand(client):
    resp = post(client, corpus.scanned())
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "pictures" in detail and "OCR PDF would add text, not lines" in detail and "by hand" in detail


def test_a_pdf_with_nothing_drawn_is_found_empty_not_refused(client):
    resp = post(client, corpus.blank_pages())
    assert resp.status_code == 200
    assert resp.json()["candidates"] == [] and resp.json()["scanPages"] == []


@pytest.mark.parametrize("name, data, words", [
    ("notes.txt", b"%PDF-1.7 not really", "Please upload a PDF"),
    ("form.pdf", b"", "empty"),
    ("form.pdf", b"PK\x03\x04 a zip file", "does not appear to be a PDF"),
])
def test_the_route_refuses_what_is_not_a_pdf(client, name, data, words):
    resp = post(client, data, name)
    assert resp.status_code == 400
    assert words in resp.json()["detail"]


def test_a_password_protected_pdf_gets_the_shared_answer(client, locked_pdf):
    resp = post(client, locked_pdf)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "This PDF is password-protected. Unlock it first, then try again."


def test_a_page_built_to_be_slow_is_stopped_by_the_workers_limits(client):
    """A page of a few kilobytes that draws an object of 5,000 lines 2,000
    times: its drawings expand to ten million lines in the worker, more than
    any machine finishes under the worker's memory and CPU limits, so it
    stops at one of them, and the visitor is told to place fields by hand."""
    doc = fitz.open()
    page = doc.new_page()
    lines = "".join(f"1 {i % 100 + 0.5:.1f} m 99 {i % 100 + 0.5:.1f} l S\n" for i in range(5000))
    inner = doc.get_new_xref()
    doc.update_object(inner, "<</Type/XObject/Subtype/Form/BBox[0 0 100 100]/Length 0>>")
    doc.update_stream(inner, lines.encode())
    outer = doc.get_new_xref()
    doc.update_object(outer, f"<</Type/XObject/Subtype/Form/BBox[0 0 612 792]/Resources<</XObject<</A {inner} 0 R>>>>"
                             "/Length 0>>")
    doc.update_stream(outer, "".join(f"q 1 0 0 1 {i % 6 * 100} {i // 6 % 7 * 110} cm /A Do Q\n"
                                     for i in range(2000)).encode())
    contents = doc.get_new_xref()
    doc.update_object(contents, "<</Length 0>>")
    doc.update_stream(contents, b"/B Do\n")
    doc.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
    doc.xref_set_key(page.xref, "Resources", f"<</XObject<</B {outer} 0 R>>>>")
    started = time.monotonic()
    resp = post(client, doc.tobytes(deflate=True))
    assert resp.status_code in (413, 422), resp.text
    assert "by hand" in resp.json()["detail"]
    assert time.monotonic() - started < 45


def test_running_out_of_memory_is_recognised_in_every_shape_it_takes():
    """Under its memory limit the worker has also seen PyMuPDF's C code fail
    with a SystemError whose cause is the MemoryError."""
    try:
        try:
            raise MemoryError()
        except MemoryError as cause:
            raise SystemError("<built-in function get_cdrawings> returned a result with an exception set") from cause
    except SystemError as exc:
        assert worker._is_memory(exc)
    assert worker._is_memory(RuntimeError("code=2: malloc (64 bytes) failed"))
    assert not worker._is_memory(ValueError("bad xref"))


def _stub_worker(tmp_path, monkeypatch, body: str) -> None:
    stub = tmp_path / "stub_form_detect_worker.py"
    stub.write_text(body)
    monkeypatch.setattr(form_detect_service, "_WORKER", stub)


def test_a_detection_that_never_finishes_is_stopped(client, monkeypatch, tmp_path):
    _stub_worker(tmp_path, monkeypatch, "import time\ntime.sleep(600)\n")
    monkeypatch.setattr(form_detect_service, "TIME_LIMIT_SECONDS", 1)
    started = time.monotonic()
    resp = post(client, corpus.contact_details().data)
    assert resp.status_code == 504
    assert time.monotonic() - started < 15


@pytest.mark.parametrize("body, status, words", [
    ("import os, signal\nos.kill(os.getpid(), signal.SIGXCPU)\n", 422, "more processing time"),
    ("import os, signal\nos.kill(os.getpid(), signal.SIGSEGV)\n", 413, "too big"),
    ("print('{\"ok\": false, \"error\": \"too_large\"}')\n", 413, "too big"),
    ("print('{\"ok\": false, \"error\": \"corrupt\"}')\n", 400, "damaged"),
    ("print('{\"ok\": false, \"error\": \"too_many_pages\", \"pages\": 80, \"limit\": 50}')\n", 413, "80 pages"),
], ids=["cpu-limit", "crashed-out-of-memory", "out-of-memory", "damaged-pages", "too-many-pages"])
def test_each_way_a_worker_stops_has_its_answer(client, monkeypatch, tmp_path, body, status, words):
    _stub_worker(tmp_path, monkeypatch, body)
    resp = post(client, corpus.contact_details().data)
    assert resp.status_code == status, resp.text
    assert words in resp.json()["detail"]


@pytest.mark.parametrize("body", [
    "import os, signal\nos.kill(os.getpid(), signal.SIGTERM)\n",
    "print('not json')\n",
    "print('{\"ok\": false, \"error\": \"too_many_pages\"}')\n",
], ids=["stopped", "garbage", "refusal-without-counts"])
def test_a_worker_that_fails_gives_a_500(client, monkeypatch, tmp_path, body):
    _stub_worker(tmp_path, monkeypatch, body)
    assert post(client, corpus.contact_details().data).status_code == 500


def test_the_v1_api_serves_the_same_detection():
    from backend.app.api_v1 import catalog, quota
    from backend.app.main import app

    paths = {route.path for route in catalog.public_routes(app)}
    assert "/api/v1/form-creator/detect" in paths
    assert quota.cost_for("/api/v1/form-creator/detect") == quota.HEAVY_COST
    assert catalog.metadata("/api/v1/form-creator/detect")["response_media"] == ["application/json"]
    constraints = " ".join(catalog.CONSTRAINTS["/form-creator/detect"])
    assert "more than 50 pages" in constraints and "not a probability" in constraints
