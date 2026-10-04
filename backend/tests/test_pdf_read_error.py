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


def _page_tree_overwritten() -> bytes:
    # Bytes overwritten in the page tree, as in the #340 review's byte-flip
    # sweep: its /Count key and its first page reference.
    whole = _classic()
    assert whole.count(b"/Count 4/Kids[4 0 R") == 1
    return whole.replace(b"/Count 4/Kids[4 0 R", b"/Cxunt 4/Kids[4 02R")


def _content_overwritten() -> bytes:
    # Ten bytes overwritten inside the first page's compressed content.
    whole = bytearray(_classic())
    start = whole.index(b"stream\n", whole.index(b"\n6 0 obj")) + len(b"stream\n")
    whole[start + 2:start + 12] = b"A" * 10
    return bytes(whole)


def _overlaid_and_saved(data: bytes) -> None:
    """What Watermark, Bates Numbering and the other stamping tools do: lay a
    page over the first page, which makes that page's content a form, and
    save."""
    stamp = pikepdf.new()
    stamp.add_blank_page()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pdf.pages[0].add_overlay(stamp.pages[0])
        pdf.save(io.BytesIO())


def test_qpdf_cannot_reconcile_a_page_tree_with_its_count():
    # qpdf raises this one as a plain RuntimeError, not a PdfError.
    exc = _raised(lambda: pikepdf.open(io.BytesIO(_page_tree_overwritten())))
    assert type(exc) is RuntimeError and str(exc) == "/Count is wrong after flattening pages tree"
    assert pdf_read_error(exc) == DAMAGED


def test_qpdf_cannot_decode_a_page_it_writes_into_a_form():
    exc = _raised(lambda: _overlaid_and_saved(_content_overwritten()))
    assert type(exc) is RuntimeError and str(exc).startswith("error while getting stream data for "), exc
    assert pdf_read_error(exc) == DAMAGED


def _raised_in_pikepdf(message: str) -> RuntimeError:
    """A RuntimeError raised, by its traceback, in pikepdf's own code, where
    qpdf's errors surface."""
    code = compile(f"raise RuntimeError({message!r})", "pikepdf/_methods.py", "exec")
    return _raised(lambda: exec(code, {"__name__": "pikepdf._methods"}))


@pytest.mark.parametrize("message", [
    # qpdf's writer wraps any error met while it reads a stream: a disk fault
    # reading the upload is the server's, not the file's.
    "error while getting stream data for 20 0 R: /app/temp/upload.pdf: read: Input/output error",
    "QPDFWriter: unable to generated a deterministic ID because the file to be written is encrypted",
    "boom",
])
def test_qpdfs_other_words_are_not_read_as_damage(message):
    assert pdf_read_error(_raised_in_pikepdf(message)) is None


def test_qpdfs_words_count_only_when_pikepdf_raised_them():
    assert pdf_read_error(_raised_in_pikepdf("/Count is wrong after flattening pages tree")) == DAMAGED
    assert pdf_read_error(RuntimeError("/Count is wrong after flattening pages tree")) is None
    assert pdf_read_error(RuntimeError(
        "error while getting stream data for 20 0 R: content stream (content stream object 6 0): "
        "errors while decoding content stream")) is None


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


def test_open_pdf_document_leaves_a_file_it_may_not_read_the_servers_fault(tmp_path):
    from backend.app.utils.cleanup import open_pdf_document

    path = tmp_path / "unreadable.pdf"
    path.write_bytes(_classic())
    os.chmod(path, 0)
    try:
        if os.access(path, os.R_OK):
            pytest.skip("this user can read a file without permission (root)")
        exc = _raised(lambda: open_pdf_document(str(path)))
    finally:
        os.chmod(path, 0o600)
    assert pdf_read_error(exc) is None
    assert pdf_read_error(_raised(lambda: open_pdf_document(str(tmp_path)))) is None
    # The file's own faults are still refused as damaged.
    assert pdf_read_error(_raised(lambda: open_pdf_document(_cut(_classic(), 5)))) == DAMAGED
    assert pdf_read_error(_raised(lambda: open_pdf_document(b""))) == DAMAGED


def _repaired_but_valid() -> bytes:
    # Bytes after %%EOF: valid, and MuPDF opens it "repaired", as it does
    # pdfunite's output and files with junk before the header.
    data = _classic() + b"\n" + bytes(range(256)) * 40
    assert fitz.open(stream=data, filetype="pdf").is_repaired
    return data


@pytest.mark.parametrize("rebuild", [False, True])
def test_process_pdf_leaves_a_tools_own_error_on_a_repaired_file_its_own(rebuild):
    from backend.app.utils.cleanup import process_pdf

    def work(doc):
        return float("a value from the request")

    exc = _raised(lambda: process_pdf(_repaired_but_valid(), work, rebuild=rebuild))
    assert type(exc) is ValueError
    assert pdf_read_error(exc) is None


def test_process_pdf_still_calls_pymupdfs_error_on_a_repaired_file_damage():
    from backend.app.utils.cleanup import process_pdf

    def work(doc):
        doc[0].insert_text((72, 72), "a stamp")  # "not a dict (null)" on this file

    exc = _raised(lambda: process_pdf(_cut(_object_streams(), 20), work, rebuild=False))
    assert isinstance(exc, PdfCorruptError)


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


def _through_the_app(monkeypatch, fails) -> int:
    """What the app answers when `fails` raises inside a route that catches
    nothing (Image Compressor), so the global catch-all answers, behind every
    middleware, as in production."""
    from fastapi.testclient import TestClient
    from PIL import Image

    from backend.app import main

    monkeypatch.setattr(Image, "open", fails)
    client = TestClient(main.app, raise_server_exceptions=False)
    return client.post("/api/image-compressor", files={"file": ("photo.png", b"\x89PNG\r\n\x1a\n", "image/png")}).status_code


def test_a_bug_raised_while_handling_a_pdf_error_stays_a_500_behind_the_middleware(monkeypatch):
    # Starlette re-raises a route's error out of each BaseHTTPMiddleware's task
    # group `from` its context, so the global catch-all saw the PdfError this
    # KeyError was raised while handling as its cause, and answered 400.
    def fails(*_args, **_kwargs):
        try:
            pikepdf.open(io.BytesIO(_cut(_classic(), 5)))
        except pikepdf.PdfError:
            {}["fallback"]

    assert _through_the_app(monkeypatch, fails) == 500


def test_a_damaged_pdf_is_still_a_400_behind_the_middleware(monkeypatch):
    def fitz_fails(*_args, **_kwargs):
        fitz.open(stream=_cut(_classic(), 5), filetype="pdf")

    def pikepdf_fails(*_args, **_kwargs):
        pikepdf.open(io.BytesIO(_cut(_classic(), 5)))

    assert _through_the_app(monkeypatch, fitz_fails) == 400
    assert _through_the_app(monkeypatch, pikepdf_fails) == 400


def test_the_global_catch_all_keeps_the_password_case(locked_pdf):
    samples = [
        _raised(lambda: pikepdf.open(io.BytesIO(locked_pdf))),
        _raised(lambda: [p.extract_text() for p in pypdf.PdfReader(io.BytesIO(locked_pdf)).pages]),
    ]
    assert [_status(exc) for exc in samples] == [LOCKED] * len(samples)
