"""Non-PDF tool routes: image, video/audio, and archive processing."""

import asyncio
import io
import logging
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import PurePosixPath

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..rate_limit import EXPENSIVE_RATE_LIMIT, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Per-route caps aligned with the 500 MB product limit + the UploadSizeLimit
# middleware. (They were 2 GB — above the middleware cap, so inert for normal
# Content-Length uploads and only loosening the bound on the chunked path.)
MAX_IMAGE_SIZE = 500 * 1024 * 1024
MAX_MEDIA_SIZE = 500 * 1024 * 1024
MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200 MB
MAX_ARCHIVE_SIZE = 500 * 1024 * 1024
MAX_ARCHIVE_FILES = 5000
# Cap total uncompressed bytes from a single archive — protects against
# zip-bomb style inputs. Enforced against ACTUAL written bytes in _copy_capped.
MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
TIMESTAMP_RE = re.compile(r"^\d{2}:\d{2}:\d{2}(?:\.\d+)?$")

IMAGE_FORMATS = {
    "jpeg": "JPEG",
    "jpg": "JPEG",
    "png": "PNG",
    "webp": "WEBP",
    "bmp": "BMP",
    "tiff": "TIFF",
}

IMAGE_MIME_MAP = {
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "tiff": "image/tiff",
}

AUDIO_MIME_MAP = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
}

VIDEO_MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}


def _cleanup_paths(*paths: str) -> None:
    for path in paths:
        if not path:
            continue
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError:
            pass


# Strip ASCII control chars (NUL..US, DEL). Filenames that flow into a
# ``Content-Disposition`` response header must NOT contain CR/LF — a
# crafted upload could otherwise inject arbitrary response headers.
_FN_CTL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _safe_filename(name: str | None, fallback: str) -> str:
    base = _FN_CTL_RE.sub("", os.path.basename(name or "").strip())
    return base or fallback


async def _read_upload(file: UploadFile, max_size: int = 0, label: str = "File") -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    if max_size and len(data) > max_size:
        limit_mb = max_size / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"{label} exceeds the {limit_mb:.0f} MB size limit",
        )
    return data


def _new_temp_file(suffix: str) -> str:
    """Return a fresh temp file path. Uses :func:`tempfile.mkstemp` so the
    create-then-reopen pattern can't race with another process writing the
    same filename on a shared ``/tmp`` (older code used
    ``NamedTemporaryFile(delete=False)`` which closes the fd before the
    caller reopens by path).
    """
    fd, path = tempfile.mkstemp(suffix=suffix)
    # We only need the path; close the fd immediately. mkstemp atomically
    # creates with 0600 perms so a later open(path, 'wb') is safe from
    # races on a multi-tenant /tmp.
    os.close(fd)
    return path


def _write_temp_file(content: bytes, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
    except Exception:
        # Best-effort cleanup if write failed.
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path


async def _run_ffmpeg_async(cmd: list[str], timeout: int) -> None:
    """Run ffmpeg off the event loop — a long encode (up to `timeout`s) must
    not block the worker from serving other requests."""
    await asyncio.to_thread(_run_ffmpeg, cmd, timeout)


def _run_ffmpeg(cmd: list[str], timeout: int) -> None:
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="ffmpeg is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Media processing timed out") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="ignore").strip()
        detail = "ffmpeg failed to process the file"
        if stderr:
            detail = f"{detail}: {stderr.splitlines()[-1][:200]}"
        raise HTTPException(status_code=400, detail=detail) from exc


def _validate_timestamp(value: str, label: str) -> None:
    if not TIMESTAMP_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label} format. Use HH:MM:SS")


def _timestamp_to_seconds(value: str) -> float:
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _safe_archive_name(raw_name: str) -> str:
    name = PurePosixPath(raw_name)
    if name.is_absolute():
        raise HTTPException(status_code=400, detail="Archive contains absolute paths")

    parts: list[str] = []
    for part in name.parts:
        if part in ("", "."):
            continue
        if part == "..":
            raise HTTPException(status_code=400, detail="Archive contains unsafe path traversal entries")
        parts.append(part)

    if not parts:
        raise HTTPException(status_code=400, detail="Archive contains an invalid file entry")

    return "/".join(parts)


_EXTRACT_CHUNK = 1024 * 1024  # 1 MB


