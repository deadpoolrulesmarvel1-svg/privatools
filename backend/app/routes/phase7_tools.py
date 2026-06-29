"""Phase 7 tools — quick, high-volume FFmpeg/Pillow ops competitors offer
that PrivaTools didn't: mute video, reverse video, change video speed,
extract dominant color palette from images, pixelate/blur image regions.
"""
from __future__ import annotations

import asyncio
import io
import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from collections import Counter

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..rate_limit import limiter, EXPENSIVE_RATE_LIMIT
from ..utils.cleanup import ensure_temp_dir, get_temp_path, remove_files
from ..utils.route_helpers import read_upload

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_VIDEO_BYTES = 200 * 1024 * 1024  # 200 MB
MAX_IMAGE_BYTES = 50 * 1024 * 1024   # 50 MB
ALLOWED_VIDEO = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}
ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _suffix(name: str | None) -> str:
    if not name or "." not in name:
        return ".mp4"
    return "." + name.rsplit(".", 1)[-1].lower()


async def _run_ffmpeg_async(args: list[str], label: str) -> None:
    """Run ffmpeg off the event loop so a long encode doesn't block the worker."""
    await asyncio.to_thread(_run_ffmpeg, args, label)


def _run_ffmpeg(args: list[str], label: str) -> None:
    try:
        proc = subprocess.run(args, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"{label} timed out") from exc
    if proc.returncode != 0:
        err = (proc.stderr.decode("utf-8", "ignore") or proc.stdout.decode("utf-8", "ignore"))[-400:]
        raise HTTPException(status_code=500, detail=f"{label} failed: {err.strip() or 'ffmpeg error'}")


# ─── Mute video (strip audio) ────────────────────────────────────────────
@router.post("/mute-video")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def mute_video_endpoint(request: Request, file: UploadFile = File(...)):
    """Strip the audio track from a video. Stream-copies video so it's instant."""
    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_VIDEO:
        raise HTTPException(status_code=400, detail="Please upload a video file (MP4, MOV, WebM, MKV, AVI, M4V).")
    data = await read_upload(file, label="Video", max_bytes=MAX_VIDEO_BYTES)
    ensure_temp_dir()
    in_path = get_temp_path(f"mute_in_{uuid.uuid4().hex}{suffix}")
    out_path = get_temp_path(f"mute_out_{uuid.uuid4().hex}{suffix}")
    in_path.write_bytes(data)
    try:
        await _run_ffmpeg_async([
            "ffmpeg", "-y", "-i", str(in_path),
            "-c:v", "copy", "-an", str(out_path),
        ], "Mute video")
        cleanup = BackgroundTask(remove_files, str(in_path), str(out_path))
        return FileResponse(
            str(out_path), media_type="video/mp4",
            filename=f"muted{suffix}", background=cleanup,
        )
    except HTTPException:
        remove_files(str(in_path), str(out_path) if out_path.exists() else None)
        raise


# ─── Reverse video (play backwards, audio reversed too) ──────────────────
@router.post("/reverse-video")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def reverse_video_endpoint(request: Request, file: UploadFile = File(...)):
    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_VIDEO:
        raise HTTPException(status_code=400, detail="Please upload a video file.")
    data = await read_upload(file, label="Video", max_bytes=MAX_VIDEO_BYTES)
    ensure_temp_dir()
    in_path = get_temp_path(f"rev_in_{uuid.uuid4().hex}{suffix}")
    # Output as .mp4 regardless of input for max compatibility.
    out_path = get_temp_path(f"rev_out_{uuid.uuid4().hex}.mp4")
    in_path.write_bytes(data)
    try:
        await _run_ffmpeg_async([
            "ffmpeg", "-y", "-i", str(in_path),
            "-vf", "reverse", "-af", "areverse",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            str(out_path),
        ], "Reverse video")
        cleanup = BackgroundTask(remove_files, str(in_path), str(out_path))
        return FileResponse(
            str(out_path), media_type="video/mp4",
            filename="reversed.mp4", background=cleanup,
        )
    except HTTPException:
        remove_files(str(in_path), str(out_path) if out_path.exists() else None)
        raise


