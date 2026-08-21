"""PDF accessibility (PDF/UA + WCAG) conformance checking.

Adobe and Foxit both keep auto-tagging and "Accessibility Full Check" behind a
paid desktop product; DocHub and PDFescape don't ship it at all. Nothing here
needs state, an account, or a licence — it's a read-only structural audit.

Two libraries, split by what they're good at:
  * pikepdf  — the object model (StructTreeRoot, /Lang, /Tabs, ViewerPreferences).
    Everything about *tagging* lives in raw PDF objects and pikepdf is the only
    thing in our stack that exposes them.
  * fitz     — page content (fonts, extractable text, images, widgets).

Checks are graded pass / fail / warn / manual. `manual` is load-bearing and not
a cop-out: a machine can confirm that a <Figure> *has* alt text but not that the
alt text is *meaningful*, and PDF/UA itself designates those checks as
human-verified. Reporting them as passes would be a lie; hiding them would make
the report look complete when it isn't. Adobe's Full Check makes the same split.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import fitz
import pikepdf

logger = logging.getLogger(__name__)

# Guard rails for the structure-tree walk. A hostile or merely broken PDF can
# contain cycles or absurd nesting; we bound both rather than trusting the file.
_MAX_STRUCT_NODES = 200_000
_MAX_STRUCT_DEPTH = 100

# Structure types that carry a heading level, in PDF/UA's own vocabulary.
_HEADING_TYPES = {"H1": 1, "H2": 2, "H3": 3, "H4": 4, "H5": 5, "H6": 6}

# BCP-47-ish. Deliberately permissive — we're catching "" and "unknown", not
# adjudicating the language subtag registry.
_LANG_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


class AccessibilityError(Exception):
    """Raised when the PDF cannot be analysed at all."""


def _name_to_str(obj: Any) -> str:
    """Normalise a pikepdf Name (/H1) to a bare string (H1)."""
    if obj is None:
        return ""
    s = str(obj)
    return s[1:] if s.startswith("/") else s


def _text_of(obj: Any) -> str:
    """Coerce a pikepdf String to str, tolerating bytes and odd encodings."""
    if obj is None:
        return ""
    try:
        if isinstance(obj, bytes):
            return obj.decode("utf-8", "replace").strip()
        return str(obj).strip()
    except Exception:
        return ""


class _StructWalk:
    """One pass over the structure tree, collecting everything the checks need.

    Walking once and collecting into a single object is deliberate: the tree can
    be very large, and re-walking it per check turned an O(n) audit into O(n·k).
    """

    def __init__(self, role_map: dict[str, str]):
        self.role_map = role_map
        self.headings: list[int] = []          # heading levels, in document order
        self.figures_total = 0
        self.figures_missing_alt = 0
        self.tables_total = 0
        self.tables_without_header = 0
        self.lists_total = 0
        self.lists_malformed = 0
        self.links_total = 0
        self.links_missing_alt = 0
        self.type_counts: dict[str, int] = {}
        self.nodes_seen = 0
        self.truncated = False

    def resolve(self, raw_type: str) -> str:
        """Apply the document's RoleMap so custom tags grade as their standard type."""
        seen = set()
        t = raw_type
        # RoleMap can chain (Custom -> MyHeading -> H2); follow it, but a broken
        # file can also make it circular, so cap the walk.
        while t in self.role_map and t not in seen:
            seen.add(t)
            t = self.role_map[t]
        return t