def _copy_capped(source, target, state: dict) -> None:
    """Stream source→target, counting ACTUAL bytes against state['remaining'].

    The old code summed the archive's DECLARED member sizes (info.file_size /
    member.size) before extraction, then used shutil.copyfileobj — which streams
    the REAL decompressed bytes with no cap, and zipfile only validates the
    declared size at EOF (after the bytes are already on disk). A bomb that
    under-declares its sizes therefore slipped the cap and could fill the disk.
    Counting the real stream here is the authoritative aggregate limit.
    """
    while True:
        chunk = source.read(_EXTRACT_CHUNK)
        if not chunk:
            break
        state["remaining"] -= len(chunk)
        if state["remaining"] < 0:
            raise HTTPException(status_code=413, detail="Extracted archive data is too large")
        target.write(chunk)


def _extract_zip_safely(zip_path: str, extract_dir: str) -> None:
    file_count = 0
    state = {"remaining": MAX_EXTRACTED_BYTES}

    with zipfile.ZipFile(zip_path, "r") as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue

            arc_name = _safe_archive_name(info.filename)
            file_count += 1
            if file_count > MAX_ARCHIVE_FILES:
                raise HTTPException(status_code=413, detail="Archive contains too many files")

            target_path = os.path.join(extract_dir, *arc_name.split("/"))
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with archive.open(info, "r") as source, open(target_path, "wb") as target:
                _copy_capped(source, target, state)


def _extract_tar_safely(tar_path: str, extract_dir: str, mode: str) -> None:
    file_count = 0
    state = {"remaining": MAX_EXTRACTED_BYTES}

    with tarfile.open(tar_path, mode) as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue

            arc_name = _safe_archive_name(member.name)
            file_count += 1
            if file_count > MAX_ARCHIVE_FILES:
                raise HTTPException(status_code=413, detail="Archive contains too many files")

            extracted = archive.extractfile(member)
            if extracted is None:
                continue

            target_path = os.path.join(extract_dir, *arc_name.split("/"))
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with extracted, open(target_path, "wb") as target:
                _copy_capped(extracted, target, state)


def _zip_directory(source_dir: str, output_zip_path: str) -> None:
    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, _dirs, files in os.walk(source_dir):
            for name in files:
                full_path = os.path.join(root, name)
                relative_path = os.path.relpath(full_path, source_dir).replace(os.sep, "/")
                archive.write(full_path, relative_path)


def _unique_name(name: str, used: set[str]) -> str:
    if name not in used:
        used.add(name)
        return name

    stem, ext = os.path.splitext(name)
    index = 1
    candidate = f"{stem}_{index}{ext}"
    while candidate in used:
        index += 1
        candidate = f"{stem}_{index}{ext}"

    used.add(candidate)
    return candidate


# Image tools


@router.post("/image-compressor")
async def image_compressor(file: UploadFile = File(...), quality: int = Form(82, ge=1, le=95)):
    from PIL import Image

    data = await _read_upload(file, MAX_IMAGE_SIZE, label="Image")

    # Detect input format and preserve it
    ext = os.path.splitext(_safe_filename(file.filename, "image.jpg"))[1].lower()

    def _work() -> tuple[str, str, str]:
        img = Image.open(io.BytesIO(data))

        if ext == ".png":
            fmt, mime, suffix = "PNG", "image/png", ".png"
            # PNG compression: optimize without quality loss
            save_kwargs = {"optimize": True}
        elif ext == ".webp":
            fmt, mime, suffix = "WEBP", "image/webp", ".webp"
            save_kwargs = {"quality": quality, "method": 4}
        else:
            # Default to JPEG for everything else
            fmt, mime, suffix = "JPEG", "image/jpeg", ".jpg"
            save_kwargs = {"quality": quality, "optimize": True}
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

        out_path = _new_temp_file(suffix)
        img.save(out_path, fmt, **save_kwargs)
        return out_path, mime, suffix

    out_path, mime, suffix = await asyncio.to_thread(_work)

    base_name = os.path.splitext(_safe_filename(file.filename, "image"))[0]
    cleanup = BackgroundTask(_cleanup_paths, out_path)
    return FileResponse(
        out_path,
        media_type=mime,
        filename=f"compressed_{base_name}{suffix}",
        background=cleanup,
    )


@router.post("/image-converter")
async def image_converter(file: UploadFile = File(...), target_format: str = Form("png")):
    from PIL import Image

    fmt_key = target_format.lower().strip()
    pil_fmt = IMAGE_FORMATS.get(fmt_key)
    if pil_fmt is None:
        raise HTTPException(status_code=400, detail="Unsupported target format")

    data = await _read_upload(file, MAX_IMAGE_SIZE, label="Image")

    suffix = ".jpg" if fmt_key == "jpeg" else f".{fmt_key}"

    def _work() -> str:
        img = Image.open(io.BytesIO(data))

        if pil_fmt == "JPEG" and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        out_path = _new_temp_file(suffix)
        img.save(out_path, pil_fmt)
        return out_path

    out_path = await asyncio.to_thread(_work)

    cleanup = BackgroundTask(_cleanup_paths, out_path)
    return FileResponse(
        out_path,
        media_type=IMAGE_MIME_MAP[fmt_key],
        filename=f"converted{suffix}",
        background=cleanup,
    )


