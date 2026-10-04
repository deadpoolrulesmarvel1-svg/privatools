"""Convert a PDF to Markdown in a separate, bounded process.

What is kept, and how it is found, is in ``_pdf_markdown_worker.py``, which
does the work. It runs there, not here, because the work grows with what the
pages hold, not with the file's size: every page's text is read character by
character, and pages with ruled lines are searched for tables. The worker
caps its own memory and CPU time (more pages, more time, up to a ceiling),
refuses files with more than MAX_PAGES pages before reading any, and this
module stops it after TIME_LIMIT_SECONDS. The web process never parses the
upload. Sanitize and the Hidden Text Checker work the same way.

Nothing is kept: the route streams the upload to a temporary file, the worker
reads it from there and writes the Markdown beside it, and both are deleted
once the answer has been sent.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
from pathlib import Path

from ..utils.cleanup import pages_lost_error, remove_files
from ..utils.exceptions import FileTooLargeError, ProcessingError, ToolError, ToolTimeoutError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)

_WORKER = Path(__file__).with_name("_pdf_markdown_worker.py")

# The worker's own limits (a test holds them equal); the API catalog and the
# page state them.
MAX_PAGES = 1000
CPU_SECONDS_BASE = 10
CPU_SECONDS_PER_PAGE = 0.12
CPU_SECONDS_MAX = 60
CHUNK_MIN, CHUNK_MAX, CHUNK_DEFAULT = 500, 50_000, 4000
# Wall-clock limit, inside the 120-second request timeout that includes the
# upload. CPU time is the real bound; this one stops a worker the machine is
# too busy to finish.
TIME_LIMIT_SECONDS = 90
_MAX_OUTPUT_BYTES = 64 * 1024
# How running out of memory can end the worker, besides saying so.
_OUT_OF_MEMORY_SIGNALS = frozenset({signal.SIGSEGV, signal.SIGBUS, signal.SIGABRT, signal.SIGKILL})

# The words match safe_open_pdf's, which the other PDF tools use, and pass
# through the page's friendlyError() as written.
PASSWORD_MESSAGE = "This PDF is password-protected. Please unlock it first using the Unlock PDF tool."
CORRUPT_MESSAGE = "This PDF appears to be corrupt or invalid."
NO_PAGES_MESSAGE = "This PDF has no pages to convert."
UNREADABLE_MESSAGE = "This PDF's pages could not be read, so nothing in it was converted. The file may be damaged."
SCAN_MESSAGE = (
    "This PDF's pages are pictures without a text layer, as a scan's are, so there is nothing to convert yet. "
    "Run the file through OCR PDF first, then convert the result."
)
BLANK_MESSAGE = "This PDF's pages are blank, so there is nothing to convert."
TOO_BIG_MESSAGE = (
    "This PDF is too big to convert in one piece on the server. "
    "Split it into smaller parts with Split PDF and convert each part."
)
TOO_SLOW_MESSAGE = (
    "Converting this PDF takes more processing time than the server allows for one file. "
    "Split it into smaller parts with Split PDF and convert each part."
)
TIMEOUT_MESSAGE = (
    "Converting this PDF took too long, so it was stopped. "
    "Split it into smaller parts with Split PDF and convert each part."
)


class TooManyPagesError(FileTooLargeError):
    """More pages than the converter reads (HTTP 413)."""


class UnconvertibleError(ToolError):
    """A readable PDF with nothing to convert, or more work than one file may take (HTTP 422)."""

    status_code = 422


def pages_message(pages: int, limit: int) -> str:
    return (f"This PDF has {pages:,} pages, and the converter reads at most {limit:,}. "
            "Split it into parts with Split PDF and convert each part.")


def cpu_budget(pages: int) -> int:
    """CPU seconds the worker allows a file of ``pages`` pages."""
    return int(min(CPU_SECONDS_MAX, CPU_SECONDS_BASE + CPU_SECONDS_PER_PAGE * pages))


def options(*, page_markers: bool = False, remove_headers_footers: bool = False, chunk: str = "none",
            chunk_size: int = CHUNK_DEFAULT, chunk_output: str = "zip") -> dict:
    """The worker's options, as the route received them (FastAPI has checked
    their values). The page sends every one; API callers get plain Markdown
    with nothing left out unless they ask."""
    return {
        "page_markers": bool(page_markers),
        "remove_headers_footers": bool(remove_headers_footers),
        "chunk": chunk,
        "chunk_size": int(chunk_size),
        "chunk_output": chunk_output,
    }


def is_zip(opts: dict) -> bool:
    return opts.get("chunk", "none") != "none" and opts.get("chunk_output", "zip") == "zip"


def convert(path: str, opts: dict) -> tuple[str, dict]:
    """Convert the PDF at ``path``; return the output file's path and the report.

    The output is Markdown, or a ZIP of Markdown chunks when ``opts`` asks for
    one. Raises ValueError, with a message for the user, when the file needs a
    password, cannot be read, none of its pages can be read, or it has no
    pages; TooManyPagesError (413) past MAX_PAGES; FileTooLargeError (413) when
    it needs more memory than the worker may use, or the worker crashes or is
    killed without an answer (how running out of memory can end it); UnconvertibleError (422) when
    it has no text to convert or needs more CPU time than its pages allow;
    ToolTimeoutError (504) past TIME_LIMIT_SECONDS; and ProcessingError (500)
    on any other failure.
    """
    target = temp_output("markdown", "zip" if is_zip(opts) else "md")
    try:
        process = subprocess.run(
            [sys.executable, "-I", str(_WORKER), path, str(target), json.dumps(opts)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=TIME_LIMIT_SECONDS, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        remove_files(target)
        logger.warning("pdf-to-markdown: stopped after %d seconds", TIME_LIMIT_SECONDS)
        raise ToolTimeoutError(TIMEOUT_MESSAGE) from exc
    except OSError as exc:
        remove_files(target)
        logger.exception("pdf-to-markdown: the worker could not run")
        raise ProcessingError() from exc

    if process.returncode == -signal.SIGXCPU:
        # The kernel stopped it at its CPU limit (SIGXCPU's default action).
        remove_files(target)
        logger.warning("pdf-to-markdown: a %d-byte file ran out of CPU time", os.path.getsize(path))
        raise UnconvertibleError(TOO_SLOW_MESSAGE)
    if -process.returncode in _OUT_OF_MEMORY_SIGNALS and not process.stdout.strip():
        # Crashed or killed before it answered. Under its memory limit MuPDF
        # cannot always report a failed allocation, and crashes instead; the
        # kernel's out-of-memory killer sends SIGKILL. A worker stopped by a
        # shutdown (SIGTERM, SIGINT) failed for no fault of the file's.
        remove_files(target)
        logger.warning("pdf-to-markdown: the worker died of signal %d on a %d-byte file",
                       -process.returncode, os.path.getsize(path))
        raise FileTooLargeError(TOO_BIG_MESSAGE)
    outcome = _outcome(process)
    if outcome.get("ok") is True and target.is_file():
        outcome.pop("ok")
        return str(target), outcome
    remove_files(target)
    error = outcome.get("error")
    if error == "password":
        raise ValueError(PASSWORD_MESSAGE)
    if error == "corrupt":
        raise ValueError(CORRUPT_MESSAGE)
    if error == "pages_lost":
        raise pages_lost_error(outcome.get("pages"), outcome.get("declared"))
    if error == "unreadable":
        raise ValueError(UNREADABLE_MESSAGE)
    if error == "no_pages":
        raise ValueError(NO_PAGES_MESSAGE)
    if error == "no_text":
        raise UnconvertibleError(SCAN_MESSAGE if outcome.get("kind") == "scan" else BLANK_MESSAGE)
    if error == "too_many_pages":
        pages, limit = outcome.get("pages"), outcome.get("limit")
        if isinstance(pages, int) and isinstance(limit, int):
            raise TooManyPagesError(pages_message(pages, limit))
    if error == "too_large":
        logger.warning("pdf-to-markdown: a %d-byte file needed more memory than allowed", os.path.getsize(path))
        raise FileTooLargeError(TOO_BIG_MESSAGE)
    logger.warning("pdf-to-markdown: the worker failed with exit status %s", process.returncode)
    raise ProcessingError()


def report_header(report: dict) -> str:
    """The report as a short JSON header (X-Markdown-Report), kept well under
    the proxy's header buffer: long lists are cut, with their full counts."""
    no_text = [p for p in report.get("pagesWithoutText", []) if isinstance(p, int)]
    not_read = [p for p in report.get("pagesNotRead", []) if isinstance(p, int)]
    removed = [str(t)[:80] for t in report.get("removedLines", [])][:3]
    compact = {
        "pages": report.get("pages", 0),
        "headings": report.get("headings", 0),
        "tables": report.get("tables", 0),
        "listItems": report.get("listItems", 0),
        "codeBlocks": report.get("codeBlocks", 0),
        "images": report.get("images", 0),
        "links": report.get("links", 0),
        "pagesWithoutText": no_text[:20],
        "pagesWithoutTextCount": len(no_text),
        "pagesNotRead": not_read[:20],
        "pagesNotReadCount": len(not_read),
        "headersFootersRemoved": report.get("headersFootersRemoved", 0),
        "removedLines": removed,
        "chunks": report.get("chunks", 1),
        "characters": report.get("characters", 0),
    }
    return json.dumps(compact, separators=(",", ":"))


def _outcome(process: subprocess.CompletedProcess) -> dict:
    """The worker's JSON answer, or ``{}`` when it crashed or answered badly."""
    if process.returncode != 0 or len(process.stdout) > _MAX_OUTPUT_BYTES:
        return {}
    try:
        payload = json.loads(process.stdout)
    except (ValueError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}
