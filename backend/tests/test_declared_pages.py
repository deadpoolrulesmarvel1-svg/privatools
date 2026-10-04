"""The page count a PDF declares, read from its bytes (utils.declared_pages).

A PDF cut short opens repaired, and the libraries then count the pages that
survived, not the pages the file had: qpdf read 4 pages of a 6-page file cut
at 60 %, and the tools answered with those 4. The declared count is what a
tool compares that with, so it has to come from the file, not the repair, and
it must never be more than the file has: a valid file whose cross-reference
table is off by a few bytes opens repaired too, and must go on as before.
"""

from __future__ import annotations

import io
import re
import time
import zlib

import fitz  # PyMuPDF
import pikepdf
import pytest

from backend.app.utils.declared_pages import declared_page_count, readable_page_count, readable_pages


def _pages(n: int) -> bytes:
    """n pages, each with its number on it, as MuPDF writes them: catalog and
    page tree first, then each page and its content."""
    doc = fitz.open()
    for i in range(n):
        doc.new_page().insert_text((72, 100), f"Page {i + 1}. A secret contract.", fontsize=12)
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _object_streams(data: bytes) -> bytes:
    """The same file as qpdf writes it with object streams: every dictionary,
    the page tree among them, compressed into an object stream."""
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pdf.save(out, object_stream_mode=pikepdf.ObjectStreamMode.generate, deterministic_id=True)
    return out.getvalue()


def _cut(data: bytes, percent: int) -> bytes:
    return data[: len(data) * percent // 100]


def _hand_built(objects: dict[int, bytes], root: int | None = 1, *, ending: bool = True) -> bytes:
    """A PDF of the given objects in order, with a cross-reference table and
    a trailer naming `root` as its catalog."""
    out = b"%PDF-1.7\n"
    offsets = {}
    for number, body in objects.items():
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    if not ending:
        return out
    size = max(offsets) + 1
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += b"%010d 00000 n \n" % offsets[number] if number in offsets else b"0000000000 65535 f \n"
    root_entry = b" /Root %d 0 R" % root if root else b""
    out += b"trailer\n<< /Size %d%s >>\nstartxref\n%d\n%%%%EOF\n" % (size, root_entry, xref)
    return out


def _page(parent: int) -> bytes:
    return b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] >>" % parent


SIX = _pages(6)


# ── the count, as written ───────────────────────────────────────────────────

def test_a_page_tree_declares_its_pages():
    assert declared_page_count(SIX) == 6
    assert declared_page_count(_pages(1)) == 1


def test_a_pdf_cut_short_still_declares_the_pages_it_had():
    cut = _cut(SIX, 60)
    with pikepdf.open(io.BytesIO(cut)) as pdf:
        assert len(pdf.pages) < 6  # what qpdf's repair leaves
    assert declared_page_count(cut) == 6


def test_a_page_tree_in_an_object_stream_is_read():
    packed = _object_streams(SIX)
    assert not re.search(rb"/Type\s*/Pages", packed)  # not in the raw bytes
    assert declared_page_count(packed) == 6
    # Cut in the page content after the object stream: still declared.
    assert declared_page_count(_cut(packed, 60)) == 6


def test_an_object_stream_cut_through_gives_the_objects_before_the_cut():
    packed = _object_streams(SIX)
    stream = packed.index(b"stream", re.search(rb"/Type\s*/ObjStm", packed).end()) + len(b"stream\n")
    length = int(re.search(rb"/Length (\d+)", packed[:stream][-200:]).group(1))
    # The catalog and the page tree are its first objects; cut after them.
    for end in (stream + length * 3 // 4, stream + length - 1):
        assert declared_page_count(packed[:end]) == 6


def test_an_object_stream_in_another_filter_is_not_read():
    packed = _object_streams(SIX)
    other = re.sub(rb"/Filter /FlateDecode", b"/Filter /LZWDecode  ", packed, count=1)
    assert declared_page_count(other) is None


def test_several_page_tree_nodes_count_the_pages_under_the_root():
    # Twelve pages under three nodes of four, as writers of long documents
    # build them.
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 12 >>"}
    page = 6
    for node in (3, 4, 5):
        kids = b" ".join(b"%d 0 R" % (page + i) for i in range(4))
        objects[node] = b"<< /Type /Pages /Parent 2 0 R /Kids [%s] /Count 4 >>" % kids
        for i in range(4):
            objects[page + i] = _page(node)
        page += 4
    whole = _hand_built(objects)
    assert declared_page_count(whole) == 12
    # The last node and its pages lost: the root still says 12.
    cut = whole[: whole.index(b"\n5 0 obj")]
    assert declared_page_count(cut) == 12
    # The root lost too: the largest count of a node that survived.
    orphans = {n: body for n, body in objects.items() if n not in (1, 2)}
    assert declared_page_count(_hand_built(orphans, root=None)) == 4


def test_a_wrong_count_over_pages_that_are_all_there_is_not_the_count():
    # A writer's /Count of 9 over three pages that are all in the file: the
    # pages are what a valid file has, and what is compared.
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 9 >>",
               3: _page(2), 4: _page(2), 5: _page(2)}
    assert declared_page_count(_hand_built(objects)) == 3


