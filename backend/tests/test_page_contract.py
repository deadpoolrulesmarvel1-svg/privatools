"""Every tool's page and its route count pages the same way.

Redact PDF's page called the first page 1 and sent that number; its route read
the number as an index counted from 0. Redacting page 1 of a three-page PDF
blacked out page 2 and left page 1 readable, and every one-page PDF was
refused. Each side had tests, but only against itself.

frontend/src/test/page-contract.json records, for every tool whose page sends
a page number, the value the page sends to mean the first and the second page.
src/test/page-contract.test.tsx holds the pages to it. These tests send the
same values through the real routes with a two-page PDF and check that the
change lands on that page and leaves the other page as it was.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import sys
from decimal import Decimal
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import pikepdf
import pytest
from fastapi.routing import APIRoute
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

CONTRACT_FILE = json.loads((ROOT / "frontend" / "src" / "test" / "page-contract.json").read_text(encoding="utf-8"))
CONTRACT = CONTRACT_FILE["tools"]

# Form fields that carry page numbers. A route with one of these must have a
# contract, or be listed below as one no page of the site calls with it.
PAGE_FIELDS = {"page", "pages", "page_order", "page_ranges"}
API_ONLY = {
    "/bates-numbering": "Bates Numbering's page numbers every page; only API callers choose pages.",
    "/extract-tables": "Extract Tables' page reads every page; only API callers choose pages.",
    "/qr-code": "QR Code Generator's page makes an image; only API callers place a code on a PDF page.",
}

MARKERS = ("FIRST PAGE 1111", "SECOND PAGE 2222")
# A region around the marker line, in points from the page's top-left corner.
REGION = {"x": 60, "y": 80, "width": 320, "height": 34}


def _pdf(pages: int) -> bytes:
    doc = fitz.open()
    for index in range(pages):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), MARKERS[index], fontsize=14)
        page.insert_text((72, 400), f"Public text on page {index + 1}", fontsize=12)
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


TWO_PAGES = _pdf(2)
ONE_PAGE = _pdf(1)


def _png_data_url() -> str:
    image = Image.new("RGB", (60, 20), (20, 40, 160))
    out = io.BytesIO()
    image.save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


SIGNATURE = _png_data_url()

# What each page puts in a request besides its page number: one item per tool
# for the routes that take a JSON list, the other form fields for the rest.
ITEMS = {
    "redact-pdf": dict(REGION),
    "whiteout-pdf": dict(REGION),
    "annotate-pdf": {"type": "highlight", **REGION, "color": "#ffe24a", "text": ""},
    "add-shapes": {"type": "rectangle", **REGION, "x2": 380, "y2": 114, "color": "#0E8A56", "fill": "#0E8A56", "stroke_width": 2},
    "edit-pdf": {"type": "text", "x": 72, "y": 600, "text": "EDITED", "font_size": 14, "color": "#000000", "font_family": "Helvetica"},
    "form-creator": {"name": "contract_field", "type": "text", **REGION, "required": False, "value": "", "multiline": False},
    "bookmarks": {"title": "Contract"},
}
FIELDS = {
    "redact-pdf": {"color": "#000000"},
    "esign-pdf": {"signature": SIGNATURE, "x": "72", "y": "80", "width": "120", "height": "40"},
    # Sign PDF measures from the bottom-left corner.
    "sign-pdf": {"signature_data": SIGNATURE, "x": "72", "y": "600", "width": "120", "height": "40"},
    "split-pdf": {"mode": "pages"},
    "rotate-pdf": {"angle": "90"},
    "stamp-pdf": {"stamp_type": "confidential", "opacity": "0.5", "position": "center"},
}
IN_PLACE = {
    "redact-pdf", "whiteout-pdf", "annotate-pdf", "add-shapes", "edit-pdf", "form-creator",
    "esign-pdf", "sign-pdf", "rotate-pdf", "stamp-pdf",
}


def _post(client, slug: str, value, pdf: bytes):
    spec = CONTRACT[slug]
    data = dict(FIELDS.get(slug, {}))
    if "key" in spec:
        data[spec["field"]] = json.dumps([{**ITEMS[slug], spec["key"]: value}])
    elif isinstance(value, list):
        data[spec["field"]] = json.dumps(value)
    else:
        data[spec["field"]] = str(value)
    if slug == "merge-pdf":
        # One range per file: the same page of two copies.
        data[spec["field"]] = json.dumps([value, value])
        files = [("files", ("a.pdf", pdf, "application/pdf")), ("files", ("b.pdf", pdf, "application/pdf"))]
    else:
        files = {"file": ("contract.pdf", pdf, "application/pdf")}
    res = client.post("/api" + spec["endpoint"], files=files, data=data)
    assert res.status_code == 200, f"{slug} {spec['field']}={value!r}: {res.status_code} {res.text[:300]}"
    return res.content


def _fingerprints(pdf: bytes) -> list[tuple]:
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        return [
            (
                page.rotation,
                page.get_text(),
                len(list(page.annots())),
                len(list(page.widgets())),
                len(page.get_images()),
                hashlib.sha256(page.get_pixmap(dpi=36).samples).hexdigest(),
            )
            for page in doc
        ]


def _changed_pages(before: bytes, after: bytes) -> set[int]:
    old, new = _fingerprints(before), _fingerprints(after)
    assert len(new) == len(old), f"the page count changed from {len(old)} to {len(new)}"
    return {number for number, (a, b) in enumerate(zip(old, new), start=1) if a != b}


def _source_pages(pdf: bytes) -> list[int]:
    """Which page of the two-page PDF each page of the result is."""
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        texts = [page.get_text() for page in doc]
    return [next(n for n, marker in enumerate(MARKERS, start=1) if marker in text) for text in texts]


def _bookmark_targets(pdf: bytes) -> list[int]:
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        return [entry[2] for entry in doc.get_toc()]


def _landed_on(slug: str, result: bytes, pdf: bytes):
    """Where the change landed, in the terms the page's user thinks in."""
    if slug in IN_PLACE:
        return _changed_pages(pdf, result)
    if slug == "bookmarks":
        return _bookmark_targets(result)
    return _source_pages(result)


