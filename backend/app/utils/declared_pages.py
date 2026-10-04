"""How many pages a PDF says it has, read from its bytes.

A PDF cut short, as by an interrupted download, opens repaired: MuPDF, qpdf
and pypdf rebuild what they can from the objects that survived. They then
report the pages they found, not the pages the file had, so a tool given the
first 60 % of a six-page PDF could answer with four pages and say nothing.
declared_page_count() reads the count the file itself gives, without any
library's repair, so that a tool can tell a repaired file that lost pages
(utils.cleanup.refuse_if_pages_lost) from one that only needed its
cross-reference table rebuilt, which is common in valid files.

The count is the page tree's own. Every page tree node ("/Type /Pages") says
how many pages lie under it (/Count), and the root's count is the file's. The
root is the one the trailer's catalog names; when the catalog or the trailer
was lost, it is the node with the largest /Count. When every page and node the
root lists is still in the file, the pages counted under it are the answer
instead, so that a valid file whose /Count is wrong is not called damaged.

Nodes written inside a compressed object stream are read too: each stream
with /Type /ObjStm is inflated (Flate only, as writers use) and its objects
read. A stream that was cut short gives the objects before the cut. A
linearized file keeps its page tree near its end, and its page count (/N) in
its first object, which is read when the tree was lost. When the page tree
cannot be found at all, in an object stream in another filter, an encrypted
one, or lost with the end of the file, the count is None: unknown, and
nothing is refused on it. Opening the file with pikepdf does not help
there: qpdf rebuilds the page tree of a damaged file as it opens it, and its
/Count is then the pages it kept (4 of a six-page file cut at 60 %).

A stream's data is skipped, by its /Length or up to its "endstream", as the
libraries' repairs skip it: a PDF attached to this one without compression
carries objects with this file's numbers, and its page tree is not this
file's.

The scan is bounded. It looks for "/Type" in one pass over the bytes, reads
only the objects that are page tree nodes, pages, catalogs, trailers and
object streams, inflates at most _MAX_INFLATED bytes in all, and gives up
(None) past _MAX_MATCHES such objects or _MAX_NODES page tree nodes: a file
of 100,000 pages takes about a second. It uses the standard library only, so
that the workers that read PDFs in a process of their own can load it.
"""

from __future__ import annotations

import bisect
import mmap
import os
import re
import zlib

# One object stream inflates to at most this much, and all of them together
# to at most _MAX_INFLATED; a stream past the first limit is read up to it.
_MAX_STREAM_INFLATED = 16 * 1024 * 1024
_MAX_INFLATED = 64 * 1024 * 1024
# More objects of these kinds than this, or more page tree nodes than
# _MAX_NODES, and the scan stops: no answer. A tree of 100,000 pages has
# 100,000 pages and, ten to a node, 11,000 nodes.
_MAX_MATCHES = 250_000
_MAX_NODES = 25_000
# A /Count above this is not a count (MuPDF's own limit on an object number
# is 8 million, and a page needs an object).
_MAX_COUNT = 8_388_607
# How far back from "/Type" the object's "N G obj" may be: a node's /Kids, a
# page's /Annots and the like can come first.
_MAX_DICT_BYTES = 32 * 1024 * 1024
# A /Kids array longer than this names more pages than the scan reads
# (_MAX_MATCHES references of about ten bytes each).
_MAX_KIDS_BYTES = 16 * _MAX_MATCHES
# Page tree depth followed; real trees are a few levels deep.
_MAX_DEPTH = 64

