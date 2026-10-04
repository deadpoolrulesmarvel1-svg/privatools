"""What a visitor is told when FFmpeg cannot open an upload as video or audio.

FFmpeg refuses a file it cannot read as media, such as a text file named
.mp3, before doing any work. Since 6.1 it says "Error opening input file
<path>." and then why: "Error opening input files: <reason>". Older versions
printed "<path>: <reason>".

The FFmpeg runners answered that with a 500, so the page said "Processing
failed. Please try again." and the browser sent the file again, or with a
400 quoting FFmpeg's last line, which the page turned into "A processing
tool failed on this file". Every runner asks unreadable_input() and answers
a 400 with NOT_MEDIA instead: services/video_tools_service.py (and the
subtitle renderer through it), and the runners in routes/non_pdf_tools.py,
phase6_tools.py and phase7_tools.py.

Only the reasons a file that is not media really produces count as the
file's (_NOT_MEDIA_REASONS, an allow list). They come from FFmpeg 6.1.1 run
on 301 synthetic uploads named with 26 media and other extensions, or none:
text, JSON, HTML, a PDF, a ZIP or random bytes, an empty file, and real
clips cut to a half, a tenth or their first 64 bytes, or with a garbled
header. FFmpeg could not open 208 of them, and said one of four things:
"Invalid data found when processing input" (most), "End of file" (GIF, AAC,
Ogg and Opus readers), "Invalid argument" (the MP3 reader) or "Input/output
error" (a Matroska or WebM file cut short, a FLAC cut to 64 bytes).

Any other reason is the server's. With each failure the system can give
injected into FFmpeg's open() of a real clip (strace), it said "Too many
open files", "No space left on device", "Stale file handle", "Disk quota
exceeded" and the rest; under the deny list this replaced, all but three
read as "isn't a video or audio file". server_fault_opening_input() names
them now, and the runners answer them with a 500 the page can offer to
retry. An open failure whose reason cannot be read stays NOT_MEDIA.

Two reasons stay ambiguous, and stay the file's, as before: "Input/output
error" is also what a failing disk says, and "Invalid argument" what open()
says for flags the kernel rejects. A file cut short is far likelier than
either, and the cut-off Matroska and FLAC files must keep their 400.

NOT_MEDIA must not say "damaged", "corrupt", "could not open" or "empty
file": the frontend's friendlyError() turns those into its PDF advice.
"""

from __future__ import annotations

NOT_MEDIA = "This file isn't a video or audio file this tool can read."

# The reasons FFmpeg gives for an upload that is not media it can read.
_NOT_MEDIA_REASONS = frozenset({
    "Invalid data found when processing input",  # AVERROR_INVALIDDATA: nothing it can probe
    "End of file",  # a reader chosen by the extension finding no header (GIF, AAC, Ogg, Opus)
    "Invalid argument",  # the MP3 reader giving up on bytes that are not MP3
    "Input/output error",  # the Matroska and FLAC readers on a file cut short
})
_SUMMARY = "Error opening input files: "  # FFmpeg 6.1 and later, after "Error opening input file <path>."


def _uploads(command: list[str]) -> list[str]:
    """The files `command` reads, leaving out inputs with a named format,
    such as FFmpeg's own sources (lavfi) and concat lists: those are made by
    the server, so their failure is never the visitor's file."""
    files: list[str] = []
    fmt = None
    for option, value in zip(command, command[1:]):
        if option == "-f":
            fmt = value
        elif option == "-i":
            if fmt is None:
                files.append(value)
            fmt = None
    return files


def _open_failures(command: list[str], stderr: str) -> list[str]:
    """The reason FFmpeg gave for each upload in `command` it could not open,
    or "" where it gave none that can be read."""
    lines = [line.strip() for line in (stderr or "").splitlines()]
    reasons: list[str] = []
    for path in _uploads(command):
        for index, line in enumerate(lines):
            if line == f"Error opening input file {path}.":
                after = lines[index + 1] if index + 1 < len(lines) else ""
                reasons.append(after[len(_SUMMARY):] if after.startswith(_SUMMARY) else "")
            elif line.startswith(f"{path}: "):
                reasons.append(line[len(path) + 2:])
    return reasons


def unreadable_input(command: list[str], stderr: str) -> bool:
    """Whether FFmpeg, running `command`, failed because one of the uploads it
    reads is not media it can read: the file's fault, a 400."""
    return any(not reason or reason in _NOT_MEDIA_REASONS for reason in _open_failures(command, stderr))


def server_fault_opening_input(command: list[str], stderr: str) -> bool:
    """Whether FFmpeg could not open one of the uploads for a reason of the
    server's, such as "Too many open files" or "Stale file handle": not the
    file's fault, a 500 the page can offer to retry."""
    return any(reason and reason not in _NOT_MEDIA_REASONS for reason in _open_failures(command, stderr))


__all__ = ["NOT_MEDIA", "server_fault_opening_input", "unreadable_input"]
