"""Decode real tool outputs; a 200 and nonempty download are not sufficient."""
import io
import json
import resource
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from backend.app.services.favicon_service import generate_favicon
from backend.app.services.video_tools_service import video_to_pdf


@pytest.mark.parametrize("size", [(120, 60), (40, 100), (8, 8)])
def test_favicon_contains_three_square_icons_without_distorting_artwork(tmp_path, size):
    source = tmp_path / "mark.png"
    Image.new("RGBA", size, (200, 40, 80, 255)).save(source)
    output = Path(generate_favicon(str(source)))
    try:
        with Image.open(output) as icon:
            assert icon.format == "ICO"
            assert icon.ico.sizes() == {(16, 16), (32, 32), (48, 48)}
            largest = icon.ico.getimage((48, 48)).convert("RGBA")
            assert largest.getpixel((24, 24)) == (200, 40, 80, 255)
            if size[0] != size[1]:
                assert largest.getpixel((0, 0))[3] == 0
                bounds = largest.getbbox()
                assert abs((bounds[2] - bounds[0]) / (bounds[3] - bounds[1]) - size[0] / size[1]) < 0.04
    finally:
        output.unlink(missing_ok=True)


@pytest.fixture(scope="module")
def media_fixtures(tmp_path_factory):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not shutil.which("ffprobe"):
        pytest.skip("Real media-output regression requires ffmpeg and ffprobe")
    directory = tmp_path_factory.mktemp("media-integrity")
    # Long GOP guarantees there is no keyframe at the selected start/end.
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-g", "100", "-c:a", "aac", "-shortest", str(directory / "clip.mp4")], check=True, timeout=30)
    return directory


def inspect_download(response, destination):
    assert response.status_code == 200, response.text[:300] if response.status_code != 200 else ""
    destination.write_bytes(response.content)
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(destination)], capture_output=True, check=True, timeout=15)
    return json.loads(result.stdout)


@pytest.mark.parametrize("start,end", [("00:00:00", "00:00:02"), ("00:00:00.400", "00:00:01.500")])
def test_video_trim_retains_video_and_audio_between_keyframes(client, media_fixtures, tmp_path, start, end):
    response = client.post("/api/trim-media", files={"file": ("clip.mp4", (media_fixtures / "clip.mp4").read_bytes(), "video/mp4")}, data={"start": start, "end": end})
    info = inspect_download(response, tmp_path / "trimmed.mp4")
    assert {stream["codec_type"] for stream in info["streams"]} == {"audio", "video"}
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    assert (video["width"], video["height"]) == (160, 90)
    duration = float(end.split(":")[-1]) - float(start.split(":")[-1])
    assert abs(float(info["format"]["duration"]) - duration) <= 0.15
    # Exercise decoding, not just container headers.
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(tmp_path / "trimmed.mp4"), "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"], check=True, timeout=15)


def test_trim_keeps_silent_video_usable(client, media_fixtures, tmp_path):
    source = tmp_path / "silent.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(media_fixtures / "clip.mp4"), "-an", "-c:v", "copy", str(source)], check=True, timeout=15)
    response = client.post("/api/trim-media", files={"file": ("silent.mp4", source.read_bytes(), "video/mp4")}, data={"start": "00:00:00.500", "end": "00:00:01.500"})
    info = inspect_download(response, tmp_path / "result.mp4")
    assert [stream["codec_type"] for stream in info["streams"]] == ["video"]


@pytest.mark.parametrize("portrait", [False, True])
def test_video_pdf_places_each_frame_on_its_own_page_within_page_bounds(media_fixtures, tmp_path, portrait):
    import fitz
    source = media_fixtures / "clip.mp4"
    if portrait:
        rotated = tmp_path / "portrait.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-vf", "transpose=1", "-an", str(rotated)], check=True, timeout=20)
        source = rotated
    output = Path(video_to_pdf(str(source), frames=3))
    try:
        with fitz.open(output) as document:
            assert len(document) == 3
            for page in document:
                images = page.get_image_info()
                assert len(images) == 1
                rectangle = fitz.Rect(images[0]["bbox"])
                assert page.rect.contains(rectangle)
                assert rectangle.width > 0 and rectangle.height > 0
    finally:
        output.unlink(missing_ok=True)


