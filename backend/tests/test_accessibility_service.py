"""Tests for the PDF/UA + WCAG accessibility checker.

The interesting inputs here are *tagged* PDFs, and no library in the stack
generates a tagged PDF for us — so the helpers below build structure trees by
hand with pikepdf. That's verbose, but it's the only way to exercise the
figure-alt / table-header / heading-order logic against real PDF objects rather
than a mock of them.
"""

import sys
from pathlib import Path

import fitz  # PyMuPDF
import pikepdf
import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.accessibility_service import (  # noqa: E402
    AccessibilityError,
    check_accessibility,
)


# ── helpers ─────────────────────────────────────────────────────────────────

def _base_pdf(path: Path, pages: int = 1, text: str = "Hello accessible world") -> None:
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"{text} {i}", fontsize=12)
    doc.save(str(path))
    doc.close()


def _elem(pdf: pikepdf.Pdf, spec: dict) -> pikepdf.Object:
    """Turn {"S": "H1", "Alt": "...", "kids": [...]} into a struct element."""
    d = pikepdf.Dictionary(
        Type=pikepdf.Name("/StructElem"),
        S=pikepdf.Name("/" + spec["S"]),
    )
    if "Alt" in spec:
        d.Alt = pikepdf.String(spec["Alt"])
    if "ActualText" in spec:
        d.ActualText = pikepdf.String(spec["ActualText"])
    if spec.get("kids"):
        d.K = pikepdf.Array([_elem(pdf, k) for k in spec["kids"]])
    return pdf.make_indirect(d)


def _tagged_pdf(
    path: Path,
    elements: list[dict],
    *,
    lang: str | None = "en-US",
    title: str | None = "Test Document",
    display_doc_title: bool = True,
    marked: bool = True,
    role_map: dict[str, str] | None = None,
    tabs_s: bool = True,
    pages: int = 1,
) -> Path:
    _base_pdf(path, pages=pages)
    with pikepdf.open(str(path), allow_overwriting_input=True) as pdf:
        struct_root = pdf.make_indirect(
            pikepdf.Dictionary(Type=pikepdf.Name("/StructTreeRoot"))
        )
        struct_root.K = pikepdf.Array([_elem(pdf, e) for e in elements])
        if role_map:
            struct_root.RoleMap = pikepdf.Dictionary(
                **{k: pikepdf.Name("/" + v) for k, v in role_map.items()}
            )
        pdf.Root.StructTreeRoot = struct_root
        pdf.Root.MarkInfo = pikepdf.Dictionary(Marked=marked)
        if lang is not None:
            pdf.Root.Lang = pikepdf.String(lang)
        if display_doc_title:
            pdf.Root.ViewerPreferences = pikepdf.Dictionary(DisplayDocTitle=True)
        if title is not None:
            with pdf.open_metadata() as xmp:
                xmp["dc:title"] = title
        if tabs_s:
            for page in pdf.pages:
                page.obj.Tabs = pikepdf.Name("/S")
        pdf.save(str(path.with_suffix(".out.pdf")))
    final = path.with_suffix(".out.pdf")
    return final


def _by_id(report: dict) -> dict[str, dict]:
    return {c["id"]: c for c in report["checks"]}


# ── untagged documents ──────────────────────────────────────────────────────

def test_untagged_pdf_fails_the_tagging_check(tmp_path):
    p = tmp_path / "plain.pdf"
    _base_pdf(p)
    report = check_accessibility(str(p))
    checks = _by_id(report)

    assert checks["tagged-pdf"]["status"] == "fail"
    assert checks["tagged-pdf"]["impact"] == "critical"
    assert report["summary"]["criticalFailures"] >= 1
    assert report["document"]["tagged"] is False


def test_untagged_pdf_rolls_structure_checks_into_one_row(tmp_path):
    """An untagged file shouldn't emit six redundant structural failures."""
    p = tmp_path / "plain.pdf"
    _base_pdf(p)
    checks = _by_id(check_accessibility(str(p)))

    assert "structure-not-applicable" in checks
    for skipped in ("heading-order", "figure-alt-text", "table-headers"):
        assert skipped not in checks


# ── document-level metadata ─────────────────────────────────────────────────

