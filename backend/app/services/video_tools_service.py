"""Video tools backed by ffmpeg + (for video-to-pdf) PIL+ReportLab.

These all share the same constraints:
  - input goes to a temp .mp4/.mov/etc, output to a temp file
  - ffmpeg invoked via subprocess with a hard timeout
  - non-zero ffmpeg exit raises ValueError so the route returns a clean 400
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

from ..utils.exceptions import DependencyError, ToolTimeoutError, ValidationError
from ..utils.filenames import temp_output

logger = logging.getLogger(__name__)

# Seconds. Re-encoding 1080p30 at the veryfast preset costs about 111 CPU-seconds
# a minute (v2.7.5 image), so on production's 1.8 CPUs this covers a little
# under three minutes of 1080p, or under a minute of 4K.
FFMPEG_TIMEOUT = 180

# Supported output formats per tool — kept lower-case for sanity.
VIDEO_OUTPUT_FORMATS = {"mp4", "mov", "webm", "mkv", "avi"}

# libvpx-vp9 at its default speed spent ~11 CPU-seconds per second of 720p30
# camera footage (release image, 2-core Oracle ARM VM), so WebM output of more
# than 15-20 s of 720p hit FFMPEG_TIMEOUT. Realtime speed 8 spends ~1, a
# little less than the H.264 path, for a slightly lower SSIM at the same
# bitrate target.
VP9_SPEED = ["-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1"]

# ─── helpers ─────────────────────────────────────────────────────────────


def _run_ffmpeg(args: list[str], timeout: int = FFMPEG_TIMEOUT, *, cwd: str | None = None) -> None:
    """Run ffmpeg with full args list; raise typed exception on failure."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", *args],
            capture_output=True, timeout=timeout, text=True,
            check=False,  # we handle returncode ourselves
            **({"cwd": cwd} if cwd is not None else {}),
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolTimeoutError(
            f"ffmpeg timed out after {timeout}s — try a shorter clip."
        ) from exc
    except FileNotFoundError as exc:
        raise ValidationError("ffmpeg is not installed on this server.") from exc

    if proc.returncode != 0:
        # Trim ffmpeg stderr so the user gets the most relevant line.
        last = (proc.stderr or "").strip().splitlines()
        msg = last[-1] if last else f"ffmpeg exited with code {proc.returncode}"
        raise ValidationError(f"ffmpeg failed: {msg}")


def _probe_duration(input_path: str) -> float:
    """Return video duration in seconds (0 if probe fails)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", input_path],
            capture_output=True, timeout=15, text=True, check=True,
        )
        return float(result.stdout.strip())
    except (subprocess.SubprocessError, FileNotFoundError, ValueError) as exc:
        logger.debug("ffprobe duration failed: %s", exc)
        return 0.0


# ─── 1. Video → PDF ──────────────────────────────────────────────────────


def video_to_pdf(input_path: str, frames: int = 12) -> str:
    """Extract `frames` evenly-spaced frames from the video and lay them out
    one per PDF page. Useful for storyboarding or sharing a video preview
    with someone who only opens PDFs.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import Image as RLImage
    from reportlab.platypus import PageBreak, SimpleDocTemplate

    if frames < 1 or frames > 100:
        raise ValidationError("frames must be between 1 and 100")

    duration = _probe_duration(input_path) or 1.0
    work_dir = tempfile.mkdtemp(prefix="vid2pdf_")
    output_path = temp_output("video_to_pdf", "pdf")

    try:
        # Extract evenly-spaced frames — fps filter avoids re-decoding the
        # whole stream and gives us roughly the count we want.
        rate = max(0.001, frames / duration)
        _run_ffmpeg([
            "-i", input_path,
            "-vf", f"fps={rate},scale=1280:-1",
            os.path.join(work_dir, "frame_%03d.jpg"),
        ])
        files = sorted(Path(work_dir).glob("frame_*.jpg"))[:frames]
        if not files:
            raise ValidationError("Could not extract any frames from the video.")

        page_w, page_h = letter
        margin = 36
        # ReportLab's frame also has 6 px padding on each edge.
        max_w = page_w - 2 * margin - 12
        max_h = page_h - 2 * margin - 12

        doc = SimpleDocTemplate(str(output_path), pagesize=letter,
                                topMargin=margin, bottomMargin=margin,
                                leftMargin=margin, rightMargin=margin)
        story = []
        from PIL import Image as PILImage
        for index, f in enumerate(files):
            with PILImage.open(f) as im:
                w, h = im.size
            ratio = min(max_w / w, max_h / h)
            if index:
                story.append(PageBreak())
            story.append(RLImage(str(f), width=w * ratio, height=h * ratio))
        doc.build(story)
        return str(output_path)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ─── 2. Video converter ─────────────────────────────────────────────────