def _walk_struct_tree(node: Any, walk: _StructWalk, depth: int = 0) -> None:
    """Recursively collect structure-element facts.

    `node` may be a struct element dict, an array of kids, or an int (a marked
    content id, i.e. a leaf pointing at page content — nothing to inspect).
    """
    if walk.nodes_seen >= _MAX_STRUCT_NODES:
        walk.truncated = True
        return
    if depth > _MAX_STRUCT_DEPTH:
        walk.truncated = True
        return

    if isinstance(node, pikepdf.Array):
        for kid in node:
            _walk_struct_tree(kid, walk, depth + 1)
        return

    if not isinstance(node, pikepdf.Dictionary):
        # Marked-content integers and object references we can't resolve.
        return

    walk.nodes_seen += 1

    raw_type = _name_to_str(node.get("/S"))
    stype = walk.resolve(raw_type) if raw_type else ""
    if stype:
        walk.type_counts[stype] = walk.type_counts.get(stype, 0) + 1

    alt = _text_of(node.get("/Alt")) or _text_of(node.get("/ActualText"))

    if stype in _HEADING_TYPES:
        walk.headings.append(_HEADING_TYPES[stype])
    elif stype == "H":
        # Untyped <H> is legal in PDF 1.7 structure but gives no level, so it
        # can't participate in the skipped-level check. Count it as level 0 and
        # let the heading-order check ignore zeros.
        walk.headings.append(0)
    elif stype == "Figure":
        walk.figures_total += 1
        if not alt:
            walk.figures_missing_alt += 1
    elif stype == "Table":
        walk.tables_total += 1
        if not _table_has_header(node):
            walk.tables_without_header += 1
    elif stype == "L":
        walk.lists_total += 1
        if not _list_has_items(node, walk):
            walk.lists_malformed += 1
    elif stype == "Link":
        walk.links_total += 1
        if not alt:
            walk.links_missing_alt += 1

    kids = node.get("/K")
    if kids is not None:
        _walk_struct_tree(kids, walk, depth + 1)


def _iter_descendants(node: Any, depth: int = 0, budget: int = 5000):
    """Yield descendant struct-element dicts, bounded."""
    if depth > _MAX_STRUCT_DEPTH or budget <= 0:
        return
    if isinstance(node, pikepdf.Array):
        for kid in node:
            yield from _iter_descendants(kid, depth + 1, budget - 1)
        return
    if not isinstance(node, pikepdf.Dictionary):
        return
    yield node
    kids = node.get("/K")
    if kids is not None:
        yield from _iter_descendants(kids, depth + 1, budget - 1)


def _table_has_header(table_node: Any) -> bool:
    """A table is navigable by a screen reader only if some cell is a /TH."""
    try:
        for desc in _iter_descendants(table_node.get("/K")):
            if _name_to_str(desc.get("/S")) == "TH":
                return True
    except Exception:
        # A malformed sub-tree shouldn't fail the whole audit; treat as
        # "couldn't prove a header" which is what the check reports anyway.
        return False
    return False


def _list_has_items(list_node: Any, walk: _StructWalk) -> bool:
    """<L> must contain <LI> children to be a list rather than styled text."""
    try:
        for desc in _iter_descendants(list_node.get("/K"), budget=500):
            if walk.resolve(_name_to_str(desc.get("/S"))) == "LI":
                return True
    except Exception:
        return False
    return False


# ── Check construction ──────────────────────────────────────────────────────

# Impact weights feed the score. A missing structure tree makes a document
# unusable with a screen reader; a missing page-tab-order costs a little
# navigation convenience. Scoring them equally would flatter broken files.
_IMPACT_WEIGHT = {"critical": 4, "serious": 3, "moderate": 2, "minor": 1, "info": 0}


def _check(
    cid: str,
    title: str,
    category: str,
    status: str,
    detail: str,
    impact: str,
    how_to_fix: str = "",
    standard: str = "",
) -> dict[str, Any]:
    return {
        "id": cid,
        "title": title,
        "category": category,
        "status": status,
        "detail": detail,
        "impact": impact,
        "howToFix": how_to_fix,
        "standard": standard,
    }


