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

from backend.app.utils import declared_pages
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


def test_a_type_in_a_streams_data_belongs_to_no_objects_dictionary():
    # A stream's data is skipped before its /Type's object is looked for, but
    # not that of a stream whose keyword is not recognised as one, here after
    # a comment. Its /Type is then in no object's dictionary, not its own
    # object's: that object's dictionary is the stream's (the #349 review's
    # surviving mutant "stream-check-off").
    data = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>", 2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                        3: _page(2), 4: b"<< /Length 30 >> % a note\nstream\n<< /Type /Pages /Count 50 >>\nendstream"})
    scan = declared_pages._Scan(data)
    assert not scan._in_stream_data(data.index(b"/Type /Pages /Count 50"))
    assert scan._header_before(data.index(b"/Type /Pages /Count 50")) is None
    assert declared_page_count(data) == 1


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
        inner[page + 1] = b"<< /Length 10 >>\nstream\nBT 0 Tj ET\nendstream"
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


def _catalog_last(pages: int = 6) -> bytes:
    """`pages` pages with their content first, then the page tree, then the
    catalog, as Chrome, LibreOffice and Ghostscript write them."""
    inner = {}
    for page in range(3, 3 + 2 * pages, 2):
        inner[page] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R >>" % (page + 1)
        inner[page + 1] = b"<< /Length 10 >>\nstream\nBT 0 Tj ET\nendstream"
    inner[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % n for n in range(3, 3 + 2 * pages, 2)), pages)
    inner[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    return _hand_built(inner)


def _carrying_objects(attachment: bytes) -> dict[int, bytes]:
    """A one-page PDF whose object 4 is `attachment`, a stream as given."""
    return {
        1: b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: _page(2),
        4: attachment,
        5: b"<< /Names [(inner.pdf) 6 0 R] >>",
        6: b"<< /Type /Filespec /F (inner.pdf) /EF << /F 4 0 R >> >>",
    }


def _carrying_stream(attachment: bytes) -> bytes:
    return _hand_built(_carrying_objects(attachment))


STORED = _catalog_last()


@pytest.mark.parametrize("attachment", [
    b"<< /Type /EmbeddedFile /Length %d >>\nstream\n%s\nendstream" % (len(STORED) - 10, STORED),
    b"<< /Type /EmbeddedFile /Length %d >>\nstream\n%s\nendstream" % (len(STORED) + 10, STORED),
    b"<< /Type /EmbeddedFile >>\nstream\n%s\nendstream" % STORED,
], ids=["length-short", "length-long", "no-length"])
def test_a_stored_pdf_whose_stream_does_not_end_at_its_length_ends_where_that_pdf_ends(attachment):
    # A wrong /Length is common in valid files, and readers cope; here the
    # stream holds a PDF whose catalog comes last. Its first "endstream" is
    # not this stream's end, and what follows it was read as this file's: a
    # one-page file declared 6 pages, and qpdf's routes refused it with junk
    # after its end. Left unknown, the count let MuPDF's repair, which ends
    # the stream at that first "endstream" too, answer with the stored PDF's
    # pages unchecked. A whole PDF ends where its own end says: at the
    # "endstream" after its last "%%EOF".
    assert declared_page_count(STORED) == 6
    outer = _carrying_stream(attachment)
    with fitz.open(stream=outer, filetype="pdf") as doc:
        assert not doc.is_repaired and len(doc) == 1
    assert declared_page_count(outer) == 1
    junk = outer + b"\n" + bytes(range(256)) * 16
    assert declared_page_count(junk) == 1
    with fitz.open(stream=junk, filetype="pdf") as doc:
        assert doc.is_repaired and readable_page_count(doc) == 6  # what MuPDF's repair reads


@pytest.mark.parametrize("stored", [
    STORED[:-6],  # its "%%EOF" lost: cut short
    STORED.replace(b"%PDF-", b"%XYZ-", 1),  # not a PDF's start
    STORED + b"% words after its end\n",  # its end not the stream's
], ids=["no-eof", "no-header", "words-after-eof"])
def test_a_stream_holding_objects_but_no_whole_pdf_still_leaves_the_count_unknown(stored):
    # Where such a stream ends cannot be told from its data: no "endstream"
    # in it is known to be the stream's own.
    outer = _carrying_stream(b"<< /Type /EmbeddedFile >>\nstream\n%s\nendstream" % stored)
    assert declared_page_count(outer) is None


def test_a_pdf_that_the_stored_pdf_carries_in_turn_is_passed_over():
    # Neither stream has a /Length, and the inner PDF's end comes first: it
    # ends the inner stream, not the one around it.
    middle = _carrying_stream(b"<< /Type /EmbeddedFile >>\nstream\n%s\nendstream" % STORED)
    assert declared_page_count(middle) == 1
    outer = _hand_built({
        1: b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>",
        3: _page(2),
        4: b"<< /Type /EmbeddedFile >>\nstream\n%s\nendstream" % middle,
        5: b"<< /Names [(inner.pdf) 6 0 R] >>",
        6: b"<< /Type /Filespec /F (inner.pdf) /EF << /F 4 0 R >> >>",
        7: _page(2),
    })
    assert declared_page_count(outer) == 2


def _with_an_object_stream(objects: dict[int, bytes], number: int, body: bytes) -> bytes:
    """A PDF 1.5 of `objects` in order, then an object stream holding object
    `number` (`body`), then a cross-reference stream naming 1 as the catalog."""
    out = b"%PDF-1.7\n"
    offsets = {}
    for n, text in objects.items():
        offsets[n] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (n, text)
    member = b"%d 0 " % number
    packed = zlib.compress(member + body)
    stm = max(*objects, number) + 1
    offsets[stm] = len(out)
    out += b"%d 0 obj\n<< /Type /ObjStm /N 1 /First %d /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream\nendobj\n" % (
        stm, len(member), len(packed), packed)
    xref = stm + 1
    offsets[xref] = len(out)
    rows = b""
    for n in range(xref + 1):
        if n in offsets:
            rows += b"\x01" + offsets[n].to_bytes(4, "big") + b"\x00\x00"
        elif n == number:
            rows += b"\x02" + stm.to_bytes(4, "big") + b"\x00\x00"
        else:
            rows += b"\x00\x00\x00\x00\x00\xff\xff"
    table = zlib.compress(rows)
    out += b"%d 0 obj\n<< /Type /XRef /Size %d /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length %d >>\nstream\n" % (
        xref, xref + 1, len(table))
    return out + table + b"\nendstream\nendobj\nstartxref\n%d\n%%%%EOF\n" % offsets[xref]


def test_a_stored_pdf_whose_length_is_in_an_object_stream_ends_where_that_pdf_ends():
    # A valid PDF 1.5: the attachment's /Length is object 7, which sits in an
    # object stream, where the raw bytes do not show it. The stored PDF's own
    # end says where the stream ends.
    attachment = b"<< /Type /EmbeddedFile /Length 7 0 R >>\nstream\n%s\nendstream" % STORED
    packed = _with_an_object_stream(_carrying_objects(attachment), 7, b"%d" % len(STORED))
    with fitz.open(stream=packed, filetype="pdf") as doc:
        assert not doc.is_repaired and len(doc) == 1
    with pikepdf.open(io.BytesIO(packed)) as pdf:
        assert len(pdf.pages) == 1
        assert len(pdf.attachments["inner.pdf"].get_file().read_bytes()) == len(STORED)
    assert declared_page_count(packed) == 1
    assert declared_page_count(packed + b"\n" + bytes(range(256)) * 16) == 1


def test_spaces_after_the_stream_keyword_are_not_the_streams_data():
    # "stream \r\n": qpdf warns of the space and reads the stream; so does
    # MuPDF. Its data starts after the end of line, and is skipped.
    outer = _carrying_stream(b"<< /Type /EmbeddedFile /Length %d >>\nstream \r\n%s\nendstream" % (len(STORED), STORED))
    assert declared_page_count(outer) == 1
    assert declared_page_count(outer + b"\n" + bytes(range(256)) * 16) == 1


def test_an_endstream_in_a_streams_words_does_not_end_it():
    # An attached note on PDF's syntax: "endstream" comes in its words before
    # any "obj", then a page tree. The stream ends at its /Length.
    note = (b"A stream ends with the keyword\nendstream\nand a page tree looks like this:\n"
            b"2 0 obj\n<< /Type /Pages /Kids [10 0 R 11 0 R 12 0 R] /Count 3 >>\nendobj\n")
    outer = _carrying_stream(b"<< /Type /EmbeddedFile /Length %d >>\nstream\n%s\nendstream" % (len(note), note))
    assert declared_page_count(outer) == 1
    assert declared_page_count(outer + b"\n" + bytes(range(256)) * 16) == 1


def test_an_object_a_string_quotes_is_not_the_files_own():
    # A note on a page quotes PDF's syntax, under the page tree's number and
    # after it: read as an object, the one-page file declared 3 pages, and a
    # copy with bytes after its end was refused by every route.
    data = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>", 2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                        3: _page(2),
                        4: b"<< /Type /Annot /Subtype /Text /Rect [72 600 92 620] /Contents (A page tree:\n"
                           b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 10 0 R 11 0 R] /Count 3 >>\nendobj) >>"})
    assert declared_page_count(data) == 1
    assert declared_page_count(data + b"\n" + bytes(range(256)) * 16) == 1


