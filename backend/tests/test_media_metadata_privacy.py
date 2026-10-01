"""Media downloads leave out where, when and on what a recording was made.

Phones tag each recording with its GPS location, the device and the date, and
FFmpeg copies an input's tags into its output unless told not to: a trimmed,
compressed or converted phone video kept the place it was recorded. Every
media route runs here on clips tagged the way phones and recorders tag them.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from backend.app.services import media_metadata

ROOT = Path(__file__).resolve().parents[2]
LOCATION = "+48.8584+002.2945+035.000/"
# What must not reach a download, searched for in its bytes as well as its tags.
PLANTED = [b"48.8584", b"2.2945", b"iPhone", b"17.0.3", b"2026-09-30", b"Rue Cler", b"Jane Example",
           b"Core Media", b"VoiceMemos"]
PHONE_TAGS = [
    "-metadata", f"location={LOCATION}", "-metadata", f"com.apple.quicktime.location.ISO6709={LOCATION}",
    "-metadata", "make=Apple", "-metadata", "model=iPhone 15 Pro",
    "-metadata", "com.apple.quicktime.make=Apple", "-metadata", "com.apple.quicktime.model=iPhone 15 Pro",
    "-metadata", "com.apple.quicktime.software=17.0.3",
    "-metadata", "com.apple.quicktime.creationdate=2026-09-30T18:42:07+0200",
    "-metadata", "creation_time=2026-09-30T16:42:07Z", "-metadata", "date=2026-09-30",
    # A title can name the place a recording was made.
    "-metadata", "title=12 Rue Cler", "-metadata", "artist=Jane Example",
]
STREAM_TAGS = [
    "-metadata:s:v", "handler_name=Core Media Video", "-metadata:s:a", "handler_name=Core Media Audio",
    "-metadata:s:v", "encoder=H.264", "-metadata:s", "creation_time=2026-09-30T16:42:07Z",
    "-metadata:s:a", "language=fra",
]
CHAPTERS = """;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=1500
title=Intro
[CHAPTER]
TIMEBASE=1/1000
START=1500
END=3000
title=Main
"""


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True, timeout=60)


@pytest.fixture(scope="module")
def tagged(tmp_path_factory):
    """Clips and recordings carrying location, device, dates, titles, handler
    and encoder names, two chapters, a French sound track and, for the
    videos, the 90-degree rotation a phone gives a portrait clip."""
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("needs FFmpeg and ffprobe")
    d = tmp_path_factory.mktemp("tagged-media")
    (d / "chapters.txt").write_text(CHAPTERS)
    (d / "captions.srt").write_text("1\n00:00:00,000 --> 00:00:02,500\nBonjour\n")
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=3", "-f", "lavfi", "-i",
           "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", d / "landscape.mp4")
    ffmpeg("-display_rotation", "90", "-i", d / "landscape.mp4", "-i", d / "chapters.txt", "-map", "0",
           "-map_chapters", "1", "-c", "copy", "-movflags", "use_metadata_tags", *PHONE_TAGS, *STREAM_TAGS,
           d / "phone.mov")
    ffmpeg("-display_rotation", "90", "-i", d / "landscape.mp4", "-i", d / "chapters.txt", "-i", d / "captions.srt",
           "-map", "0", "-map", "2", "-map_chapters", "1", "-c", "copy", "-c:s", "srt", *PHONE_TAGS, *STREAM_TAGS,
           "-metadata:s:s", "language=spa", "-metadata:s:s", "title=Notes by Jane Example", d / "phone.mkv")
    tone = ["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=3"]
    ffmpeg(*tone, "-i", d / "chapters.txt", "-map", "0", "-map_chapters", "1", "-c:a", "aac",
           "-movflags", "use_metadata_tags", *PHONE_TAGS, "-metadata", "encoder=com.apple.VoiceMemos (iPhone Version 17.0.3)",
           "-metadata:s:a", "handler_name=Core Media Audio", "-metadata:s:a", "language=fra", d / "memo.m4a")
    ffmpeg(*tone, "-i", d / "chapters.txt", "-map", "0", "-map_chapters", "1", "-c:a", "libmp3lame",
           *PHONE_TAGS, d / "memo.mp3")
    # Ogg keeps its tags on the stream rather than on the file.
    ffmpeg(*tone, "-c:a", "libvorbis", *PHONE_TAGS, "-metadata:s:a", "language=fra", d / "memo.ogg")
    # A recorder's WAV: RIFF INFO tags and a Broadcast Wave chunk naming the device.
    ffmpeg(*tone, "-c:a", "pcm_s16le", "-write_bext", "1", *PHONE_TAGS, "-metadata", "originator=iPhone 15 Pro",
           "-metadata", "origination_date=2026-09-30", "-metadata", "comment=12 Rue Cler", d / "memo.wav")
    frames = [Image.new("RGB", (64, 48), colour) for colour in ("red", "blue", "green")]
    frames[0].save(d / "notes.gif", save_all=True, append_images=frames[1:], duration=200, loop=0,
                   comment=f"12 Rue Cler {LOCATION} iPhone 15 Pro 2026-09-30".encode())
    return d


def upload(path, field="file"):
    return (field, (path.name, path.read_bytes(), "application/octet-stream"))


# endpoint, files, form, output suffix, and what the download must still have:
# its chapter titles (None: the format has no place for them), whether it
# shows upright, and the language of each sound and subtitle track
# (None: the format or the tool keeps none).
CASES = {
    "video-converter to MP4": ("video-converter", ["phone.mov"], {"target_format": "mp4"}, ".mp4", ["Intro", "Main"], True, ["fra"]),
    "video-converter to MOV": ("video-converter", ["phone.mov"], {"target_format": "mov"}, ".mov", ["Intro", "Main"], True, ["fra"]),
    "video-converter to MKV": ("video-converter", ["phone.mkv"], {"target_format": "mkv"}, ".mkv", ["Intro", "Main"], True, ["fra", "spa"]),
    "video-converter to WebM": ("video-converter", ["phone.mov"], {"target_format": "webm"}, ".webm", ["Intro", "Main"], True, ["fra"]),
    "video-converter to AVI": ("video-converter", ["phone.mov"], {"target_format": "avi"}, ".avi", None, True, None),
    "video-resizer": ("video-resizer", ["phone.mov"], {"preset": "240p"}, ".mp4", ["Intro", "Main"], True, ["fra"]),
    "compress-video": ("compress-video", ["phone.mov"], {"quality": "34"}, ".mp4", ["Intro", "Main"], True, ["fra"]),
    "trim-media video": ("trim-media", ["phone.mov"], {"start": "00:00:00.500", "end": "00:00:02"}, ".mov", ["Intro", "Main"], True, ["fra"]),
    "trim-media audio": ("trim-media", ["memo.mp3"], {"start": "00:00:00.500", "end": "00:00:02"}, ".mp3", ["Intro", "Main"], None, None),
    "audio-trim M4A": ("audio-trim", ["memo.m4a"], {"start": "0.5", "end": "2"}, ".m4a", ["Intro", "Main"], None, ["fra"]),
    "audio-trim OGG": ("audio-trim", ["memo.ogg"], {"start": "0.5", "end": "2"}, ".ogg", None, None, ["fra"]),
    "mute-video MOV": ("mute-video", ["phone.mov"], {}, ".mov", ["Intro", "Main"], True, []),
    "mute-video MKV": ("mute-video", ["phone.mkv"], {}, ".mkv", ["Intro", "Main"], True, ["spa"]),
    # Speed and Reverse move every moment, so chapters would point at the wrong ones.
    "video-speed": ("video-speed", ["phone.mov"], {"speed": "2"}, ".mp4", [], True, None),
    "reverse-video": ("reverse-video", ["phone.mov"], {}, ".mp4", [], True, ["fra"]),
    "extract-audio to MP3": ("extract-audio", ["phone.mov"], {"format": "mp3"}, ".mp3", ["Intro", "Main"], None, None),
    "extract-audio to WAV": ("extract-audio", ["phone.mov"], {"format": "wav"}, ".wav", None, None, None),
    "extract-audio to AAC": ("extract-audio", ["phone.mov"], {"format": "aac"}, ".aac", None, None, None),
    "extract-audio to FLAC": ("extract-audio", ["phone.mov"], {"format": "flac"}, ".flac", None, None, None),
    "extract-audio to OGG": ("extract-audio", ["phone.mov"], {"format": "ogg"}, ".ogg", None, None, ["fra"]),
    "add-subtitles": ("add-subtitles", ["phone.mov", ("srt", "captions.srt")], {}, ".mp4", ["Intro", "Main"], True, ["fra"]),
    "video-merge": ("video-merge", [("files", "phone.mov"), ("files", "phone.mov")], {}, ".mp4", [], True, None),
    "video-to-gif": ("video-to-gif", ["phone.mov"], {"fps": "5", "width": "120"}, ".gif", None, True, None),
    "video-thumbnail": ("video-thumbnail", ["phone.mov"], {"time_seconds": "1"}, ".jpg", None, True, None),
    "video-to-pdf": ("video-to-pdf", ["phone.mov"], {"frames": "2"}, ".pdf", None, None, None),
    "gif-to-mp4": ("gif-to-mp4", ["notes.gif"], {}, ".mp4", [], False, None),
    "audio-converter M4A to MP3": ("audio-converter", ["memo.m4a"], {"format": "mp3"}, ".mp3", ["Intro", "Main"], None, None),
    "audio-converter M4A to OGG": ("audio-converter", ["memo.m4a"], {"format": "ogg"}, ".ogg", None, None, ["fra"]),
    "audio-converter OGG to OGG": ("audio-converter", ["memo.ogg"], {"format": "ogg"}, ".ogg", None, None, ["fra"]),
    "audio-converter WAV to FLAC": ("audio-converter", ["memo.wav"], {"format": "flac"}, ".flac", None, None, None),
    "audio-merge": ("audio-merge", [("files", "memo.m4a"), ("files", "memo.mp3")], {}, ".mp3", [], None, None),
}
# FFmpeg's own tags, and the values its muxers write when a stream has none.
OWN_TAG_NAMES = {"major_brand", "minor_version", "compatible_brands", "duration"}
OWN_TAG_VALUES = {"VideoHandler", "SoundHandler", "SubtitleHandler", "FFMP", "[0][0][0][0]"}


def probe(path):
    return json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", str(path)], timeout=30))


@pytest.fixture
def ffmpeg_commands(monkeypatch):
    """Every FFmpeg command line the app runs during a test."""
    commands, real_run = [], subprocess.run

    def recording_run(command, *args, **kwargs):
        if isinstance(command, (list, tuple)) and command and command[0] == "ffmpeg":
            commands.append(list(command))
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", recording_run)
    return commands


@pytest.mark.parametrize("case", CASES)
def test_media_download_keeps_no_identifying_tags(client, tagged, tmp_path, ffmpeg_commands, case):
    endpoint, sources, form, suffix, chapters, upright, languages = CASES[case]
    files = [upload(tagged / s) if isinstance(s, str) else upload(tagged / s[1], s[0]) for s in sources]
    response = client.post(f"/api/{endpoint}", files=files, data=form)
    assert response.status_code == 200, response.text[:300]
    output = tmp_path / f"download{suffix}"
    output.write_bytes(response.content)

    # Every FFmpeg run writing a file took the tag options, whatever the input.
    writing = [command for command in ffmpeg_commands if "-i" in command]
    assert writing and all("-map_metadata:g" in command for command in writing), writing

    data = output.read_bytes()
    assert not [marker for marker in PLANTED if marker in data]
    if suffix == ".pdf":
        return
    info = probe(output)
    carried = [(scope, name, value)
               for scope, tags in [("file", info["format"].get("tags", {}))]
               + [(f"stream {s['index']}", s.get("tags", {})) for s in info["streams"]]
               for name, value in tags.items()
               if name.lower() not in OWN_TAG_NAMES | media_metadata.KEPT_STREAM_TAGS
               and value not in OWN_TAG_VALUES and not value.startswith(("Lavf", "Lavc"))]
    assert not carried

    if chapters is not None:
        assert [chapter.get("tags", {}).get("title") for chapter in info.get("chapters", [])] == chapters
    if languages is not None:
        tracks = [s for s in info["streams"] if s["codec_type"] in ("audio", "subtitle")]
        assert [s.get("tags", {}).get("language") for s in tracks] == languages
    if upright is not None:
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        width, height = video["width"], video["height"]
        turns = [entry["rotation"] for entry in video.get("side_data_list", []) if "rotation" in entry]
        if turns and round(turns[0] / 90) % 2:
            width, height = height, width
        # The portrait clip shows taller than wide, whether its frames were
        # turned upright or a copy kept the rotation; the GIF is landscape.
        assert (height > width) == upright, (video["width"], video["height"], turns)


def test_every_media_tool_runs_through_the_tag_check():
    """A new video or audio tool fails here until its route is in CASES."""
    manifest = json.loads((ROOT / "frontend" / "public" / "tool-content.json").read_text())
    overrides = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', (ROOT / "frontend" / "src" / "lib" / "tool-endpoints.ts").read_text()))
    media = re.compile(r"\.(mp4|mov|m4v|mkv|webm|avi|mp3|m4a|wav|aac|flac|ogg|opus|wma)\b")
    endpoints = {overrides.get(tool["slug"], f"/{tool['slug']}").lstrip("/")
                 for tool in manifest
                 if not tool.get("clientOnly") and (tool["category"] == "video-audio" or media.search(tool.get("accepts", "")))}
    assert len(endpoints) >= 17
    assert endpoints <= {endpoint for endpoint, *_ in CASES.values()}


def test_stream_tags_that_cannot_all_be_named_are_all_dropped(monkeypatch):
    """A name FFmpeg's command line cannot delete, or a probe that fails, means
    no stream keeps any tag rather than some keeping theirs."""
    def probe_answering(names):
        tags = {name: "x" for name in names}
        return lambda command, **kwargs: subprocess.CompletedProcess(command, 0, json.dumps({"streams": [{"tags": tags}]}), "")

    every_stream_tag = ["-map_metadata:g", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1"]
    monkeypatch.setattr(subprocess, "run", probe_answering(["language", "handler_name"]))
    assert media_metadata.metadata_options("clip.mov") == ["-map_metadata:g", "-1", "-metadata:s", "handler_name=", "-map_chapters", "-1"]
    monkeypatch.setattr(subprocess, "run", probe_answering(["handler_name", "where=Rue Cler"]))
    assert media_metadata.metadata_options("clip.mov") == every_stream_tag
    def unreadable(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, "", "Invalid data found when processing input")

    monkeypatch.setattr(subprocess, "run", unreadable)
    assert media_metadata.metadata_options("clip.mov") == every_stream_tag
    # A concat list's streams carry the listed clips' tags, not its own.
    assert media_metadata.with_metadata_options(["-f", "concat", "-i", "clips.txt", "-c", "copy", "out.mp4"]) == [
        "-f", "concat", "-i", "clips.txt", "-c", "copy", *every_stream_tag, "out.mp4"]
