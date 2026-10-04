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
    of MuPDF's codes for damage. The answer is a 400 with the words the global
    handler always gave a PDF it could not read, "This PDF appears to be
    corrupt or invalid.", or "This PDF is password-protected. Unlock it first,
    then try again."; the frontend's friendlyError() turns them into its
    damaged-PDF advice (Repair PDF) and its password advice.

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
    """
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        answer = _pdf_read_error(exc)
        if answer is not None:
            return answer
        if isinstance(exc, ToolError):
            return None
        if exc.__cause__ is not None:
            exc = exc.__cause__
        elif exc.__suppress_context__ or not _rewords(exc, exc.__context__):
            exc = None
        else:
            exc = exc.__context__
    return None


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
    return None


__all__ = ["DAMAGED_MESSAGE", "PASSWORD_MESSAGE", "pdf_read_error"]