def test_a_page_tree_after_a_stream_left_without_endobj_is_still_the_files():
    # A writer that leaves out "endobj" after "endstream": the next object's
    # header follows the stream's own, and is not quoted inside it.
    data = (b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
            b"5 0 obj\n<< /Length 10 >>\nstream\nBT 0 Tj ET\nendstream\n"
            b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n"
            b"3 0 obj\n" + _page(2) + b"\nendobj\n4 0 obj\n" + _page(2) + b"\nendobj\n")
    assert declared_page_count(data) == 2


def test_a_catalog_the_count_cannot_read_leaves_the_count_unknown():
    # A catalog without /Type /Catalog, which MuPDF does without, and a page
    # tree a merge left behind, larger than the file's own: no count is
    # guessed from the nodes that are left while a trailer names the root.
    objects = {1: b"<< /Pages 2 0 R >>",
               2: b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", 3: _page(2), 4: _page(2),
               7: b"<< /Type /Pages /Kids [8 0 R 9 0 R 10 0 R] /Count 3 >>", 8: _page(7), 9: _page(7), 10: _page(7)}
    assert declared_page_count(_hand_built(objects)) is None


def _updated(base: bytes, objects: dict[int, bytes], root: int = 1) -> bytes:
    """`base` with an incremental update that writes `objects` (again), with a
    cross-reference section of its own and a trailer naming the one before."""
    prev = int(base.rsplit(b"startxref", 1)[1].split()[0])
    size = int(base.split(b"/Size", 1)[1].split()[0])
    out, offsets = base, {}
    for number, body in objects.items():
        offsets[number] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n" + b"".join(b"%d 1\n%010d 00000 n \n" % (n, offsets[n]) for n in sorted(offsets))
    size = max(size, max(offsets) + 1)
    return out + b"trailer\n<< /Size %d /Root %d 0 R /Prev %d >>\nstartxref\n%d\n%%%%EOF\n" % (size, root, prev, xref)