def video_convert(input_path: str, target_format: str) -> str:
    fmt = target_format.lower().strip()
    if fmt not in VIDEO_OUTPUT_FORMATS:
        raise ValidationError(
            f"target_format must be one of: {', '.join(sorted(VIDEO_OUTPUT_FORMATS))}"
        )
    output_path = temp_output("video_convert", fmt)

    # Sensible per-format codec choices:
    args = ["-i", input_path]
    if fmt == "webm":
        args += ["-c:v", "libvpx-vp9", "-b:v", "1M", *VP9_SPEED, "-c:a", "libopus"]
    elif fmt == "mkv":
        args += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac"]
    elif fmt == "avi":
        args += ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "mp3"]
    elif fmt == "mov":
        args += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
                 "-c:a", "aac", "-movflags", "+faststart"]
    else:  # mp4 (default)
        args += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
                 "-c:a", "aac", "-movflags", "+faststart"]
    args.append(str(output_path))
    _run_ffmpeg(args)
    return str(output_path)


# ─── 3. Video resizer ────────────────────────────────────────────────────


VIDEO_PRESETS = {
    "240p":  (-2, 240),
    "360p":  (-2, 360),
    "480p":  (-2, 480),
    "720p":  (-2, 720),
    "1080p": (-2, 1080),
    "1440p": (-2, 1440),
}


def video_resize(input_path: str, preset: str = "720p") -> str:
    if preset not in VIDEO_PRESETS:
        raise ValidationError(
            f"preset must be one of: {', '.join(VIDEO_PRESETS.keys())}"
        )
    w, h = VIDEO_PRESETS[preset]
    output_path = temp_output("video_resize", "mp4")
    _run_ffmpeg([
        "-i", input_path,
        "-vf", f"scale={w}:{h}",
        "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
        "-c:a", "aac", "-movflags", "+faststart",
        str(output_path),
    ])
    return str(output_path)


# ─── 4. Video → single thumbnail JPG ─────────────────────────────────────


def video_thumbnail(input_path: str, time_seconds: float = 1.0) -> str:
    if time_seconds < 0:
        time_seconds = 0
    output_path = temp_output("video_thumb", "jpg")
    _run_ffmpeg([
        "-ss", str(time_seconds),
        "-i", input_path,
        "-frames:v", "1",
        "-vf", "scale=1280:-1",
        "-q:v", "3",
        str(output_path),
    ])
    return str(output_path)


# ─── 5. GIF → MP4 ────────────────────────────────────────────────────────


def gif_to_mp4(input_path: str) -> str:
    output_path = temp_output("gif_to_mp4", "mp4")
    _run_ffmpeg([
        "-i", input_path,
        # H.264 needs even dimensions; the pad filter keeps it safe for any input.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "23", "-preset", "veryfast",
        "-movflags", "+faststart",
        str(output_path),
    ])
    return str(output_path)


# ─── 6. Burn-in subtitles (.srt) onto a video ────────────────────────────