_WHITESPACE = b" \t\r\n\f\x00"
_DELIMITERS = b"()<>[]{}/%"
_TYPE = re.compile(rb"/Type[ \t\r\n\f\x00]*/(Pages|Page|Catalog|ObjStm|XRef)(?![^ \t\r\n\f\x00()<>\[\]{}/%])")
_HEADER_TAIL = re.compile(rb"(?<![0-9])([0-9]{1,10})[ \t\r\n\f\x00]+([0-9]{1,5})[ \t\r\n\f\x00]+obj$")
_REF = re.compile(rb"([0-9]{1,10})[ \t\r\n\f\x00]+[0-9]{1,5}[ \t\r\n\f\x00]+R(?![^ \t\r\n\f\x00()<>\[\]{}/%])")
_INT = re.compile(rb"[+-]?[0-9]+")
# How far back from a "stream" keyword its object's "N G obj" is looked for.
_MAX_STREAM_DICT_BYTES = 64 * 1024
# An object that is an integer, the rest of "N G obj 1234 endobj".
_INTEGER_OBJECT = re.compile(rb"obj[ \t\r\n\f\x00]*([0-9]{1,15})[ \t\r\n\f\x00]*endobj")
_NESTED_STOP = re.compile(rb"[\[\]()<>%]")
_STRING_STOP = re.compile(rb"[()\\]")
_LINE_END = re.compile(rb"[\r\n]")


def declared_page_count(source) -> int | None:
    """The number of pages the PDF at `source` (a path, or the bytes) declares,
    or None when its page tree cannot be found in its bytes."""
    if isinstance(source, (bytes, bytearray, memoryview)):
        return _Scan(bytes(source) if isinstance(source, memoryview) else source).declared()
    with open(os.fspath(source), "rb") as fh:
        try:
            data = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
        except ValueError:  # an empty file cannot be mapped
            return None
        try:
            return _Scan(data).declared()
        finally:
            data.close()


def readable_pages(doc) -> list[int]:
    """The numbers of the pages MuPDF lists in `doc` (a PyMuPDF document) that
    it can read. Of a file it had to repair, MuPDF lists every page the page
    tree names, also one whose own object was lost, which it shows blank:
    listed, but not read. Each page's object is looked up, never the page
    itself."""
    size = doc.xref_length()
    readable = []
    for number in range(len(doc)):
        try:
            xref = doc.page_xref(number)
            if 0 < xref < size and doc.xref_object(xref, compressed=True).lstrip().startswith("<<"):
                readable.append(number)
        except Exception:  # noqa: BLE001 - MuPDF's errors for an object it cannot read are many
            pass
    return readable


def readable_page_count(doc) -> int:
    """How many of the pages MuPDF lists in `doc` it can read (readable_pages)."""
    return len(readable_pages(doc))