# ─── Change video playback speed (0.25× – 4×) ────────────────────────────
@router.post("/video-speed")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def video_speed_endpoint(
    request: Request,
    file: UploadFile = File(...),
    speed: float = Form(1.5, ge=0.25, le=4.0),
):
    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_VIDEO:
        raise HTTPException(status_code=400, detail="Please upload a video file.")
    data = await read_upload(file, label="Video", max_bytes=MAX_VIDEO_BYTES)
    ensure_temp_dir()
    in_path = get_temp_path(f"speed_in_{uuid.uuid4().hex}{suffix}")
    out_path = get_temp_path(f"speed_out_{uuid.uuid4().hex}.mp4")
    in_path.write_bytes(data)
    # Build atempo chain — ffmpeg's atempo only handles 0.5-2.0 per call.
    atempo_chain: list[str] = []
    s = float(speed)
    if s <= 0.25 or s >= 4:
        raise HTTPException(status_code=400, detail="Speed must be between 0.25 and 4.")
    # Decompose into 0.5/2.0 factors
    while s > 2.0:
        atempo_chain.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        atempo_chain.append("atempo=0.5")
        s /= 0.5
    atempo_chain.append(f"atempo={s:.4f}")
    a_filter = ",".join(atempo_chain)
    v_filter = f"setpts={1.0 / float(speed):.4f}*PTS"
    try:
        await _run_ffmpeg_async([
            "ffmpeg", "-y", "-i", str(in_path),
            "-filter_complex", f"[0:v]{v_filter}[v];[0:a]{a_filter}[a]",
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            str(out_path),
        ], "Video speed change")
        cleanup = BackgroundTask(remove_files, str(in_path), str(out_path))
        return FileResponse(
            str(out_path), media_type="video/mp4",
            filename=f"speed{speed:g}x.mp4", background=cleanup,
        )
    except HTTPException:
        remove_files(str(in_path), str(out_path) if out_path.exists() else None)
        raise