FIVE = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>",
                    2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>",
                    **{n: _page(2) for n in range(3, 8)}})


@pytest.mark.parametrize("update", [
    {2: b"<< /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"},
    {9: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>", 1: b"<< /Pages 9 0 R >>"},
], ids=["root-node", "catalog"])
def test_an_update_that_rewrites_the_tree_without_its_type_leaves_the_count_unknown(update):
    # The update rewrites the root node, or the catalog, without /Type. Both
    # keys are required, but MuPDF and qpdf read the update without them
    # (qpdf: "setting missing or invalid /Type entry"): three pages. Only
    # typed definitions are read here, so the base's five-page tree outlived
    # its rewrite, and qpdf's routes refused even the intact file, "only 3 of
    # its 5 pages" (the #349 re-review's RS1). The later header says that the
    # definition read is not the file's own: the count is unknown.
    data = _updated(FIVE, update)
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert not doc.is_repaired and len(doc) == 3
    with pikepdf.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) == 3
    assert declared_page_count(data) is None
    assert declared_page_count(data + b"\n" + bytes(range(256)) * 16) is None


def _updated_in_an_object_stream(base: bytes, number: int, body: bytes) -> bytes:
    """`base` with an incremental update that writes object `number` again,
    inside an object stream, under a cross-reference stream naming the
    section before it."""
    prev = int(base.rsplit(b"startxref", 1)[1].split()[0])
    size = int(base.split(b"/Size", 1)[1].split()[0])
    stm, xref = size, size + 1
    member = b"%d 0 " % number
    packed = zlib.compress(member + body)
    at_stm = len(base)
    out = base + b"%d 0 obj\n<< /Type /ObjStm /N 1 /First %d /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream\nendobj\n" % (
        stm, len(member), len(packed), packed)
    at_xref = len(out)
    rows = (b"\x02" + stm.to_bytes(4, "big") + b"\x00\x00" + b"\x01" + at_stm.to_bytes(4, "big") + b"\x00\x00"
            + b"\x01" + at_xref.to_bytes(4, "big") + b"\x00\x00")
    table = zlib.compress(rows)
    out += (b"%d 0 obj\n<< /Type /XRef /Size %d /Index [%d 1 %d 2] /W [1 4 2] /Root 1 0 R /Prev %d "
            b"/Filter /FlateDecode /Length %d >>\nstream\n" % (xref, xref + 1, number, stm, prev, len(table)))
    return out + table + b"\nendstream\nendobj\nstartxref\n%d\n%%%%EOF\n" % at_xref