def _document_checks(pdf: pikepdf.Pdf, has_struct: bool) -> list[dict[str, Any]]:
    """Catalog-level checks: tagging, language, title, and the title-display flag."""
    checks: list[dict[str, Any]] = []
    root = pdf.Root

    # 1. Tagged PDF. This is the gate — almost every other structural check is
    # meaningless without it, which is why it's weighted critical.
    mark_info = root.get("/MarkInfo")
    marked = False
    if isinstance(mark_info, pikepdf.Dictionary):
        marked = bool(mark_info.get("/Marked", False))
    if has_struct and marked:
        checks.append(_check(
            "tagged-pdf", "Document is tagged", "Document", "pass",
            "A structure tree is present and MarkInfo/Marked is true.",
            "critical", standard="PDF/UA-1 7.1, WCAG 1.3.1",
        ))
    elif has_struct and not marked:
        checks.append(_check(
            "tagged-pdf", "Document is tagged", "Document", "warn",
            "A structure tree exists but MarkInfo/Marked is not set to true, so "
            "conforming readers may ignore the tags entirely.",
            "serious",
            "Set /MarkInfo << /Marked true >> in the document catalog.",
            "PDF/UA-1 7.1",
        ))
    else:
        checks.append(_check(
            "tagged-pdf", "Document is tagged", "Document", "fail",
            "No structure tree found. Screen readers have no headings, no reading "
            "order and no table semantics to work with — they can only guess from "
            "the visual layout.",
            "critical",
            "Tag the document in an authoring tool before exporting, or re-export "
            "from the source file with 'tagged PDF' / 'document structure' enabled.",
            "PDF/UA-1 7.1, WCAG 1.3.1",
        ))

    # 2. Natural language. Without /Lang a screen reader reads the document in
    # whatever voice it defaults to, which mangles pronunciation.
    lang = _text_of(root.get("/Lang"))
    if lang and _LANG_RE.match(lang):
        checks.append(_check(
            "document-language", "Document language is set", "Document", "pass",
            f"Catalog /Lang is '{lang}'.", "serious",
            standard="PDF/UA-1 7.2, WCAG 3.1.1",
        ))
    elif lang:
        checks.append(_check(
            "document-language", "Document language is set", "Document", "warn",
            f"Catalog /Lang is '{lang}', which is not a well-formed language tag.",
            "moderate",
            "Use a BCP 47 tag such as 'en-US', 'fr' or 'de-CH'.",
            "PDF/UA-1 7.2, WCAG 3.1.1",
        ))
    else:
        checks.append(_check(
            "document-language", "Document language is set", "Document", "fail",
            "No /Lang entry. Assistive technology can't tell what language to "
            "pronounce the text in.",
            "serious",
            "Set the document language in the authoring tool, or add /Lang to the "
            "catalog.",
            "PDF/UA-1 7.2, WCAG 3.1.1",
        ))

    # 3. Title, and 4. the flag that makes viewers actually use it.
    title = ""
    info = pdf.trailer.get("/Info")
    if isinstance(info, pikepdf.Dictionary):
        title = _text_of(info.get("/Title"))
    if not title:
        try:
            with pdf.open_metadata() as xmp:
                title = _text_of(xmp.get("dc:title"))
        except Exception:
            pass

    if title:
        checks.append(_check(
            "document-title", "Document has a title", "Document", "pass",
            f"Title is '{title}'.", "moderate",
            standard="PDF/UA-1 7.1, WCAG 2.4.2",
        ))
    else:
        checks.append(_check(
            "document-title", "Document has a title", "Document", "fail",
            "No title in either the document info dictionary or the XMP metadata. "
            "Assistive technology announces the filename instead.",
            "moderate",
            "Set a descriptive title — use the Edit Metadata tool.",
            "PDF/UA-1 7.1, WCAG 2.4.2",
        ))

    vp = root.get("/ViewerPreferences")
    display_title = False
    if isinstance(vp, pikepdf.Dictionary):
        display_title = bool(vp.get("/DisplayDocTitle", False))
    if display_title:
        checks.append(_check(
            "display-doc-title", "Title is shown instead of the filename",
            "Document", "pass",
            "ViewerPreferences /DisplayDocTitle is true.", "minor",
            standard="PDF/UA-1 7.1",
        ))
    else:
        checks.append(_check(
            "display-doc-title", "Title is shown instead of the filename",
            "Document", "fail",
            "/DisplayDocTitle is not set, so viewers show the filename in the "
            "window title even when a proper title exists.",
            "minor",
            "Set /ViewerPreferences << /DisplayDocTitle true >>.",
            "PDF/UA-1 7.1",
        ))

    # 5. Encryption must not withhold the text from assistive technology.
    if pdf.is_encrypted:
        allowed = True
        try:
            allowed = bool(pdf.allow.accessibility)
        except Exception:
            pass
        if allowed:
            checks.append(_check(
                "accessibility-permission", "Encryption allows assistive technology",
                "Document", "pass",
                "The document is encrypted but permits content extraction for "
                "accessibility.",
                "critical", standard="PDF/UA-1 7.1, WCAG 1.3.1",
            ))
        else:
            checks.append(_check(
                "accessibility-permission", "Encryption allows assistive technology",
                "Document", "fail",
                "Encryption permissions block content extraction, which can stop "
                "screen readers from reading the document at all.",
                "critical",
                "Re-save without the extraction restriction, or enable the "
                "accessibility extraction permission.",
                "PDF/UA-1 7.1",
            ))

    return checks


