"""Plain SRT renderer for FFmpeg builds without libass.

Pillow renders only cue changes; a concat timeline keeps original timing without
creating one image per video frame. Native libass remains preferred for shaping.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import tempfile
from pathlib import Path

from ..utils.exceptions import DependencyError, ValidationError

TIMING = re.compile(r"^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$")


def read_cues(srt_path: str) -> list[tuple[float, float, str]]:
    if Path(srt_path).stat().st_size > 1_000_000:
        raise ValidationError("Subtitle files must be smaller than 1 MB.")
    try:
        text = Path(srt_path).read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    except UnicodeDecodeError as exc:
        raise ValidationError("Save your subtitles as a UTF-8 SRT file and try again.") from exc
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.strip().splitlines()
        if lines and lines[0].strip().isdigit():
            lines = lines[1:]
        match = TIMING.fullmatch(lines[0].strip()) if lines else None
        if not match or len(lines) < 2:
            raise ValidationError("The SRT file has an invalid cue. Each cue needs start/end timestamps and text.")
        values = [int(value) for value in match.groups()]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        caption = html.unescape(re.sub(r"</?(?:b|i|u|font)(?:\s[^>]*)?>", "", "\n".join(lines[1:]), flags=re.I)).strip()
        if end <= start or not caption or len(caption) > 1000:
            raise ValidationError("Each subtitle needs text, an end after its start, and at most 1,000 characters.")
        cues.append((start, end, caption))
        if len(cues) > 1000:
            raise ValidationError("This renderer supports up to 1,000 subtitle cues per video.")
    if not cues:
        raise ValidationError("The SRT file contains no subtitle cues.")
    return cues


def _video_shape(path: str) -> tuple[int, int, float]:
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:format=duration", "-of", "json", path], capture_output=True, text=True, timeout=15, check=True)
        info = json.loads(result.stdout)
        stream = info["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
        duration = float(info["format"]["duration"])
        rotation = next((s.get("rotation", 0) for s in stream.get("side_data_list", []) if "rotation" in s), 0)
        if abs(int(rotation)) % 180 == 90:
            width, height = height, width
        if not 0 < duration <= 14400 or not 0 < width * height <= 33_177_600:
            raise ValueError("Unsupported video dimensions or duration")
        return width, height, duration
    except FileNotFoundError as exc:
        raise DependencyError("Subtitle rendering requires FFprobe on this server.") from exc
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValidationError("Could not read this video. Use a video under four hours and up to 8K resolution.") from exc


def render_plain_subtitles(video_path: str, srt_path: str, output_path: str, run_ffmpeg) -> None:
    from PIL import Image, ImageDraw, ImageFont

    cues = read_cues(srt_path)
    width, height, duration = _video_shape(video_path)
    cues = [(start, min(end, duration), text) for start, end, text in cues if start < duration]
    if not cues:
        raise ValidationError("All subtitle cues start after this video ends. Check the timestamps.")
    # Fixed lower strip bounds raster work, even for 4K/8K sources.
    raster_width = min(width, 1920)
    font_size = max(12, min(56, round(raster_width / 26)))
    font = None
    for filename in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "DejaVuSans.ttf"):
        try:
            font = ImageFont.truetype(filename, font_size)
            break
        except OSError:
            continue
    if font is None:
        raise DependencyError("Subtitle rendering needs a font. Install DejaVu Sans or FFmpeg with libass.")
    strip_height = min(height, font_size * 6 + 20)
    points = sorted({0.0, duration, *(s for s, _, _ in cues), *(e for _, e, _ in cues)})
    if len(points) * raster_width * strip_height > 500_000_000:
        raise ValidationError("This subtitle file is too large to render here. Split the video or use fewer cues.")
    measure = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    def wrap(caption: str) -> list[str]:
        lines = []
        for paragraph in caption.splitlines():
            current = ""
            for character in paragraph:
                if measure.textlength(current + character, font=font) > raster_width - 32:
                    lines.append(current)
                    current = character
                else:
                    current += character
            if current:
                lines.append(current)
        if len(lines) * (font_size + 5) > strip_height - 20:
            raise ValidationError("A subtitle is too long for this video. Split long or overlapping cues into shorter lines.")
        return lines

    with tempfile.TemporaryDirectory(prefix="subtitle_raster_") as folder:
        root = Path(folder)
        images: dict[str, str] = {}
        manifest = ["ffconcat version 1.0"]
        last_name = ""
        for start, end in zip(points, points[1:]):
            active = "\n".join(text for cue_start, cue_end, text in cues if cue_start <= start < cue_end)
            if active not in images:
                name = f"caption_{len(images):04d}.png"
                image = Image.new("RGBA", (raster_width, strip_height))
                if active:
                    lines = wrap(active)
                    draw = ImageDraw.Draw(image)
                    block_height = len(lines) * (font_size + 5)
                    top = strip_height - block_height - 12
                    longest = max(draw.textlength(line, font=font) for line in lines)
                    draw.rounded_rectangle(((raster_width - longest) / 2 - 10, top - 5, (raster_width + longest) / 2 + 10, strip_height - 4), radius=5, fill=(0, 0, 0, 175))
                    for index, line in enumerate(lines):
                        draw.text((raster_width / 2, top + index * (font_size + 5)), line, font=font, fill="white", anchor="mt", stroke_width=1, stroke_fill=(0, 0, 0, 160))
                image.save(root / name)
                images[active] = name
            last_name = images[active]
            manifest.extend([f"file {last_name}", "option framerate 1000", f"duration {end-start:.3f}"])
        manifest.extend([f"file {last_name}", "option framerate 1000"])
        timeline = root / "captions.ffconcat"
        timeline.write_text("\n".join(manifest) + "\n", encoding="utf-8")
        run_ffmpeg(["-i", video_path, "-f", "concat", "-safe", "0", "-i", str(timeline), "-filter_complex", "[0:v:0][1:v:0]overlay=x=(W-w)/2:y=H-h:eof_action=pass:shortest=0[v]", "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", output_path], chapters=True)
