"""The routes in routes/new_tools.py answer a service's ToolError as the
service chose, as Split in Half and Merge Videos already did.

A ToolError carries its own status and wording: 504 when FFmpeg runs out of
time, 400 when the service refuses the file. Ten routes caught it in their
`except Exception` and answered 500, so the page said "Processing failed.
Please try again." for a file that could never work, and offered a retry.
"""

from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import fitz
import pikepdf
import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.services import (
    highlight_service,
    long_image_service,
    pdf_to_svg_service,
    smart_redact_service,
    video_tools_service,
)
from backend.app.utils.exceptions import PdfEncryptedError, ToolTimeoutError, ValidationError

JUNK = b"not really a video, only its name says so"


def _pdf() -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "A secret meeting at noon.", fontsize=12)
    return doc.tobytes()


def _zero_page_pdf() -> bytes:
    out = io.BytesIO()
    pikepdf.new().save(out)
    return out.getvalue()


PDF = _pdf()

# route -> (service module, function, upload fields, form data)
ROUTES = {
    "/api/video-to-pdf": (video_tools_service, "video_to_pdf", [("file", ("clip.mp4", JUNK))], {}),
    "/api/video-converter": (video_tools_service, "video_convert", [("file", ("clip.mp4", JUNK))], {"target_format": "webm"}),
    "/api/video-resizer": (video_tools_service, "video_resize", [("file", ("clip.mp4", JUNK))], {}),
    "/api/video-thumbnail": (video_tools_service, "video_thumbnail", [("file", ("clip.mp4", JUNK))], {}),
    "/api/gif-to-mp4": (video_tools_service, "gif_to_mp4", [("file", ("loop.gif", JUNK))], {}),
    "/api/audio-merge": (video_tools_service, "audio_merge", [("files", ("a.mp3", JUNK)), ("files", ("b.mp3", JUNK))], {}),
    "/api/highlight": (highlight_service, "highlight_text", [("file", ("doc.pdf", PDF))], {"query": "secret"}),
    "/api/pdf-to-svg": (pdf_to_svg_service, "pdf_to_svg", [("file", ("doc.pdf", PDF))], {}),
    "/api/smart-redact": (smart_redact_service, "smart_redact", [("file", ("doc.pdf", PDF))], {"needles": json.dumps(["secret"])}),
    "/api/pdf-to-long-image": (long_image_service, "pdf_to_long_image", [("file", ("doc.pdf", PDF))], {}),
}

ERRORS = [
    # The global handler words every 5xx itself.
    (ToolTimeoutError("ffmpeg timed out after 180s — try a shorter clip."), 504,
     "The operation timed out. Try a smaller file."),
    (PdfEncryptedError(), 400, PdfEncryptedError.default_detail),
    (ValidationError("The service refused this file, and said why."), 400,
     "The service refused this file, and said why."),
]


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.mark.parametrize("route", list(ROUTES))
@pytest.mark.parametrize("error,status,detail", ERRORS, ids=["timeout", "password", "refusal"])
def test_a_services_tool_error_keeps_its_status_and_words(quiet_client, monkeypatch, route, error, status, detail):
    module, function, files, data = ROUTES[route]

    def refuse(*args, **kwargs):
        raise error

    monkeypatch.setattr(module, function, refuse)
    response = quiet_client.post(route, files=files, data=data)
    assert response.status_code == status, response.text
    assert response.json()["detail"] == detail


FFMPEG_ROUTES = ["/api/video-to-pdf", "/api/video-converter", "/api/video-resizer",
                 "/api/video-thumbnail", "/api/gif-to-mp4", "/api/audio-merge"]


@pytest.mark.parametrize("route", FFMPEG_ROUTES)
def test_ffmpeg_out_of_time_answers_504_and_leaves_no_partial_output(quiet_client, monkeypatch, route):
    """FFmpeg writes as it goes, so a run stopped at its time limit leaves part
    of a file behind, at a path the route never learns."""
    real_run = subprocess.run
    outputs: list[Path] = []

    def ffmpeg_out_of_time(command, *args, **kwargs):
        if command and command[0] == "ffmpeg" and "-encoders" not in command:
            Path(command[-1]).write_bytes(b"\0" * 1024)
            outputs.append(Path(command[-1]))
            raise subprocess.TimeoutExpired(command, kwargs.get("timeout"))
        return real_run(command, *args, **kwargs)  # ffprobe still answers

    monkeypatch.setattr(subprocess, "run", ffmpeg_out_of_time)
    _, _, files, data = ROUTES[route]
    response = quiet_client.post(route, files=files, data=data)
    assert response.status_code == 504, response.text
    assert outputs, "FFmpeg never ran"
    assert not [path for path in outputs if path.exists()], "the partial output was left in the temp directory"


@pytest.mark.parametrize("route,data", [
    ("/api/highlight", {"query": "secret"}),
    ("/api/smart-redact", {"needles": json.dumps(["secret"])}),
    ("/api/pdf-to-svg", {}),
])
@pytest.mark.parametrize("sample,detail", [
    (b"%PDF-1.7\n", "This PDF appears to be corrupt or invalid."),
    (_zero_page_pdf(), "This PDF has no pages."),
], ids=["header-only", "no-pages"])
def test_a_pdf_these_tools_cannot_use_is_a_400_that_says_why(quiet_client, route, data, sample, detail):
    response = quiet_client.post(route, files={"file": ("doc.pdf", sample, "application/pdf")}, data=data)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == detail


@pytest.mark.parametrize("route,data", [
    ("/api/highlight", {"query": "secret"}),
    ("/api/smart-redact", {"needles": json.dumps(["secret"])}),
    ("/api/pdf-to-svg", {}),
])
def test_a_pdf_that_needs_a_password_says_so(quiet_client, locked_pdf, route, data):
    response = quiet_client.post(route, files={"file": ("doc.pdf", locked_pdf, "application/pdf")}, data=data)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PdfEncryptedError.default_detail
