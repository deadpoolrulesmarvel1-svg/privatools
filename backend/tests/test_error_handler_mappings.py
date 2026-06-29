"""Tests for builtin_exception_handler's exception→HTTP-status mapping.

The dispatcher matches well-known exceptions (by type or class name) to friendly
status codes the frontend's friendlyError() relies on. The audit noted only one
branch was covered; these pin the rest so a reordering/regression is caught.
"""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.middleware.error_handlers import builtin_exception_handler


class _Req:
    class state:  # noqa: D401 — mimic starlette Request.state surface
        request_id = "test-rid"

    url = type("U", (), {"path": "/api/test"})()
    method = "POST"


def _status(exc) -> int:
    return asyncio.run(builtin_exception_handler(_Req(), exc)).status_code


# Name-matched branches — the handler keys on type(exc).__name__, so locally
# defined classes with the right names exercise them without the real libs.
class DecompressionBombError(Exception):
    pass


class PasswordError(Exception):
    pass


class PdfError(Exception):
    pass


class CalledProcessError(Exception):
    pass


class TestErrorHandlerMappings:
    def test_decompression_bomb_is_413(self):
        assert _status(DecompressionBombError("bomb")) == 413

    def test_password_error_is_400(self):
        assert _status(PasswordError("encrypted")) == 400

    def test_pdf_error_is_400(self):
        assert _status(PdfError("corrupt")) == 400

    def test_file_not_found_is_400(self):
        assert _status(FileNotFoundError("missing")) == 400

    def test_permission_error_is_500(self):
        assert _status(PermissionError("denied")) == 500

    def test_memory_error_is_413(self):
        assert _status(MemoryError()) == 413

    def test_timeout_error_is_504(self):
        assert _status(TimeoutError("slow")) == 504

    def test_not_implemented_is_501(self):
        assert _status(NotImplementedError()) == 501

    def test_subprocess_failure_is_500(self):
        assert _status(CalledProcessError("ffmpeg exited 1")) == 500

    def test_value_error_with_message_is_400(self):
        assert _status(ValueError("max_size_mb must be > 0")) == 400

    def test_value_error_without_message_is_500(self):
        # No useful message → don't surface raw internals; generic 500.
        assert _status(ValueError("")) == 500

    def test_unknown_exception_is_generic_500(self):
        assert _status(RuntimeError("boom")) == 500