# ─── Audio trim (standalone — distinct from video trim-media) ────────────
ALLOWED_AUDIO = {".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".wma"}


@router.post("/audio-trim")
@limiter.limit(EXPENSIVE_RATE_LIMIT)
async def audio_trim_endpoint(
    request: Request,
    file: UploadFile = File(...),
    start: str = Form("00:00:00"),
    end: str = Form("00:00:30"),
):
    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_AUDIO:
        raise HTTPException(status_code=400, detail="Please upload an audio file (MP3, WAV, AAC, FLAC, OGG, M4A).")
    data = await read_upload(file, label="Audio", max_bytes=MAX_VIDEO_BYTES)
    # Validate timestamps: H:MM:SS or seconds. Use fullmatch + a hard length
    # cap so an attacker can't pass a multi-MB form value to force pathological
    # regex backtracking (defence-in-depth — Starlette already caps form size).
    import re as _re
    _TS_RE = _re.compile(r"\d+:\d{1,2}:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?", _re.ASCII)
    s_strip = start.strip()
    e_strip = end.strip()
    if len(s_strip) > 32 or not _TS_RE.fullmatch(s_strip):
        raise HTTPException(status_code=400, detail="Start must be HH:MM:SS or seconds")
    if len(e_strip) > 32 or not _TS_RE.fullmatch(e_strip):
        raise HTTPException(status_code=400, detail="End must be HH:MM:SS or seconds")
    ensure_temp_dir()
    in_path = get_temp_path(f"atrim_in_{uuid.uuid4().hex}{suffix}")
    out_path = get_temp_path(f"atrim_out_{uuid.uuid4().hex}{suffix}")
    in_path.write_bytes(data)
    try:
        await _run_ffmpeg_async([
            "ffmpeg", "-y", "-ss", start.strip(), "-to", end.strip(),
            "-i", str(in_path), "-c", "copy", str(out_path),
        ], "Audio trim")
        cleanup = BackgroundTask(remove_files, str(in_path), str(out_path))
        return FileResponse(
            str(out_path), media_type=f"audio/{suffix.lstrip('.')}",
            filename=f"trimmed{suffix}", background=cleanup,
        )
    except HTTPException:
        remove_files(str(in_path), str(out_path) if out_path.exists() else None)
        raise


# ─── Image color palette extractor ───────────────────────────────────────
@router.post("/image-palette")
async def image_palette_endpoint(
    file: UploadFile = File(...),
    colors: int = Form(6, ge=2, le=24),
):
    """Extract the N most-dominant colors from an image as a JSON palette."""
    from PIL import Image

    data = await read_upload(file, label="Image", max_bytes=MAX_IMAGE_BYTES)
    img = Image.open(io.BytesIO(data)).convert("RGB")
    # Resize for speed — palette extraction doesn't need full resolution.
    img.thumbnail((400, 400))
    # Use Pillow's quantize for a fast palette pass.
    paletted = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
    palette = paletted.getpalette() or []
    # Count pixel occurrences per palette index
    pixels = paletted.getdata()
    counts = Counter(pixels)
    total = sum(counts.values()) or 1
    result = []
    for idx, count in counts.most_common(colors):
        r, g, b = palette[idx * 3 : idx * 3 + 3]
        hex_code = f"#{r:02X}{g:02X}{b:02X}"
        result.append({
            "hex": hex_code,
            "rgb": [r, g, b],
            "percentage": round(100 * count / total, 1),
        })
    return JSONResponse({"palette": result, "count": len(result)})


# ─── Pixelate / blur image (privacy tool) ────────────────────────────────
@router.post("/pixelate-image")
async def pixelate_image_endpoint(
    file: UploadFile = File(...),
    mode: str = Form("pixelate"),
    strength: int = Form(20, ge=1, le=100),
):
    """Apply pixelation or Gaussian blur to the entire image.

    mode: "pixelate" (mosaic) or "blur" (gaussian).
    strength: 1-100. Higher = blockier/blurrier.
    """
    from PIL import Image, ImageFilter

    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    data = await read_upload(file, label="Image", max_bytes=MAX_IMAGE_BYTES)
    img = Image.open(io.BytesIO(data))
    mode_clean = (mode or "").lower().strip()
    if mode_clean not in ("pixelate", "blur"):
        raise HTTPException(status_code=400, detail="Mode must be 'pixelate' or 'blur'.")
    out_ext = ".jpg" if suffix in (".jpg", ".jpeg") else ".png"
    out_path = get_temp_path(f"pix_out_{uuid.uuid4().hex}{out_ext}")
    media = "image/jpeg" if out_ext == ".jpg" else "image/png"

    # The decode + resize/blur + save is CPU-bound — run it off the event loop
    # so it can't freeze concurrent requests on the 2-core VM.
    def _work() -> None:
        image = img
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        if mode_clean == "pixelate":
            # Downsample then upsample with nearest-neighbour → mosaic blocks.
            block = max(2, min(120, int(strength * 0.8) + 4))
            w, h = image.size
            small_w = max(1, w // block)
            small_h = max(1, h // block)
            image = image.resize((small_w, small_h), Image.Resampling.BILINEAR)
            image = image.resize((w, h), Image.Resampling.NEAREST)
        else:  # blur
            radius = max(1, int(strength * 0.4) + 1)
            image = image.filter(ImageFilter.GaussianBlur(radius=radius))
        if out_ext == ".jpg":
            if image.mode == "RGBA":
                image = image.convert("RGB")
            image.save(out_path, "JPEG", quality=90)
        else:
            image.save(out_path, "PNG")

    await asyncio.to_thread(_work)
    cleanup = BackgroundTask(remove_files, str(out_path))
    suffix_word = "pixelated" if mode_clean == "pixelate" else "blurred"
    return FileResponse(
        str(out_path), media_type=media,
        filename=f"{suffix_word}{out_ext}", background=cleanup,
    )


# ─── Rotate image (90 / 180 / 270 / arbitrary) ───────────────────────────
@router.post("/rotate-image")
async def rotate_image_endpoint(
    file: UploadFile = File(...),
    degrees: int = Form(90),
):
    """Rotate an image by 90, 180, 270, or an arbitrary angle (counter-clockwise)."""
    from PIL import Image

    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    data = await read_upload(file, label="Image", max_bytes=MAX_IMAGE_BYTES)
    img = Image.open(io.BytesIO(data))
    # Preserve alpha if PNG/WEBP — convert if needed
    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if has_alpha else "RGB")
    deg = ((degrees % 360) + 360) % 360
    if deg in (90, 180, 270):
        method = {90: Image.Transpose.ROTATE_90, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_270}[deg]
        img = img.transpose(method)
    elif deg != 0:
        # Arbitrary angle — Pillow rotates CCW by default; expand=True to avoid cropping.
        # Use a transparent fill if source had alpha, else white.
        fill = (0, 0, 0, 0) if has_alpha else (255, 255, 255)
        img = img.rotate(deg, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)
    out_ext = suffix if suffix in (".jpg", ".jpeg", ".png", ".webp") else ".png"
    out_path = get_temp_path(f"rot_out_{uuid.uuid4().hex}{out_ext}")
    if out_ext in (".jpg", ".jpeg"):
        if img.mode == "RGBA":
            img = img.convert("RGB")
        img.save(out_path, "JPEG", quality=92)
        media = "image/jpeg"
    elif out_ext == ".webp":
        img.save(out_path, "WEBP", quality=92)
        media = "image/webp"
    else:
        img.save(out_path, "PNG")
        media = "image/png"
    cleanup = BackgroundTask(remove_files, str(out_path))
    return FileResponse(
        str(out_path), media_type=media,
        filename=f"rotated{out_ext}", background=cleanup,
    )


# ─── Flip image (horizontal / vertical) ──────────────────────────────────
@router.post("/flip-image")
async def flip_image_endpoint(
    file: UploadFile = File(...),
    direction: str = Form("horizontal"),
):
    """Mirror an image horizontally or vertically."""
    from PIL import Image

    suffix = _suffix(file.filename)
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    direction = (direction or "").lower().strip()
    if direction not in ("horizontal", "vertical", "h", "v"):
        raise HTTPException(status_code=400, detail="direction must be 'horizontal' or 'vertical'")
    data = await read_upload(file, label="Image", max_bytes=MAX_IMAGE_BYTES)
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if (img.mode in ("LA",) or "transparency" in img.info) else "RGB")
    method = Image.Transpose.FLIP_LEFT_RIGHT if direction in ("horizontal", "h") else Image.Transpose.FLIP_TOP_BOTTOM
    img = img.transpose(method)
    out_ext = suffix if suffix in (".jpg", ".jpeg", ".png", ".webp") else ".png"
    out_path = get_temp_path(f"flip_out_{uuid.uuid4().hex}{out_ext}")
    if out_ext in (".jpg", ".jpeg"):
        if img.mode == "RGBA":
            img = img.convert("RGB")
        img.save(out_path, "JPEG", quality=92)
        media = "image/jpeg"
    elif out_ext == ".webp":
        img.save(out_path, "WEBP", quality=92)
        media = "image/webp"
    else:
        img.save(out_path, "PNG")
        media = "image/png"
    cleanup = BackgroundTask(remove_files, str(out_path))
    return FileResponse(
        str(out_path), media_type=media,
        filename=f"flipped-{direction[0]}{out_ext}", background=cleanup,
    )
