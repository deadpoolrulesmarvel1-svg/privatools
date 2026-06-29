"""Tests for the shared process_pdf_upload lifecycle helper (P2)."""

import asyncio
import io
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.utils.upload_helper import process_pdf_upload


class _FakeUpload:
    def __init__(self, data: bytes, filename: str = "x.pdf"):
        self.filename = filename
        self._b = io.BytesIO(data)

    async def read(self, n: int = -1) -> bytes:
        return self._b.read(n)


def test_rejects_wrong_extension():
    up = _FakeUpload(b"%PDF-1.4\n" + b"x" * 100, filename="x.txt")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(process_pdf_upload(up, lambda p: p, output_filename="o.pdf"))
    assert ei.value.status_code == 400


def test_rejects_non_pdf_content_early():
    up = _FakeUpload(b"<html>not a pdf</html>" + b"x" * 100)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(process_pdf_upload(up, lambda p: p, output_filename="o.pdf"))
    assert ei.value.status_code == 400


def test_happy_path_returns_fileresponse(tmp_path):
    out = tmp_path / "out.pdf"
    out.write_bytes(b"%PDF-1.4 result")
    up = _FakeUpload(b"%PDF-1.4\n" + b"x" * 200)

    def run(inp: str) -> str:
        # the streamed input is a real PDF-headed temp file
        assert Path(inp).read_bytes().startswith(b"%PDF-")
        return str(out)

    resp = asyncio.run(process_pdf_upload(up, run, output_filename="result.pdf"))
    assert isinstance(resp, FileResponse)
    assert resp.path == str(out)
    assert resp.status_code == 200


def test_run_httpexception_passes_through_and_cleans():
    up = _FakeUpload(b"%PDF-1.4\n" + b"x" * 200)
    seen: dict[str, str] = {}

    def run(inp: str):
        seen["inp"] = inp
        raise HTTPException(status_code=400, detail="page out of range")

    with pytest.raises(HTTPException) as ei:
        asyncio.run(process_pdf_upload(up, run, output_filename="o.pdf"))
    assert ei.value.status_code == 400
    assert ei.value.detail == "page out of range"
    assert not Path(seen["inp"]).exists()  # temp cleaned up


def test_unexpected_error_becomes_generic_500_and_cleans():
    up = _FakeUpload(b"%PDF-1.4\n" + b"x" * 200)
    seen: dict[str, str] = {}

    def run(inp: str):
        seen["inp"] = inp
        raise RuntimeError("leaked /etc/secret internal path")

    with pytest.raises(HTTPException) as ei:
        asyncio.run(process_pdf_upload(up, run, output_filename="o.pdf"))
    assert ei.value.status_code == 500
    assert "secret" not in ei.value.detail.lower()
    assert not Path(seen["inp"]).exists()