@router.post("/remove-exif")
async def remove_exif(files: list[UploadFile] = File(...)):
    from PIL import Image

    if len(files) > 100:
        raise HTTPException(status_code=400, detail="Please upload at most 100 images")

    output_paths: list[str] = []
    original_names: list[str] = []

    try:
        for file in files:
            data = await _read_upload(file, MAX_IMAGE_SIZE, label=file.filename or "Image")

            def _work(data: bytes = data) -> str:
                img = Image.open(io.BytesIO(data))

                if hasattr(img, "getexif"):
                    img.getexif().clear()
                img.info.pop("exif", None)

                ext = os.path.splitext(_safe_filename(file.filename, "image.jpg"))[1].lower()
                if ext in (".jpg", ".jpeg"):
                    fmt, suffix = "JPEG", ".jpg"
                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                elif ext == ".webp":
                    fmt, suffix = "WEBP", ".webp"
                elif ext == ".bmp":
                    fmt, suffix = "BMP", ".bmp"
                elif ext in (".tif", ".tiff"):
                    fmt, suffix = "TIFF", ".tiff"
                else:
                    fmt, suffix = "PNG", ".png"

                out_path = _new_temp_file(suffix)
                icc = img.info.get("icc_profile")
                save_kwargs = {}
                if icc and fmt in ("JPEG", "PNG", "TIFF", "WEBP"):
                    save_kwargs["icc_profile"] = icc
                img.save(out_path, fmt, **save_kwargs)
                return out_path

            out_path = await asyncio.to_thread(_work)
            suffix = os.path.splitext(out_path)[1]
            output_paths.append(out_path)
            original_names.append(_safe_filename(file.filename, f"image{suffix}"))

        # Single file: return directly
        if len(output_paths) == 1:
            mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                        ".webp": "image/webp", ".bmp": "image/bmp", ".tiff": "image/tiff"}
            ext = os.path.splitext(output_paths[0])[1]
            cleanup = BackgroundTask(_cleanup_paths, *output_paths)
            return FileResponse(output_paths[0], media_type=mime_map.get(ext, "image/png"),
                                filename=f"clean_{original_names[0]}", background=cleanup)

        # Multiple files: return ZIP. Disambiguate duplicate uploaded names so
        # the resulting archive contains every input even when several came in
        # with the same filename.
        zip_path = _new_temp_file(".zip")

        def _zip_outputs() -> None:
            import zipfile as zf_mod
            with zf_mod.ZipFile(zip_path, "w", zf_mod.ZIP_DEFLATED) as zf:
                used_arcnames: set[str] = set()
                for i, out in enumerate(output_paths):
                    arcname = _unique_name(f"clean_{original_names[i]}", used_arcnames)
                    zf.write(out, arcname)

        await asyncio.to_thread(_zip_outputs)
        cleanup = BackgroundTask(_cleanup_paths, *output_paths, zip_path)
        return FileResponse(zip_path, media_type="application/zip",
                            filename="clean_images.zip", background=cleanup)
    except HTTPException:
        _cleanup_paths(*output_paths)
        raise
    except Exception as e:
        _cleanup_paths(*output_paths)
        logger.exception("remove-exif error")
        raise HTTPException(status_code=500, detail="Failed to remove EXIF data")


@router.post("/resize-crop-image")
async def resize_crop_image(
    file: UploadFile = File(...),
    width: int = Form(800, ge=1, le=8000),
    height: int = Form(600, ge=1, le=8000),
    mode: str = Form("resize"),
):
    from PIL import Image, ImageOps

    mode_normalized = mode.strip().lower()
    if mode_normalized not in {"resize", "crop"}:
        raise HTTPException(status_code=400, detail="mode must be either 'resize' or 'crop'")

    data = await _read_upload(file, MAX_IMAGE_SIZE, label="Image")

    ext = os.path.splitext(_safe_filename(file.filename, "image.jpg"))[1].lower()

    def _work() -> tuple[str, str, str]:
        img = Image.open(io.BytesIO(data))

        if mode_normalized == "crop":
            img = ImageOps.fit(img, (width, height))
        else:
            img = img.resize((width, height), Image.LANCZOS)

        if ext in (".jpg", ".jpeg"):
            fmt = "JPEG"
            mime_type = "image/jpeg"
            suffix = ".jpg"
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
        else:
            fmt = "PNG"
            mime_type = "image/png"
            suffix = ".png"

        out_path = _new_temp_file(suffix)
        img.save(out_path, fmt)
        return out_path, mime_type, suffix

    out_path, mime_type, suffix = await asyncio.to_thread(_work)

    cleanup = BackgroundTask(_cleanup_paths, out_path)
    return FileResponse(
        out_path,
        media_type=mime_type,
        filename=f"{mode_normalized}{suffix}",
        background=cleanup,
    )