@pytest.mark.parametrize("endpoint", ["trim-media", "audio-trim"])
@pytest.mark.parametrize("extension", ["mp3", "wav", "aac", "flac", "ogg", "m4a"])
def test_audio_only_trim_preserves_container_and_codec(client, media_fixtures, tmp_path, extension, endpoint):
    source = tmp_path / f"sound.{extension}"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(media_fixtures / "clip.mp4"), "-vn", str(source)], check=True, timeout=20)
    source_info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(source)]))
    response = client.post(f"/api/{endpoint}", files={"file": (source.name, source.read_bytes(), "application/octet-stream")}, data={"start": "00:00:00.500", "end": "00:00:01.500"})
    info = inspect_download(response, tmp_path / f"result.{extension}")
    assert [stream["codec_type"] for stream in info["streams"]] == ["audio"]
    assert info["streams"][0]["codec_name"] == source_info["streams"][0]["codec_name"]
    assert 0.85 <= float(info["format"]["duration"]) <= 1.2
    assert response.headers["content-type"].startswith("audio/")


def stream_seconds(info, kind):
    return float(next(stream for stream in info["streams"] if stream["codec_type"] == kind)["duration"])


@pytest.fixture(scope="module")
def speed_clip(media_fixtures):
    # 30 fps keeps the video's duration within a few frames of the exact value at 4x.
    path = media_fixtures / "speed.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path)], check=True, timeout=30)
    return path


# The slider's 0.25x end and the 4x preset, sent with two decimals as the page does.
@pytest.mark.parametrize("speed,seconds", [("0.25", 8.0), ("4.00", 0.5)])
def test_video_speed_accepts_both_ends_of_its_range(client, speed_clip, tmp_path, speed, seconds):
    response = client.post("/api/video-speed", files={"file": ("clip.mp4", speed_clip.read_bytes(), "video/mp4")}, data={"speed": speed})
    info = inspect_download(response, tmp_path / "speed.mp4")
    # Per stream: audio left at the old tempo would still pass a check of the file's duration.
    assert abs(stream_seconds(info, "video") - seconds) <= 0.15
    assert abs(stream_seconds(info, "audio") - seconds) <= 0.15


@pytest.mark.parametrize("speed", ["0.24", "4.01"])
def test_video_speed_rejects_speeds_outside_its_range(client, speed_clip, speed):
    response = client.post("/api/video-speed", files={"file": ("clip.mp4", speed_clip.read_bytes(), "video/mp4")}, data={"speed": speed})
    assert response.status_code == 422


def test_video_speed_changes_a_video_without_audio(client, speed_clip, tmp_path):
    source = tmp_path / "silent.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(speed_clip), "-an", "-c:v", "copy", str(source)], check=True, timeout=15)
    response = client.post("/api/video-speed", files={"file": ("silent.mp4", source.read_bytes(), "video/mp4")}, data={"speed": "2"})
    info = inspect_download(response, tmp_path / "result.mp4")
    assert [stream["codec_type"] for stream in info["streams"]] == ["video"]
    assert abs(stream_seconds(info, "video") - 1.0) <= 0.15


def solid_clip(path, colour, size, *, sar="1", codec=("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac")):
    """Two seconds of one colour with a tone, so bars and stretching are easy to find."""
    # rgb24: in YUV the colour source rounds an odd size down to even.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={colour}:s={size}:r=10:d=2,format=rgb24", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-vf", f"setsar={sar}", *codec, "-shortest", str(path)], check=True, timeout=30)
    return path


@pytest.fixture(scope="module")
def merge_clips(media_fixtures):
    wide = solid_clip(media_fixtures / "wide.mp4", "blue", "320x180")
    # Phones store portrait video as landscape frames plus a display rotation.
    portrait = media_fixtures / "portrait.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-display_rotation", "90", "-i", str(wide), "-c", "copy", str(portrait)], check=True, timeout=15)
    return {
        "wide": wide,
        "portrait": portrait,
        "small": solid_clip(media_fixtures / "small.mp4", "red", "160x120"),
        # 180x180 stored pixels, each 16:9 wide, display as 320x180.
        "anamorphic": solid_clip(media_fixtures / "anamorphic.mp4", "red", "180x180", sar="16/9"),
        # VP8 keeps an odd size; H.264 in 4:2:0 needs even dimensions.
        "odd": solid_clip(media_fixtures / "odd.webm", "blue", "321x181", codec=("-c:v", "libvpx", "-deadline", "realtime", "-c:a", "libopus")),
    }


def merge(client, *clips):
    return client.post("/api/video-merge", files=[("files", (clip.name, clip.read_bytes(), "video/mp4")) for clip in clips])


