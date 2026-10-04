"""pdf_read_error: a PDF a library cannot read is a 400 that says so, and
nothing else is.

A PDF cut short by an interrupted download made 47 PDF routes answer 500,
"Processing failed. Please try again.", a retry that can never work. The
libraries say what is wrong in their own ways: pikepdf raises PdfError,
MuPDF a format or syntax error (under PyMuPDF's FileDataError when it cannot
open the file at all) or a RuntimeError carrying MuPDF's code, and pypdf a
PdfReadError. pdf_read_error() reads each of them, from real damaged and
locked files below, and the global catch-all asks it. Unrelated faults, and a
bug raised while a PDF error was being handled, stay a logged 500.
"""

from __future__ import annotations

import asyncio
import io
import os

import fitz  # PyMuPDF
import pikepdf
import pypdf
import pytest

from backend.app.middleware.error_handlers import builtin_exception_handler
from backend.app.utils.cleanup import _DAMAGED_PDF, safe_open_pdf
from backend.app.utils.exceptions import PdfCorruptError, PdfEncryptedError, ProcessingError
from backend.app.utils.pdf_errors import DAMAGED_MESSAGE, PASSWORD_MESSAGE, pdf_read_error

DAMAGED = (400, "This PDF appears to be corrupt or invalid.")
LOCKED = (400, "This PDF is password-protected. Unlock it first, then try again.")


def _classic() -> bytes:
    doc = fitz.open()
    for i in range(4):
        doc.new_page().insert_text((72, 100), f"Page {i + 1}. " + "Words of the contract. " * 8, fontsize=11)
    data = doc.tobytes(garbage=0, deflate=True)
    doc.close()
    return data


def _object_streams() -> bytes:
    buf = io.BytesIO()
    with pikepdf.open(io.BytesIO(_classic())) as pdf:
        pdf.save(buf, object_stream_mode=pikepdf.ObjectStreamMode.generate, deterministic_id=True)
    return buf.getvalue()