def test_well_formed_document_passes_metadata_checks(tmp_path):
    out = _tagged_pdf(tmp_path / "good.pdf", [{"S": "P"}])
    checks = _by_id(check_accessibility(str(out)))

    assert checks["tagged-pdf"]["status"] == "pass"
    assert checks["document-language"]["status"] == "pass"
    assert checks["document-title"]["status"] == "pass"
    assert checks["display-doc-title"]["status"] == "pass"
    assert checks["tab-order"]["status"] == "pass"


def test_missing_language_fails(tmp_path):
    out = _tagged_pdf(tmp_path / "nolang.pdf", [{"S": "P"}], lang=None)
    assert _by_id(check_accessibility(str(out)))["document-language"]["status"] == "fail"


def test_malformed_language_tag_warns_rather_than_fails(tmp_path):
    out = _tagged_pdf(tmp_path / "badlang.pdf", [{"S": "P"}], lang="not a language")
    assert _by_id(check_accessibility(str(out)))["document-language"]["status"] == "warn"


def test_marked_false_warns_even_with_a_structure_tree(tmp_path):
    out = _tagged_pdf(tmp_path / "unmarked.pdf", [{"S": "P"}], marked=False)
    assert _by_id(check_accessibility(str(out)))["tagged-pdf"]["status"] == "warn"


def test_missing_tabs_entry_fails_tab_order(tmp_path):
    out = _tagged_pdf(tmp_path / "notabs.pdf", [{"S": "P"}], tabs_s=False)
    assert _by_id(check_accessibility(str(out)))["tab-order"]["status"] == "fail"


# ── figures ─────────────────────────────────────────────────────────────────

def test_figure_without_alt_text_fails(tmp_path):
    out = _tagged_pdf(tmp_path / "fig.pdf", [{"S": "Figure"}])
    check = _by_id(check_accessibility(str(out)))["figure-alt-text"]
    assert check["status"] == "fail"
    assert check["impact"] == "critical"


def test_figure_with_alt_text_passes(tmp_path):
    out = _tagged_pdf(tmp_path / "fig.pdf", [{"S": "Figure", "Alt": "A bar chart"}])
    assert _by_id(check_accessibility(str(out)))["figure-alt-text"]["status"] == "pass"


def test_actual_text_counts_as_an_alternative(tmp_path):
    """/ActualText is the right tag for e.g. a drop-cap image of a letter."""
    out = _tagged_pdf(tmp_path / "fig.pdf", [{"S": "Figure", "ActualText": "W"}])
    assert _by_id(check_accessibility(str(out)))["figure-alt-text"]["status"] == "pass"


def test_partially_described_figures_still_fail(tmp_path):
    out = _tagged_pdf(
        tmp_path / "figs.pdf",
        [{"S": "Figure", "Alt": "described"}, {"S": "Figure"}],
    )
    check = _by_id(check_accessibility(str(out)))["figure-alt-text"]
    assert check["status"] == "fail"
    assert "1 of 2" in check["detail"]


# ── headings ────────────────────────────────────────────────────────────────

def test_skipped_heading_level_fails(tmp_path):
    out = _tagged_pdf(tmp_path / "h.pdf", [{"S": "H1"}, {"S": "H3"}])
    check = _by_id(check_accessibility(str(out)))["heading-order"]
    assert check["status"] == "fail"
    assert "H1 → H3" in check["detail"]


def test_sequential_headings_pass(tmp_path):
    out = _tagged_pdf(
        tmp_path / "h.pdf", [{"S": "H1"}, {"S": "H2"}, {"S": "H3"}, {"S": "H2"}]
    )
    assert _by_id(check_accessibility(str(out)))["heading-order"]["status"] == "pass"


def test_document_with_no_headings_warns(tmp_path):
    out = _tagged_pdf(tmp_path / "h.pdf", [{"S": "P"}, {"S": "P"}])
    assert _by_id(check_accessibility(str(out)))["headings-present"]["status"] == "warn"


def test_descending_then_ascending_headings_are_not_skips(tmp_path):
    """H1 → H2 → H1 → H2 is a normal two-section document, not a skip."""
    out = _tagged_pdf(
        tmp_path / "h.pdf", [{"S": "H1"}, {"S": "H2"}, {"S": "H1"}, {"S": "H2"}]
    )
    assert _by_id(check_accessibility(str(out)))["heading-order"]["status"] == "pass"


# ── tables and lists ────────────────────────────────────────────────────────

