import uuid
import asyncio
import shutil
from pathlib import Path
from ..utils.cleanup import get_temp_path, ensure_temp_dir

ALLOWED_EXTENSIONS = {".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".odt", ".ods", ".odp"}


async def office_to_pdf(input_path: str) -> str:
    """Convert an Office document to PDF using LibreOffice headless."""
    ensure_temp_dir()
    temp_input = get_temp_path(f"office_{uuid.uuid4().hex}{Path(input_path).suffix}")
    shutil.copy2(input_path, str(temp_input))

    temp_dir = temp_input.parent
    # Per-conversion LibreOffice profile dir. Without this, LibreOffice tries
    # to create its first-run profile under $HOME — but the container's
    # appuser has no home dir, so that fails with "User installation could
    # not be completed" and the whole conversion bails out.
    #
    # The profile path MUST be absolute. Passing a relative path produces
    # `file://temp/...` which LibreOffice interprets as a URL with hostname
    # "temp" and silently hangs trying to resolve it.
    profile_dir = get_temp_path(f"lo_profile_{uuid.uuid4().hex}").resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)

    proc = await asyncio.create_subprocess_exec(
        "libreoffice",
        f"-env:UserInstallation=file://{profile_dir}",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(temp_dir),
        str(temp_input),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        proc.kill()
        raise Exception("LibreOffice conversion timed out")

    if proc.returncode != 0:
        raise Exception(f"LibreOffice conversion failed: {stderr.decode()}")

    output_path = temp_input.with_suffix(".pdf")
    if not output_path.exists():
        raise Exception("Conversion output file not found")

    return str(output_path)