def _structure_checks(walk: _StructWalk, has_struct: bool) -> list[dict[str, Any]]:
    """Checks that only mean something once a structure tree exists."""
    checks: list[dict[str, Any]] = []

    if not has_struct:
        # Reporting seven separate failures for an untagged file is noise — the
        # single critical `tagged-pdf` failure already says it. One rolled-up
        # entry keeps the report honest without burying the real finding.
        checks.append(_check(
            "structure-not-applicable", "Structure checks", "Structure", "warn",
            "Skipped — heading order, figure alt text, table headers and list "
            "structure can't be evaluated without a structure tree.",
            "info",
            "Tag the document, then re-run this check.",
        ))
        return checks

    # Heading order: a jump from H1 straight to H3 breaks outline navigation,
    # which is how most screen-reader users skim a document.
    levelled = [h for h in walk.headings if h > 0]
    if not walk.headings:
        checks.append(_check(
            "headings-present", "Document uses headings", "Structure", "warn",
            "No heading elements found. Long documents without headings can't be "
            "skimmed or navigated by outline.",
            "moderate",
            "Tag section titles as H1–H6 rather than styling them as bold text.",
            "WCAG 1.3.1, 2.4.6",
        ))
    else:
        skips: list[str] = []
        prev = 0
        for lvl in levelled:
            if prev and lvl > prev + 1:
                skips.append(f"H{prev} → H{lvl}")
            prev = lvl
        if skips:
            shown = ", ".join(skips[:5]) + ("…" if len(skips) > 5 else "")
            checks.append(_check(
                "heading-order", "Heading levels are not skipped", "Structure",
                "fail",
                f"{len(skips)} skipped heading level(s): {shown}.",
                "moderate",
                "Use heading levels in sequence — don't jump a level for visual "
                "size. Change the tag, not the font.",
                "WCAG 1.3.1, 2.4.10",
            ))
        else:
            checks.append(_check(
                "heading-order", "Heading levels are not skipped", "Structure",
                "pass",
                f"{len(walk.headings)} heading(s), no skipped levels.",
                "moderate", standard="WCAG 1.3.1, 2.4.10",
            ))

    # Figures without alt text are simply invisible to a screen reader.
    if walk.figures_total == 0:
        checks.append(_check(
            "figure-alt-text", "Images have alternative text", "Structure", "pass",
            "No tagged figures in this document.", "critical",
            standard="PDF/UA-1 7.3, WCAG 1.1.1",
        ))
    elif walk.figures_missing_alt:
        checks.append(_check(
            "figure-alt-text", "Images have alternative text", "Structure", "fail",
            f"{walk.figures_missing_alt} of {walk.figures_total} figure(s) have no "
            "/Alt or /ActualText.",
            "critical",
            "Add alternative text describing what each image conveys. Purely "
            "decorative images should be marked as artifacts instead.",
            "PDF/UA-1 7.3, WCAG 1.1.1",
        ))
    else:
        checks.append(_check(
            "figure-alt-text", "Images have alternative text", "Structure", "pass",
            f"All {walk.figures_total} figure(s) carry alternative text.",
            "critical", standard="PDF/UA-1 7.3, WCAG 1.1.1",
        ))

    # Tables need header cells or every data cell is context-free.
    if walk.tables_total == 0:
        checks.append(_check(
            "table-headers", "Tables have header cells", "Structure", "pass",
            "No tagged tables in this document.", "serious",
            standard="PDF/UA-1 7.5, WCAG 1.3.1",
        ))
    elif walk.tables_without_header:
        checks.append(_check(
            "table-headers", "Tables have header cells", "Structure", "fail",
            f"{walk.tables_without_header} of {walk.tables_total} table(s) contain "
            "no <TH> header cell.",
            "serious",
            "Tag the header row's cells as <TH>. Without them a screen reader "
            "reads values with no idea which column they belong to.",
            "PDF/UA-1 7.5, WCAG 1.3.1",
        ))
    else:
        checks.append(_check(
            "table-headers", "Tables have header cells", "Structure", "pass",
            f"All {walk.tables_total} table(s) have header cells.",
            "serious", standard="PDF/UA-1 7.5, WCAG 1.3.1",
        ))

    if walk.lists_total and walk.lists_malformed:
        checks.append(_check(
            "list-structure", "Lists are correctly structured", "Structure", "warn",
            f"{walk.lists_malformed} of {walk.lists_total} list(s) contain no <LI> "
            "item elements.",
            "moderate",
            "A <L> element should contain <LI> children, each with an <LBody>.",
            "PDF/UA-1 7.6, WCAG 1.3.1",
        ))
    elif walk.lists_total:
        checks.append(_check(
            "list-structure", "Lists are correctly structured", "Structure", "pass",
            f"All {walk.lists_total} list(s) contain item elements.",
            "moderate", standard="PDF/UA-1 7.6, WCAG 1.3.1",
        ))

    if walk.truncated:
        checks.append(_check(
            "structure-size", "Structure tree size", "Structure", "warn",
            "The structure tree is unusually large or deeply nested and the walk "
            "was truncated, so structural counts above are a lower bound.",
            "info",
        ))

    return checks


