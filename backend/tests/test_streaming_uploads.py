"""C3: stream_upload_to_disk writes uploads to disk in chunks (no full-RAM
buffer) and can reject early via first-chunk validation."""

import asyncio
import io
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.utils.cleanup import validate_pdf_content
from backend.app.utils.route_helpers import stream_upload_to_disk


class _FakeUpload:
    """Minimal UploadFile stand-in: async chunked read over a byte buffer."""

    def __init__(self, data: bytes):
        self._buf = io.BytesIO(data)

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)


def test_streams_full_payload_to_disk(tmp_path):
    data = b"%PDF-1.4\n" + b"x" * 5000
    dest = tmp_path / "out.bin"
    written = asyncio.run(
        stream_upload_to_disk(_FakeUpload(data), dest, chunk_size=256)
    )
    assert written == len(data)
    assert dest.read_bytes() == data


def test_early_validation_rejects_non_pdf_and_cleans_partial(tmp_path):
    bad = b"<html>not a pdf</html>" + b"x" * 5000
    dest = tmp_path / "out.bin"
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            stream_upload_to_disk(
                _FakeUpload(bad), dest, chunk_size=256, validate=validate_pdf_content
            )
        )
    assert ei.value.status_code == 400
    assert not dest.exists()


def test_validation_passes_for_pdf(tmp_path):
    good = b"%PDF-1.7\n" + b"x" * 5000
    dest = tmp_path / "out.bin"
    written = asyncio.run(
        stream_upload_to_disk(
            _FakeUpload(good), dest, chunk_size=256, validate=validate_pdf_content
        )
    )
    assert written == len(good)
    assert dest.exists()


def test_size_cap_raises_413_and_cleans_partial(tmp_path):
    dest = tmp_path / "out.bin"
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            stream_upload_to_disk(
                _FakeUpload(b"x" * 5000), dest, max_bytes=1000, chunk_size=256
            )
        )
    assert ei.value.status_code == 413
    assert not dest.exists()


def test_empty_upload_raises_400(tmp_path):
    dest = tmp_path / "out.bin"
    with pytest.raises(HTTPException) as ei:
        asyncio.run(stream_upload_to_disk(_FakeUpload(b""), dest))
    assert ei.value.status_code == 400
    assert not dest.exists()
