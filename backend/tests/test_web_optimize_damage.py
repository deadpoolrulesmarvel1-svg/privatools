"""Web Optimize runs the qpdf command, which fails with the same exit status
for a damaged input and for a fault of the server's. When it fails, the input
is judged as process_pdf judges it: a page object MuPDF cannot read is the
file's damage (400); anything else stays the server's fault (500). qpdf is
stubbed, so this holds on a machine without it; CI also runs the real command
through test_damaged_pdfs_everywhere. All files are synthetic."""
import asyncio
import os

import fitz  # PyMuPDF
import pytest

from backend.app.services import web_optimize_service
from backend.app.utils.cleanup import MIXED_UP_MESSAGE, pages_lost_message
from backend.app.utils.exceptions import ExternalToolError, PdfCorruptError
from backend.tests.test_damaged_pdfs_everywhere import CLASSIC, OVERWRITTEN


class _FailingQpdf:
    returncode = 2

    async def communicate(self):
        return b"", b"WARNING: upload.pdf (object 4 0, offset 329): unknown token while reading object"

    def kill(self):
        pass


@pytest.fixture
def failing_qpdf(monkeypatch):
    async def fake_exec(*args, **kwargs):
        return _FailingQpdf()
    monkeypatch.setattr(web_optimize_service.asyncio, "create_subprocess_exec", fake_exec)


def test_a_page_object_mupdf_cannot_read_is_the_files_damage(tmp_path, failing_qpdf):
    source = tmp_path / "overwritten.pdf"
    source.write_bytes(OVERWRITTEN["page-object"])
    with pytest.raises(PdfCorruptError):
        asyncio.run(web_optimize_service.web_optimize(str(source)))


def test_qpdf_failing_on_an_intact_file_stays_the_servers_fault(tmp_path, failing_qpdf):
    source = tmp_path / "intact.pdf"
    source.write_bytes(CLASSIC)
    with pytest.raises(ExternalToolError):
        asyncio.run(web_optimize_service.web_optimize(str(source)))


# ── what the command wrote ──────────────────────────────────────────────────
#
# The command rebuilds a damaged file on its own, with its own qpdf, not the
# library that read the upload. In CI, qpdf 11.9 missed the table of a valid
# one-page PDF that carries a six-page PDF without compression and has bytes
# after its end, rebuilt it from every "N G obj" in the bytes, and wrote the
# stored PDF's six pages, a success. Its output must have the pages the input
# declares (utils.declared_pages).

def _pdf(pages: int, label: str) -> bytes:
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 100), f"{label} {i + 1}", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


class _WritingQpdf:
    """The command, succeeding, having written `output`."""

    returncode = 0

    def __init__(self, target: str, output: bytes):
        self.target, self.output = target, output

    async def communicate(self):
        with open(self.target, "wb") as fh:
            fh.write(self.output)
        return b"", b""

    def kill(self):
        pass


@pytest.fixture
def qpdf_writes(monkeypatch):
    written: dict[str, bytes] = {}
    targets: list[str] = []

    async def fake_exec(*args, **kwargs):
        targets.append(args[-1])
        return _WritingQpdf(args[-1], written["output"])

    monkeypatch.setattr(web_optimize_service.asyncio, "create_subprocess_exec", fake_exec)
    written["targets"] = targets
    return written


def test_an_output_with_more_pages_than_the_file_declares_is_refused_as_another_document(tmp_path, qpdf_writes):
    source = tmp_path / "carrying.pdf"
    source.write_bytes(_pdf(1, "The covering page") + b"\n" + bytes(range(256)) * 16)
    qpdf_writes["output"] = _pdf(6, "Stored page")  # as qpdf 11.9 wrote it
    with pytest.raises(PdfCorruptError) as refused:
        asyncio.run(web_optimize_service.web_optimize(str(source)))
    assert refused.value.detail == MIXED_UP_MESSAGE
    assert not os.path.exists(qpdf_writes["targets"][0])  # never left behind


def test_an_output_with_fewer_pages_than_the_file_declares_is_refused_as_pages_lost(tmp_path, qpdf_writes):
    source = tmp_path / "three.pdf"
    source.write_bytes(_pdf(3, "Page"))
    qpdf_writes["output"] = _pdf(2, "Page")
    with pytest.raises(PdfCorruptError) as refused:
        asyncio.run(web_optimize_service.web_optimize(str(source)))
    assert refused.value.detail == pages_lost_message(2, 3)


def test_an_output_with_the_pages_the_file_declares_is_answered(tmp_path, qpdf_writes):
    source = tmp_path / "three.pdf"
    source.write_bytes(_pdf(3, "Page"))
    qpdf_writes["output"] = _pdf(3, "Page")
    output = asyncio.run(web_optimize_service.web_optimize(str(source)))
    with fitz.open(output) as doc:
        assert len(doc) == 3
    os.unlink(output)


def test_an_input_whose_page_tree_cannot_be_found_refuses_nothing(tmp_path, qpdf_writes, monkeypatch):
    from backend.app.utils import declared_pages

    monkeypatch.setattr(declared_pages, "_MAX_SECONDS", -1.0)  # every count unknown
    source = tmp_path / "three.pdf"
    source.write_bytes(_pdf(3, "Page"))
    qpdf_writes["output"] = _pdf(6, "Page")
    output = asyncio.run(web_optimize_service.web_optimize(str(source)))
    os.unlink(output)