def _content_checks(doc: "fitz.Document") -> list[dict[str, Any]]:
    """Page-content checks: font embedding and whether the text is real text."""
    checks: list[dict[str, Any]] = []
    page_count = doc.page_count

    # Non-embedded fonts get substituted by the viewer. The substitute may lack
    # the glyphs, and character codes stop mapping reliably to Unicode — which
    # means the screen reader reads gibberish even though the page looks fine.
    non_embedded: set[str] = set()
    for pno in range(page_count):
        try:
            for font in doc.get_page_fonts(pno):
                # (xref, ext, type, basefont, name, encoding[, referencer])
                if len(font) >= 4 and font[1] == "n/a":
                    non_embedded.add(str(font[3]))
        except Exception:
            continue

    if non_embedded:
        shown = ", ".join(sorted(non_embedded)[:6])
        more = "…" if len(non_embedded) > 6 else ""
        checks.append(_check(
            "fonts-embedded", "Fonts are embedded", "Content", "warn",
            f"{len(non_embedded)} font(s) are not embedded: {shown}{more}.",
            "moderate",
            "Embed all fonts when exporting. Substituted fonts can break the "
            "character-to-Unicode mapping that assistive technology relies on.",
            "PDF/UA-1 7.21",
        ))
    else:
        checks.append(_check(
            "fonts-embedded", "Fonts are embedded", "Content", "pass",
            "All fonts used on the pages are embedded.", "moderate",
            standard="PDF/UA-1 7.21",
        ))

    # Image-only pages: the page carries images and (almost) no extractable
    # text, i.e. a scan that was never OCR'd. To a screen reader it is blank.
    image_only: list[int] = []
    total_chars = 0
    for pno in range(page_count):
        try:
            page = doc.load_page(pno)
            text = (page.get_text() or "").strip()
            total_chars += len(text)
            if len(text) < 10 and page.get_images(full=False):
                image_only.append(pno + 1)
        except Exception:
            continue

    if image_only:
        shown = ", ".join(str(p) for p in image_only[:10])
        more = f" (+{len(image_only) - 10} more)" if len(image_only) > 10 else ""
        checks.append(_check(
            "text-extractable", "Pages contain real, selectable text",
            "Content", "fail",
            f"{len(image_only)} of {page_count} page(s) contain images but "
            f"virtually no extractable text — page(s) {shown}{more}. These are "
            "almost certainly un-OCR'd scans.",
            "critical",
            "Run the document through the OCR tool to add a text layer.",
            "PDF/UA-1 7.1, WCAG 1.4.5",
        ))
    elif total_chars == 0:
        checks.append(_check(
            "text-extractable", "Pages contain real, selectable text",
            "Content", "warn",
            "No extractable text was found anywhere in the document.",
            "critical",
            "If this document should contain text, run it through OCR.",
            "WCAG 1.4.5",
        ))
    else:
        checks.append(_check(
            "text-extractable", "Pages contain real, selectable text",
            "Content", "pass",
            f"Extractable text found across the document ({total_chars:,} characters).",
            "critical", standard="WCAG 1.4.5",
        ))

    return checks