def _expected(slug: str, page: int):
    other = 3 - page
    return {
        "bookmarks": [page],
        "delete-pages": [other],
        "merge-pdf": [page, page],
    }.get(slug, {page} if slug in IN_PLACE else [page])


@pytest.mark.parametrize("which,page", [("first", 1), ("second", 2)])
@pytest.mark.parametrize("slug", sorted(CONTRACT))
def test_the_page_the_user_chose_is_the_page_that_changes(client, slug, which, page):
    result = _post(client, slug, CONTRACT[slug][which], TWO_PAGES)
    assert _landed_on(slug, result, TWO_PAGES) == _expected(slug, page), (
        f"{slug}: the page sends {CONTRACT[slug][which]!r} for page {page}, "
        f"and the route changed something else"
    )


@pytest.mark.parametrize("slug", sorted(IN_PLACE))
def test_the_first_page_of_a_one_page_pdf_works(client, slug):
    result = _post(client, slug, CONTRACT[slug]["first"], ONE_PAGE)
    assert _changed_pages(ONE_PAGE, result) == {1}


@pytest.mark.parametrize("page", [1, 2])
def test_redaction_removes_the_text_on_the_chosen_page_only(client, page):
    result = _post(client, "redact-pdf", CONTRACT["redact-pdf"]["first" if page == 1 else "second"], TWO_PAGES)
    with fitz.open(stream=result, filetype="pdf") as doc:
        texts = [p.get_text() for p in doc]
    assert MARKERS[page - 1] not in texts[page - 1], "the text under the box is still in the file"
    assert MARKERS[2 - page] in texts[2 - page], "the other page lost its text"
    assert f"Public text on page {page}" in texts[page - 1], "text outside the box was removed"


def _page_field_routes() -> dict[str, set[str]]:
    """Every /api route whose form has a page-number field, without /api."""
    from backend.app.main import app

    found: dict[str, set[str]] = {}

    def visit(route, prefix: str = "") -> None:
        if isinstance(route, APIRoute):
            path = f"{prefix}{route.path}"
            names = {param.alias for param in route.dependant.body_params} & PAGE_FIELDS
            if names and path.startswith("/api/") and not path.startswith("/api/v1/"):
                found[path[len("/api"):]] = names
        original_router = getattr(route, "original_router", None)
        if original_router is not None:
            child_prefix = f"{prefix}{getattr(getattr(route, 'include_context', None), 'prefix', '')}"
            for child in original_router.routes:
                visit(child, child_prefix)

    for route in app.routes:
        visit(route)
    return found


def test_every_route_that_takes_page_numbers_has_a_contract():
    routes = _page_field_routes()
    assert len(routes) >= 10, f"found only {sorted(routes)}; the route walk is broken"
    covered = {spec["endpoint"] for spec in CONTRACT.values()}
    missing = sorted(set(routes) - covered - set(API_ONLY))
    assert not missing, (
        "These routes take page numbers but frontend/src/test/page-contract.json has no entry "
        "for them, so nothing checks that their page and the route count pages alike: "
        + ", ".join(f"{path} ({', '.join(sorted(routes[path]))})" for path in missing)
    )
    stale = sorted(set(API_ONLY) - set(routes))
    assert not stale, f"API_ONLY names routes that no longer take page numbers: {stale}"


# ─── A page the PDF does not have is refused, not skipped ───────────────────
#
# White-Out, Annotate, Add Shapes and Edit PDF skipped an item whose page the
# PDF does not have and sent the file back unchanged, so the visitor got a
# download and thought the region was covered. Like Redact, they now refuse it.

SKIPPING_TOOLS = ["whiteout-pdf", "annotate-pdf", "add-shapes", "edit-pdf"]
# What each route calls an item; the pages use the same words and numbers.
NOUNS = {"whiteout-pdf": "Region", "annotate-pdf": "Annotation", "add-shapes": "Shape", "edit-pdf": "Edit"}


def _post_items(client, slug: str, item: dict, pdf: bytes = TWO_PAGES):
    spec = CONTRACT[slug]
    data = {spec["field"]: json.dumps([item])}
    return client.post("/api" + spec["endpoint"], files={"file": ("contract.pdf", pdf, "application/pdf")}, data=data)


