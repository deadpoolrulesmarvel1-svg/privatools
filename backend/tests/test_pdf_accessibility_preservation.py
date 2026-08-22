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


# ── structure tree ──────────────────────────────────────────────────────────
#
# A structure tree that merely *exists* is worse than none: it tells assistive
# technology the document is navigable and then hands it dangling page
# references and colliding ParentTree keys. These tests check the tree is
# correct, not just present.

from backend.app.utils.pdf_accessibility import (  # noqa: E402
    StructureTreeMerger,
    preserve_structure_tree,
)


def _struct_summary(pdf_path: str) -> dict:
    with pikepdf.open(pdf_path) as pdf:
        root = pdf.Root.get("/StructTreeRoot")
        if not isinstance(root, pikepdf.Dictionary):
            return {"tagged": False}
        page_objgens = {p.obj.objgen for p in pdf.pages}

        elements, dangling = [], 0

        def walk(node, depth=0):
            nonlocal dangling
            if depth > 40:
                return
            if isinstance(node, pikepdf.Array):
                for kid in node:
                    walk(kid, depth + 1)
                return
            if not isinstance(node, pikepdf.Dictionary):
                return
            stype = str(node.get("/S") or "")
            if stype:
                elements.append(stype.lstrip("/"))
            page = node.get("/Pg")
            if page is not None and page.objgen not in page_objgens:
                dangling += 1
            kids = node.get("/K")
            if kids is not None:
                walk(kids, depth + 1)

        walk(root.get("/K"))

        parent_tree = root.get("/ParentTree")
        keys = []
        if isinstance(parent_tree, pikepdf.Dictionary):
            nums = parent_tree.get("/Nums")
            if isinstance(nums, pikepdf.Array):
                keys = [int(nums[i]) for i in range(0, len(nums) - 1, 2)]

        page_keys = []
        for p in pdf.pages:
            v = p.obj.get("/StructParents")
            if v is not None:
                page_keys.append(int(v))

        mark_info = pdf.Root.get("/MarkInfo")
        return {
            "tagged": True,
            "elements": elements,
            "dangling": dangling,
            "parent_tree_keys": keys,
            "page_struct_parents": page_keys,
            "marked": bool(mark_info.get("/Marked", False))
            if isinstance(mark_info, pikepdf.Dictionary) else False,
        }


def test_merge_carries_the_structure_tree_from_every_source(tmp_path):
    a = _accessible_pdf(tmp_path / "a.pdf")
    b = _accessible_pdf(tmp_path / "b.pdf")
    summary = _struct_summary(merge_pdfs([str(a), str(b)]))

    assert summary["tagged"] is True
    assert summary["marked"] is True
    # Each source contributes H1, P, H2, Figure.
    assert summary["elements"].count("H1") == 2
    assert summary["elements"].count("Figure") == 2


def test_merged_structure_tree_has_no_dangling_page_references(tmp_path):
    a = _accessible_pdf(tmp_path / "a.pdf")
    b = _accessible_pdf(tmp_path / "b.pdf")
    assert _struct_summary(merge_pdfs([str(a), str(b)]))["dangling"] == 0


def test_merged_parent_tree_keys_do_not_collide(tmp_path):
    """Both sources number their pages from 0; without shifting, keys collide.

    A collision doesn't error — it silently points half the pages at the other
    document's struct elements, which is the worst kind of failure here.
    """
    a = _accessible_pdf(tmp_path / "a.pdf")
    b = _accessible_pdf(tmp_path / "b.pdf")
    summary = _struct_summary(merge_pdfs([str(a), str(b)]))

    keys = summary["parent_tree_keys"]
    assert len(keys) == len(set(keys)), f"duplicate ParentTree keys: {keys}"

    page_keys = summary["page_struct_parents"]
    assert len(page_keys) == len(set(page_keys)), (
        f"two pages share a /StructParents key: {page_keys}"
    )
    for key in page_keys:
        assert key in keys, f"page /StructParents {key} has no ParentTree entry"


def test_merging_a_tagged_and_an_untagged_file_does_not_claim_tagged(tmp_path):
    """All-or-nothing: half a tree must not be advertised as a whole one."""
    tagged = _accessible_pdf(tmp_path / "tagged.pdf")
    plain = tmp_path / "plain.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "untagged content")
    doc.save(str(plain))
    doc.close()

    summary = _struct_summary(merge_pdfs([str(tagged), str(plain)]))
    assert summary["tagged"] is False, (
        "merged output claims a structure tree while half its pages have none"
    )


def test_extract_pages_prunes_elements_for_dropped_pages(tmp_path):
    """Elements belonging to pages that didn't come along must be removed."""
    src = _accessible_pdf(tmp_path / "a.pdf", pages=3)
    out = extract_pages(str(src), "1")
    summary = _struct_summary(out)

    assert summary["tagged"] is True
    assert summary["dangling"] == 0, "kept struct elements for pages not in the output"


def test_extract_pages_reaches_parity_with_its_input(tmp_path):
    src = _accessible_pdf(tmp_path / "a.pdf")
    before = check_accessibility(str(src))["summary"]["score"]
    after = check_accessibility(extract_pages(str(src), "1-2"))["summary"]["score"]
    assert after == before, f"extract-pages scored {after}, input was {before}"


def test_merge_reaches_parity_with_its_input(tmp_path):
    src = _accessible_pdf(tmp_path / "a.pdf")
    before = check_accessibility(str(src))["summary"]["score"]
    after = check_accessibility(merge_pdfs([str(src), str(src)]))["summary"]["score"]
    assert after == before, f"merge scored {after}, input was {before}"


def test_preserve_structure_tree_is_a_no_op_on_untagged_input(tmp_path):
    plain = tmp_path / "plain.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "no tags here")
    doc.save(str(plain))
    doc.close()

    with pikepdf.open(str(plain)) as src:
        dst = pikepdf.Pdf.new()
        dst.pages.append(src.pages[0])
        assert preserve_structure_tree(src, dst) is False
        assert "/StructTreeRoot" not in dst.Root
        assert "/MarkInfo" not in dst.Root


def test_merger_with_no_tagged_sources_installs_nothing(tmp_path):
    dst = pikepdf.Pdf.new()
    merger = StructureTreeMerger(dst)
    assert merger.finalize() is False
    assert "/StructTreeRoot" not in dst.Root
