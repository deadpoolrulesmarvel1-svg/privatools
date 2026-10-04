"""What a visitor is told when a PDF library cannot read their PDF.

pdf_read_error() is the PDF counterpart of utils.images.image_read_error. The
global catch-all and the catch-alls of the PDF routes ask it before they answer
500, so a PDF that is damaged, cut short by an interrupted download or locked
with a password gets the 400 the other PDF tools give, in the same words,
instead of "Processing failed. Please try again." and a retry that can never
work.
"""

from __future__ import annotations

from functools import cache

from .exceptions import PdfCorruptError, PdfEncryptedError, ToolError
from .images import _raised_in, _rewords

DAMAGED_MESSAGE = PdfCorruptError.default_detail
PASSWORD_MESSAGE = PdfEncryptedError.default_detail

# MuPDF's codes for input it cannot parse: FZ_ERROR_FORMAT and FZ_ERROR_SYNTAX.
# PyMuPDF raises some of its errors as a plain RuntimeError or ValueError that
# carries the code in its words, as len(doc) does for a page tree it cannot
# count: "code=7: Invalid number of pages".
_MUPDF_DAMAGE_CODES = ("code=7: ", "code=8: ")

# qpdf's words for two kinds of damage that pikepdf raises as a plain
# RuntimeError rather than a PdfError, because qpdf throws them as a C++
# runtime_error: a page tree it repaired that no longer matches its /Count,
# and a page's content stream it cannot decode when it writes that page into
# a form, as the tools that lay a stamp, a watermark or a signature over a
# page do; its writer names the form it was writing and repeats qpdf's own
# error. That writer wraps any error the same way, a disk fault reading the
# upload too, so the stream's words are matched at both ends.
_QPDF_PAGE_TREE_DAMAGE = "/Count is wrong after flattening pages tree"
_QPDF_STREAM_DAMAGE = ("error while getting stream data for ", ": errors while decoding content stream")


@cache
def _library_errors() -> tuple[tuple[type[BaseException], ...], tuple[type[BaseException], ...]]:
    """The PDF libraries' own errors for a file that needs a password, and for
    one they cannot parse."""
    import fitz  # PyMuPDF
    import pikepdf
    from pypdf import errors as pypdf_errors

    password = (
        pikepdf.PasswordError,
        pypdf_errors.FileNotDecryptedError,  # and WrongPasswordError
    )
    damage = (
        pikepdf.PdfError,  # qpdf could not make sense of it; DataDecodingError is one
        fitz.mupdf.FzErrorFormat,
        fitz.mupdf.FzErrorSyntax,
        pypdf_errors.PdfReadError,  # PdfStreamError and EmptyFileError are two
    )
    return password, damage


def pdf_read_error(exc: BaseException) -> tuple[int, str] | None:
    """The HTTP status and message for a PDF a library could not read, or None.

    By type: pikepdf's PdfError and PasswordError, MuPDF's format and syntax
    errors (what PyMuPDF's FileDataError is raised from when it cannot open a
    file), pypdf's PdfReadError and FileNotDecryptedError, and this app's own
    PdfCorruptError and PdfEncryptedError, which keep their words. By words: a
    RuntimeError or ValueError raised inside PyMuPDF whose message carries one
    of MuPDF's codes for damage, and a RuntimeError raised inside pikepdf with
    qpdf's words for a page tree or a content stream it cannot read. The
    answer is a 400 with the words the global handler always gave a PDF it
    could not read, "This PDF appears to be corrupt or invalid.", or "This PDF
    is password-protected. Unlock it first, then try again."; the frontend's
    friendlyError() turns them into its damaged-PDF advice (Repair PDF) and
    its password advice.

    Nothing is matched by type alone that a server fault can raise too: never a
    bare ValueError, RuntimeError or OSError, and never a FileDataError for
    itself, since PyMuPDF raises one for a file it could not open from a disk
    error or a missing permission as well; only the MuPDF error under it says
    which it was. Any other ToolError is an answer already and is left alone.

    An error raised `from` another is read with its cause, as safe_open_pdf's
    ValueError is with pikepdf's. One raised while another was being handled is
    read with that one only when its message repeats the other's, as a library
    that rewords what it caught does. Any other error raised in an `except`
    around a failed read, such as a KeyError in a fallback, is a fault of its
    own and stays a logged 500.

    By the time an error reaches the global catch-all, Starlette has re-raised
    it `from` its context (_unwrapped_from_a_group), so there a cause is read
    like a context, except PyMuPDF's FileDataError's, which it always sets.
    """
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        answer = _pdf_read_error(exc)
        if answer is not None:
            return answer
        if isinstance(exc, ToolError):
            return None
        cause = exc.__cause__
        if cause is not None and (
            not _unwrapped_from_a_group(exc)
            or _rewords(exc, cause)
            or isinstance(exc, _file_data_error())
        ):
            exc = cause
        elif exc.__suppress_context__ or not _rewords(exc, exc.__context__):
            exc = None
        else:
            exc = exc.__context__
    return None


def _unwrapped_from_a_group(exc: BaseException) -> bool:
    """Whether `exc` was re-raised by Starlette out of a task group, whose
    ExceptionGroup it was the only member of. Starlette raises it `from` its
    cause or else its context (starlette._utils.create_collapsing_task_group,
    under every BaseHTTPMiddleware), so a KeyError raised while a PdfError was
    being handled reached the global catch-all with that PdfError as its
    cause, and was answered as a damaged PDF."""
    group = exc.__context__
    return (
        exc.__suppress_context__
        and isinstance(group, BaseExceptionGroup)
        and any(inner is exc for inner in group.exceptions)
    )


@cache
def _file_data_error() -> type[BaseException]:
    import fitz  # PyMuPDF

    return fitz.FileDataError


def _pdf_read_error(exc: BaseException) -> tuple[int, str] | None:
    if isinstance(exc, (PdfCorruptError, PdfEncryptedError)):
        return exc.status_code, exc.detail
    password, damage = _library_errors()
    if isinstance(exc, password):
        return 400, PASSWORD_MESSAGE
    if isinstance(exc, damage):
        return 400, DAMAGED_MESSAGE
    if (
        isinstance(exc, (RuntimeError, ValueError))
        and str(exc).startswith(_MUPDF_DAMAGE_CODES)
        and _raised_in(exc, "pymupdf")
    ):
        return 400, DAMAGED_MESSAGE
    if isinstance(exc, RuntimeError) and _qpdf_damage(str(exc)) and _raised_in(exc, "pikepdf"):
        return 400, DAMAGED_MESSAGE
    return None


def _qpdf_damage(message: str) -> bool:
    start, end = _QPDF_STREAM_DAMAGE
    return message == _QPDF_PAGE_TREE_DAMAGE or (message.startswith(start) and message.endswith(end))


__all__ = ["DAMAGED_MESSAGE", "PASSWORD_MESSAGE", "pdf_read_error"]
