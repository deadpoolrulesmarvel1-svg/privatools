"""A file FFmpeg cannot open as media is a 400 that says so, on every media route.

A text file named .mp3 sent to the audio converter answered 500, so the page
said "Processing failed. Please try again." for a file that can never work,
and the browser sent it again. Other routes answered 400 with FFmpeg's own
last line, which the page turns into "A processing tool failed on this file".
FFmpeg says why before doing any work ("Error opening input file <path>."),
and services/media_errors.py reads that for every FFmpeg runner.
"""

from __future__ import annotations

import io
import shutil
import struct
import subprocess
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.services.media_errors import NOT_MEDIA, server_fault_opening_input, unreadable_input

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


# ── Allow list, not deny list ───────────────────────────────────────────────
# Only the reasons a file that is not media produces count as the file's. The
# deny list this replaced named three server faults, so any other reason, such
# as "Too many open files" or "Stale file handle", read as "isn't a video or
# audio file": a 400 that blamed the visitor and offered no retry.

def _opened(path: str, reason: str) -> str:
    """What FFmpeg 6.1 prints when it cannot open an input, for that reason."""
    return (f"[in#0 @ 0x1] Error opening input: {reason}\n"
            f"Error opening input file {path}.\nError opening input files: {reason}\n")


UPLOAD = "/app/temp/upload_1.mp4"
COMMAND = ["ffmpeg", "-y", "-i", UPLOAD, "out.mp4"]
# What FFmpeg 6.1.1 said with each failure injected into its open() of a real
# clip (strace -e inject=openat:error=...), and the three already known. Not
# "Input/output error": the Matroska and FLAC readers say it for a file cut
# short (below), so it stays the file's.
SERVER_REASONS = [
    "Too many open files", "Too many open files in system",
    "Resource temporarily unavailable", "Interrupted system call", "No space left on device",
    "Read-only file system", "Too many levels of symbolic links", "File name too long",
    "Value too large for defined data type", "Text file busy", "Operation not permitted",
    "No such device", "No such device or address", "File too large", "Stale file handle",
    "Disk quota exceeded", "No such file or directory", "Permission denied", "Cannot allocate memory",
]


@pytest.mark.parametrize("reason", SERVER_REASONS)
def test_a_server_fault_opening_the_upload_is_not_called_not_media(reason):
    for stderr in (_opened(UPLOAD, reason), f"{UPLOAD}: {reason}\n"):  # 6.1 and later, and earlier
        assert unreadable_input(COMMAND, stderr) is False
        assert server_fault_opening_input(COMMAND, stderr) is True


@pytest.mark.parametrize("reason", [
    "Invalid data found when processing input", "End of file", "Invalid argument", "Input/output error",
    "Not yet implemented in FFmpeg, patches welcome",
])
def test_the_reasons_non_media_gives_are_the_files_fault(reason):
    for stderr in (_opened(UPLOAD, reason), f"{UPLOAD}: {reason}\n"):
        assert unreadable_input(COMMAND, stderr) is True
        assert server_fault_opening_input(COMMAND, stderr) is False


def test_an_open_failure_without_a_reason_stays_not_media():
    # A format whose reason this module cannot read keeps #332's answer.
    stderr = f"Error opening input file {UPLOAD}.\n"
    assert unreadable_input(COMMAND, stderr) is True
    assert server_fault_opening_input(COMMAND, stderr) is False


def test_a_server_made_input_is_neither():
    command = ["ffmpeg", "-i", UPLOAD, "-f", "lavfi", "-i", "anullsrc", "out.mp4"]
    stderr = _opened("anullsrc", "Too many open files")
    assert unreadable_input(command, stderr) is False
    assert server_fault_opening_input(command, stderr) is False


