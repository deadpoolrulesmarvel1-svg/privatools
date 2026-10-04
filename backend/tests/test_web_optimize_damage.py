"""Web Optimize runs the qpdf command, which fails with the same exit status
for a damaged input and for a fault of the server's. When it fails, the input
is judged as process_pdf judges it: a page object MuPDF cannot read is the
file's damage (400); anything else stays the server's fault (500). qpdf is
stubbed, so this holds on a machine without it; CI also runs the real command
through test_damaged_pdfs_everywhere. All files are synthetic."""
import asyncio

import pytest

from backend.app.services import web_optimize_service
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