def test_table_without_header_cells_fails(tmp_path):
    out = _tagged_pdf(
        tmp_path / "t.pdf",
        [{"S": "Table", "kids": [{"S": "TR", "kids": [{"S": "TD"}, {"S": "TD"}]}]}],
    )
    assert _by_id(check_accessibility(str(out)))["table-headers"]["status"] == "fail"


def test_table_with_header_cells_passes(tmp_path):
    out = _tagged_pdf(
        tmp_path / "t.pdf",
        [{"S": "Table", "kids": [
            {"S": "TR", "kids": [{"S": "TH"}, {"S": "TH"}]},
            {"S": "TR", "kids": [{"S": "TD"}, {"S": "TD"}]},
        ]}],
    )
    assert _by_id(check_accessibility(str(out)))["table-headers"]["status"] == "pass"


def test_list_without_items_warns(tmp_path):
    out = _tagged_pdf(tmp_path / "l.pdf", [{"S": "L", "kids": [{"S": "P"}]}])
    assert _by_id(check_accessibility(str(out)))["list-structure"]["status"] == "warn"


def test_list_with_items_passes(tmp_path):
    out = _tagged_pdf(
        tmp_path / "l.pdf",
        [{"S": "L", "kids": [{"S": "LI", "kids": [{"S": "LBody"}]}]}],
    )
    assert _by_id(check_accessibility(str(out)))["list-structure"]["status"] == "pass"


# ── role mapping ────────────────────────────────────────────────────────────

def test_role_map_resolves_custom_tags_to_standard_types(tmp_path):
    """A custom 'Heading1' tag mapped to H1 must grade as a heading, not be ignored."""
    out = _tagged_pdf(
        tmp_path / "rm.pdf",
        [{"S": "Heading1"}, {"S": "Heading3"}],
        role_map={"Heading1": "H1", "Heading3": "H3"},
    )
    checks = _by_id(check_accessibility(str(out)))
    assert checks["heading-order"]["status"] == "fail"
    assert "H1 → H3" in checks["heading-order"]["detail"]


def test_role_map_applies_to_figures(tmp_path):
    out = _tagged_pdf(
        tmp_path / "rm.pdf", [{"S": "MyImage"}], role_map={"MyImage": "Figure"}
    )
    assert _by_id(check_accessibility(str(out)))["figure-alt-text"]["status"] == "fail"


# ── robustness ──────────────────────────────────────────────────────────────

def test_cyclic_structure_tree_terminates(tmp_path):
    """A /K cycle must not hang the audit — depth is capped and reported."""
    p = tmp_path / "cycle.pdf"
    _base_pdf(p)
    with pikepdf.open(str(p), allow_overwriting_input=True) as pdf:
        elem = pdf.make_indirect(
            pikepdf.Dictionary(Type=pikepdf.Name("/StructElem"), S=pikepdf.Name("/P"))
        )
        elem.K = pikepdf.Array([elem])  # points at itself
        root = pdf.make_indirect(
            pikepdf.Dictionary(Type=pikepdf.Name("/StructTreeRoot"), K=pikepdf.Array([elem]))
        )
        pdf.Root.StructTreeRoot = root
        pdf.Root.MarkInfo = pikepdf.Dictionary(Marked=True)
        pdf.save(str(tmp_path / "cycle.out.pdf"))

    report = check_accessibility(str(tmp_path / "cycle.out.pdf"))
    assert any(c["id"] == "structure-size" for c in report["checks"])


def test_password_protected_pdf_raises_a_clear_error(tmp_path):
    p = tmp_path / "locked.pdf"
    _base_pdf(p)
    with pikepdf.open(str(p), allow_overwriting_input=True) as pdf:
        pdf.save(
            str(tmp_path / "locked.out.pdf"),
            encryption=pikepdf.Encryption(user="secret", owner="secret"),
        )
    with pytest.raises(AccessibilityError, match="password-protected"):
        check_accessibility(str(tmp_path / "locked.out.pdf"))


def test_non_pdf_input_raises(tmp_path):
    p = tmp_path / "not.pdf"
    p.write_bytes(b"this is not a pdf at all")
    with pytest.raises(AccessibilityError):
        check_accessibility(str(p))


def test_check_is_read_only(tmp_path):
    """The audit must never modify the file it is auditing."""
    out = _tagged_pdf(tmp_path / "ro.pdf", [{"S": "H1"}])
    before = out.read_bytes()
    check_accessibility(str(out))
    assert out.read_bytes() == before