@pytest.mark.parametrize("page", [0, 3, -1, 1.5, True, None, "two"])
@pytest.mark.parametrize("slug", SKIPPING_TOOLS)
def test_an_item_on_a_page_the_pdf_does_not_have_is_refused(client, slug, page):
    res = _post_items(client, slug, {**ITEMS[slug], CONTRACT[slug]["key"]: page})
    assert res.status_code == 400, f"{slug} page={page!r}: {res.status_code} {res.text[:200]}"
    detail = res.json()["detail"]
    assert detail.startswith(f"{NOUNS[slug]} 1 "), detail
    if type(page) is int:
        assert f"page {page}, which this PDF does not have" in detail, detail
        assert "1 to 2" in detail, detail
    else:
        assert "which is not a page number" in detail, detail


@pytest.mark.parametrize("page", [2, "2", 2.0])
@pytest.mark.parametrize("slug", SKIPPING_TOOLS)
def test_a_page_number_written_as_text_or_a_whole_float_still_counts(client, slug, page):
    res = _post_items(client, slug, {**ITEMS[slug], CONTRACT[slug]["key"]: page})
    assert res.status_code == 200, f"{slug} page={page!r}: {res.status_code} {res.text[:200]}"
    assert _changed_pages(TWO_PAGES, res.content) == {2}


# ─── Boxes drawn on turned pages and on pages that do not start at 0,0 ──────
#
# The preview shows a page as pdf.js draws it: turned by /Rotate and cut to its
# visible area. On such pages a box sent as the preview showed it landed
# somewhere else or off the page, and a redaction hid nothing. Even with the
# right numbers, PyMuPDF drew White-Out, shapes, signatures and Redact's black
# fill in the wrong place on a turned page whose visible area does not start at
# 0,0, and Sign and Edit PDF shrank and moved everything on pages turned a
# quarter or cut by a CropBox.
#
# page-contract.json ("turned") records, for each page, the box the visitor
# draws and what the page sends for it. These tests build each page with a
# secret line upright under the drawn box, send what the page sends through
# the real routes, and look at the result as the page is shown.

TURNED = CONTRACT_FILE["turned"]
DRAWN = TURNED["drawn"]
SECRET_LINE = "SECRET 4111-0001"
PUBLIC_LINE = "Public words stay"
# Baselines as the page is shown: the secret line inside the drawn box, the
# public line well below it.
SECRET_AT = (DRAWN["x"] + 12, DRAWN["y"] + DRAWN["height"] - 10)
PUBLIC_AT = (72, 300)


def _visible_area(spec: dict) -> list[float]:
    media = spec["mediabox"]
    crop = spec.get("cropbox") or media
    return [max(media[0], crop[0]), max(media[1], crop[1]), min(media[2], crop[2]), min(media[3], crop[3])]


def _shown_rotate(spec: dict) -> int:
    return spec.get("shown_rotate", spec["rotate"])


def _pdfjs_rotate(raw) -> int:
    """How pdf.js reads a /Rotate value (Page.rotate in its worker): 0 unless
    it is a multiple of 90, then turned into 0, 90, 180 or 270. Written out
    here so the tests do not lean on the code they test."""
    if isinstance(raw, bool) or not isinstance(raw, (int, Decimal)) or raw % 90:
        return 0
    return int(raw) % 360


def _as_pdfjs_shows(pdf: bytes) -> bytes:
    """A copy of `pdf` whose first page carries /Rotate the way pdf.js reads
    it, so PyMuPDF shows it as the preview does: MuPDF reads /Rotate 80 as 90,
    where pdf.js (and Chrome) read 0."""
    with pikepdf.open(io.BytesIO(pdf)) as doc:
        node, raw = doc.pages[0].obj, None
        while node is not None:
            if pikepdf.Name.Rotate in node:
                raw = node.Rotate
                break
            node = node.get(pikepdf.Name.Parent)
        if raw is None or (type(raw) is int and raw == _pdfjs_rotate(raw)):
            return pdf
        doc.pages[0].obj.Rotate = _pdfjs_rotate(raw)
        out = io.BytesIO()
        doc.save(out)
        return out.getvalue()