@pytest.mark.parametrize("count", [b"-3", b"2.5", b"(six)", b"/Six", b"99999999999", b"7 0 R", b"[6]"])
def test_a_count_that_is_not_one_is_ignored(count):
    complete = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
                2: b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count %s >>" % count,
                3: _page(2), 4: _page(2)}
    # Every page there: counted.
    assert declared_page_count(_hand_built(complete)) == 2
    # One page lost: the pages found and the one missing, at least.
    lost = {n: b for n, b in complete.items() if n != 4}
    assert declared_page_count(_hand_built(lost)) == 2


def test_a_kid_that_names_no_object_is_not_one_more_page():
    # /Kids lists a reference to an object the file never had, beside the
    # four pages /Count names: MuPDF and qpdf both read four pages, and four
    # is what the file declares.
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R 999 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>",
               3: _page(2), 4: _page(2), 5: _page(2), 6: _page(2)}
    assert declared_page_count(_hand_built(objects)) == 4


def test_the_last_definition_of_the_page_tree_is_the_one_counted():
    # An incremental update that deleted a page: the page tree is written
    # again under the same number, with one page fewer. A repair keeps the
    # later one, and so does the count.
    first = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>",
                         2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
                         3: _page(2), 4: _page(2), 5: _page(2)})
    update = b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n"
    assert declared_page_count(first + update) == 2


def test_the_catalog_names_the_page_tree_counted():
    # The update wrote a new page tree under a new number; the old one, with
    # more pages, is still in the file but nothing names it.
    first = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>",
                         2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
                         3: _page(2), 4: _page(2), 5: _page(2)})
    update = (b"6 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n"
              b"1 0 obj\n<< /Type /Catalog /Pages 6 0 R >>\nendobj\n"
              b"trailer\n<< /Size 7 /Root 1 0 R >>\n%%EOF\n")
    assert declared_page_count(first + update) == 2


def test_a_dictionary_inside_a_string_or_a_stream_is_not_read():
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 /Note (<< /Type /Pages /Count 40 >>) >>",
               3: _page(2),
               4: b"<< /Length 30 >>\nstream\n<< /Type /Pages /Count 50 >>\nendstream"}
    assert declared_page_count(_hand_built(objects)) == 1


def _carrying(inner: bytes) -> bytes:
    """A one-page PDF carrying `inner`, a whole PDF, as an attachment written
    without compression (as `mutool clean -d` or `qpdf --qdf` leave one)."""
    return _hand_built({
        1: b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: _page(2),
        4: b"<< /Type /EmbeddedFile /Length %d >>\nstream\n%s\nendstream" % (len(inner), inner),
        5: b"<< /Names [(inner.pdf) 6 0 R] >>",
        6: b"<< /Type /Filespec /F (inner.pdf) /EF << /F 4 0 R >> >>",
    })


def test_a_pdf_stored_in_a_stream_is_not_read_as_the_files_own():
    # The attachment's objects reuse this file's numbers, and come later in
    # the bytes: read as objects, its page tree of six was taken for this
    # file's, and a valid file MuPDF repaired was refused as having lost 5 of
    # 6 pages. MuPDF and qpdf skip a stream's data; so does the count.
    outer = _carrying(SIX)
    assert declared_page_count(outer) == 1
    assert declared_page_count(outer + b"\n" + bytes(range(256)) * 16) == 1  # MuPDF repairs this one
    with fitz.open(stream=outer + b"\n" + bytes(range(256)) * 16, filetype="pdf") as doc:
        assert doc.is_repaired and len(doc) == readable_page_count(doc) == 1


