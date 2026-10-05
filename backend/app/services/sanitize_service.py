"""Sanitize a PDF in a separate, bounded process.

What goes is listed in ``_sanitize_worker.py``, which does the work. It runs
there, not here, because sanitizing costs what the file expands to rather than
what it weighs: removing layers decodes and parses every content stream, and
every object is walked. A 300 KB upload that inflates to 300 MB took this
process from 61 MB to 689 MB. The worker caps its own memory and CPU time,
this module stops it after a time limit, and the web process never parses the
upload. The signature checker and the QR reader work the same way.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

from ..utils.cleanup import pages_lost_error, remove_files
from ..utils.exceptions import FileTooLargeError, ProcessingError, ToolTimeoutError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)

_SANITIZE_WORKER = Path(__file__).with_name("_sanitize_worker.py")
# A 150 MB, 1,000-page file takes a few seconds. The limit grows with the
# file and stays well inside the 120-second request timeout.
_SANITIZE_SECONDS_BASE = 20
_SANITIZE_SECONDS_PER_MB = 0.2
_SANITIZE_SECONDS_MAX = 90
_MAX_OUTPUT_BYTES = 4096

# The words match safe_open_pdf's, which the other PDF tools use.
PASSWORD_MESSAGE = "This PDF is password-protected. Please unlock it first using the Unlock PDF tool."
CORRUPT_MESSAGE = "This PDF appears to be corrupt or invalid."
# "damaged" is what the frontend's friendlyError() turns into a pointer to Repair PDF.
UNREADABLE_CONTENT_MESSAGE = (
    "Some of this PDF's page content is damaged and could not be read, so its hidden layers "
    "could not be removed."
)
TOO_LARGE_MESSAGE = (
    "This PDF is too large to sanitize safely: its page content expands to more than the "
    "server allows for one file."
)
TIMEOUT_MESSAGE = "Sanitizing this PDF took too long, so it was stopped. Try a smaller file."


def _time_limit(size: int) -> float:
    return min(_SANITIZE_SECONDS_MAX, _SANITIZE_SECONDS_BASE + _SANITIZE_SECONDS_PER_MB * size / 1_000_000)


def sanitize_pdf(data: bytes) -> str:
    """Write a sanitized copy of the PDF in ``data`` to a temp file and return its path.

    Raises ValueError, with a message for the user, when the file needs a
    password to open, cannot be read, or has layered content that will not
    parse (skipping it would leave its hidden layers in place);
    FileTooLargeError (413) when its content is too large to process within
    the worker's limits; ToolTimeoutError (504) when the work runs past its
    time limit; and ProcessingError (500) on any other failure.
    """
    source = temp_output("sanitize-in", "pdf")
    target = temp_output("sanitized", "pdf")
    limit = _time_limit(len(data))
    try:
        source.write_bytes(data)
        process = subprocess.run(
            [sys.executable, "-I", str(_SANITIZE_WORKER), str(source), str(target)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=limit, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        remove_files(target)
        logger.warning("sanitize: stopped after %.0f seconds", limit)
        raise ToolTimeoutError(TIMEOUT_MESSAGE) from exc
    except OSError as exc:
        remove_files(target)
        logger.exception("sanitize: the worker could not run")
        raise ProcessingError() from exc
    finally:
        remove_files(source)

    outcome = _outcome(process)
    if outcome.get("ok") is True and target.is_file():
        return str(target)
    remove_files(target)
    error = outcome.get("error")
    if error == "password":
        raise ValueError(PASSWORD_MESSAGE)
    if error == "corrupt":
        raise ValueError(CORRUPT_MESSAGE)
    if error == "pages_lost":
        raise pages_lost_error(outcome.get("pages"), outcome.get("declared"))
    if error == "unreadable_content":
        raise ValueError(UNREADABLE_CONTENT_MESSAGE)
    if error == "too_large":
        logger.warning("sanitize: refused a %d-byte file whose content is too large to sanitize", len(data))
        raise FileTooLargeError(TOO_LARGE_MESSAGE)
    logger.warning("sanitize: the worker failed with exit status %s", process.returncode)
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