def test_an_update_in_an_object_stream_that_rewrites_the_root_without_its_type_leaves_the_count_unknown():
    data = _updated_in_an_object_stream(FIVE, 2, b"<< /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>")
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert not doc.is_repaired and len(doc) == 3
    with pikepdf.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) == 3
    assert declared_page_count(data) is None


def test_a_header_an_update_quotes_in_a_string_is_no_definition():
    # The update adds a note that quotes the root node's header; the tree is
    # the base's, five pages.
    note = (b"<< /Type /Annot /Subtype /Text /Rect [72 600 92 620] /Contents (The root:\n"
            b"2 0 obj\n<< /Kids [3 0 R] /Count 1 >>\nendobj) >>")
    data = _updated(FIVE, {8: note})
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert len(doc) == 5
    assert declared_page_count(data) == 5


def test_an_update_that_rewrites_the_tree_with_its_type_is_counted():
    # The same update, typed: the rewrite is the definition read.
    data = _updated(FIVE, {2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"})
    assert declared_page_count(data) == 3
    data = _updated(FIVE, {9: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
                           1: b"<< /Type /Catalog /Pages 9 0 R >>"})
    assert declared_page_count(data) == 3


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


# ── the time it may take ────────────────────────────────────────────────────

def test_a_count_out_of_time_is_unknown(monkeypatch):
    monkeypatch.setattr(declared_pages, "_MAX_SECONDS", -1.0)
    assert declared_page_count(SIX) is None
    assert declared_page_count(_object_streams(SIX)) is None
    with fitz.open(stream=SIX, filetype="pdf") as doc:
        assert readable_page_count(doc) is None
        assert readable_pages(doc) == list(range(6))  # Repair's own list has no deadline


class _Waiting:
    """The clocks a count reads, as a request thread sees them while other
    requests hold the interpreter: the wall clock runs on, ten seconds a
    reading, and the thread's own CPU time only while it computes."""

    def __init__(self) -> None:
        self.wall = time.monotonic()

    def monotonic(self) -> float:
        self.wall += 10
        return self.wall

    thread_time = staticmethod(time.thread_time)
    perf_counter = staticmethod(time.perf_counter)


def test_time_spent_waiting_for_other_requests_is_not_the_counts(monkeypatch):
    # A count runs in a request thread beside up to eight others, and waits
    # while they hold the interpreter. On the wall clock that waiting spent
    # its budget: beside three such threads, a cut file of 2,000 pages and
    # 0.6 MB went unchecked (the #349 re-review's RS2). The budget is the
    # thread's own CPU time.
    monkeypatch.setattr(declared_pages, "time", _Waiting())
    assert declared_page_count(SIX) == 6
    with fitz.open(stream=SIX, filetype="pdf") as doc:
        assert readable_page_count(doc) == 6


def test_windows_that_add_up_end_at_the_time_budget(monkeypatch):
    # Each page tree node's /Kids opens a string that runs over every later
    # node, then over a long run of escapes, a step each: every node's
    # dictionary is read to the end of the file. The caps are per kind and
    # each read is within its window, so this took 30 seconds; the scan now
    # stops when its time is spent, and the count is unknown.
    monkeypatch.setattr(declared_pages, "_MAX_SECONDS", 0.25)
    nodes = b"".join(b"%d 0 obj\n<< /Type /Pages /Kids [ (" % n for n in range(1, 301))
    data = b"%PDF-1.7\n" + nodes + b"\\\\" * 200_000 + b")" * 300 + b"]" * 300
    started = time.monotonic()
    assert declared_page_count(data) is None
    assert time.monotonic() - started < 5


def test_a_scan_cut_off_by_its_budget_counts_nothing_it_read(monkeypatch):
    # An update took a five-page file to three. A scan that ran out of time
    # after the first page tree, and counted what it had read, would declare
    # five pages that the file no longer has: the count is None instead.
    base = _hand_built({1: b"<< /Type /Catalog /Pages 2 0 R >>",
                        2: b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>",
                        **{n: _page(2) for n in range(3, 8)}})
    update = b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n"
    data = base + update
    assert declared_page_count(data) == 3
    plain = declared_pages._Scan._plain

    def out_of_time_at_the_update(self, match):
        if match.start() >= len(base):
            raise declared_pages._OutOfTime
        return plain(self, match)

    monkeypatch.setattr(declared_pages._Scan, "_plain", out_of_time_at_the_update)
    assert declared_page_count(data) is None


def _listing(count: int, *, lost_kid: bool) -> bytes:
    """A page tree whose /Count says `count` over one page (and one kid whose
    object is gone), among enough objects for MuPDF to list them all, without
    a cross-reference table: MuPDF repairs it and lists `count` pages."""
    kids = b"3 0 R 4 0 R" if lost_kid else b"3 0 R"
    return (b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
            + b"2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n" % (kids, count)
            + b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
            + b"".join(b"%d 0 obj null endobj\n" % n for n in range(5, count + 10))
            + b"trailer\n<< /Root 1 0 R >>\n%%EOF\n")


def test_pages_listed_beyond_the_time_budget_are_not_counted(monkeypatch):
    # MuPDF lists as many pages as the /Count says, one per object at most,
    # and looks up the absent ones one by one: two million held a request
    # for 20 seconds. Out of time, the count of readable pages is unknown.
    monkeypatch.setattr(declared_pages, "_MAX_SECONDS", 0.05)
    with fitz.open(stream=_listing(100_000, lost_kid=True), filetype="pdf") as doc:
        assert doc.is_repaired and len(doc) == 100_000
        assert readable_page_count(doc) is None


def test_readable_pages_are_counted_no_further_than_the_declared_count():
    # Every kid is there, so the file declares the one page it has, and the
    # count stops there rather than look up 100,000 listed pages.
    data = _listing(100_000, lost_kid=False)
    assert declared_page_count(data) == 1
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert len(doc) == 100_000
        started = time.monotonic()
        assert readable_page_count(doc, 1) == 1
        assert time.monotonic() - started < 0.5
    with fitz.open(stream=SIX, filetype="pdf") as doc:
        assert readable_page_count(doc, 4) == 4
        assert readable_page_count(doc, 10) == readable_page_count(doc) == 6


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


# ── a library's reading, against the page tree the file declares ───────────
#
# A valid PDF that carries a PDF attached without compression, with a common
# cross-reference defect (offsets shifted, no startxref, bytes after its end),
# opens repaired, and the libraries' repairs took the attachment's objects for
# the file's own: the tools answered with the attachment's pages, as a
# success. misread() compares a reading with the page tree the file declares.

def _shifted(data: bytes) -> bytes:
    """Seven bytes after the header: every offset in the table is off by 7."""
    first_line = data.index(b"\n") + 1
    return data[:first_line] + b"%xxxxx\n" + data[first_line:]


def _junk(data: bytes) -> bytes:
    return data + b"\n" + bytes(range(256)) * 16


def _small_page(parent: int, contents: int | None = None) -> bytes:
    """A 300 x 300 page: the stored PDF's, told from the file's own 612 x 792."""
    tail = b" /Contents %d 0 R" % contents if contents else b""
    return b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 300 300]%s >>" % (parent, tail)


# One page, under this file's very numbers: catalog 1, page tree 2, page 3.
SAME_SHAPE = _hand_built({
    1: b"<< /Type /Catalog /Pages 2 0 R >>",
    2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: _small_page(2),
})


def _reads(name: str, data: bytes, use):
    """use(reading function) with `name`'s library open on `data`."""
    if name == "mupdf":
        with fitz.open(stream=data, filetype="pdf") as doc:
            return use(lambda declared: declared_pages.mupdf_reading(doc, declared))
    if name == "qpdf":
        with pikepdf.open(io.BytesIO(data)) as pdf:
            return use(lambda declared: declared_pages.qpdf_reading(pdf, declared))
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    return use(lambda declared: declared_pages.pypdf_reading(reader, declared))


def test_qpdf_reading_an_attachment_of_the_same_shape_as_the_file_is_another_document():
    # qpdf's rebuild reads every "N G obj" in the bytes, stream data and all,
    # and the stored PDF's come later: it read the stored page as the file's,
    # one page for one, under the same page tree root. Only where it read
    # them from tells: inside the attachment's data.
    data = _shifted(_carrying(SAME_SHAPE))
    with pikepdf.open(io.BytesIO(data)) as pdf:
        assert pdf.get_warnings() and len(pdf.pages) == 1
        assert pdf.pages[0].mediabox[2] == 300  # the stored page
        reading = declared_pages.qpdf_reading(pdf, 1)
        assert reading.pages == 1 and reading.root == 2
        assert declared_pages.misread(data, lambda declared: declared_pages.qpdf_reading(pdf, declared)) == (
            declared_pages.MIXED, 1, 1)
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert doc.is_repaired and doc[0].rect.width == 612  # MuPDF skips the stream's data
        assert declared_pages.misread(data, lambda declared: declared_pages.mupdf_reading(doc, declared)) is None


def test_pypdf_reading_an_attachment_of_the_same_shape_as_the_file_is_another_document():
    import pypdf

    data = _shifted(_carrying(SAME_SHAPE))
    reader = pypdf.PdfReader(io.BytesIO(data))
    assert len(reader.pages) == 1 and reader.pages[0].mediabox.width == 300  # the stored page
    assert declared_pages.misread(data, lambda declared: declared_pages.pypdf_reading(reader, declared)) == (
        declared_pages.MIXED, 1, 1)
    intact = pypdf.PdfReader(io.BytesIO(_carrying(SAME_SHAPE)))
    assert declared_pages.misread(
        _carrying(SAME_SHAPE), lambda declared: declared_pages.pypdf_reading(intact, declared)) is None


def _stored_page_after_a_stream() -> bytes:
    """A one-page PDF carrying a PDF whose page is object 3, as this file's
    page is, written after a stream of the stored PDF's own; the attachment's
    /Length is an object after it, which MuPDF's repair cannot use."""
    stored = _hand_built({
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        5: b"<< /Length 10 >>\nstream\nBT 0 Tj ET\nendstream",
        3: _small_page(2, 5),
    })
    return _hand_built({
        1: b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: _page(2),
        4: b"<< /Type /EmbeddedFile /Length 7 0 R >>\nstream\n%s\nendstream" % stored,
        7: b"%d" % len(stored),
        5: b"<< /Names [(inner.pdf) 6 0 R] >>",
        6: b"<< /Type /Filespec /F (inner.pdf) /EF << /F 4 0 R >> >>",
    })


def test_mupdf_taking_a_stored_object_for_the_files_page_is_another_document():
    # MuPDF's repair ends a stream whose /Length it cannot use at its first
    # "endstream", the stored PDF's own, and reads what follows as the
    # file's: the stored page, under the number of this file's page. One
    # page for one, the same root, and a page that is not the file's.
    data = _junk(_stored_page_after_a_stream())
    assert declared_page_count(data) == 1
    with fitz.open(stream=data, filetype="pdf") as doc:
        assert doc.is_repaired and len(doc) == 1 and doc[0].rect.width == 300
        reading = declared_pages.mupdf_reading(doc, 1)
        assert reading.pages == 1 and reading.root == 2
        assert declared_pages.misread(data, lambda declared: declared_pages.mupdf_reading(doc, declared)) == (
            declared_pages.MIXED, 1, 1)
    with pikepdf.open(io.BytesIO(data)) as pdf:  # qpdf finds the table, and reads the file's own
        assert pdf.pages[0].mediabox[2] == 612
        assert declared_pages.misread(data, lambda declared: declared_pages.qpdf_reading(pdf, declared)) is None


def test_more_pages_than_declared_are_another_document_and_fewer_are_lost():
    root = 2  # MuPDF's own numbering: catalog 1, page tree 2
    with fitz.open(stream=SIX, filetype="pdf") as doc:
        assert doc.xref_get_key(doc.pdf_catalog(), "Pages") == ("xref", "2 0 R")
    reading = declared_pages.Reading
    assert declared_pages.misread(SIX, lambda declared: reading(6, root)) is None
    assert declared_pages.misread(SIX, lambda declared: reading(4, root)) == (declared_pages.LOST, 4, 6)
    assert declared_pages.misread(SIX, lambda declared: reading(7, root)) == (declared_pages.MIXED, 7, 6)
    assert declared_pages.misread(SIX, lambda declared: reading(6, root + 40)) == (declared_pages.MIXED, 6, 6)
    assert declared_pages.misread(SIX, lambda declared: reading(4, root + 40)) == (declared_pages.MIXED, 4, 6)
    assert declared_pages.misread(SIX, lambda declared: reading(None, None)) is None


def test_an_object_read_from_inside_a_streams_data_is_another_document():
    data = _carrying(SAME_SHAPE)
    own = data.index(b"1 0 obj")
    stored = data.index(b"1 0 obj", data.index(b"stream"))
    reading = declared_pages.Reading
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((1, own),))) is None
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((1, stored),))) == (
        declared_pages.MIXED, 1, 1)
    # MuPDF's offsets can point at the whitespace or comments before a header.
    assert data[stored - 1:stored] == b"\n"
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((1, stored - 1),))) == (
        declared_pages.MIXED, 1, 1)
    # An offset that leads to another object's header, or to none, says nothing.
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((9, stored),))) is None
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((1, stored + 3),))) is None
    assert declared_pages.misread(data, lambda declared: reading(1, 2, lambda: ((1, len(data) + 10),))) is None