def frame_size(info):
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    return video["width"], video["height"]


def colours_at(video, seconds, points, tmp_path):
    frame = tmp_path / f"frame-{seconds}.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(seconds), "-i", str(video), "-frames:v", "1", str(frame)], check=True, timeout=15)
    with Image.open(frame) as image:
        pixels = image.convert("RGB")
        return [colour_name(pixels.getpixel(point)) for point in points]


def colour_name(pixel):
    red, green, blue = pixel
    if max(pixel) < 40:
        return "black"
    if red > 180 and green < 70 and blue < 70:
        return "red"
    if blue > 180 and red < 70 and green < 70:
        return "blue"
    return str(pixel)


def test_video_merge_fits_clips_of_another_size_inside_the_first_clips_frame(client, merge_clips, tmp_path):
    info = inspect_download(merge(client, merge_clips["wide"], merge_clips["small"]), tmp_path / "merged.mp4")
    assert frame_size(info) == (320, 180)
    assert {stream["codec_type"] for stream in info["streams"]} == {"video", "audio"}
    assert abs(float(info["format"]["duration"]) - 4.0) <= 0.2
    assert colours_at(tmp_path / "merged.mp4", 1, [(10, 90), (310, 90)], tmp_path) == ["blue", "blue"]
    # 160x120 is 4:3: fitted to 180 lines it is 240 wide, centred between 40-pixel bars.
    assert colours_at(tmp_path / "merged.mp4", 3, [(20, 90), (50, 90), (160, 90), (270, 90), (300, 90)], tmp_path) == ["black", "red", "red", "red", "black"]


def test_video_merge_takes_the_frame_from_the_first_clip_as_displayed(client, merge_clips, tmp_path):
    info = inspect_download(merge(client, merge_clips["portrait"], merge_clips["small"]), tmp_path / "merged.mp4")
    assert frame_size(info) == (180, 320)
    assert colours_at(tmp_path / "merged.mp4", 1, [(10, 10), (170, 310)], tmp_path) == ["blue", "blue"]
    # 160x120 fitted to 180 columns is 135 lines, centred between bars above and below.
    assert colours_at(tmp_path / "merged.mp4", 3, [(90, 40), (90, 160), (90, 290)], tmp_path) == ["black", "red", "black"]


def test_video_merge_keeps_the_shape_of_clips_with_non_square_pixels(client, merge_clips, tmp_path):
    info = inspect_download(merge(client, merge_clips["anamorphic"], merge_clips["wide"]), tmp_path / "merged.mp4")
    assert frame_size(info) == (320, 180)
    assert colours_at(tmp_path / "merged.mp4", 1, [(10, 90), (310, 90)], tmp_path) == ["red", "red"]
    assert colours_at(tmp_path / "merged.mp4", 3, [(10, 90), (310, 90)], tmp_path) == ["blue", "blue"]


def test_video_merge_gives_every_clip_without_audio_a_silent_track(client, merge_clips, tmp_path):
    silent = []
    for name in ("quiet-1.mp4", "quiet-2.mp4"):
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(merge_clips["wide"]), "-an", "-c:v", "copy", str(tmp_path / name)], check=True, timeout=15)
        silent.append(tmp_path / name)
    info = inspect_download(merge(client, merge_clips["wide"], *silent), tmp_path / "merged.mp4")
    assert {stream["codec_type"] for stream in info["streams"]} == {"video", "audio"}
    assert abs(float(info["format"]["duration"]) - 6.0) <= 0.2


def test_video_merge_rounds_an_odd_first_clip_down_to_an_even_frame(client, merge_clips, tmp_path):
    source = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(merge_clips["odd"])], timeout=15))
    assert frame_size(source) == (321, 181)
    info = inspect_download(merge(client, merge_clips["odd"], merge_clips["small"]), tmp_path / "merged.mp4")
    assert frame_size(info) == (320, 180)