def _not_media_samples(folder) -> dict[str, bytes]:
    """Uploads that are not media FFmpeg can read, made here: at least one for
    each of the reasons it gives (media_errors._NOT_MEDIA_REASONS)."""
    made = {}
    for name, source in {
        "c.mp4": ["-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=10", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
        "c.webm": ["-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=10", "-c:v", "libvpx-vp9", "-deadline",
                   "realtime"],
        "t.mp3": ["-f", "lavfi", "-i", "sine=duration=1"],
        "t.wav": ["-f", "lavfi", "-i", "sine=duration=1"],
        "t.flac": ["-f", "lavfi", "-i", "sine=duration=1"],
    }.items():
        subprocess.run(["ffmpeg", "-v", "error", "-y", *source, str(folder / name)], check=True, timeout=60)
        made[name] = (folder / name).read_bytes()
    mp4, webm, mp3, pcm, flac = (made[n] for n in ("c.mp4", "c.webm", "t.mp3", "t.wav", "t.flac"))
    junk = bytes((i * 73 + 41) % 251 for i in range(20000))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("notes.txt", "hello " * 300)
    return {
        # "Invalid data found when processing input"
        "notes.mp4": TEXT, "empty.mp4": b"", "moov-lost.mp4": mp4[: len(mp4) // 2],
        "first-64-bytes.mp4": mp4[:64], "garbled-header.mp4": junk[:64] + mp4[64:],
        "first-20-bytes.wav": pcm[:20], "junk.mp4": junk,
        "report.mp4": b"%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer << >>\n%%EOF\n",
        "page.mp4": b"<!doctype html><p>not a video</p>\n",
        # "Invalid argument", from the MP3 reader
        "notes.mp3": TEXT, "empty.mp3": b"", "junk.mp3": junk, "first-100-bytes.mp3": mp3[:100],
        "archive.mp3": archive.getvalue(), "data.mp3": b'{"title": "not media"}\n',
        # "End of file", from readers the extension chooses
        "notes.gif": TEXT, "notes.ogg": TEXT, "notes.aac": TEXT,
        # "Input/output error", from the Matroska and FLAC readers
        "cut-off.webm": webm[: len(webm) // 10], "first-64-bytes.flac": flac[:64],
        # "Not yet implemented in FFmpeg, patches welcome", from the AU reader: a
        # Sun/NeXT sound file in an encoding FFmpeg has no decoder for (10: 8-bit
        # fixed point). It is media, but not media this tool can read.
        "dsp-encoding.au": b".snd" + struct.pack(">IIIII", 24, 0xFFFFFFFF, 10, 8000, 1) + bytes(4000),
    }


@pytest.mark.parametrize("command", [
    ["ffmpeg", "-y", "-i", "{upload}", "-b:a", "128k", "{out}.wav"],
    ["ffmpeg", "-y", "-loglevel", "error", "-i", "{upload}", "-c:v", "libx264", "-t", "1", "{out}.mp4"],
], ids=["default-log-level", "loglevel-error"])
def test_real_ffmpeg_on_files_that_are_not_media_still_reads_as_not_media(tmp_path, command):
    reasons = set()
    for name, data in _not_media_samples(tmp_path).items():
        upload = tmp_path / f"upload_{name}"
        upload.write_bytes(data)
        run = [part.format(upload=upload, out=tmp_path / "out") for part in command]
        done = subprocess.run(run, capture_output=True, text=True, timeout=60)
        assert done.returncode != 0, name
        assert unreadable_input(run, done.stderr), (name, done.stderr[-300:])
        assert not server_fault_opening_input(run, done.stderr), name
        reasons.update(line.split(": ", 1)[1] for line in done.stderr.splitlines()
                       if line.startswith("Error opening input files: "))
    # The samples cover every reason on the allow list, as this FFmpeg words them.
    assert reasons == {"Invalid data found when processing input", "End of file", "Invalid argument",
                       "Input/output error", "Not yet implemented in FFmpeg, patches welcome"}


def _first_upload(command: list[str]) -> str:
    fmt = None
    for option, value in zip(command, command[1:]):
        if option == "-f":
            fmt = value
        elif option == "-i":
            if fmt is None:
                return value
            fmt = None
    raise AssertionError(f"no upload in {command}")


@pytest.fixture(scope="module")
def media_for_routes(tmp_path_factory, real_media):
    folder = tmp_path_factory.mktemp("server-fault")
    gif = folder / "anim.gif"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=5",
                    str(gif)], check=True, timeout=60)
    return {**real_media, "gif": gif.read_bytes()}


@pytest.mark.parametrize("route", list(ROUTES))
def test_a_server_fault_opening_the_upload_is_a_500_on_every_media_route(
    quiet_client, monkeypatch, media_for_routes, route,
):
    real_run = subprocess.run
    calls = []

    def ffmpeg_cannot_open(command, *args, **kwargs):
        if command and command[0] == "ffmpeg" and "-encoders" not in command and "-i" in command:
            calls.append(command)
            stderr = _opened(_first_upload(command), "Too many open files")
            if not (kwargs.get("text") or kwargs.get("universal_newlines")):
                stderr = stderr.encode()
            if kwargs.get("check"):
                raise subprocess.CalledProcessError(1, command, output=b"", stderr=stderr)
            return subprocess.CompletedProcess(command, 1, b"" if isinstance(stderr, bytes) else "", stderr)
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", ffmpeg_cannot_open)
    fields, data = ROUTES[route]
    files = []
    for field, name, content in fields:
        if content is None:  # the upload FFmpeg reads: real media this time
            content = {".gif": "gif", ".mp3": "tone"}.get(name[name.rindex("."):], "clip")
        files.append((field, (name, media_for_routes.get(content, content), "application/octet-stream")))
    response = quiet_client.post(route, files=files, data=data)
    assert calls, "FFmpeg never ran"
    assert response.status_code == 500, response.text
    assert response.json()["detail"] != NOT_MEDIA


# ── A killed FFmpeg, a full disk, a missing FFmpeg ───────────────────────────
# Measured with real FFmpeg 6.1.1 in the PR #336 review: FFmpeg SIGKILLed (as
# the kernel's OOM killer does) and a disk that fills while FFmpeg writes were
# a 400 "ffmpeg failed to process the file" on the four routes of
# non_pdf_tools.py, which the page words as the file's fault; a missing ffmpeg
# was a 500 there, and a 400 "File not provided or no longer available." on
# Audio Converter and the four routes of phase7_tools.py.
FAILURES = {
    "killed": (-9, ""),
    "disk-full": (228, "[out#0/mp4 @ 0x1] Error closing file: No space left on device\nConversion failed!\n"),
}


@pytest.mark.parametrize("failure", [*FAILURES, "missing"])
@pytest.mark.parametrize("route", list(ROUTES))
def test_a_killed_starved_or_missing_ffmpeg_is_the_servers_fault_on_every_media_route(
    quiet_client, monkeypatch, media_for_routes, route, failure,
):
    real_run = subprocess.run
    calls = []

    def ffmpeg_fails(command, *args, **kwargs):
        if command and command[0] == "ffmpeg" and "-encoders" not in command and "-i" in command:
            calls.append(command)
            if failure == "missing":
                raise FileNotFoundError(2, "No such file or directory", "ffmpeg")
            returncode, stderr = FAILURES[failure]
            if not (kwargs.get("text") or kwargs.get("universal_newlines")):
                stderr = stderr.encode()
            if kwargs.get("check"):
                raise subprocess.CalledProcessError(returncode, command, output=b"", stderr=stderr)
            return subprocess.CompletedProcess(command, returncode, b"" if isinstance(stderr, bytes) else "", stderr)
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", ffmpeg_fails)
    fields, data = ROUTES[route]
    files = []
    for field, name, content in fields:
        if content is None:  # the upload FFmpeg reads: real media this time
            content = {".gif": "gif", ".mp3": "tone"}.get(name[name.rindex("."):], "clip")
        files.append((field, (name, media_for_routes.get(content, content), "application/octet-stream")))
    response = quiet_client.post(route, files=files, data=data)
    assert calls, "FFmpeg never ran"
    assert response.status_code == (503 if failure == "missing" else 500), response.text