# Video/Audio tools (require ffmpeg)


@router.post("/video-to-gif")
async def video_to_gif(
    file: UploadFile = File(...),
    fps: int = Form(10, ge=1, le=30),
    width: int = Form(480, ge=120, le=1920),
):
    input_ext = os.path.splitext(_safe_filename(file.filename, "video.mp4"))[1] or ".mp4"
    data = await _read_upload(file, MAX_VIDEO_SIZE, label="Video")
    input_path = _write_temp_file(data, input_ext)
    output_path = _new_temp_file(".gif")

    try:
        await _run_ffmpeg_async(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-vf",
                f"fps={fps},scale={width}:-1:flags=lanczos",
                "-loop",
                "0",
                output_path,
            ],
            timeout=180,
        )
    except HTTPException:
        _cleanup_paths(input_path, output_path)
        raise

    cleanup = BackgroundTask(_cleanup_paths, input_path, output_path)
    return FileResponse(output_path, media_type="image/gif", filename="output.gif", background=cleanup)


@router.post("/extract-audio")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def extract_audio(request: Request, file: UploadFile = File(...), format: str = Form("mp3")):
    audio_format = format.lower().strip()
    codec_map = {
        "mp3": "libmp3lame",
        "wav": "pcm_s16le",
        "aac": "aac",
        "flac": "flac",
        "ogg": "libvorbis",
    }
    if audio_format not in codec_map:
        raise HTTPException(status_code=400, detail="Unsupported output audio format")

    input_ext = os.path.splitext(_safe_filename(file.filename, "video.mp4"))[1] or ".mp4"
    data = await _read_upload(file, MAX_VIDEO_SIZE, label="Media file")
    input_path = _write_temp_file(data, input_ext)
    output_path = _new_temp_file(f".{audio_format}")

    try:
        await _run_ffmpeg_async(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-vn",
                "-acodec",
                codec_map[audio_format],
                output_path,
            ],
            timeout=180,
        )
    except HTTPException:
        _cleanup_paths(input_path, output_path)
        raise

    cleanup = BackgroundTask(_cleanup_paths, input_path, output_path)
    return FileResponse(
        output_path,
        media_type=AUDIO_MIME_MAP[audio_format],
        filename=f"audio.{audio_format}",
        background=cleanup,
    )


@router.post("/trim-media")
async def trim_media(
    file: UploadFile = File(...),
    start: str = Form("00:00:00"),
    end: str = Form("00:00:10"),
):
    _validate_timestamp(start, "start timestamp")
    _validate_timestamp(end, "end timestamp")
    if _timestamp_to_seconds(start) >= _timestamp_to_seconds(end):
        raise HTTPException(status_code=400, detail="end timestamp must be greater than start timestamp")

    ext = os.path.splitext(_safe_filename(file.filename, "media.mp4"))[1] or ".mp4"
    data = await _read_upload(file, MAX_VIDEO_SIZE, label="Media file")
    input_path = _write_temp_file(data, ext)
    output_path = _new_temp_file(ext)

    try:
        await _run_ffmpeg_async(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-ss",
                start,
                "-to",
                end,
                "-c",
                "copy",
                output_path,
            ],
            timeout=180,
        )
    except HTTPException:
        _cleanup_paths(input_path, output_path)
        raise

    cleanup = BackgroundTask(_cleanup_paths, input_path, output_path)
    media_type = VIDEO_MIME_BY_EXT.get(ext.lower(), "application/octet-stream")
    return FileResponse(output_path, media_type=media_type, filename=f"trimmed{ext}", background=cleanup)


@router.post("/compress-video")
async def compress_video(file: UploadFile = File(...), quality: int = Form(28, ge=18, le=40)):
    data = await _read_upload(file, MAX_MEDIA_SIZE, label="Video")
    input_ext = os.path.splitext(_safe_filename(file.filename, "video.mp4"))[1] or ".mp4"
    input_path = _write_temp_file(data, input_ext)
    output_path = _new_temp_file(".mp4")

    try:
        await _run_ffmpeg_async(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-vcodec",
                "libx264",
                "-crf",
                str(quality),
                "-preset",
                "medium",
                "-movflags",
                "+faststart",
                output_path,
            ],
            timeout=300,
        )
    except HTTPException:
        _cleanup_paths(input_path, output_path)
        raise

    base_name = os.path.splitext(_safe_filename(file.filename, "video"))[0]
    cleanup = BackgroundTask(_cleanup_paths, input_path, output_path)
    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename=f"compressed_{base_name}.mp4",
        background=cleanup,
    )