def _turned_pdf(name: str) -> bytes:
    """The contract's page, with both lines written to read upright where the
    page is shown. /Rotate is written as the contract says, on the page or on
    the page tree; the lines are laid out for the rotation pdf.js reads."""
    spec = TURNED["pages"][name]
    turn = _shown_rotate(spec)
    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica,
        Encoding=pikepdf.Name.WinAnsiEncoding,
    ))
    page = pikepdf.Dictionary(
        Type=pikepdf.Name.Page, MediaBox=pikepdf.Array(spec["mediabox"]),
        Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)),
    )
    if "cropbox" in spec:
        page.CropBox = pikepdf.Array(spec["cropbox"])
    if turn:
        page.Rotate = turn  # for laying out the lines; replaced below
    pdf.pages.append(pikepdf.Page(page))
    blank = io.BytesIO()
    pdf.save(blank)
    with fitz.open(stream=blank.getvalue(), filetype="pdf") as doc:
        derotate = doc[0].derotation_matrix
    left, _, _, top = _visible_area(spec)
    # Text turned against /Rotate reads upright once the page is turned.
    angle = math.radians(turn)
    a, b = round(math.cos(angle)), round(math.sin(angle))
    content = ""
    for text, shown_at in ((SECRET_LINE, SECRET_AT), (PUBLIC_LINE, PUBLIC_AT)):
        at = fitz.Point(shown_at) * derotate  # on the unturned page, from the visible area's top-left
        content += f"BT /F1 14 Tf {a} {b} {-b} {a} {left + at.x:g} {top - at.y:g} Tm ({text}) Tj ET\n"
    pdf.pages[0].Contents = pdf.make_stream(content.encode())
    if pikepdf.Name.Rotate in pdf.pages[0].obj:
        del pdf.pages[0].obj.Rotate
    if spec["rotate"]:
        # A Decimal keeps pikepdf writing a real token ("-90.0"); an int or a
        # float could come out as "-90".
        written = Decimal(f"{spec['rotate']:.1f}") if spec.get("real") else int(spec["rotate"])
        (pdf.Root.Pages if spec.get("inherited") else pdf.pages[0].obj).Rotate = written
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


TURNED_PDFS = {name: _turned_pdf(name) for name in TURNED["pages"]}
DRAWN_RECT = fitz.Rect(DRAWN["x"], DRAWN["y"], DRAWN["x"] + DRAWN["width"], DRAWN["y"] + DRAWN["height"])


def _shown(pdf: bytes) -> np.ndarray:
    """The page as pdf.js shows it, in grey, one pixel per point."""
    with fitz.open(stream=_as_pdfjs_shows(pdf), filetype="pdf") as doc:
        pix = doc[0].get_pixmap(dpi=72, colorspace=fitz.csGRAY, annots=True)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()


