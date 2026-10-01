"""Keep a recording's identifying tags out of every media download.

Phones and recorders tag each file with where it was made (GPS), on what
(make, model, software version) and when, and name its streams after
themselves ("Core Media Video"); a title can name a place too. FFmpeg copies
an input's tags into its output unless told not to: the first input's
file-level tags, each stream's tags along with the stream, and the chapters
with their titles. A phone video that was trimmed, compressed or converted
here kept the place it was recorded.

Every FFmpeg command that writes a download goes through
with_metadata_options(), which the FFmpeg runners call, so a new media tool
gets it by default. What a file needs to play as recorded is not a tag and is
kept: a stream copy keeps the display rotation, colour description and pixel
aspect ratio, and a re-encode turns the frames upright. Of the tags, only
each stream's language stays, and chapter markers with their titles where a
tool keeps the timeline they mark.

Never map data streams (no `-map 0`): cameras and drones record GPS tracks
there, and FFmpeg leaves them out only while nothing asks for them.
"""

from __future__ import annotations

import json
import logging
import subprocess

logger = logging.getLogger(__name__)

# The stream tags a download keeps: which language a sound or subtitle track is in.
KEPT_STREAM_TAGS = frozenset({"language"})

# Far more than any recording carries; a file with more loses every stream tag.
_MAX_STREAM_TAGS = 256


def metadata_options(*inputs: str, chapters: bool = False) -> list[str]:
    """FFmpeg output options that leave out every tag `inputs` carry except
    their streams' languages, and their chapters unless `chapters` is true.

    `inputs` are the files whose streams FFmpeg may copy into the output.
    Without any, or when their stream tags cannot all be listed, no stream
    keeps any tag, its language included.
    """
    # File-level tags: location, make and model, dates, title, artist,
    # comments and the recording software are all here.
    options = ["-map_metadata:g", "-1"]
    names = _stream_tag_names(inputs) if inputs else None
    if names is None:
        options += ["-map_metadata:s", "-1"]
    else:
        # FFmpeg copies each stream's tags with the stream; an empty value
        # deletes one. Copying and deleting, rather than adding the language
        # back, keeps the language of whichever track FFmpeg picks.
        for name in sorted(names):
            options += ["-metadata:s", f"{name}="]
    if not chapters:
        options += ["-map_chapters", "-1"]
    return options


def with_metadata_options(command: list[str], *, chapters: bool = False) -> list[str]:
    """`command`, an FFmpeg command line that ends with its output file, with
    metadata_options() for its inputs placed before that file."""
    return [*command[:-1], *metadata_options(*_inputs(command), chapters=chapters), command[-1]]


def _inputs(command: list[str]) -> list[str]:
    """The files `command` reads, or none when one of them is read with a
    named format, such as a concat list, whose streams' tags are not that
    file's own. Sources FFmpeg generates itself (lavfi) carry no tags."""
    files: list[str] = []
    fmt = None
    for option, value in zip(command, command[1:-1]):
        if option == "-f":
            fmt = value
        elif option == "-i":
            if fmt is None:
                files.append(value)
            elif fmt != "lavfi":
                return []
            fmt = None
    return files


def _stream_tag_names(paths: tuple[str, ...]) -> set[str] | None:
    """The names of the stream tags in `paths` other than the kept ones, or
    None when they cannot all be read and deleted by name."""
    names: set[str] = set()
    for path in paths:
        try:
            result = subprocess.run(
                # Invalid UTF-8 in a name fails the probe rather than being
                # dropped from it, which would list a name the file lacks.
                ["ffprobe", "-v", "error", "-show_entries", "stream_tags",
                 "-of", "json=string_validation=fail", path],
                capture_output=True, timeout=15, text=True, check=True,
            )
            streams = json.loads(result.stdout)["streams"]
            for stream in streams:
                names.update(stream.get("tags", {}))
        except Exception as exc:  # whatever went wrong, drop every stream tag
            logger.info("media metadata: could not list stream tags (%s); dropping them all",
                        type(exc).__name__)
            return None
    names = {name for name in names if name.lower() not in KEPT_STREAM_TAGS}
    # "-metadata:s name=" ends the name at its first "=", so such a tag could
    # not be deleted.
    if len(names) > _MAX_STREAM_TAGS or any(not name or "=" in name for name in names):
        return None
    return names