def test_where_a_library_read_the_pages_is_asked_only_when_a_stream_holds_objects():
    # Placing every page takes a lookup or two a page; a library can take an
    # object from the wrong place only where a stream's data holds one.
    def never():
        raise AssertionError("asked where the pages were read")

    assert declared_pages.misread(SIX, lambda declared: declared_pages.Reading(6, 2, never)) is None
    asked = []
    data = _carrying(SAME_SHAPE)
    assert declared_pages.misread(
        data, lambda declared: declared_pages.Reading(1, 2, lambda: asked.append(True) or ())) is None
    assert asked == [True]


def test_nothing_is_refused_on_an_unknown_count_or_reading():
    asked = []
    no_tree = _hand_built({1: b"<< /Type /Catalog >>", 3: _page(2)})
    assert declared_page_count(no_tree) is None
    assert declared_pages.misread(no_tree, lambda declared: asked.append(declared)) is None
    assert asked == []  # not even asked
    assert declared_pages.misread(SIX, lambda declared: None) is None


@pytest.mark.parametrize("library", ["mupdf", "qpdf", "pypdf"])
@pytest.mark.parametrize("layout", ["classic", "object-streams"])
def test_each_library_says_where_it_read_the_objects_it_shows_the_pages_with(library, layout):
    # The check depends on these: a library that stopped saying where it read
    # an object would let through every misreading that shows as many pages
    # under the same root. Each place leads to the header of its object, or
    # of the object stream that holds it, outside every stream's data.
    data = SIX if layout == "classic" else _object_streams(SIX)

    def use(read):
        reading = read(6)
        assert reading.pages == 6 and reading.root is not None
        assert len(list(reading.places())) >= 1 + 6 * 2  # the catalog's, and each page's and its content's
        scan = declared_pages._Scan(data)
        assert scan.declared() == 6
        for number, offset in reading.places():
            at = declared_pages._skip_space(data, offset, len(data))
            assert re.match(rb"%d 0 obj" % number, data[at:at + 20]), (number, offset)
            assert not scan.in_stream_data(number, offset)
        assert declared_pages.misread(data, read) is None

    _reads(library, data, use)


def test_a_reading_places_no_more_pages_than_one_past_the_declared_count():
    many = _pages(40)
    with fitz.open(stream=many, filetype="pdf") as doc:
        assert declared_pages.mupdf_reading(doc, 3).pages == 4
    with pikepdf.open(io.BytesIO(many)) as pdf:
        reading = declared_pages.qpdf_reading(pdf, 3)
        assert reading.pages == 40  # qpdf lists them anyway
        assert len({number for number, _ in reading.places()}) < 20  # but places only four