def _bounds(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def _page_text(pdf: bytes) -> str:
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        return " ".join(doc[0].get_text().split())


@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_each_turned_page_is_built_as_the_contract_says(name):
    """The fixture itself: PyMuPDF shows the page at the size pdf.js shows it,
    with the secret line upright inside the drawn box and the public line
    outside it."""
    spec = TURNED["pages"][name]
    # /Rotate as the file writes it (pikepdf would copy an inherited value onto
    # the page while opening the file).
    with fitz.open(stream=TURNED_PDFS[name], filetype="pdf") as doc:
        page_xref = doc[0].xref
        tree_xref = int(doc.xref_get_key(page_xref, "Parent")[1].split()[0])
        on_page, on_tree = doc.xref_get_key(page_xref, "Rotate"), doc.xref_get_key(tree_xref, "Rotate")
    (other_kind, _), (kind, value) = (on_page, on_tree) if spec.get("inherited") else (on_tree, on_page)
    assert other_kind == "null", (on_page, on_tree)
    if spec["rotate"]:
        # PyMuPDF names a direct real "float" and writes 90.0 as "90".
        assert kind == ("float" if spec.get("real") else "int") and float(value) == spec["rotate"], (on_page, on_tree)
        if spec.get("real"):
            assert f"/Rotate {spec['rotate']:.1f}".encode() in TURNED_PDFS[name], "the file does not write a real token"
    else:
        assert kind == "null", (on_page, on_tree)
    with fitz.open(stream=_as_pdfjs_shows(TURNED_PDFS[name]), filetype="pdf") as doc:
        page = doc[0]
        assert page.rotation == _shown_rotate(spec)
        assert [round(page.rect.width), round(page.rect.height)] == spec["shown"]
        words = page.get_text("words")
        secret = [fitz.Rect(w[:4]) * page.rotation_matrix for w in words if w[4] in SECRET_LINE.split()]
        public = [fitz.Rect(w[:4]) * page.rotation_matrix for w in words if w[4] in PUBLIC_LINE.split()]
    assert len(secret) == 2 and len(public) == 3, words
    for rect in secret:
        assert DRAWN_RECT.contains(rect), f"{name}: {SECRET_LINE} shows at {rect}"
    for rect in public:
        assert not DRAWN_RECT.intersects(rect)
    line = secret[0] | secret[1]
    assert line.width > 3 * line.height, f"{name}: the secret line is not upright as shown: {line}"


def _marked_signature() -> str:
    """A signature image whose left third is black, so a turned result shows."""
    image = Image.new("RGB", (90, 30), (150, 150, 150))
    image.paste((0, 0, 0), (0, 0, 30, 30))
    out = io.BytesIO()
    image.save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


SIGNATURE_MARKED = _marked_signature()

# (tool, what its page sends for a box already in the route's frame)
TURNED_KINDS = {
    "redact": ("redact-pdf", lambda box: {"redactions": json.dumps([{"page": 0, **box}]), "color": "#000000"}),
    "whiteout": ("whiteout-pdf", lambda box: {"regions": json.dumps([{"page": 1, **box}])}),
    **{
        f"annotate-{kind}": ("annotate-pdf", lambda box, kind=kind: {"annotations": json.dumps(
            [{"type": kind, "page": 1, **box, "color": "#e54a3c", "text": ""}])})
        for kind in ("highlight", "underline", "strikethrough")
    },
    **{
        f"shapes-{kind}": ("add-shapes", lambda box, kind=kind: {"shapes": json.dumps([{
            "type": kind, "page": 1, **box, "x2": box["x"] + box["width"], "y2": box["y"] + box["height"],
            "color": "#000000", "fill": "#000000" if kind in ("rectangle", "circle") else "", "stroke_width": 2,
        }])})
        for kind in ("rectangle", "circle", "line", "arrow")
    },
    "form-text": ("form-creator", lambda box: {"form_fields": json.dumps([{
        "name": "contract_field", "type": "text", "page": 1, **box, "required": False, "value": "FIELDVALUE", "multiline": False,
    }])}),
    "form-checkbox": ("form-creator", lambda box: {"form_fields": json.dumps([{
        "name": "contract_field", "type": "checkbox", "page": 1, **box, "required": False, "checked": True,
    }])}),
    "esign": ("esign-pdf", lambda box: {"signature": SIGNATURE_MARKED, "page": "1", **{k: str(v) for k, v in box.items()}}),
    "sign": ("sign-pdf", lambda box: {"signature_data": SIGNATURE_MARKED, "page": "1", **{k: str(v) for k, v in box.items()}}),
    "edit-rectangle": ("edit-pdf", lambda box: {"edits": json.dumps([{
        "type": "rectangle", "page": 1, **box, "stroke_color": "#000000", "fill_color": "#000000", "stroke_width": 0,
    }])}),
    "edit-image": ("edit-pdf", lambda box: {"edits": json.dumps([{"type": "image", "page": 1, **box, "image_data": SIGNATURE_MARKED}])}),
    "edit-text": ("edit-pdf", lambda box: {"edits": json.dumps([{
        "type": "text", "page": 1, "x": box["x"] + 4, "y": box["y"] + 10, "text": "EDITED", "font_size": 14,
        "color": "#000000", "font_family": "Helvetica",
    }])}),
}
# How far a mark may reach past the drawn box: half a stroke, an arrow's barbs,
# or the rounded ends MuPDF gives a highlight on any page (a fifth of the box's
# height beyond each end of the line; before the fix, on a page turned a
# quarter, that was a fifth of the box's length, 57 points past it).
REACH = {"shapes-arrow": 7, "annotate-highlight": 7}


def _box_for_route(slug: str, name: str) -> dict:
    """The drawn box as the tool's page sends it (page-contract.json, frame)."""
    spec = TURNED["pages"][name]
    if CONTRACT[slug]["frame"] == "unrotated":
        return dict(spec["unrotated"])
    assert CONTRACT[slug]["frame"] == "shown-from-bottom"
    return {**DRAWN, "y": spec["shown"][1] - DRAWN["y"] - DRAWN["height"]}


@pytest.mark.parametrize("kind", sorted(TURNED_KINDS))
@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_a_box_drawn_on_a_turned_page_lands_where_it_was_drawn(client, name, kind):
    slug, form = TURNED_KINDS[kind]
    pdf = TURNED_PDFS[name]
    res = client.post("/api" + CONTRACT[slug]["endpoint"], files={"file": ("turned.pdf", pdf, "application/pdf")},
                      data=form(_box_for_route(slug, name)))
    assert res.status_code == 200, f"{kind} on {name}: {res.status_code} {res.text[:300]}"
    assert _as_pdfjs_shows(res.content) == res.content, (
        f"{kind} on {name}: the result's /Rotate still reads differently in different viewers"
    )
    before, after = _shown(pdf), _shown(res.content)
    assert before.shape == after.shape, f"{kind} on {name}: the page changed size"
    landed = _bounds(np.abs(before.astype(int) - after.astype(int)) > 48)
    assert landed is not None, f"{kind} on {name}: nothing changed on the page"
    reach = REACH.get(kind, 2)
    assert (landed[0] >= DRAWN_RECT.x0 - reach and landed[1] >= DRAWN_RECT.y0 - reach
            and landed[2] <= DRAWN_RECT.x1 + reach and landed[3] <= DRAWN_RECT.y1 + reach), (
        f"{kind} on {name}: drawn at {tuple(DRAWN_RECT)}, changed {landed} as the page is shown"
    )
    inside = after[int(DRAWN_RECT.y0) + 1:int(DRAWN_RECT.y1) - 1, int(DRAWN_RECT.x0) + 1:int(DRAWN_RECT.x1) - 1]
    if kind in ("redact", "shapes-rectangle", "edit-rectangle"):
        assert (inside < 60).mean() > 0.97, f"{kind} on {name}: the drawn box is not filled"
    if kind == "whiteout":
        assert (inside == 255).mean() > 0.995, f"{name}: something still shows under the white-out"
    if kind == "redact":
        text = _page_text(res.content)
        assert "SECRET" not in text and "4111" not in text, f"{name}: the secret is still in the file: {text!r}"
        assert PUBLIC_LINE in text, f"{name}: text outside the box went too: {text!r}"
    if kind in ("esign", "sign", "edit-image"):
        ys, xs = np.nonzero(after[landed[1]:landed[3], landed[0]:landed[2]] < 60)
        across = (xs.mean() + 0.5) / (landed[2] - landed[0])
        down = (ys.mean() + 0.5) / (landed[3] - landed[1])
        assert across < 0.4 and 0.3 < down < 0.7, (
            f"{kind} on {name}: the signature is turned (its black third sits at {across:.2f}, {down:.2f})"
        )
    if kind == "edit-text":
        assert (landed[2] - landed[0]) > 2 * (landed[3] - landed[1]), f"{name}: the text is not upright: {landed}"


@pytest.mark.parametrize("code", ["(b)(6)", "Exemption 3: 26 U.S.C. 6103"])
@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_an_exemption_code_reads_upright_in_its_box_on_a_turned_page(client, name, code):
    """PyMuPDF printed a code along the page as stored: sideways on a page
    turned a quarter, upside down on one turned half, and a long code broken
    over several sideways lines."""
    box = TURNED["pages"][name]["unrotated"]
    res = client.post("/api/redact", files={"file": ("turned.pdf", TURNED_PDFS[name], "application/pdf")},
                      data={"redactions": json.dumps([{"page": 0, **box, "code": code}])})
    assert res.status_code == 200, res.text[:300]
    assert _as_pdfjs_shows(res.content) == res.content, f"{name}: /Rotate still reads differently in different viewers"
    with fitz.open(stream=_as_pdfjs_shows(res.content), filetype="pdf") as doc:
        page = doc[0]
        turn = fitz.Matrix(page.rotation_matrix)
        turn.e = turn.f = 0
        lines = [(fitz.Point(line["dir"]) * turn, "".join(span["text"] for span in line["spans"]), fitz.Rect(line["bbox"]) * page.rotation_matrix)
                 for block in page.get_text("dict")["blocks"] for line in block.get("lines", [])]
    printed = [(direction, text, where) for direction, text, where in lines if text == code]
    assert printed, f"{name}: the code is not printed whole: {[text for _, text, _ in lines]}"
    direction, _, where = printed[0]
    assert (round(direction.x, 3), round(direction.y, 3)) == (1, 0), f"{name}: the code runs {direction} as shown"
    assert DRAWN_RECT.contains(where), f"{name}: the code shows at {where}, outside the box"


@pytest.mark.parametrize("kind", ["form-text", "form-checkbox"])
@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_a_form_fields_value_reads_upright_on_a_turned_page(client, name, kind):
    """Fields are made on the page as stored, so what a field showed ran along
    the page as stored: a typed name sideways on a page turned a quarter,
    upside down on one turned half, and a tick on its side. The field's /MK/R
    now turns it with the page, and its appearance is drawn turned."""
    slug, form = TURNED_KINDS[kind]
    res = client.post("/api" + CONTRACT[slug]["endpoint"], files={"file": ("turned.pdf", TURNED_PDFS[name], "application/pdf")},
                      data=form(_box_for_route(slug, name)))
    assert res.status_code == 200, f"{kind} on {name}: {res.status_code} {res.text[:300]}"
    rotation = _shown_rotate(TURNED["pages"][name]) % 360
    with fitz.open(stream=_as_pdfjs_shows(res.content), filetype="pdf") as doc:
        (widget,) = doc[0].widgets()
        written = doc.xref_get_key(widget.xref, "MK/R")
        assert (int(written[1]) if written[0] == "int" else 0) == rotation, f"{kind} on {name}: /MK/R is {written}"
        doc.bake()
        page = doc[0]
        turn = fitz.Matrix(page.rotation_matrix)
        turn.e = turn.f = 0
        shown = [fitz.Point(line["dir"]) * turn for block in page.get_text("dict")["blocks"]
                 for line in block.get("lines", [])
                 if "".join(span["text"] for span in line["spans"]).strip() not in ("", SECRET_LINE, PUBLIC_LINE)]
    assert shown, f"{kind} on {name}: the field shows nothing"
    assert {(round(d.x, 3), round(d.y, 3)) for d in shown} == {(1, 0)}, f"{kind} on {name}: the field's text runs {shown} as shown"


# Every way a file can write /Rotate, and how pdf.js (the preview) reads it:
# a multiple of 90 turned into 0, 90, 180 or 270, anything else 0. PyMuPDF
# reports a direct integer as "int", a direct real as "float" ("90" for 90.0)
# and anything indirect as "xref"; reading "float" as no number put boxes back
# in the wrong place on pages whose /Rotate is written 90.0.
ROTATE_TOKENS = {
    "90": 90, "-90": 270, "450": 90, "80": 0, "90.0": 90, "-90.0": 270, "450.0": 90, "90.5": 0,
    ".0": 0, "true": 0, "/R90": 0, "null": 0,
}


def _rotate_written(token: str, where: str) -> bytes:
    """A page whose /Rotate is `token`: on the page, as an indirect object,
    or on the page tree."""
    rotate = {"page": f" /Rotate {token}", "indirect": " /Rotate 4 0 R", "tree": ""}[where]
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [3 0 R] /Count 1{f' /Rotate {token}' if where == 'tree' else ''} >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]{rotate} >>",
    ] + ([token] if where == "indirect" else [])
    out = "%PDF-1.7\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    return (out + f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").encode()


