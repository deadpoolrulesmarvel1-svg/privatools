"""Tools must not silently destroy accessibility their input already had.

Found by auditing our own output with the new accessibility checker: an
accessible PDF scoring 96/100 came back from /merge and /extract-pages at
39/100, and from /grayscale at 11/100.

That is data loss, not a missing feature. Someone who paid to have a document
remediated for WCAG or Section 508 loses that work by merging it, and nothing
in the output tells them.

Root causes:
  * merge / extract-pages built on `pikepdf.Pdf.new()`, whose catalog starts
    empty — /Lang, the title and /ViewerPreferences were never carried over.
  * grayscale ran a 200 DPI rasterising pass *unconditionally*, contradicting
    its own module docstring ("preserving vector text and graphics ... falls
    back to rasterization only for pages that fail"). Every PDF through
    /grayscale came back as flat images: no selectable text, no search, no
    structure tree, bigger file.
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz  # PyMuPDF
import pikepdf
import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.accessibility_service import check_accessibility
from backend.app.services.extract_pages_service import extract_pages
from backend.app.services.grayscale_service import (
    _has_non_gray_marking_content,
    convert_to_grayscale,
)
from backend.app.services.merge_service import merge_pdfs
from backend.app.utils.pdf_accessibility import (
    _transplant,
    preserve_document_properties,
)


# ── fixtures ────────────────────────────────────────────────────────────────

def _accessible_pdf(path: Path, pages: int = 3) -> Path:
    """A properly tagged PDF: structure tree, /Lang, title, /Tabs."""
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Heading {i + 1}", fontsize=18)
        page.insert_text((72, 110), "Body text a screen reader should read.", fontsize=11)
    doc.save(str(path))
    doc.close()

    with pikepdf.open(str(path), allow_overwriting_input=True) as pdf:
        def elem(stype, **kw):
            d = pikepdf.Dictionary(Type=pikepdf.Name("/StructElem"), S=pikepdf.Name("/" + stype))
            for k, v in kw.items():
                setattr(d, k, v)
            return pdf.make_indirect(d)

        root = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name("/StructTreeRoot")))
        root.K = pikepdf.Array([
            elem("H1"), elem("P"), elem("H2"),
            elem("Figure", Alt=pikepdf.String("A descriptive alt text")),
        ])
        pdf.Root.StructTreeRoot = root
        pdf.Root.MarkInfo = pikepdf.Dictionary(Marked=True)
        pdf.Root.Lang = pikepdf.String("en-US")
        pdf.Root.ViewerPreferences = pikepdf.Dictionary(DisplayDocTitle=True)
        with pdf.open_metadata() as xmp:
            xmp["dc:title"] = "An Accessible Test Document"
        for page in pdf.pages:
            page.obj.Tabs = pikepdf.Name("/S")
        out = path.with_suffix(".acc.pdf")
        pdf.save(str(out))
    return out


def _props(pdf_path: str) -> dict:
    with pikepdf.open(pdf_path) as pdf:
        info = pdf.trailer.get("/Info")
        docinfo_title = ""
        if isinstance(info, pikepdf.Dictionary):
            docinfo_title = str(info.get("/Title") or "").strip()
        vp = pdf.Root.get("/ViewerPreferences")
        return {
            "lang": str(pdf.Root.get("/Lang") or ""),
            "title": docinfo_title,
            "display_doc_title": bool(vp.get("/DisplayDocTitle", False))
            if isinstance(vp, pikepdf.Dictionary) else False,
        }


# ── merge ───────────────────────────────────────────────────────────────────

def test_merge_preserves_language_title_and_viewer_preferences(tmp_path):
    src = _accessible_pdf(tmp_path / "a.pdf")
    out = merge_pdfs([str(src), str(src)])
    props = _props(out)

    assert props["lang"] == "en-US"
    assert props["title"] == "An Accessible Test Document"
    assert props["display_doc_title"] is True


def test_merge_does_not_regress_the_accessibility_score_to_untagged_defaults(tmp_path):
    """Merging used to drop an accessible file from 96 to 39."""
    src = _accessible_pdf(tmp_path / "a.pdf")
    before = check_accessibility(str(src))["summary"]["score"]
    after = check_accessibility(merge_pdfs([str(src), str(src)]))["summary"]["score"]

    # The structure tree is still lost (merging tag trees is a separate job),
    # so this is not parity — but it must be far above the old 39.
    assert after >= 65, f"merge output scored {after}, was {before} before merging"


def test_merge_takes_properties_from_the_first_document(tmp_path):
    first = _accessible_pdf(tmp_path / "first.pdf")
    second = _accessible_pdf(tmp_path / "second.pdf")
    with pikepdf.open(str(second), allow_overwriting_input=True) as pdf:
        pdf.Root.Lang = pikepdf.String("fr-FR")
        pdf.save(str(tmp_path / "second-fr.pdf"))

    out = merge_pdfs([str(first), str(tmp_path / "second-fr.pdf")])
    assert _props(out)["lang"] == "en-US"


# ── extract pages ───────────────────────────────────────────────────────────

def test_extract_pages_preserves_language_and_title(tmp_path):
    src = _accessible_pdf(tmp_path / "a.pdf")
    out = extract_pages(str(src), "1-2")
    props = _props(out)

    assert props["lang"] == "en-US"
    assert props["title"] == "An Accessible Test Document"
    assert props["display_doc_title"] is True


# ── the "don't lie" invariant ───────────────────────────────────────────────

def test_preservation_never_claims_the_output_is_tagged(tmp_path):
    """Copying /MarkInfo without the structure tree would assert a lie.

    A document with `/MarkInfo << /Marked true >>` and no /StructTreeRoot tells
    every downstream tool it is tagged when it is not — worse than visibly
    losing the tags.
    """
    src = _accessible_pdf(tmp_path / "a.pdf")
    out = merge_pdfs([str(src), str(src)])
    with pikepdf.open(out) as pdf:
        has_struct = "/StructTreeRoot" in pdf.Root
        mark_info = pdf.Root.get("/MarkInfo")
        marked = bool(mark_info.get("/Marked", False)) if isinstance(
            mark_info, pikepdf.Dictionary) else False
        assert not (marked and not has_struct), (
            "output claims /Marked true with no structure tree"
        )


def test_existing_destination_values_are_not_overwritten(tmp_path):
    src = _accessible_pdf(tmp_path / "a.pdf")
    with pikepdf.open(str(src)) as s:
        dst = pikepdf.Pdf.new()
        dst.pages.append(s.pages[0])
        dst.Root.Lang = pikepdf.String("de-DE")
        preserve_document_properties(s, dst)
        assert str(dst.Root.get("/Lang")) == "de-DE"


# ── transplant ──────────────────────────────────────────────────────────────

def test_transplant_handles_direct_strings_and_dictionaries(tmp_path):
    """pikepdf rejects foreign objects both ways; both gaps must be covered.

    Assigning a foreign object raises ForeignObjectError ("use copy_foreign"),
    and copy_foreign on a *direct* object raises ForeignObjectError ("called
    with direct object handle"). /Lang is the first case, /ViewerPreferences
    the second.
    """
    src = _accessible_pdf(tmp_path / "a.pdf")
    with pikepdf.open(str(src)) as s:
        dst = pikepdf.Pdf.new()
        lang = _transplant(s.Root.get("/Lang"), dst)
        vp = _transplant(s.Root.get("/ViewerPreferences"), dst)
        assert str(lang) == "en-US"
        assert bool(vp.get("/DisplayDocTitle")) is True


def test_transplant_rejects_absurd_nesting(tmp_path):
    dst = pikepdf.Pdf.new()
    nested = pikepdf.Dictionary()
    current = nested
    for _ in range(40):
        child = pikepdf.Dictionary()
        current["/K"] = child
        current = child
    with pytest.raises(ValueError, match="too deeply"):
        _transplant(nested, dst)


# ── grayscale ───────────────────────────────────────────────────────────────

def _is_grayscale(pdf_path: str) -> bool:
    """Render every page and confirm no pixel carries colour."""
    doc = fitz.open(pdf_path)
    try:
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5))
            if pix.n - pix.alpha < 3:
                continue  # already a gray colorspace
            data = pix.samples
            stride = pix.n
            for i in range(0, len(data), stride * 17):  # sample, don't scan all
                r, g, b = data[i], data[i + 1], data[i + 2]
                if not (r == g == b):
                    return False
    finally:
        doc.close()
    return True


def test_grayscale_keeps_the_text_layer_on_a_text_only_pdf(tmp_path):
    """The regression: /grayscale returned 200 DPI images for every input."""
    src = _accessible_pdf(tmp_path / "a.pdf")
    out = convert_to_grayscale(str(src))
    report = check_accessibility(out)
    checks = {c["id"]: c["status"] for c in report["checks"]}

    assert checks["text-extractable"] == "pass", "grayscale rasterised the text away"
    assert report["document"]["tagged"] is True, "grayscale destroyed the structure tree"
    assert report["summary"]["score"] >= 90


def test_grayscale_still_produces_grayscale_output(tmp_path):
    """The fix must not cost grayscale its actual job."""
    path = tmp_path / "colour.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Bright red text", fontsize=24, color=(1, 0, 0))
    page.draw_rect(fitz.Rect(72, 120, 300, 200), color=(0, 0, 1), fill=(0, 0.5, 1))
    doc.save(str(path))
    doc.close()

    assert _has_non_gray_marking_content(str(path)) is True
    out = convert_to_grayscale(str(path))
    assert _is_grayscale(out), "coloured content survived grayscale conversion"


def test_colour_detection_says_no_for_black_text(tmp_path):
    path = tmp_path / "black.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Plain black text", fontsize=12)
    doc.save(str(path))
    doc.close()
    assert _has_non_gray_marking_content(str(path)) is False


def test_colour_detection_fails_safe_on_an_unreadable_file(tmp_path):
    """Unparseable input must return True so the rasterising path still runs."""
    path = tmp_path / "junk.pdf"
    path.write_bytes(b"not a pdf")
    assert _has_non_gray_marking_content(str(path)) is True