def test_a_pdf_stored_in_a_stream_whose_length_is_an_object_is_not_read_either():
    # qpdf's QDF mode, Ghostscript, LibreOffice and cairo write a stream's
    # /Length as an object after it. The stored PDF's own first "endstream"
    # then came before its catalog and page tree, written last as many
    # writers do, and those were read as this file's: 6 pages for 1.
    inner = {}
    for page in range(3, 15, 2):
        inner[page] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R >>" % (page + 1)
        inner[page + 1] = b"<< /Length 9 >>\nstream\nBT 0 Tj ET\nendstream"
    inner[2] = b"<< /Type /Pages /Kids [%s] /Count 6 >>" % b" ".join(b"%d 0 R" % n for n in range(3, 15, 2))
    inner[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    stored = _hand_built(inner)
    outer = _hand_built({
        1: b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: _page(2),
        4: b"<< /Type /EmbeddedFile /Length 7 0 R >>\nstream\n%s\nendstream" % stored,
        7: b"%d" % len(stored),
        5: b"<< /Names [(inner.pdf) 6 0 R] >>",
        6: b"<< /Type /Filespec /F (inner.pdf) /EF << /F 4 0 R >> >>",
    })
    assert declared_page_count(stored) == 6
    assert declared_page_count(outer) == 1
    assert declared_page_count(outer + b"\n" + bytes(range(256)) * 16) == 1


def test_a_catalog_the_count_cannot_read_leaves_the_count_unknown():
    # A catalog without /Type /Catalog, which MuPDF does without, and a page
    # tree a merge left behind, larger than the file's own: no count is
    # guessed from the nodes that are left while a trailer names the root.
    objects = {1: b"<< /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", 3: _page(2), 4: _page(2),
               7: b"<< /Type /Pages /Kids [8 0 R 9 0 R 10 0 R] /Count 3 >>", 8: _page(7), 9: _page(7), 10: _page(7)}
    assert declared_page_count(_hand_built(objects)) is None


def test_no_page_tree_in_the_bytes_is_unknown():
    # Catalog and page tree written last, as many writers do, and lost with
    # the end of the file.
    late = _hand_built({3: _page(2), 4: _page(2), 2: b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
                        1: b"<< /Type /Catalog /Pages 2 0 R >>"})
    assert declared_page_count(late[: late.index(b"\n2 0 obj")]) is None
    assert declared_page_count(b"") is None
    assert declared_page_count(b"not a PDF at all") is None


def test_a_linearized_pdf_whose_page_tree_was_lost_declares_its_first_objects_count():
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(SIX)) as pdf:
        pdf.save(out, linearize=True, deterministic_id=True)
    linear = out.getvalue()
    assert linear.index(b"/Linearized") < 1024
    tree = re.search(rb"/Type\s*/Pages", linear).start()
    assert tree > len(linear) // 2  # kept near the end
    assert declared_page_count(linear) == 6
    # Cut inside the page tree: only the linearization dictionary says 6.
    assert declared_page_count(linear[: tree + 5]) == 6
    # Not linearized, and no page tree: unknown.
    assert declared_page_count(linear[: tree + 5].replace(b"/Linearized", b"/Linearizex")) is None


def test_a_path_and_the_bytes_give_the_same_count(tmp_path):
    path = tmp_path / "doc.pdf"
    path.write_bytes(_cut(SIX, 60))
    assert declared_page_count(path) == declared_page_count(str(path)) == 6
    (tmp_path / "empty.pdf").write_bytes(b"")
    assert declared_page_count(tmp_path / "empty.pdf") is None


def test_a_locked_pdf_declares_its_pages():
    # Encryption covers strings and streams, not the dictionaries.
    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(SIX)) as pdf:
        pdf.save(out, encryption=pikepdf.Encryption(user="u-pass", owner="o-pass", R=4))
    assert declared_page_count(out.getvalue()) == 6


# ── bounded ─────────────────────────────────────────────────────────────────

def test_too_many_objects_is_no_answer_rather_than_a_long_scan():
    many = b"%PDF-1.7\n" + b"".join(b"%d 0 obj <</Type /Page>> endobj\n" % i for i in range(1, 300_000))
    started = time.monotonic()
    assert declared_page_count(many) is None
    assert time.monotonic() - started < 30


def test_an_object_stream_that_inflates_too_far_is_no_answer():
    bomb = zlib.compress(b"0 0 " * (8 * 1024 * 1024), 9)
    streams = b"".join(
        b"%d 0 obj <</Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length %d>>\nstream\n%s\nendstream\nendobj\n"
        % (number, len(bomb), bomb) for number in range(1, 10))
    assert declared_page_count(b"%PDF-1.7\n" + streams) is None


def test_a_page_tree_deeper_than_any_real_one_is_not_followed():
    deep = b"%PDF-1.7\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n" + b"".join(
        b"%d 0 obj <</Type /Pages /Count 1 /Kids [%d 0 R]>> endobj\n" % (n, n + 1) for n in range(2, 200))
    assert declared_page_count(deep) == 1  # the root's own count; the walk stops


# ── what MuPDF can read of what it lists ────────────────────────────────────

def _opens(data: bytes) -> fitz.Document | None:
    try:
        return fitz.open(stream=data, filetype="pdf")
    except fitz.FileDataError:  # a cut inside a stream: MuPDF opens none of it
        return None


def test_mupdf_lists_a_page_whose_object_was_lost_but_cannot_read_it():
    # The cuts MuPDF opens: it trusts the page tree's count, so it lists all
    # six pages, and shows the ones whose object was lost blank.
    opened = [doc for doc in (_opens(_cut(SIX, pct)) for pct in range(40, 80)) if doc is not None]
    assert opened
    doc = opened[0]
    assert doc.is_repaired and len(doc) == 6
    readable = readable_pages(doc)
    assert readable_page_count(doc) == len(readable) < 6
    assert readable == list(range(len(readable)))  # the pages before the cut
    assert "Page 1." in doc[0].get_text()
    with fitz.open(stream=SIX, filetype="pdf") as intact:
        assert readable_page_count(intact) == 6