@pytest.mark.parametrize("where", ["page", "indirect", "tree"])
@pytest.mark.parametrize("token", sorted(ROTATE_TOKENS))
def test_rotate_is_read_as_the_preview_reads_it_however_it_is_written(token, where):
    from backend.app.utils.page_space import settle_rotation

    data, expected = _rotate_written(token, where), ROTATE_TOKENS[token]
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert settle_rotation(doc[0]) == expected, "PyMuPDF path"
        assert doc[0].rotation == expected  # and MuPDF now reads it that way too
    with pikepdf.open(io.BytesIO(data)) as pdf:
        page = pikepdf.Page(pdf.pages[0])
        assert settle_rotation(page) == expected, "pikepdf path"
        assert page.rotation == expected


@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_smart_redact_paints_its_box_on_the_words_it_removes(client, name):
    """Smart Redact finds words on the page as stored and removed the right
    ones, but on a turned page whose visible area does not start at 0,0 it
    painted the black box somewhere else."""
    pdf = TURNED_PDFS[name]
    with fitz.open(stream=_as_pdfjs_shows(pdf), filetype="pdf") as doc:
        page = doc[0]
        word = next(fitz.Rect(w[:4]) * page.rotation_matrix for w in page.get_text("words") if w[4] == "SECRET")
    res = client.post("/api/smart-redact", files={"file": ("turned.pdf", pdf, "application/pdf")},
                      data={"needles": json.dumps(["SECRET"]), "color": "#000000"})
    assert res.status_code == 200, res.text[:300]
    assert "SECRET" not in _page_text(res.content)
    before, after = _shown(pdf), _shown(res.content)
    painted = _bounds((after < 60) & (np.abs(before.astype(int) - after.astype(int)) > 48))
    assert painted is not None, f"{name}: no black box"
    assert (painted[0] >= word.x0 - 2 and painted[1] >= word.y0 - 2
            and painted[2] <= word.x1 + 2 and painted[3] <= word.y1 + 2), f"{name}: the word shows at {word}, the box at {painted}"