def _navigation_and_annotation_checks(
    pdf: pikepdf.Pdf, page_count: int
) -> list[dict[str, Any]]:
    """Tab order, bookmarks, link descriptions and form-field labels."""
    checks: list[dict[str, Any]] = []

    pages_wrong_tab = 0
    links_total = 0
    links_no_desc = 0
    widgets_total = 0
    widgets_no_label = 0

    for page in pdf.pages:
        try:
            if _name_to_str(page.obj.get("/Tabs")) != "S":
                pages_wrong_tab += 1
        except Exception:
            pages_wrong_tab += 1

        try:
            annots = page.obj.get("/Annots")
            if not isinstance(annots, pikepdf.Array):
                continue
            for annot in annots:
                if not isinstance(annot, pikepdf.Dictionary):
                    continue
                subtype = _name_to_str(annot.get("/Subtype"))
                if subtype == "Link":
                    links_total += 1
                    if not _text_of(annot.get("/Contents")):
                        links_no_desc += 1
                elif subtype == "Widget":
                    widgets_total += 1
                    # /TU is the field's accessible name. Screen readers announce
                    # it; without it the user hears "edit text, blank".
                    if not _text_of(annot.get("/TU")):
                        widgets_no_label += 1
        except Exception:
            continue

    # /Tabs must be /S so keyboard tab order follows the structure tree rather
    # than the (arbitrary) order annotations happen to sit in the array.
    if pages_wrong_tab == 0:
        checks.append(_check(
            "tab-order", "Page tab order follows document structure",
            "Navigation", "pass",
            "Every page sets /Tabs to /S.", "moderate",
            standard="PDF/UA-1 7.18.1",
        ))
    else:
        checks.append(_check(
            "tab-order", "Page tab order follows document structure",
            "Navigation", "fail",
            f"{pages_wrong_tab} of {page_count} page(s) don't set /Tabs to /S, so "
            "keyboard focus may move through links and fields in an "
            "unpredictable order.",
            "moderate",
            "Set /Tabs /S on every page.",
            "PDF/UA-1 7.18.1",
        ))

    if links_total:
        if links_no_desc:
            checks.append(_check(
                "link-descriptions", "Links have a description", "Navigation",
                "warn",
                f"{links_no_desc} of {links_total} link annotation(s) have no "
                "/Contents description.",
                "moderate",
                "Give each link an alternate description so it isn't announced "
                "as a bare URL.",
                "PDF/UA-1 7.18.5, WCAG 2.4.4",
            ))
        else:
            checks.append(_check(
                "link-descriptions", "Links have a description", "Navigation",
                "pass",
                f"All {links_total} link annotation(s) carry a description.",
                "moderate", standard="PDF/UA-1 7.18.5, WCAG 2.4.4",
            ))

    if widgets_total:
        if widgets_no_label:
            checks.append(_check(
                "form-field-labels", "Form fields have accessible labels",
                "Forms", "fail",
                f"{widgets_no_label} of {widgets_total} form field(s) have no /TU "
                "tooltip, so assistive technology has no name to announce.",
                "serious",
                "Set a tooltip (/TU) on every field describing what it's for.",
                "PDF/UA-1 7.18.4, WCAG 1.3.1, 4.1.2",
            ))
        else:
            checks.append(_check(
                "form-field-labels", "Form fields have accessible labels",
                "Forms", "pass",
                f"All {widgets_total} form field(s) have a tooltip.",
                "serious", standard="PDF/UA-1 7.18.4, WCAG 1.3.1",
            ))

    # Bookmarks matter for navigation once a document is long enough that
    # scrolling stops being viable. Below that they're not expected.
    try:
        has_outline = isinstance(pdf.Root.get("/Outlines"), pikepdf.Dictionary)
    except Exception:
        has_outline = False
    if page_count >= 21 and not has_outline:
        checks.append(_check(
            "bookmarks", "Long documents have bookmarks", "Navigation", "warn",
            f"This document has {page_count} pages and no bookmark outline.",
            "minor",
            "Add bookmarks for top-level sections — use the Bookmarks tool.",
            "WCAG 2.4.5",
        ))
    elif has_outline:
        checks.append(_check(
            "bookmarks", "Long documents have bookmarks", "Navigation", "pass",
            "A bookmark outline is present.", "minor", standard="WCAG 2.4.5",
        ))

    return checks


