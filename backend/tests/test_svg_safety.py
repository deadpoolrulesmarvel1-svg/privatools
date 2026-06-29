"""Tests for the cairosvg SSRF/LFI guard (block_external_refs).

Pure stdlib — no cairosvg/native libs needed — so they run anywhere.
"""

import base64
import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.svg_safety import block_external_refs


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "file://localhost/etc/shadow",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata SSRF
        "http://127.0.0.1:8000/api/health",
        "https://evil.example.com/exfil.png",
        "../../../etc/passwd",  # relative filesystem ref
        "/etc/passwd",
        "ftp://example.com/x",
    ],
)
def test_blocks_external_and_filesystem_references(url):
    with pytest.raises(ValueError):
        block_external_refs(url)


def test_allows_inline_base64_data_uri():
    raw = b"\x89PNG\r\n\x1a\n-not-a-real-png-but-bytes"
    uri = "data:image/png;base64," + base64.b64encode(raw).decode()
    result = block_external_refs(uri, resource_type="image")
    assert result["string"] == raw
    assert result["mime_type"] == "image/png"


def test_allows_plain_data_uri():
    result = block_external_refs("data:text/plain,hello%20world")
    assert result["string"] == b"hello world"
    assert result["mime_type"] == "text/plain"


def test_data_uri_without_mime_defaults_to_text_plain():
    result = block_external_refs("data:,justtext")
    assert result["string"] == b"justtext"
    assert result["mime_type"] == "text/plain"