def _cut(data: bytes, percent: int) -> bytes:
    return data[: len(data) * percent // 100]


def _cut_after_the_page_list() -> bytes:
    whole = _classic()
    return whole[: whole.index(b"endobj", whole.index(b"/Type/Pages")) + len(b"endobj")]


def _raised(action) -> BaseException:
    with pytest.raises(BaseException) as caught:
        action()
    return caught.value


def test_the_words_are_the_ones_the_pdf_tools_already_use():
    assert (400, DAMAGED_MESSAGE) == DAMAGED
    assert (400, PASSWORD_MESSAGE) == LOCKED


# ── pikepdf ─────────────────────────────────────────────────────────────────

def test_pikepdf_cannot_read_a_cut_file():
    exc = _raised(lambda: pikepdf.open(io.BytesIO(_cut(_classic(), 5))))
    assert isinstance(exc, pikepdf.PdfError)
    assert pdf_read_error(exc) == DAMAGED


def test_pikepdf_needs_the_password(locked_pdf):
    exc = _raised(lambda: pikepdf.open(io.BytesIO(locked_pdf)))
    assert isinstance(exc, pikepdf.PasswordError)
    assert pdf_read_error(exc) == LOCKED


def test_safe_open_pdfs_value_errors_are_read_with_their_cause(tmp_path, locked_pdf):
    cut = tmp_path / "cut.pdf"
    cut.write_bytes(_cut(_object_streams(), 40))
    locked = tmp_path / "locked.pdf"
    locked.write_bytes(locked_pdf)
    damaged = _raised(lambda: safe_open_pdf(str(cut)))
    needs_password = _raised(lambda: safe_open_pdf(str(locked)))
    assert type(damaged) is ValueError and type(needs_password) is ValueError
    assert pdf_read_error(damaged) == DAMAGED
    assert pdf_read_error(needs_password) == LOCKED


# ── MuPDF ───────────────────────────────────────────────────────────────────

def test_mupdf_cannot_open_a_cut_file():
    exc = _raised(lambda: fitz.open(stream=_cut(_classic(), 5), filetype="pdf"))
    assert isinstance(exc, fitz.FileDataError)
    assert isinstance(exc.__cause__, fitz.mupdf.FzErrorSyntax)
    assert pdf_read_error(exc) == DAMAGED


def test_mupdf_cannot_parse_an_object_of_a_repaired_file():
    doc = fitz.open(stream=_cut(_object_streams(), 20), filetype="pdf")
    exc = _raised(doc.tobytes)
    assert isinstance(exc, fitz.mupdf.FzErrorFormat), exc
    assert pdf_read_error(exc) == DAMAGED


def test_mupdf_cannot_count_the_pages_of_a_file_cut_after_its_page_list():
    doc = fitz.open(stream=_cut_after_the_page_list(), filetype="pdf")
    exc = _raised(lambda: len(doc))
    # PyMuPDF raises this one as a plain RuntimeError with MuPDF's code.
    assert type(exc) is RuntimeError and str(exc).startswith("code=7: ")
    assert pdf_read_error(exc) == DAMAGED


# ── pypdf ───────────────────────────────────────────────────────────────────

def test_pypdf_cannot_read_a_cut_file():
    exc = _raised(lambda: [page.extract_text() for page in pypdf.PdfReader(io.BytesIO(_cut(_classic(), 50))).pages])
    assert isinstance(exc, pypdf.errors.PdfStreamError)
    assert pdf_read_error(exc) == DAMAGED


def test_pypdf_needs_the_password(locked_pdf):
    unopened = _raised(lambda: [page.extract_text() for page in pypdf.PdfReader(io.BytesIO(locked_pdf)).pages])
    wrong = _raised(lambda: pypdf.PdfReader(io.BytesIO(locked_pdf), password="not it"))
    assert isinstance(unopened, pypdf.errors.FileNotDecryptedError)
    assert isinstance(wrong, pypdf.errors.WrongPasswordError)
    assert pdf_read_error(unopened) == LOCKED
    assert pdf_read_error(wrong) == LOCKED


# ── The app's own answers ───────────────────────────────────────────────────

def test_the_apps_own_refusals_keep_their_words():
    assert pdf_read_error(PdfCorruptError(_DAMAGED_PDF)) == (400, _DAMAGED_PDF)
    assert pdf_read_error(PdfCorruptError()) == DAMAGED
    assert pdf_read_error(PdfEncryptedError()) == LOCKED


def test_any_other_tool_error_is_an_answer_already():
    try:
        try:
            pikepdf.open(io.BytesIO(_cut(_classic(), 5)))
        except pikepdf.PdfError as exc:
            raise ProcessingError("The service chose this answer.") from exc
    except ProcessingError as exc:
        assert pdf_read_error(exc) is None


# ── What is not a PDF that cannot be read ───────────────────────────────────

@pytest.mark.parametrize("exc", [
    ValueError("max_size_mb must be > 0"),
    ValueError(""),
    RuntimeError("boom"),
    OSError(5, "Input/output error"),
    OSError(28, "No space left on device"),
    PermissionError(13, "Permission denied"),
    KeyError("/Root"),
    MemoryError(),
], ids=lambda e: type(e).__name__ + (f"-{e}" if str(e) else ""))
def test_a_plain_error_is_never_read_by_its_type(exc):
    assert pdf_read_error(exc) is None


def test_mupdf_failing_to_open_a_file_it_may_not_read_is_the_servers_fault(tmp_path):
    path = tmp_path / "unreadable.pdf"
    path.write_bytes(_classic())
    os.chmod(path, 0)
    try:
        if os.access(path, os.R_OK):
            pytest.skip("this user can read a file without permission (root)")
        exc = _raised(lambda: fitz.open(str(path)))
    finally:
        os.chmod(path, 0o600)
    assert isinstance(exc, fitz.FileDataError)
    assert isinstance(exc.__cause__, fitz.mupdf.FzErrorSystem)
    assert pdf_read_error(exc) is None


def test_mupdf_given_a_directory_is_the_servers_fault(tmp_path):
    exc = _raised(lambda: fitz.open(str(tmp_path)))
    assert isinstance(exc, fitz.FileDataError)
    assert pdf_read_error(exc) is None


def test_a_missing_file_is_not_a_damaged_pdf(tmp_path):
    for opener in (fitz.open, pikepdf.open, pypdf.PdfReader):
        exc = _raised(lambda: opener(str(tmp_path / "gone.pdf")))
        assert pdf_read_error(exc) is None, opener


def test_mupdfs_other_codes_are_not_read_as_damage():
    # "not a dict (null)": MuPDF's argument error, from changing a page of a
    # repaired file. Damage there, but the same code covers a call that is
    # simply wrong; process_pdf tells the two apart by whether MuPDF had to
    # repair the file.
    doc = fitz.open(stream=_cut(_object_streams(), 20), filetype="pdf")
    exc = _raised(lambda: doc[0].insert_text((72, 72), "a stamp"))
    assert isinstance(exc, fitz.mupdf.FzErrorArgument), exc
    assert pdf_read_error(exc) is None


def test_mupdfs_words_count_only_when_mupdf_said_them():
    assert pdf_read_error(RuntimeError("code=7: Invalid number of pages")) is None


def test_an_unrelated_error_raised_while_handling_a_pdf_error_stays_a_500():
    try:
        try:
            pikepdf.open(io.BytesIO(_cut(_classic(), 5)))
        except pikepdf.PdfError:
            {}["fallback"]  # a bug in the code that handles the PDF error
    except KeyError as bug:
        assert isinstance(bug.__context__, pikepdf.PdfError)
        assert pdf_read_error(bug) is None
        assert _status(bug) == (500, "Processing failed. Please try again.")


def test_an_error_that_rewords_the_pdf_error_it_caught_is_read_with_it():
    try:
        try:
            fitz.open(stream=_cut_after_the_page_list(), filetype="pdf").page_count
        except RuntimeError as inner:
            raise ValueError(f"Could not read the pages: {inner}")
    except ValueError as outer:
        assert pdf_read_error(outer) == DAMAGED


def test_an_error_that_suppresses_the_pdf_error_is_not_read_with_it():
    try:
        try:
            pikepdf.open(io.BytesIO(_cut(_classic(), 5)))
        except pikepdf.PdfError as inner:
            raise RuntimeError(f"failed: {inner}") from None
    except RuntimeError as outer:
        assert pdf_read_error(outer) is None


# ── The global catch-all ────────────────────────────────────────────────────

class _Req:
    class state:  # noqa: D401 — mimic starlette Request.state surface
        request_id = "test-rid"

    url = type("U", (), {"path": "/api/test"})()
    method = "POST"


def _status(exc) -> tuple[int, str]:
    import json

    response = asyncio.run(builtin_exception_handler(_Req(), exc))
    return response.status_code, json.loads(response.body)["detail"]


def test_the_global_catch_all_answers_every_librarys_damage_with_a_400():
    samples = [
        _raised(lambda: pikepdf.open(io.BytesIO(_cut(_classic(), 5)))),
        _raised(lambda: fitz.open(stream=_cut(_classic(), 5), filetype="pdf")),
        _raised(fitz.open(stream=_cut(_object_streams(), 20), filetype="pdf").tobytes),
        _raised(lambda: len(fitz.open(stream=_cut_after_the_page_list(), filetype="pdf"))),
        _raised(lambda: [p.extract_text() for p in pypdf.PdfReader(io.BytesIO(_cut(_classic(), 50))).pages]),
    ]
    assert [_status(exc) for exc in samples] == [DAMAGED] * len(samples)


def test_the_global_catch_all_keeps_the_password_case(locked_pdf):
    samples = [
        _raised(lambda: pikepdf.open(io.BytesIO(locked_pdf))),
        _raised(lambda: [p.extract_text() for p in pypdf.PdfReader(io.BytesIO(locked_pdf)).pages]),
    ]
    assert [_status(exc) for exc in samples] == [LOCKED] * len(samples)