def _manual_checks() -> list[dict[str, Any]]:
    """Requirements no static analysis can decide.

    These are reported, never scored. PDF/UA classifies them as human-verified
    and Adobe's Full Check does the same. Silently omitting them would make a
    passing report look more complete than it is.
    """
    items = [
        ("colour-contrast", "Text has sufficient colour contrast", "Content",
         "Contrast depends on the rendered appearance of overlapping content, "
         "which can't be reliably computed from the page objects alone.",
         "Check body text against its background for at least 4.5:1 (3:1 for "
         "large text).", "WCAG 1.4.3"),
        ("reading-order", "Reading order matches the visual order", "Structure",
         "A structure tree can be present and complete but still order content "
         "differently from how it reads on the page.",
         "Read the document with the tag tree, or with a screen reader, and "
         "confirm the order matches.", "PDF/UA-1 7.2, WCAG 1.3.2"),
        ("alt-text-quality", "Alternative text is meaningful", "Structure",
         "Presence of /Alt is checked automatically; whether it describes the "
         "image usefully is not something a machine can judge.",
         "Confirm each description conveys the information the image carries — "
         "'chart' is present but useless.", "WCAG 1.1.1"),
        ("colour-alone", "Colour is not the only way information is conveyed",
         "Content",
         "Whether meaning is carried by colour alone requires understanding the "
         "content.",
         "Check that anything distinguished by colour is also distinguished by "
         "text, shape or position.", "WCAG 1.4.1"),
    ]
    return [
        _check(cid, title, cat, "manual", detail, "info", fix, std)
        for cid, title, cat, detail, fix, std in items
    ]