def has_audio(path: str) -> bool:
    """Return True if the file has at least one audio stream."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=codec_type",
             "-of", "default=nw=1", path],
            capture_output=True, timeout=10, text=True, check=True,
        )
        return "audio" in result.stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def _display_size(path: str) -> tuple[int, int]:
    """Frame size of the first video stream as players show it.

    Phones store portrait video as landscape frames plus a display rotation,
    which ffmpeg applies when it decodes, and some clips have non-square
    pixels. Rounded down to even numbers, which H.264 in 4:2:0 requires.
    """
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_streams", "-of", "json", path],
            capture_output=True, timeout=15, text=True, check=True,
        )
        stream = json.loads(result.stdout)["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
    except (subprocess.SubprocessError, FileNotFoundError, ValueError, KeyError, IndexError) as exc:
        raise ValidationError("Could not read the frame size of the first video.") from exc
    try:
        sar = Fraction(stream.get("sample_aspect_ratio", "1:1").replace(":", "/"))
    except (ValueError, ZeroDivisionError):
        sar = Fraction(1)
    if sar <= 0:  # 0:1 means unknown
        sar = Fraction(1)
    rotation = next((entry["rotation"] for entry in stream.get("side_data_list", []) if "rotation" in entry), 0)
    if round(rotation / 90) % 2:  # a quarter turn either way
        width, height, sar = height, width, 1 / sar
    width = int(width * sar)
    return width - width % 2, height - height % 2


# What phones record, and what an MP4 carries as it is.
_COPYABLE_VIDEO = {"h264", "hevc"}
_COPYABLE_AUDIO = {"aac"}
_VIDEO_KEYS = ("codec_name", "profile", "level", "width", "height", "pix_fmt", "sample_aspect_ratio",
               "field_order", "color_range", "color_space", "color_transfer", "color_primaries",
               "time_base", "extradata_hash")
_AUDIO_KEYS = ("codec_name", "profile", "sample_rate", "channels", "channel_layout", "time_base",
               "extradata_hash")


# More hidden audio than an encoder's priming (Apple's AAC primes 2112 samples,
# 44 ms at 48 kHz) means part of the sound was cut away without re-encoding.
_MAX_HIDDEN_AUDIO = 0.1


def _copy_plan(path: str) -> tuple[tuple, dict] | None:
    """A clip's copy signature and timing, or None if it must be re-encoded.

    The signature is what has to be the same in every clip for a merge to copy
    their video: the streams, in the same order; the video's codec set-up down
    to its parameter sets (the extradata hash), frame size, pixels, colours,
    time base and display rotation; and the audio's format. The timing is how
    long the clip's video runs and where its sound starts, which the merge
    lines each clip's sound up with.

    None for a clip that cannot go into an MP4 as it is, such as VP9 or one
    with two audio tracks; for anything but an MP4 or MOV, which is what phones
    record (copied MKV and AVI joins came out with irregular or reversed
    timestamps); and for a clip trimmed without re-encoding: it keeps the
    frames and sound before the cut, marked to be discarded (an edit list),
    and a copy would bring the cut footage back.
    """
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_data_hash", "sha256", "-show_entries",
             "format=format_name,start_time:stream:packet=stream_index,flags,duration_time", "-of", "json", path],
            capture_output=True, timeout=60, text=True, check=True,
        )
        info = json.loads(result.stdout)
        streams, packets, fmt = info["streams"], info.get("packets", []), info["format"]
    except (subprocess.SubprocessError, FileNotFoundError, ValueError, KeyError):
        return None
    if "mp4" not in fmt.get("format_name", "").split(","):
        return None
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if len(video) != 1 or len(audio) > 1 or video[0].get("codec_name") not in _COPYABLE_VIDEO:
        return None
    if audio and audio[0].get("codec_name") not in _COPYABLE_AUDIO:
        return None
    hidden = [p for p in packets if "D" in p.get("flags", "")]
    if any(p.get("stream_index") == video[0]["index"] for p in hidden):
        return None
    if sum(float(p.get("duration_time") or 0) for p in hidden) > _MAX_HIDDEN_AUDIO:
        return None
    try:
        file_start = float(fmt["start_time"])
        video_end = float(video[0]["start_time"]) + float(video[0]["duration"])
        audio_start = float(audio[0]["start_time"]) if audio else file_start
    except (KeyError, TypeError, ValueError):
        return None
    rotation = next((entry["rotation"] for entry in video[0].get("side_data_list", []) if "rotation" in entry), 0)
    signature = (
        tuple(s.get("codec_type") for s in streams),
        tuple(video[0].get(key) for key in _VIDEO_KEYS),
        rotation,
        tuple(audio[0].get(key) for key in _AUDIO_KEYS) if audio else None,
    )
    timing = {"length": video_end - file_start, "audio_lead": audio_start - file_start,
              "sample_rate": int(audio[0]["sample_rate"]) if audio else 0}
    return signature, timing


def _merge_by_copy(input_paths: list[str], timings: list[dict], *, hevc: bool) -> str:
    """Join clips of one encoding by copying their video, which loses nothing
    and costs little: re-encoding the sound is most of the work, up to about
    two minutes per hour of footage. Re-encoding one minute of 1080p30 took
    111 CPU-seconds (v2.7.5 image), so a merge of about three minutes ran out
    of FFmpeg's 180 s on the production container; copying it took 1.5.

    The sound is rebuilt instead of copied. Copied, each clip's audio kept its
    encoder's priming and the few milliseconds it runs past its video, which
    players play back to back, so the sound fell about 24 ms further behind
    the picture at every join: 238 ms by clip 10 in Chromium. Here each clip's
    sound is trimmed or padded to exactly its video's length, and the concat
    list gives each clip that same length, so every clip's sound starts with
    its picture. Sound that runs on past a clip's video is cut there. Only
    the sound is encoded, once.
    """
    output_path = temp_output("video_merge", "mp4")
    work_dir = tempfile.mkdtemp(prefix="video_merge_")
    try:
        listing = Path(work_dir) / "clips.txt"
        # The concat list quotes each path; a quote inside one is written '\''.
        listing.write_text("".join(
            "file '" + os.path.abspath(path).replace("'", "'\\''") + f"'\nduration {timing['length']:.6f}\n"
            for path, timing in zip(input_paths, timings)
        ))
        # -copyts: FFmpeg would otherwise shift the copied video so its input's
        # earliest timestamp is zero, and that is the first clip's discarded
        # AAC priming packet, so the picture started 21 ms after the rebuilt
        # sound in every clip.
        args = ["-copyts", "-f", "concat", "-safe", "0", "-i", str(listing)]
        rate = timings[0]["sample_rate"]
        if rate:
            chains = []
            for k, (path, timing) in enumerate(zip(input_paths, timings)):
                args += ["-i", path]
                samples = round(timing["length"] * rate)
                lead = round(timing["audio_lead"] * rate)
                chains.append(f"[{k + 1}:a:0]asetpts=PTS-STARTPTS"
                              + (f",adelay=delays={lead}S:all=1" if lead > 0 else "")
                              + f",atrim=end_sample={samples},apad=whole_len={samples}[a{k}]")
            joined = "".join(f"[a{k}]" for k in range(len(input_paths)))
            # The fast AAC coder, which FFmpeg's documentation calls "better
            # and much faster at higher bitrates" (above 64 kbps). With the
            # default coder the sound took most of a long merge, at 15 to 35
            # times real time on a 2-core ARM server like production's, so
            # FFmpeg's 180 s covered as little as 45 minutes of footage; fast
            # ran at 29 to 58 times, and a merge of 2 x 5 minutes took 13.8
            # CPU-s against 27.8.
            args += ["-filter_complex", ";".join(chains) + f";{joined}concat=n={len(input_paths)}:v=0:a=1[a]",
                     "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
                     "-c:a", "aac", "-aac_coder", "fast", "-b:a", "192k"]
        else:
            args += ["-map", "0:v:0", "-c:v", "copy"]
        _run_ffmpeg([
            *args,
            # Apple's players open HEVC in an MP4 only under the hvc1 tag.
            *(["-tag:v", "hvc1"] if hevc else []),
            # No tags or chapters from the clips, such as where they were
            # recorded. The rotation is not a tag, and stays.
            "-map_metadata", "-1", "-map_chapters", "-1",
            "-movflags", "+faststart", str(output_path),
        ])
    except BaseException:
        Path(output_path).unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    return str(output_path)


def video_merge(input_paths: list[str]) -> str:
    """Concatenate videos into one MP4.

    Clips recorded the same way, as one phone's clips usually are, are joined
    as they are (see _merge_by_copy). Any other mix goes through ffmpeg's
    concat filter and is re-encoded once as H.264 and AAC.

    Handles mixed audio-presence inputs by padding video-only clips with a
    silent audio track at concat time, so the user never gets the cryptic
    "Error binding filtergraph inputs/outputs" failure.

    concat also needs one frame size, so every clip is scaled to fit the
    first clip's frame, keeping its shape, and centred between black bars.
    """
    if len(input_paths) < 2:
        raise ValidationError("Need at least 2 videos to merge.")
    if len(input_paths) > 20:
        raise ValidationError("Too many videos to merge in one call (max 20).")

    plans = [_copy_plan(p) for p in input_paths]
    if all(plans) and len({signature for signature, _ in plans}) == 1:
        try:
            return _merge_by_copy(input_paths, [timing for _, timing in plans],
                                  hevc=plans[0][0][1][0] == "hevc")
        except ValidationError:
            # FFmpeg refused to join them as they are; re-encoding still can.
            logger.warning("video-merge: joining by copy failed, re-encoding", exc_info=True)

    output_path = temp_output("video_merge", "mp4")
    n = len(input_paths)

    # Probe whether ANY input has audio. If none do, drop the audio stream
    # entirely. If some do, pad the silent ones with anullsrc so concat works.
    audio_flags = [has_audio(p) for p in input_paths]
    any_audio = any(audio_flags)

    inputs: list[str] = []
    for p in input_paths:
        inputs += ["-i", p]

    # The first scale squares non-square pixels, so the fit keeps the shape
    # players show; setsar=1 undoes the rounding the fit leaves in the ratio.
    width, height = _display_size(input_paths[0])
    fit = (f"scale=trunc(iw*sar/2)*2:ih,setsar=1,"
           f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
           f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    scaled = "".join(f"[{i}:v:0]{fit}[v{i}];" for i in range(n))

    if any_audio:
        # Add an anullsrc per silent input as additional inputs.
        anull_indices: dict[int, int] = {}
        for idx, has in enumerate(audio_flags):
            if not has:
                anull_indices[idx] = n + len(anull_indices)  # next ffmpeg input index
                inputs += ["-f", "lavfi", "-t", "0.1", "-i",
                           "anullsrc=channel_layout=stereo:sample_rate=44100"]
        # Build concat input list — use real audio when available, anullsrc when not.
        parts = []
        for i in range(n):
            parts.append(f"[v{i}]")
            if audio_flags[i]:
                parts.append(f"[{i}:a:0]")
            else:
                parts.append(f"[{anull_indices[i]}:a:0]")
        filter_complex = scaled + "".join(parts) + f"concat=n={n}:v=1:a=1[v][a]"
        map_args = ["-map", "[v]", "-map", "[a]"]
        codec_args = ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
                      "-c:a", "aac"]
    else:
        # Video-only concat — drop audio entirely.
        filter_complex = scaled + "".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[v]"
        map_args = ["-map", "[v]"]
        codec_args = ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-an"]

    try:
        _run_ffmpeg([
            *inputs,
            "-filter_complex", filter_complex,
            *map_args,
            *codec_args,
            # FFmpeg copies the first input's tags by default: where a phone
            # recorded the clip (GPS location), on what, and when. The frames
            # are already turned upright, so no rotation tag is needed.
            "-map_metadata", "-1", "-map_chapters", "-1",
            "-movflags", "+faststart",
            str(output_path),
        ])
    except BaseException:
        # A merge stopped at FFmpeg's time limit has written about 250 MB by
        # then. The route never learns this path, so remove it here, or it
        # stays in the temp directory until the 10-minute sweep.
        Path(output_path).unlink(missing_ok=True)
        raise
    return str(output_path)


def audio_merge(input_paths: list[str]) -> str:
    """Concatenate audio tracks. Output is MP3 for broadest compatibility."""
    if len(input_paths) < 2:
        raise ValidationError("Need at least 2 audio files to merge.")
    if len(input_paths) > 50:
        raise ValidationError("Too many audio files to merge in one call (max 50).")
    output_path = temp_output("audio_merge", "mp3")
    inputs: list[str] = []
    for p in input_paths:
        inputs += ["-i", p]
    n = len(input_paths)
    filter_complex = "".join(f"[{i}:a:0]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    _run_ffmpeg([
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[a]",
        "-c:a", "libmp3lame", "-q:a", "2",
        str(output_path),
    ])
    return str(output_path)


def burn_subtitles(video_path: str, srt_path: str) -> str:
    """Render timed SRT captions, preferring libass with a plain-text fallback."""
    try:
        filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, timeout=10, text=True, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise DependencyError("Subtitle rendering requires FFmpeg on this server.") from exc
    if filters.returncode != 0:
        raise DependencyError("The server could not check FFmpeg subtitle support. Please retry later.")
    native = any(len(line.split()) > 1 and line.split()[1] == "subtitles" for line in filters.stdout.splitlines())
    overlay = any(len(line.split()) > 1 and line.split()[1] == "overlay" for line in filters.stdout.splitlines())
    if not native and not overlay:
        raise DependencyError("Subtitle rendering requires FFmpeg with libass or the overlay filter.")
    output_path = temp_output("video_subs", "mp4")
    try:
        if not native:
            from .subtitle_renderer import render_plain_subtitles
            render_plain_subtitles(video_path, srt_path, str(output_path), _run_ffmpeg)
        else:
            # A relative fixed filename also handles configured temp directories
            # containing colons/quotes; those must never enter filter syntax.
            with tempfile.TemporaryDirectory(prefix="subtitle_native_") as folder:
                shutil.copy2(srt_path, Path(folder) / "captions.srt")
                _run_ffmpeg(["-i", str(Path(video_path).resolve()), "-vf", "subtitles=captions.srt", "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", str(output_path.resolve())], cwd=folder)
        return str(output_path)
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
