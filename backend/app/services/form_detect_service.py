"""Find likely form fields in a PDF drawn as a form, in a separate, bounded process.

How fields are found is in ``_form_detect_worker.py``, which does the work.
It runs there, not here, because the work grows with what the pages draw,
not with the file's size: a small file can draw one shape a million times.
The worker caps its own memory and CPU time (more pages, more time, up to a
ceiling) and this module stops it after TIME_LIMIT_SECONDS. The web process
only opens the upload to give the answers every PDF tool gives (a password,
damage, no pages; ``open_pdf_document``) and to count its pages, refusing
more than MAX_PAGES before any page is read. PDF to Markdown and the Hidden
Text Checker work the same way.

The limits, measured on the ARM cores production runs on: a form page takes
5 to 10 ms of CPU, a page of dense text about 70 ms, so 50 pages take at most
a few seconds. The page limit keeps the review to what a person can check,
and Form Creator takes at most 300 fields in one request anyway.

Nothing is kept: the route streams the upload to a temporary file, the worker
reads it from there, and the route deletes it as soon as the worker has
answered.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
from pathlib import Path

from ..utils.cleanup import _DAMAGED_PDF, NO_PAGES_MESSAGE, open_pdf_document
from ..utils.exceptions import (
    FileTooLargeError, PdfCorruptError, PdfEncryptedError, ProcessingError, ToolError, ToolTimeoutError,
    ValidationError,
)

logger = logging.getLogger(__name__)

_WORKER = Path(__file__).with_name("_form_detect_worker.py")

# The worker's own limits (a test holds them equal); the API catalog and the
# guide state them.
MAX_PAGES = 50
CPU_SECONDS_BASE = 5
CPU_SECONDS_PER_PAGE = 0.5
CPU_SECONDS_MAX = 30
MAX_CANDIDATES = 300
# Wall-clock limit, inside the 120-second request timeout that includes the
# upload. CPU time is the real bound; this one stops a worker the machine is
# too busy to finish.
TIME_LIMIT_SECONDS = 60
_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
# How running out of memory can end the worker, besides saying so.
_OUT_OF_MEMORY_SIGNALS = frozenset({signal.SIGSEGV, signal.SIGBUS, signal.SIGABRT, signal.SIGKILL})

BY_HAND = "Place the fields by hand: choose Draw a field and drag a box on the page."
SCAN_MESSAGE = (
    "This PDF's pages are pictures, as a scan's are, so there are no drawn lines, boxes or labels "
    "to find fields in. OCR PDF would add text, not lines, so it would not help here. " + BY_HAND
)
TOO_BIG_MESSAGE = "This PDF is too big to look for fields in on the server. " + BY_HAND
TOO_SLOW_MESSAGE = (
    "Looking for fields in this PDF takes more processing time than the server allows for one file. "
    + BY_HAND
)
TIMEOUT_MESSAGE = "Looking for fields in this PDF took too long, so it was stopped. " + BY_HAND


class TooManyPagesError(FileTooLargeError):
    """More pages than detection reads (HTTP 413)."""


class UndetectableError(ToolError):
    """A readable PDF with nothing to find fields in (a scan), or more work
    than one file may take (HTTP 422)."""

    status_code = 422


def pages_message(pages: int, limit: int = MAX_PAGES) -> str:
    return (f"This PDF has {pages:,} pages, and field detection reads at most {limit:,}. "
            "Place the fields by hand, or detect them in a shorter copy made with Split PDF.")


def cpu_budget(pages: int) -> int:
    """CPU seconds the worker allows a file of ``pages`` pages."""
    return int(min(CPU_SECONDS_MAX, CPU_SECONDS_BASE + CPU_SECONDS_PER_PAGE * pages))


def detect_fields(path: str) -> dict:
    """The likely form fields in the PDF at ``path``: the worker's report,
    without "ok".

    Raises PdfEncryptedError, PdfCorruptError or ValidationError (400) as
    open_pdf_document does for a PDF that needs a password, cannot be read,
    or has no pages, and PdfCorruptError for one whose pages cannot be read;
    TooManyPagesError (413) past MAX_PAGES; FileTooLargeError (413) when it
    needs more memory than the worker may use, or the worker is killed
    without an answer (how running out of memory can end it);
    UndetectableError (422) when every page is a picture and nothing was
    found, or it needs more CPU time than its pages allow; ToolTimeoutError
    (504) past TIME_LIMIT_SECONDS; and ProcessingError (500) on any other
    failure.
    """
    doc = open_pdf_document(path)
    try:
        pages = doc.page_count
    finally:
        doc.close()
    if pages > MAX_PAGES:
        raise TooManyPagesError(pages_message(pages))
    try:
        process = subprocess.run(
            [sys.executable, "-I", str(_WORKER), path],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=TIME_LIMIT_SECONDS, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logger.warning("form-detect: stopped after %d seconds", TIME_LIMIT_SECONDS)
        raise ToolTimeoutError(TIMEOUT_MESSAGE) from exc
    except OSError as exc:
        logger.exception("form-detect: the worker could not run")
        raise ProcessingError() from exc

    if process.returncode == -signal.SIGXCPU:
        # The kernel stopped it at its CPU limit (SIGXCPU's default action).
        logger.warning("form-detect: a %d-byte file ran out of CPU time", os.path.getsize(path))
        raise UndetectableError(TOO_SLOW_MESSAGE)
    if -process.returncode in _OUT_OF_MEMORY_SIGNALS and not process.stdout.strip():
        # Crashed or killed before it answered. Under its memory limit MuPDF
        # cannot always report a failed allocation, and crashes instead; the
        # kernel's out-of-memory killer sends SIGKILL.
        logger.warning("form-detect: the worker died of signal %d on a %d-byte file",
                       -process.returncode, os.path.getsize(path))
        raise FileTooLargeError(TOO_BIG_MESSAGE)
    outcome = _outcome(process)
    if outcome.get("ok") is True:
        outcome.pop("ok")
        if not outcome.get("candidates") and outcome.get("scanPages") \
                and len(outcome["scanPages"]) == outcome.get("pages"):
            raise UndetectableError(SCAN_MESSAGE)
        return outcome
    error = outcome.get("error")
    if error == "password":
        raise PdfEncryptedError()
    if error in ("corrupt", "unreadable"):
        raise PdfCorruptError(_DAMAGED_PDF)
    if error == "no_pages":
        raise ValidationError(NO_PAGES_MESSAGE)
    if error == "too_many_pages":
        found, limit = outcome.get("pages"), outcome.get("limit")
        if isinstance(found, int) and isinstance(limit, int):
            raise TooManyPagesError(pages_message(found, limit))
    if error == "too_large":
        logger.warning("form-detect: a %d-byte file needed more memory than allowed", os.path.getsize(path))
        raise FileTooLargeError(TOO_BIG_MESSAGE)
    logger.warning("form-detect: the worker failed with exit status %s", process.returncode)
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