CROP = TURNED["crop-pdf"]


def _crop_margins(name: str) -> dict:
    """The margins Crop's page sends when the drawn box is the area to keep."""
    width, height = TURNED["pages"][name]["shown"]
    return {
        "top": DRAWN["y"], "left": DRAWN["x"],
        "right": width - DRAWN["x"] - DRAWN["width"], "bottom": height - DRAWN["y"] - DRAWN["height"],
    }


@pytest.mark.parametrize("name", sorted(TURNED["pages"]))
def test_the_area_drawn_to_keep_on_a_turned_page_is_the_area_kept(client, name):
    """Crop's margins are drawn on the page as shown. Measured from the MediaBox
    before /Rotate, the route trimmed the wrong sides of a turned page and, on a
    page already cropped, kept more than the preview showed."""
    pdf = TURNED_PDFS[name]
    data = {k: str(v) for k, v in _crop_margins(name).items()} | {"margins_from": CROP["margins_from"]}
    res = client.post("/api" + CROP["endpoint"], files={"file": ("turned.pdf", pdf, "application/pdf")}, data=data)
    assert res.status_code == 200, res.text[:300]
    assert _as_pdfjs_shows(res.content) == res.content, f"{name}: /Rotate still reads differently in different viewers"
    before, after = _shown(pdf), _shown(res.content)
    assert after.shape == (DRAWN["height"], DRAWN["width"]), f"{name}: kept {after.shape[::-1]} as shown"
    kept = before[DRAWN["y"]:DRAWN["y"] + DRAWN["height"], DRAWN["x"]:DRAWN["x"] + DRAWN["width"]]
    assert np.abs(kept.astype(int) - after.astype(int)).mean() < 2, f"{name}: the page shows another part of the page"
    assert SECRET_LINE in _page_text(res.content)


def test_crop_margins_are_measured_from_the_mediabox_unless_the_caller_asks():
    """The API's default is unchanged: margins from the MediaBox as stored."""
    from backend.app.services.crop_service import crop_pdf
    import tempfile

    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "turned.pdf"
        source.write_bytes(TURNED_PDFS["cropped-rotate-90"])
        out = crop_pdf(str(source), top=10, bottom=20, left=30, right=40)
        with pikepdf.open(out) as pdf:
            assert [float(v) for v in pdf.pages[0].CropBox] == [30, 20, 612 - 40, 792 - 10]
        # Written exactly as before: no rounding of what the caller sent.
        out = crop_pdf(str(source), top=30.1234567)
        with pikepdf.open(out) as pdf:
            assert str(pdf.pages[0].CropBox[3]) == "761.8765433"


def test_crop_takes_only_the_two_ways_of_measuring_margins(client):
    res = client.post("/api/crop", files={"file": ("c.pdf", TWO_PAGES, "application/pdf")},
                      data={"top": "10", "margins_from": "cropbox"})
    assert res.status_code == 422, res.text[:300]
    assert "margins_from" in res.json()["detail"]
    schema = client.get("/api/v1/openapi.json").json()
    body = schema["paths"]["/api/v1/crop"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]
    if "$ref" in body:
        body = schema["components"]["schemas"][body["$ref"].split("/")[-1]]
    assert body["properties"]["margins_from"]["enum"] == ["mediabox", "shown"]