# ── scoring and reporting ───────────────────────────────────────────────────

def test_manual_checks_are_reported_but_never_scored(tmp_path):
    out = _tagged_pdf(tmp_path / "m.pdf", [{"S": "H1"}])
    report = check_accessibility(str(out))
    manual = [c for c in report["checks"] if c["status"] == "manual"]

    assert len(manual) >= 4
    assert report["summary"]["manual"] == len(manual)
    # Manual rows carry no weight, so they can't inflate or deflate the score.
    assert all(c["impact"] == "info" for c in manual)


def test_a_good_document_scores_higher_than_an_untagged_one(tmp_path):
    plain = tmp_path / "plain.pdf"
    _base_pdf(plain)
    good = _tagged_pdf(
        tmp_path / "good.pdf",
        [{"S": "H1"}, {"S": "H2"}, {"S": "Figure", "Alt": "chart"}],
    )
    assert check_accessibility(str(good))["summary"]["score"] > check_accessibility(
        str(plain)
    )["summary"]["score"]


def test_score_is_bounded(tmp_path):
    out = _tagged_pdf(tmp_path / "s.pdf", [{"S": "H1"}])
    score = check_accessibility(str(out))["summary"]["score"]
    assert 0 <= score <= 100


def test_every_check_has_the_full_shape(tmp_path):
    out = _tagged_pdf(tmp_path / "shape.pdf", [{"S": "H1"}, {"S": "Figure"}])
    report = check_accessibility(str(out))
    for c in report["checks"]:
        assert set(c) == {
            "id", "title", "category", "status", "detail",
            "impact", "howToFix", "standard",
        }
        assert c["status"] in {"pass", "fail", "warn", "manual"}
        assert c["impact"] in {"critical", "serious", "moderate", "minor", "info"}
        assert c["detail"]
        # Anything actionable must say how to act on it.
        if c["status"] in {"fail", "warn", "manual"} and c["impact"] != "info":
            assert c["howToFix"], f"{c['id']} has no remediation guidance"


def test_check_ids_are_unique(tmp_path):
    out = _tagged_pdf(tmp_path / "u.pdf", [{"S": "H1"}, {"S": "Table"}, {"S": "L"}])
    ids = [c["id"] for c in check_accessibility(str(out))["checks"]]
    assert len(ids) == len(set(ids))


def test_summary_counts_match_the_check_list(tmp_path):
    out = _tagged_pdf(tmp_path / "c.pdf", [{"S": "H1"}, {"S": "Figure"}])
    report = check_accessibility(str(out))
    s = report["summary"]
    statuses = [c["status"] for c in report["checks"]]
    assert s["passed"] == statuses.count("pass")
    assert s["failed"] == statuses.count("fail")
    assert s["warnings"] == statuses.count("warn")
    assert s["manual"] == statuses.count("manual")


# ── HTTP endpoint ───────────────────────────────────────────────────────────

def test_endpoint_returns_a_report(client, tmp_path):
    p = tmp_path / "e.pdf"
    _base_pdf(p)
    res = client.post(
        "/api/accessibility-check",
        files={"file": ("e.pdf", p.read_bytes(), "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"summary", "document", "checks"}
    assert body["checks"]
    assert 0 <= body["summary"]["score"] <= 100


def test_endpoint_rejects_non_pdf_filename(client):
    res = client.post(
        "/api/accessibility-check",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 400


def test_endpoint_rejects_empty_upload(client):
    res = client.post(
        "/api/accessibility-check",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert res.status_code == 400


def test_endpoint_reports_password_protected_as_a_client_error(client, tmp_path):
    """A locked PDF is the user's problem to fix, not a 500."""
    p = tmp_path / "locked.pdf"
    _base_pdf(p)
    with pikepdf.open(str(p), allow_overwriting_input=True) as pdf:
        pdf.save(
            str(tmp_path / "locked.out.pdf"),
            encryption=pikepdf.Encryption(user="secret", owner="secret"),
        )
    res = client.post(
        "/api/accessibility-check",
        files={"file": ("locked.pdf", (tmp_path / "locked.out.pdf").read_bytes(), "application/pdf")},
    )
    assert res.status_code == 400
    assert "password" in res.json()["detail"].lower()
