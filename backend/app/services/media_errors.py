"""What a visitor is told when FFmpeg cannot open an upload as video or audio.

FFmpeg refuses a file it cannot read as media, such as a text file named
.mp3, before doing any work. Since 6.1 it says "Error opening input file
<path>." and then why: "Invalid data found when processing input", or
"Invalid argument" when its MP3 reader gives up on the bytes. Older versions
printed "<path>: <why>".

The FFmpeg runners answered that with a 500, so the page said "Processing
failed. Please try again." and the browser sent the file again, or with a
400 quoting FFmpeg's last line, which the page turned into "A processing
tool failed on this file". Every runner asks unreadable_input() and answers
a 400 with NOT_MEDIA instead: services/video_tools_service.py (and the
subtitle renderer through it), and the runners in routes/non_pdf_tools.py,
phase6_tools.py and phase7_tools.py.

NOT_MEDIA must not say "damaged", "corrupt", "could not open" or "empty
file": the frontend's friendlyError() turns those into its PDF advice.
"""

from __future__ import annotations

NOT_MEDIA = "This file isn't a video or audio file this tool can read."

# Reasons that are the server's fault, not the file's: the upload it wrote
# is gone or unreadable, or the machine is out of memory.
_SERVER_REASONS = ("No such file or directory", "Permission denied", "Cannot allocate memory")


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


def unreadable_input(command: list[str], stderr: str) -> bool:
    """Whether FFmpeg, running `command`, failed because it could not open
    one of the uploads it reads as media."""
    if not stderr or any(reason in stderr for reason in _SERVER_REASONS):
        return False
    lines = stderr.splitlines()
    for path in _uploads(command):
        if f"Error opening input file {path}." in lines:
            return True
        if any(line.startswith(f"{path}: ") for line in lines):
            return True
    return False


__all__ = ["NOT_MEDIA", "unreadable_input"]
