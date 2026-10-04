"""A file FFmpeg cannot open as media is a 400 that says so, on every media route.

A text file named .mp3 sent to the audio converter answered 500, so the page
said "Processing failed. Please try again." for a file that can never work,
and the browser sent it again. Other routes answered 400 with FFmpeg's own
last line, which the page turns into "A processing tool failed on this file".
FFmpeg says why before doing any work ("Error opening input file <path>."),
and services/media_errors.py reads that for every FFmpeg runner.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.services.media_errors import NOT_MEDIA, unreadable_input

TEXT = b"Meeting notes, saved with the wrong name.\n" * 4
SRT = b"1\n00:00:00,000 --> 00:00:01,000\nHello\n"

pytestmark = pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="needs ffmpeg and ffprobe")


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def real_media(tmp_path_factory):
    folder = tmp_path_factory.mktemp("unreadable-input")
    clip, tone = folder / "clip.mp4", folder / "tone.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=10",
                    "-f", "lavfi", "-i", "sine=duration=1", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(clip)],
                   check=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1", str(tone)],
                   check=True, timeout=60)
    return {"clip": clip.read_bytes(), "tone": tone.read_bytes()}


# route -> (upload fields; "clip"/"tone" stand for a real file, beside the text one, form data)
ROUTES = {
    "/api/audio-converter": ([("file", "notes.mp3", None)], {"format": "wav"}),
    "/api/extract-audio": ([("file", "notes.mp4", None)], {}),
    "/api/video-to-gif": ([("file", "notes.mp4", None)], {}),
    "/api/trim-media": ([("file", "notes.mp4", None)], {"start": "00:00:00", "end": "00:00:01"}),
    "/api/compress-video": ([("file", "notes.mp4", None)], {}),
    "/api/video-to-pdf": ([("file", "notes.mp4", None)], {}),
    "/api/video-converter": ([("file", "notes.mp4", None)], {"target_format": "webm"}),
    "/api/video-resizer": ([("file", "notes.mp4", None)], {}),
    "/api/video-thumbnail": ([("file", "notes.mp4", None)], {}),
    "/api/gif-to-mp4": ([("file", "notes.gif", None)], {}),
    "/api/add-subtitles": ([("file", "notes.mp4", None), ("srt", "subs.srt", SRT)], {}),
    # The first clip is real: Merge Videos reads its frame size before FFmpeg runs.
    "/api/video-merge": ([("files", "clip.mp4", "clip"), ("files", "notes.mp4", None)], {}),
    "/api/audio-merge": ([("files", "tone.mp3", "tone"), ("files", "notes.mp3", None)], {}),
    "/api/mute-video": ([("file", "notes.mp4", None)], {}),
    "/api/reverse-video": ([("file", "notes.mp4", None)], {}),
    "/api/video-speed": ([("file", "notes.mp4", None)], {}),
    "/api/audio-trim": ([("file", "notes.mp3", None)], {"start": "0", "end": "1"}),
}


@pytest.mark.parametrize("route", list(ROUTES))
def test_a_file_that_is_not_media_is_a_400_that_says_so(quiet_client, real_media, route):
    fields, data = ROUTES[route]
    files = []
    for field, name, content in fields:
        payload = TEXT if content is None else real_media.get(content, content)
        files.append((field, (name, payload, "application/octet-stream")))
    response = quiet_client.post(route, files=files, data=data)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == NOT_MEDIA


# What FFmpeg 6.1 and later print when an input cannot be opened, and what
# older versions printed. CI and the dev VM run 6.1; the image runs 7.1.
OPEN_FAILED_61 = (
    "[mp3 @ 0xadb04cbf4930] Failed to read frame size: Could not seek to 1051.\n"
    "[in#0 @ 0xadb04cbf4830] Error opening input: Invalid argument\n"
    "Error opening input file /app/temp/upload_1.mp3.\n"
    "Error opening input files: Invalid argument\n"
)
OPEN_FAILED_60 = "/app/temp/upload_1.mp4: Invalid data found when processing input\n"


@pytest.mark.parametrize("command,stderr,expected", [
    (["ffmpeg", "-y", "-i", "/app/temp/upload_1.mp3", "out.wav"], OPEN_FAILED_61, True),
    (["-i", "/app/temp/upload_1.mp4", "out.mp4"], OPEN_FAILED_60, True),
    # The second of two inputs.
    (["-i", "/app/temp/a.mp3", "-i", "/app/temp/upload_1.mp3", "out.mp3"], OPEN_FAILED_61, True),
    # The file is media; what failed is the output.
    (["-i", "/app/temp/upload_1.mp4", "out.mp3"],
     "[out#0/mp3 @ 0xbf2d42f2d690] Output file does not contain any stream\n"
     "Error opening output file out.mp3.\nError opening output files: Invalid argument\n", False),
    # An input the server made up itself is the server's problem.
    (["-i", "/app/temp/upload_1.mp4", "-f", "lavfi", "-i", "anullsrc=bad", "out.mp4"],
     "Error opening input file anullsrc=bad.\nError opening input files: Invalid argument\n", False),
    # The upload vanished or could not be read: the server's fault, not the file's.
    (["-i", "/app/temp/upload_1.mp4", "out.mp4"],
     "[in#0 @ 0x1] Error opening input: No such file or directory\n"
     "Error opening input file /app/temp/upload_1.mp4.\nError opening input files: No such file or directory\n", False),
    (["-i", "/app/temp/upload_1.mp4", "out.mp4"],
     "[in#0 @ 0x1] Error opening input: Permission denied\n"
     "Error opening input file /app/temp/upload_1.mp4.\nError opening input files: Permission denied\n", False),
    (["-i", "/app/temp/upload_1.mp4", "out.mp4"], "", False),
])
def test_unreadable_input_reads_ffmpegs_reason(command, stderr, expected):
    assert unreadable_input(command, stderr) is expected