def test_video_merge_past_ffmpegs_time_limit_answers_504(client, merge_clips, monkeypatch):
    """Three minutes of 1080p reach FFmpeg's 180 s limit in the v2.7.5 image
    on production's 1.8 CPUs, and the route answered that with a 500, so the
    page said "Processing failed. Please try again." """
    real_run = subprocess.run
    outputs = []

    def ffmpeg_out_of_time(command, *args, **kwargs):
        if command and command[0] == "ffmpeg":
            # FFmpeg has written part of the merge by the time it is stopped:
            # about 250 MB at the real limit.
            Path(command[-1]).write_bytes(b"\0" * 1024)
            outputs.append(Path(command[-1]))
            raise subprocess.TimeoutExpired(command, kwargs.get("timeout"))
        return real_run(command, *args, **kwargs)  # ffprobe still answers

    monkeypatch.setattr(subprocess, "run", ffmpeg_out_of_time)
    response = merge(client, merge_clips["wide"], merge_clips["small"])
    assert response.status_code == 504, response.text
    assert outputs and not any(path.exists() for path in outputs), "the partial merge was left in the temp directory"


def test_video_merge_leaves_out_where_and_on_what_the_clips_were_recorded(client, merge_clips, tmp_path):
    """Phones tag each recording with where it was made and on what. The
    merge copied the first clip's tags into its output, GPS location included."""
    tagged = []
    for name in ("wide", "small"):
        dst = tmp_path / f"{name}-tagged.mov"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(merge_clips[name]), "-c", "copy",
                        "-metadata", "location=+48.8584+002.2945/", "-metadata", "make=Apple",
                        "-metadata", "model=iPhone 15", str(dst)], check=True, timeout=30)
        tagged.append(dst)
    merged = tmp_path / "merged.mp4"
    info = inspect_download(merge(client, *tagged), merged)
    assert not {key.lower() for key in info["format"].get("tags", {})} & {"location", "make", "model"}
    assert b"+48.8584" not in merged.read_bytes()
    assert b"iPhone 15" not in merged.read_bytes()


def test_video_merge_of_a_file_that_is_no_video_answers_400(client, merge_clips, tmp_path):
    notes = tmp_path / "notes.mp4"
    notes.write_bytes(b"Meeting notes, saved with the wrong name.")
    response = merge(client, notes, merge_clips["wide"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Could not read the frame size of the first video."


def child_cpu_seconds():
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return usage.ru_utime + usage.ru_stime


@pytest.fixture(scope="module")
def motion_clips(media_fixtures):
    """The same five seconds of 640x360 motion as MP4 and as WebM."""
    mp4, webm = media_fixtures / "motion.mp4", media_fixtures / "motion.webm"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(mp4)], check=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp4), "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", str(webm)], check=True, timeout=60)
    return mp4, webm


def cpu_seconds_for(client, endpoint, upload, data):
    """CPU used by the route's encoder: load from other processes does not inflate it."""
    before = child_cpu_seconds()
    response = client.post(endpoint, files={"file": upload}, data=data)
    assert response.status_code == 200, response.text[:300]
    return child_cpu_seconds() - before, response


# libvpx-vp9 at its default speed used several times the CPU of the H.264
# path, so WebM output of more than about 15 s of 720p hit the 180 s limit.
def test_webm_conversion_costs_about_as_much_cpu_as_mp4(client, motion_clips, tmp_path):
    mp4, _ = motion_clips
    upload = ("motion.mp4", mp4.read_bytes(), "video/mp4")
    to_mp4, _ = cpu_seconds_for(client, "/api/video-converter", upload, {"target_format": "mp4"})
    to_webm, response = cpu_seconds_for(client, "/api/video-converter", upload, {"target_format": "webm"})
    assert to_webm < 3 * to_mp4, f"WebM took {to_webm:.1f} s of CPU, MP4 {to_mp4:.1f} s"
    info = inspect_download(response, tmp_path / "converted.webm")
    assert sorted(stream["codec_name"] for stream in info["streams"]) == ["opus", "vp9"]
    assert abs(float(info["format"]["duration"]) - 5.0) <= 0.2


def test_webm_trim_costs_about_as_much_cpu_as_mp4_trim(client, motion_clips, tmp_path):
    mp4, webm = motion_clips
    window = {"start": "00:00:00", "end": "00:00:05"}
    as_mp4, _ = cpu_seconds_for(client, "/api/trim-media", ("motion.mp4", mp4.read_bytes(), "video/mp4"), window)
    as_webm, response = cpu_seconds_for(client, "/api/trim-media", ("motion.webm", webm.read_bytes(), "video/webm"), window)
    assert as_webm < 3 * as_mp4, f"WebM took {as_webm:.1f} s of CPU, MP4 {as_mp4:.1f} s"
    info = inspect_download(response, tmp_path / "trimmed.webm")
    assert sorted(stream["codec_name"] for stream in info["streams"]) == ["opus", "vp9"]