def _score(checks: list[dict[str, Any]]) -> dict[str, Any]:
    """Weight automated checks by impact; manual and informational ones don't count.

    A warning earns half credit — it marks something that degrades the
    experience without making the document unusable.
    """
    earned = 0.0
    possible = 0.0
    passed = failed = warnings = manual = 0
    critical_failures = 0

    for c in checks:
        status = c["status"]
        if status == "manual":
            manual += 1
            continue
        weight = _IMPACT_WEIGHT.get(c["impact"], 0)
        if status == "pass":
            passed += 1
        elif status == "warn":
            warnings += 1
        elif status == "fail":
            failed += 1
            if c["impact"] == "critical":
                critical_failures += 1
        if weight == 0:
            continue  # informational rows are reported but never scored
        possible += weight
        if status == "pass":
            earned += weight
        elif status == "warn":
            earned += weight * 0.5

    score = int(round(100 * earned / possible)) if possible else 0

    if critical_failures:
        verdict = (
            "Not accessible. At least one issue makes the document unusable with "
            "a screen reader."
        )
    elif failed:
        verdict = "Partly accessible. Real barriers remain, but nothing blocking."
    elif warnings:
        verdict = "Broadly accessible, with some issues worth fixing."
    else:
        verdict = (
            "Passes every automated check. The manual checks below still need a "
            "human."
        )

    return {
        "score": score,
        "passed": passed,
        "failed": failed,
        "warnings": warnings,
        "manual": manual,
        "criticalFailures": critical_failures,
        "verdict": verdict,
    }


def check_accessibility(input_path: str) -> dict[str, Any]:
    """Audit a PDF against PDF/UA and the PDF-relevant parts of WCAG 2.2.

    Returns a report dict. Raises AccessibilityError for files we can't open.
    Read-only: the input is never modified.
    """
    try:
        pdf = pikepdf.open(input_path)
    except pikepdf.PasswordError as exc:
        raise AccessibilityError(
            "This PDF is password-protected — unlock it first."
        ) from exc
    except Exception as exc:
        raise AccessibilityError("This file isn't a readable PDF.") from exc

    try:
        struct_root = pdf.Root.get("/StructTreeRoot")
        has_struct = isinstance(struct_root, pikepdf.Dictionary)

        role_map: dict[str, str] = {}
        if has_struct:
            raw_map = struct_root.get("/RoleMap")
            if isinstance(raw_map, pikepdf.Dictionary):
                for key, value in raw_map.items():
                    role_map[_name_to_str(key)] = _name_to_str(value)

        walk = _StructWalk(role_map)
        if has_struct:
            try:
                _walk_struct_tree(struct_root.get("/K"), walk)
            except Exception:
                # A broken sub-tree shouldn't sink the whole audit — the counts
                # collected so far are still worth reporting.
                logger.debug("accessibility: structure walk aborted early", exc_info=True)
                walk.truncated = True

        page_count = len(pdf.pages)

        checks: list[dict[str, Any]] = []
        checks += _document_checks(pdf, has_struct)
        checks += _structure_checks(walk, has_struct)

        doc = None
        try:
            doc = fitz.open(input_path)
            checks += _content_checks(doc)
        except Exception:
            logger.debug("accessibility: content checks skipped", exc_info=True)
            checks.append(_check(
                "content-checks", "Page content checks", "Content", "warn",
                "Page content could not be analysed, so font embedding and text "
                "extraction were not evaluated.",
                "info",
            ))
        finally:
            if doc is not None:
                doc.close()

        checks += _navigation_and_annotation_checks(pdf, page_count)
        checks += _manual_checks()

        title = ""
        info = pdf.trailer.get("/Info")
        if isinstance(info, pikepdf.Dictionary):
            title = _text_of(info.get("/Title"))

        return {
            "summary": _score(checks),
            "document": {
                "pages": page_count,
                "tagged": has_struct,
                "title": title,
                "language": _text_of(pdf.Root.get("/Lang")),
                "encrypted": bool(pdf.is_encrypted),
                "headings": len(walk.headings),
                "figures": walk.figures_total,
                "tables": walk.tables_total,
            },
            "checks": checks,
        }
    finally:
        pdf.close()
