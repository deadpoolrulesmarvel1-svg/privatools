"""Check a PDF for hidden text in a separate, bounded process.

What counts as hidden, and how it is found, is in ``_hidden_text_worker.py``,
which does the work. It runs there, not here, because the work grows with what
the pages draw, not with the file's size: every page's text is extracted
twice, its drawing log is read, and pages with doubtful text are rendered. The
worker caps its own memory and CPU time, refuses files with more than
MAX_PAGES pages before reading any, and this module stops it after
``time_limit(size)`` seconds. The web process never parses the upload.
Sanitize, the signature checker and the QR reader work the same way.

Nothing is kept: the route streams the upload to a temporary file, the worker
reads it from there, and the route deletes it as soon as the worker has
answered.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

from ..utils.exceptions import FileTooLargeError, ProcessingError, ToolTimeoutError

logger = logging.getLogger(__name__)

_WORKER = Path(__file__).with_name("_hidden_text_worker.py")
# On the dev VM's ARM core, the class production runs on, an ordinary page
# takes 30 to 50 ms of CPU and 500 dense pages of 7,000 characters about 50 s.
# The time a check may take grows with the file, as Sanitize's does, so that a
# small file built to be slow (500 pages drawing one shared stream of 80 KB)
# cannot hold one of the heavy slots for long. The most stays inside the
# 120-second request timeout, which includes the upload.
TIME_LIMIT_BASE_SECONDS = 20
TIME_LIMIT_SECONDS_PER_MB = 12
TIME_LIMIT_MAX_SECONDS = 90
# The worker's own limit on pages (a test holds the two equal); the API
# catalog states it.
MAX_PAGES = 500
_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

# The words match safe_open_pdf's, which the other PDF tools use.
PASSWORD_MESSAGE = "This PDF is password-protected. Please unlock it first using the Unlock PDF tool."
CORRUPT_MESSAGE = "This PDF appears to be corrupt or invalid."
NO_PAGES_MESSAGE = "This PDF has no pages to check."
UNREADABLE_MESSAGE = "This PDF's pages could not be read, so nothing in it was checked. The file may be damaged."
TOO_BIG_MESSAGE = (
    "This PDF needs more memory to check than the server allows for one file. "
    "Split it into smaller parts with Split PDF and check each part."
)
TIMEOUT_MESSAGE = (
    "Checking this PDF took too long, so it was stopped. "
    "Split it into smaller parts with Split PDF and check each part."
)


class TooManyPagesError(FileTooLargeError):
    """More pages than the checker reads (HTTP 413)."""


def time_limit(size: int) -> float:
    """Seconds a check of a file of ``size`` bytes may take."""
    return min(TIME_LIMIT_MAX_SECONDS, TIME_LIMIT_BASE_SECONDS + TIME_LIMIT_SECONDS_PER_MB * size / 1_000_000)


def pages_message(pages: int, limit: int) -> str:
    return (f"This PDF has {pages:,} pages, and the checker reads at most {limit:,}. "
            "Split it into parts with Split PDF and check each part.")


def check_hidden_text(path: str) -> dict:
    """The hidden-text report for the PDF at ``path`` (the worker's, without "ok").

    Raises ValueError, with a message for the user, when the file needs a
    password, cannot be read, none of its pages can be read, or it has no
    pages; TooManyPagesError (413) past MAX_PAGES; FileTooLargeError (413)
    when it needs more memory than the worker may use; ToolTimeoutError (504)
    past ``time_limit``; and ProcessingError (500) on any other failure.
    """
    seconds = time_limit(os.path.getsize(path))
    try:
        process = subprocess.run(
            [sys.executable, "-I", str(_WORKER), path],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=seconds, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logger.warning("hidden-text: stopped after %.0f seconds", seconds)
        raise ToolTimeoutError(TIMEOUT_MESSAGE) from exc
    except OSError as exc:
        logger.exception("hidden-text: the worker could not run")
        raise ProcessingError() from exc

    outcome = _outcome(process)
    if outcome.get("ok") is True:
        outcome.pop("ok")
        return outcome
    error = outcome.get("error")
    if error == "password":
        raise ValueError(PASSWORD_MESSAGE)
    if error == "corrupt":
        raise ValueError(CORRUPT_MESSAGE)
    if error == "unreadable":
        raise ValueError(UNREADABLE_MESSAGE)
    if error == "no_pages":
        raise ValueError(NO_PAGES_MESSAGE)
    if error == "too_many_pages":
        pages, limit = outcome.get("pages"), outcome.get("limit")
        if isinstance(pages, int) and isinstance(limit, int):
            raise TooManyPagesError(pages_message(pages, limit))
    if error == "too_large":
        logger.warning("hidden-text: a %d-byte file needed more memory than allowed", os.path.getsize(path))
        raise FileTooLargeError(TOO_BIG_MESSAGE)
    logger.warning("hidden-text: the worker failed with exit status %s", process.returncode)
    raise ProcessingError()


def _outcome(process: subprocess.CompletedProcess) -> dict:
    """The worker's JSON answer, or ``{}`` when it crashed or answered badly."""
    if process.returncode != 0 or len(process.stdout) > _MAX_OUTPUT_BYTES:
        return {}
    try:
        payload = json.loads(process.stdout)
    except (ValueError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}