class _Scan:
    """One pass over a PDF's bytes for its page tree."""

    def __init__(self, data) -> None:
        self.data = data
        # Object number -> (where it is defined, kind, what it says). The
        # last definition in the file is the one a repair keeps.
        self.objects: dict[int, tuple[tuple[int, int], str, object]] = {}
        self.roots: list[tuple[tuple[int, int], int]] = []  # (where, catalog number) from trailers
        self.matches = 0  # "/Type"s of the kinds read, in the file and its object streams
        self.inflated = 0
        self.parsed = 0  # page tree nodes and catalogs read
        self.steps = 0  # kids visited while counting
        self.overflow = False
        self._cursor: tuple[int, tuple[int, int, int] | None] = (0, None)
        self._last_start = -1
        # The data of the last stream found, where the search for the next
        # "stream" keyword resumes, and every stream's data (_in_stream_data).
        self._body = (0, 0)
        self._streams_from = 0
        self._starts: list[int] = []
        self._ends: list[int] = []
        self._integers: dict[int, list[int]] | None = None  # _integer_objects

    # ── collecting ──────────────────────────────────────────────────────────

    def declared(self) -> int | None:
        for match in _TYPE.finditer(self.data):
            self.matches += 1
            if self.matches > _MAX_MATCHES or self.overflow:
                return None
            if self._in_stream_data(match.start()):
                continue  # a PDF stored in a stream, as an attachment, is not this file
            self._plain(match)
        self._in_stream_data(len(self.data))  # every stream, for _trailer
        self._trailer()
        if self.overflow:
            return None
        count = self._count()
        return count if count is not None else self._linearized()

    def _linearized(self) -> int | None:
        """The page count of a linearized file's first object (/N), for when
        its page tree, which such a file keeps near its end, was lost."""
        data = self.data
        at = data.find(b"/Linearized", 0, 1024)
        start = data.rfind(b"<<", 0, at) if at > 0 else -1
        if start < 0:
            return None
        entries = _dict_entries(data, start, min(len(data), start + 4096))
        return _count(data, entries.get(b"N")) if entries else None

    def _plain(self, match: re.Match) -> None:
        kind = match.group(1).decode()
        header = self._header_before(match.start())
        if header is None or header[1] == self._last_start:
            return  # not in an object, or in one whose /Type came first
        number, start, body = header
        self._last_start = start
        if kind == "ObjStm":
            self._object_stream(start, body)
            return
        if kind == "XRef":
            entries = _dict_entries(self.data, body, self._dict_end(body))
            root = _ref(self.data, entries.get(b"Root")) if entries else None
            if root is not None:
                self.roots.append(((start, -1), root))
            return
        self._define(number, (start, -1), kind, self.data, body)

    def _define(self, number: int, where: tuple[int, int], kind: str, buf, body: int) -> None:
        known = self.objects.get(number)
        if known is not None and known[0] > where:
            return
        if kind == "Page":
            self.objects[number] = (where, kind, None)
            return
        self.parsed += 1
        if self.parsed > _MAX_NODES:
            self.overflow = True
            return
        entries = _dict_entries(buf, body, min(len(buf), body + _MAX_DICT_BYTES))
        if entries is None:
            return
        if kind == "Pages":
            kids = entries.get(b"Kids")
            if kids is not None and kids[1] - kids[0] > _MAX_KIDS_BYTES:
                self.overflow = True  # more kids than the scan reads
                return
            self.objects[number] = (where, kind, (_count(buf, entries.get(b"Count")), _kids(buf, kids)))
        else:  # Catalog
            self.objects[number] = (where, kind, _ref(buf, entries.get(b"Pages")))

    def _header_before(self, pos: int) -> tuple[int, int, int] | None:
        """The object a "/Type" at `pos` belongs to: (its number, where its
        header starts, where its body starts), or None when it is not in an
        object's dictionary (it follows an "endobj", or a "stream").

        The search goes back from `pos` no further than the previous "/Type":
        with nothing in between, this one is in the same object as that one.
        So the bytes are searched once in all, however many there are."""
        data = self.data
        previous_pos, previous = self._cursor
        low = max(previous_pos, pos - _MAX_DICT_BYTES)
        end = pos
        result = None
        while True:
            at = data.rfind(b"obj", low, end)
            if at < 0:
                if low == previous_pos and previous is not None and data.find(b"stream", previous_pos, pos) < 0:
                    result = previous
                break
            if at >= 3 and data[at - 3:at] == b"end":
                break  # the end of an earlier object: this one is stray
            tail = _HEADER_TAIL.search(data, max(0, at - 64), at + 3)
            after = data[at + 3:at + 4]
            if tail is not None and (not after or after in _WHITESPACE or after in _DELIMITERS):
                body = at + 3
                if data.find(b"stream", body, pos) < 0:
                    result = int(tail.group(1)), tail.start(), body
                break
            end = at
        self._cursor = (pos, result)
        return result

    def _dict_end(self, body: int) -> int:
        return min(len(self.data), body + _MAX_DICT_BYTES)

    def _in_stream_data(self, pos: int) -> bool:
        """Whether `pos` lies in a stream's data. The "stream" keywords before
        `pos` are visited once, in order, and each stream's data is jumped
        over (_stream_end), so that the objects of a PDF stored in a stream,
        as an attachment written uncompressed, are never taken for this
        file's own: MuPDF's and qpdf's repairs skip a stream's data too. The
        positions asked about only grow."""
        data = self.data
        while True:
            start, end = self._body
            if pos < end:
                return pos >= start
            keyword = _stream_keyword(data, max(end, self._streams_from), pos)
            if keyword is None:
                self._streams_from = max(self._streams_from, pos)
                return False
            at, begin = keyword
            self._streams_from = begin
            before = data.rfind(b">>", max(0, at - 64), at)
            if before < 0 or data[before + 2:at].strip(_WHITESPACE):
                continue  # not after a dictionary: the word in a string, not a keyword
            self._body = (begin, self._stream_end(at, begin))
            self._starts.append(begin)
            self._ends.append(self._body[1])
            if len(self._starts) > _MAX_MATCHES:
                self.overflow = True  # more streams than the scan reads: no answer
                return True

    def _stream_end(self, keyword: int, begin: int) -> int:
        """Where the data of the stream whose keyword is at `keyword` ends: at
        its /Length, given directly or as an integer object, when "endstream"
        follows there, else at the next "endstream", else at the end of the
        bytes (a stream cut short)."""
        data = self.data
        found = data.find(b"endstream", begin)
        end = found if found >= 0 else len(data)
        if data.find(b"obj", begin, end) < 0:
            return end  # nothing in it that could be taken for an object
        at = data.rfind(b"obj", max(0, keyword - _MAX_STREAM_DICT_BYTES), keyword)
        entries = _dict_entries(data, at + 3, keyword) if at >= 0 else None
        span = entries.get(b"Length") if entries else None
        length = _number(data, span)
        if length is not None:
            lengths = [length]
        else:
            # An indirect /Length, an object written after the stream: the
            # first "endstream" may be one of the stored PDF's own.
            ref = _ref(data, span)
            lengths = self._integer_objects().get(ref, [])[::-1] if ref is not None else []
        for length in lengths:  # the last definition first, as a repair keeps it
            if begin + length <= len(data):
                after = _skip_space(data, begin + length, min(len(data), begin + length + 64))
                if data[after:after + 9] == b"endstream":
                    return begin + length
        return end

    def _integer_objects(self) -> dict[int, list[int]]:
        """Object number -> the integers it is defined as ("N G obj 1234
        endobj"), in the order of the bytes: where qpdf's QDF mode,
        Ghostscript, LibreOffice and cairo keep a stream's /Length. Read in
        one pass over the bytes, the first time a stream needs it."""
        if self._integers is None:
            data = self.data
            integers: dict[int, list[int]] = {}
            found = 0
            for match in _INTEGER_OBJECT.finditer(data):
                at = match.start()
                tail = _HEADER_TAIL.search(data, max(0, at - 64), at + 3)
                if tail is None:
                    continue
                integers.setdefault(int(tail.group(1)), []).append(int(match.group(1)))
                found += 1
                if found >= _MAX_MATCHES:
                    break  # the lengths past these are not read: such a stream ends at its "endstream"
            self._integers = integers
        return self._integers

    def _outside_streams(self, pos: int) -> bool:
        place = bisect.bisect_right(self._starts, pos) - 1
        return place < 0 or pos >= self._ends[place]

    def _trailer(self) -> None:
        data = self.data
        at = data.rfind(b"trailer")
        while at >= 0:
            if not self._outside_streams(at):
                at = data.rfind(b"trailer", 0, at)
                continue
            entries = _dict_entries(data, at + len(b"trailer"), min(len(data), at + 1024 * 1024))
            root = _ref(data, entries.get(b"Root")) if entries else None
            if root is not None:
                self.roots.append(((at, -1), root))
                return
            at = data.rfind(b"trailer", 0, at)

    def _object_stream(self, start: int, body: int) -> None:
        data = self.data
        entries = _dict_entries(data, body, self._dict_end(body))
        if not entries or not _flate_only(data, entries):
            return
        count = _count(data, entries.get(b"N"))
        first = _number(data, entries.get(b"First"))
        if not count or first is None:
            return
        dict_end = entries.get(b"")[1] if b"" in entries else body
        keyword = data.find(b"stream", dict_end, dict_end + 64)
        if keyword < 0:
            return
        begin = keyword + len(b"stream")
        if data[begin:begin + 2] == b"\r\n":
            begin += 2
        elif data[begin:begin + 1] in (b"\n", b"\r"):
            begin += 1
        length = _number(data, entries.get(b"Length"))
        stop = data.find(b"endstream", begin)
        if length is not None and begin + length <= len(data):
            stop = begin + length
        elif stop < 0:
            stop = len(data)
        inflated = self._inflate(data, begin, stop, filtered=b"Filter" in entries)
        if inflated is None:
            return
        pairs = _INT.findall(inflated, 0, first)
        members = sorted((first + int(pairs[i + 1]), int(pairs[i]), i // 2)
                         for i in range(0, min(len(pairs), 2 * count) - 1, 2))
        starts = [at for at, _, _ in members]
        done = -1
        for found in _TYPE.finditer(inflated, first):
            self.matches += 1
            if self.matches > _MAX_MATCHES:
                self.overflow = True
                return
            place = bisect.bisect_right(starts, found.start()) - 1
            if place < 0 or place == done or found.group(1) in (b"ObjStm", b"XRef"):
                continue
            done = place  # the first /Type in an object is its own
            at, number, index = members[place]
            before = inflated[at:found.start()]
            if before.count(b"<<") - before.count(b">>") != 1:
                continue  # a /Type in a dictionary inside the object
            self._define(number, (start, index), found.group(1).decode(), inflated, at)

    def _inflate(self, data, begin: int, stop: int, *, filtered: bool) -> bytes | None:
        room = min(_MAX_STREAM_INFLATED, _MAX_INFLATED - self.inflated)
        if room <= 0:
            self.overflow = True
            return None
        if not filtered:
            out = bytes(data[begin:min(stop, begin + room)])
        else:
            inflater = zlib.decompressobj()
            parts: list[bytes] = []
            size = 0
            for chunk_at in range(begin, stop, 64 * 1024):
                try:
                    part = inflater.decompress(data[chunk_at:min(stop, chunk_at + 64 * 1024)], room - size)
                except zlib.error:
                    break  # cut or damaged: keep what came before
                parts.append(part)
                size += len(part)
                if size >= room or inflater.eof:
                    break
            out = b"".join(parts)
        self.inflated += len(out)
        return out

    # ── counting ────────────────────────────────────────────────────────────

    def _count(self) -> int | None:
        nodes = {n: v[2] for n, v in self.objects.items() if v[1] == "Pages"}
        if not nodes:
            return None
        root = self._root(nodes)
        if root is not None:
            declared = self._declared_under(root, nodes)
            return None if self.overflow else declared
        if self.roots:
            # A trailer survived and names a catalog whose page tree the scan
            # cannot find (no /Type /Catalog, say): the count is unknown. The
            # nodes left are not this file's tree, but an earlier revision's
            # or one a merge left behind, and may count more pages.
            return None
        # The catalog or the trailer was lost: the largest count of a node
        # that survived, as a node lower in the tree counts fewer pages. Only
        # the nodes no surviving node lists are walked: the others are under
        # one of them.
        listed = {kid for _, kids in nodes.values() if kids for kid in kids}
        tops = [n for n in nodes if n not in listed] or list(nodes)
        known = [c for c in (self._declared_under(n, nodes) for n in tops) if c is not None]
        if self.overflow:
            return None
        return max(known) if known else None

    def _root(self, nodes: dict) -> int | None:
        catalogs = {n: v for n, v in self.objects.items() if v[1] == "Catalog"}
        candidates = [number for _, number in sorted(self.roots, reverse=True)]
        candidates += [n for n, _ in sorted(catalogs.items(), key=lambda item: item[1][0], reverse=True)]
        for number in candidates:
            catalog = catalogs.get(number)
            if catalog is not None and catalog[2] in nodes:
                return catalog[2]
        return None

    def _declared_under(self, number: int, nodes: dict) -> int | None:
        stated, kids = nodes[number]
        found, missing = self._walk(number, nodes, set(), 0)
        if missing == 0 and found:
            return found  # every page is there: the tree's own count
        if stated is not None:
            # Its /Count, as both readers take it: a /Kids entry naming no
            # object, which neither reads as a page, is not one more page.
            return max(stated, found)
        if kids is None:
            return None  # neither a count nor a list of kids survived
        return found + missing or None

    def _walk(self, number: int, nodes: dict, seen: set, depth: int) -> tuple[int, int]:
        """(pages found under node `number`, kids missing under it)."""
        _, kids = nodes[number]
        if kids is None or depth > _MAX_DEPTH or number in seen:
            return 0, 1
        seen.add(number)
        self.steps += len(kids)
        if self.steps > 2 * _MAX_MATCHES:
            self.overflow = True
            return 0, 1
        found = missing = 0
        for kid in kids:
            known = self.objects.get(kid)
            if known is None:
                missing += 1
            elif known[1] == "Page":
                found += 1
            elif known[1] == "Pages":
                f, m = self._walk(kid, nodes, seen, depth + 1)
                found += f
                missing += m
            else:
                missing += 1
        return found, missing


# ── a little of PDF's syntax ────────────────────────────────────────────────

def _stream_keyword(buf, start: int, end: int) -> tuple[int, int] | None:
    """(where the next "stream" keyword in buf[start:end] is, where its data
    starts, past the end of line that follows it), or None."""
    while True:
        at = buf.find(b"stream", start, end)
        if at < 0:
            return None
        start = at + 6
        if at > 0 and buf[at - 1:at].isalpha():
            continue  # "endstream", or a longer word
        eol = buf[at + 6:at + 8]
        if eol == b"\r\n":
            return at, at + 8
        if eol[:1] in (b"\n", b"\r"):
            return at, at + 7


def _skip_space(buf, i: int, end: int) -> int:
    """The index of the next token at or after `i`, past whitespace and comments."""
    while i < end:
        c = buf[i:i + 1]
        if c in _WHITESPACE:
            i += 1
        elif c == b"%":
            line_end = _LINE_END.search(buf, i, end)
            i = end if line_end is None else line_end.end()
        else:
            break
    return i


def _token_end(buf, i: int, end: int) -> int:
    while i < end:
        c = buf[i:i + 1]
        if c in _WHITESPACE or c in _DELIMITERS:
            break
        i += 1
    return i


def _skip_value(buf, i: int, end: int) -> int:
    """The index after the value that starts at `i` (a reference counts as one)."""
    c = buf[i:i + 1]
    if c == b"<":
        if buf[i + 1:i + 2] == b"<":
            return _skip_nested(buf, i, end)
        close = buf.find(b">", i, end)
        return end if close < 0 else close + 1
    if c == b"[":
        return _skip_nested(buf, i, end)
    if c == b"(":
        return _skip_string(buf, i, end)
    if c == b"/":
        return _token_end(buf, i + 1, end)
    ref = _REF.match(buf, i, min(end, i + 64))
    if ref is not None:
        return ref.end()
    token_end = _token_end(buf, i, end)
    return token_end if token_end > i else i + 1  # a stray delimiter


def _skip_nested(buf, i: int, end: int) -> int:
    """The index after the array or dictionary that starts at `i`."""
    depth = 0
    while True:
        found = _NESTED_STOP.search(buf, i, end)
        if found is None:
            return end
        i = found.start()
        c = buf[i:i + 1]
        if c == b"(":
            i = _skip_string(buf, i, end)
        elif c == b"%":
            i = _skip_space(buf, i, end)
        elif c == b"[" or (c == b"<" and buf[i + 1:i + 2] == b"<"):
            depth += 1
            i += 1 if c == b"[" else 2
            if depth > _MAX_DEPTH:
                return end
        elif c == b"]" or (c == b">" and buf[i + 1:i + 2] == b">"):
            depth -= 1
            i += 1 if c == b"]" else 2
            if depth <= 0:
                return i
        elif c == b"<":  # a hex string
            close = buf.find(b">", i, end)
            i = end if close < 0 else close + 1
        else:  # a ">" on its own
            i += 1


def _skip_string(buf, i: int, end: int) -> int:
    """The index after the literal string that starts at `i`."""
    depth = 0
    while True:
        found = _STRING_STOP.search(buf, i, end)
        if found is None:
            return end
        i = found.start()
        c = buf[i:i + 1]
        if c == b"\\":
            i += 2
            continue
        depth += 1 if c == b"(" else -1
        i += 1
        if depth <= 0:
            return i


def _dict_entries(buf, i: int, end: int) -> dict[bytes, tuple[int, int]] | None:
    """The top-level entries of the dictionary at `i`: {key: (start, end) of
    its value}, and b"" for the dictionary's own end. A dictionary cut short
    gives the entries before the cut. None when no dictionary starts there."""
    i = _skip_space(buf, i, end)
    if buf[i:i + 2] != b"<<":
        return None
    i += 2
    entries: dict[bytes, tuple[int, int]] = {}
    while True:
        i = _skip_space(buf, i, end)
        if i >= end:
            entries[b""] = (end, end)
            return entries
        if buf[i:i + 2] == b">>":
            entries[b""] = (i, i + 2)
            return entries
        if buf[i:i + 1] != b"/":
            entries[b""] = (i, i)
            return entries  # not a key: stop here, keep what was read
        key_end = _token_end(buf, i + 1, end)
        key = bytes(buf[i + 1:key_end])
        i = _skip_space(buf, key_end, end)
        value_end = _skip_value(buf, i, end) if i < end else end
        if value_end >= end and b"" not in entries and i < end and buf[i:i + 1] in (b"[", b"<", b"("):
            # A value cut short is no value.
            entries[b""] = (end, end)
            return entries
        entries.setdefault(key, (i, value_end))
        i = max(value_end, i + 1)


def _number(buf, span: tuple[int, int] | None) -> int | None:
    """A direct, non-negative integer at `span`, or None."""
    if span is None:
        return None
    token = bytes(buf[span[0]:span[1]]).strip()
    return int(token) if token.isdigit() and len(token) <= 15 else None


def _count(buf, span: tuple[int, int] | None) -> int | None:
    """A page count at `span`: a direct, non-negative integer no larger than
    any PDF could hold, or None."""
    value = _number(buf, span)
    return value if value is not None and value <= _MAX_COUNT else None


def _ref(buf, span: tuple[int, int] | None) -> int | None:
    if span is None:
        return None
    match = _REF.match(buf, span[0], span[1])
    return int(match.group(1)) if match else None


def _kids(buf, span: tuple[int, int] | None) -> list[int] | None:
    """The object numbers a direct /Kids array names, or None (absent, cut
    short, or not a direct array)."""
    if span is None or buf[span[0]:span[0] + 1] != b"[":
        return None
    body = bytes(buf[span[0]:span[1]])
    if not body.endswith(b"]"):
        return None
    return [int(m.group(1)) for m in _REF.finditer(body)]


def _flate_only(buf, entries: dict) -> bool:
    """Whether a stream is unfiltered or Flate-encoded without parameters."""
    if b"DecodeParms" in entries:
        return False
    span = entries.get(b"Filter")
    if span is None:
        return True
    value = re.sub(rb"[ \t\r\n\f\x00]+", b"", bytes(buf[span[0]:span[1]]))
    return value in (b"/FlateDecode", b"[/FlateDecode]")


__all__ = ["declared_page_count", "readable_page_count", "readable_pages"]