# ─── Text markup follows the text under it ──────────────────────────────────
#
# A highlight, underline or strikethrough runs along the text under its box,
# the way that text reads. Text can be sideways on the page as shown (a page
# turned by a viewer, or by our own Rotate tool, keeps its text upright on the
# stored page). Laid across the page as shown, a highlight over such text
# spilled about 29 points past each side of the box, over the next lines, and
# an underline crossed the text instead of running under it.

SIDEWAYS_LINE = "SIDEWAYS 4111-0002"


def _sideways_pdf() -> tuple[bytes, fitz.Rect]:
    """A page turned 90 degrees whose line is upright on the stored page, so
    it reads top to bottom as shown; and the box around the line, stored."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 120), SIDEWAYS_LINE, fontsize=14)
    page.insert_text((72, 150), "the next line", fontsize=14)
    page.set_rotation(90)
    words = [fitz.Rect(w[:4]) for w in page.get_text("words") if w[4] in SIDEWAYS_LINE.split()]
    box = (words[0] | words[1]) + (-2, -2, 2, 2)
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue(), box


@pytest.mark.parametrize("kind", ["highlight", "underline", "strikethrough"])
def test_markup_runs_along_sideways_text(client, kind):
    pdf, box = _sideways_pdf()
    annotation = {"type": kind, "page": 1, "x": box.x0, "y": box.y0, "width": box.width, "height": box.height, "color": "#e54a3c"}
    res = client.post("/api/annotate-pdf", files={"file": ("sideways.pdf", pdf, "application/pdf")},
                      data={"annotations": json.dumps([annotation])})
    assert res.status_code == 200, res.text[:300]
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        shown_box = box * doc[0].rotation_matrix  # tall: the line reads top to bottom as shown
    before, after = _shown(pdf), _shown(res.content)
    landed = _bounds(np.abs(before.astype(int) - after.astype(int)) > 48)
    reach = 7
    assert landed is not None
    assert (landed[0] >= shown_box.x0 - reach and landed[1] >= shown_box.y0 - reach
            and landed[2] <= shown_box.x1 + reach and landed[3] <= shown_box.y1 + reach), (
        f"{kind}: the box shows at {tuple(round(v) for v in shown_box)}, the mark at {landed}"
    )
    if kind != "highlight":  # a line along the text, not across it
        assert landed[3] - landed[1] > 0.8 * shown_box.height and landed[2] - landed[0] < 6, landed


def test_markup_over_no_text_runs_across_the_page_as_shown(client):
    """Where there is no text to follow, an underline runs across the page as
    it is shown, under the box."""
    blank = {"x": 300, "y": 600, "width": 34, "height": 150}  # stored; 150 wide and 34 tall as shown
    pdf = TURNED_PDFS["rotate-90"]
    res = client.post("/api/annotate-pdf", files={"file": ("turned.pdf", pdf, "application/pdf")},
                      data={"annotations": json.dumps([{"type": "underline", "page": 1, **blank, "color": "#e54a3c"}])})
    assert res.status_code == 200, res.text[:300]
    landed = _bounds(np.abs(_shown(pdf).astype(int) - _shown(res.content).astype(int)) > 48)
    stored = fitz.Rect(blank["x"], blank["y"], blank["x"] + blank["width"], blank["y"] + blank["height"])
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        shown_box = stored * doc[0].rotation_matrix
    assert shown_box.width > shown_box.height
    assert landed[2] - landed[0] > 0.8 * shown_box.width and landed[3] - landed[1] < 6, landed
    assert landed[1] > shown_box.y0 + shown_box.height / 2, f"the underline is not under the box: {landed}"


# ─── Annotate refuses an empty box ──────────────────────────────────────────

@pytest.mark.parametrize("box, answer", [
    ({"width": 0, "height": 14}, "has an empty box"),
    ({"width": 100, "height": 0}, "has an empty box"),
    ({"width": "wide", "height": 14}, "not in numbers"),
])
def test_an_empty_markup_box_is_refused(client, box, answer):
    annotation = {"type": "highlight", "page": 1, "x": 60, "y": 80, **box}
    res = client.post("/api/annotate-pdf", files={"file": ("contract.pdf", TWO_PAGES, "application/pdf")},
                      data={"annotations": json.dumps([annotation])})
    assert res.status_code == 400, res.text[:300]
    detail = res.json()["detail"]
    assert detail.startswith("Annotation 1 ") and answer in detail, detail


@pytest.mark.parametrize("kind", ["highlight", "underline"])
def test_a_negative_width_or_height_counts_back_from_x_or_y(client, kind):
    """(x 380, y 114, width -320, height -34) is the box (60, 80, 320, 34)."""
    results = []
    for box in ({"x": 60, "y": 80, "width": 320, "height": 34}, {"x": 380, "y": 114, "width": -320, "height": -34}):
        res = client.post("/api/annotate-pdf", files={"file": ("contract.pdf", TWO_PAGES, "application/pdf")},
                          data={"annotations": json.dumps([{"type": kind, "page": 1, **box, "color": "#e54a3c"}])})
        assert res.status_code == 200, res.text[:300]
        results.append(_shown(res.content))
    assert np.array_equal(results[0], results[1])
