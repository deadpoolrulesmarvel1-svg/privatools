"""Unreadable images get a 400 that says why, not a 500 that invites a retry.

Routes that hand an upload to Pillow let `UnidentifiedImageError` (a text
file named .png, a format Pillow doesn't decode) and a truncated file's
`OSError` become a 500: through the catch-all ("Server error") or through
their own `except Exception` ("Conversion failed", "Watermark failed" and
so on). The page then offered "Try again" for a file that can never work.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main

JUNK = b"just some text, not a picture"

# (route, upload field, file name, extra form fields)
ROUTES = [
    ("/api/image-converter", "file", "notes.png", {"target_format": "jpeg"}),
    ("/api/image-compressor", "file", "notes.png", {}),
    ("/api/generate-favicon", "file", "notes.png", {}),
    ("/api/image-watermark", "file", "notes.png", {"text": "draft"}),
    ("/api/remove-exif", "files", "notes.png", {}),
    ("/api/view-exif", "file", "notes.png", {}),
    ("/api/heic-to-jpg", "file", "notes.heic", {}),
]


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _truncated_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 30, 30)).save(buf, "PNG")
    data = buf.getvalue()
    return data[: len(data) // 2]


@pytest.mark.parametrize("route,field,name,data", ROUTES, ids=[r[0] for r in ROUTES])
def test_a_file_that_is_not_an_image_is_a_400(quiet_client, route, field, name, data):
    response = quiet_client.post(route, files={field: (name, JUNK, "image/png")}, data=data)
    assert response.status_code == 400, response.text
    assert "not an image" in response.json()["detail"]


# View EXIF reads metadata without decoding pixels, so a file cut off in its
# image data still answers 200 there, which is right.
TRUNCATED = [r for r in ROUTES if r[2].endswith(".png") and r[0] != "/api/view-exif"]


@pytest.mark.parametrize("route,field,name,data", TRUNCATED, ids=[r[0] for r in TRUNCATED])
def test_a_truncated_image_is_a_400(quiet_client, route, field, name, data):
    response = quiet_client.post(route, files={field: ("cut.png", _truncated_png(), "image/png")}, data=data)
    assert response.status_code == 400, response.text
    assert "incomplete" in response.json()["detail"]


def test_a_real_image_still_converts(quiet_client):
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), (10, 120, 200)).save(buf, "PNG")
    response = quiet_client.post(
        "/api/image-converter", files={"file": ("ok.png", buf.getvalue(), "image/png")}, data={"target_format": "jpeg"},
    )
    assert response.status_code == 200
    assert response.content[:3] == b"\xff\xd8\xff"
