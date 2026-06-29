"""P1 D2/D3: office_to_pdf must clean its intermediate input copy on every
path. The route only knows the original upload + the returned PDF, so the
service-created office_*.<ext> copy leaks unless the service removes it."""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services import office_to_pdf_service as svc
from backend.app.utils.exceptions import ExternalToolError


class _FailingProc:
    """Stand-in for the LibreOffice subprocess that exits non-zero."""

    returncode = 1

    async def communicate(self):
        return (b"", b"some chatty init noise\nfinal error line")

    def kill(self):  # pragma: no cover - only the timeout path calls this
        pass


def test_intermediate_copy_removed_on_conversion_failure(tmp_path, monkeypatch):
    src = tmp_path / "in.docx"
    src.write_bytes(b"PK\x03\x04 not a real docx but enough to copy")

    captured: dict[str, Path] = {}
    real_temp_output = svc.temp_output

    def spy_temp_output(prefix, ext=""):
        p = real_temp_output(prefix, ext)
        if prefix == "office":
            captured["temp_input"] = Path(p)
        return p

    async def fake_exec(*args, **kwargs):
        return _FailingProc()

    monkeypatch.setattr(svc, "temp_output", spy_temp_output)
    monkeypatch.setattr(svc.asyncio, "create_subprocess_exec", fake_exec)

    try:
        asyncio.run(svc.office_to_pdf(str(src)))
    except ExternalToolError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected ExternalToolError on non-zero exit")

    temp_input = captured.get("temp_input")
    assert temp_input is not None, "service never created its intermediate copy"
    assert not temp_input.exists(), f"intermediate copy leaked: {temp_input}"