# Archive tools


@router.post("/extract-archive")
async def extract_archive(file: UploadFile = File(...)):
    archive_name = _safe_filename(file.filename, "archive.zip").lower()

    if archive_name.endswith(".zip"):
        suffix = ".zip"
        archive_kind = "zip"
        tar_mode = ""
    elif archive_name.endswith(".tar.gz") or archive_name.endswith(".tgz"):
        suffix = ".tgz"
        archive_kind = "tar"
        tar_mode = "r:gz"
    elif archive_name.endswith(".tar.bz2") or archive_name.endswith(".tbz2"):
        suffix = ".tbz2"
        archive_kind = "tar"
        tar_mode = "r:bz2"
    elif archive_name.endswith(".tar.xz") or archive_name.endswith(".txz"):
        suffix = ".txz"
        archive_kind = "tar"
        tar_mode = "r:xz"
    elif archive_name.endswith(".tar"):
        suffix = ".tar"
        archive_kind = "tar"
        tar_mode = "r:"
    else:
        raise HTTPException(status_code=400, detail="Unsupported archive type")

    data = await _read_upload(file, MAX_ARCHIVE_SIZE, label="Archive")
    input_path = _write_temp_file(data, suffix)
    extract_dir = tempfile.mkdtemp(prefix="extract_")
    output_path = _new_temp_file(".zip")

    try:
        if archive_kind == "zip":
            await asyncio.to_thread(_extract_zip_safely, input_path, extract_dir)
        else:
            await asyncio.to_thread(_extract_tar_safely, input_path, extract_dir, tar_mode)

        await asyncio.to_thread(_zip_directory, extract_dir, output_path)
    except HTTPException:
        _cleanup_paths(input_path, extract_dir, output_path)
        raise
    except (zipfile.BadZipFile, tarfile.TarError, OSError, shutil.ReadError) as exc:
        _cleanup_paths(input_path, extract_dir, output_path)
        logger.exception("extract-archive: archive parse failure")
        raise HTTPException(status_code=400, detail=f"Unable to read archive: {exc}") from exc
    except Exception as exc:
        _cleanup_paths(input_path, extract_dir, output_path)
        logger.exception("extract-archive: unexpected failure")
        raise HTTPException(status_code=500, detail=f"Failed to extract archive: {exc}") from exc

    cleanup = BackgroundTask(_cleanup_paths, input_path, extract_dir, output_path)
    return FileResponse(output_path, media_type="application/zip", filename="extracted.zip", background=cleanup)


@router.post("/create-zip")
async def create_zip(
    files: list[UploadFile] = File(...),
    password: str = Form(""),
    compression: int = Form(6, ge=0, le=9),
):
    """Bundle the uploaded files into a ZIP.

    `compression` is 0–9. 0 stores files uncompressed (fastest, largest
    output). 1–9 uses deflate where 1 is fastest and 9 is smallest. Matches
    the slider on the frontend CreateZipUI.
    """
    if password:
        raise HTTPException(status_code=400, detail="Password-protected ZIP creation is not supported yet")

    if compression == 0:
        zip_method = zipfile.ZIP_STORED
        zip_args: dict = {}
    else:
        zip_method = zipfile.ZIP_DEFLATED
        # compresslevel was added to zipfile.ZipFile in Python 3.7
        zip_args = {"compresslevel": compression}

    output_path = _new_temp_file(".zip")
    used_names: set[str] = set()

    try:
        with zipfile.ZipFile(output_path, "w", zip_method, **zip_args) as archive:
            for upload in files:
                safe_name = _safe_filename(upload.filename, "file")
                safe_name = _unique_name(safe_name, used_names)
                data = await _read_upload(upload, MAX_ARCHIVE_SIZE, label=f"File '{safe_name}'")
                archive.writestr(safe_name, data)
    except HTTPException:
        _cleanup_paths(output_path)
        raise
    except Exception as exc:
        _cleanup_paths(output_path)
        raise HTTPException(status_code=500, detail="Failed to create archive") from exc

    cleanup = BackgroundTask(_cleanup_paths, output_path)
    return FileResponse(output_path, media_type="application/zip", filename="archive.zip", background=cleanup)
