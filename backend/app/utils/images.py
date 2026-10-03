"""Shared PIL image-open helper.

Centralises the ``Image.open()`` + size-guard + friendly-error pattern
that several services were copy-pasting. The global ``MAX_IMAGE_PIXELS``
cap in :mod:`app.utils.__init__` already protects us from
decompression-bomb OOMs at the bitmap-decode level; this helper adds a
typed error path so services don't all rediscover that ``UnidentifiedImageError``
and ``DecompressionBombError`` need the same answers as everywhere else (400,
and 413 for a bomb).

Use this from services that open an image file path directly. Code that
already needs raw PIL features (e.g. EXIF, frame iteration) can keep
calling ``Image.open()`` directly — this helper is meant for the common
"open it and convert to RGB" case.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from PIL import Image, UnidentifiedImageError

from .exceptions import FileTooLargeError, UnsupportedFileError, ValidationError


@contextmanager
def open_image_safe(
    path: str,
    *,
    convert: str | None = None,
) -> Iterator[Image.Image]:
    """Context-managed ``Image.open(path)`` with friendly errors.

    Args:
        path: filesystem path to the image.
        convert: optional PIL mode to convert to inside the context
            (e.g. ``"RGB"``). The conversion is done after the open so a
            corrupt image still raises the proper validation error.

    Raises:
        UnsupportedFileError: if PIL can't identify the format.
        FileTooLargeError: if the image hits the decompression-bomb cap
            (413, as everywhere else).
        ValidationError: if it otherwise fails to open.
    """
    try:
        img = Image.open(path)
    except UnidentifiedImageError as exc:
        raise UnsupportedFileError(image_read_error(exc)[1]) from exc
    except Image.DecompressionBombError as exc:
        raise FileTooLargeError(image_read_error(exc)[1]) from exc
    except (OSError, ValueError) as exc:
        # Truncated files, broken headers, etc.
        known = image_read_error(exc)
        raise ValidationError(known[1] if known else f"Couldn't read image: {exc}") from exc

    try:
        if convert and img.mode != convert:
            img = img.convert(convert)
        yield img
    finally:
        try:
            img.close()
        except Exception:  # pragma: no cover — defensive
            pass


_TRUNCATED_MESSAGES = (
    "image file is truncated",
    "broken data stream when reading image file",
)

# Pillow words its own decoders' failures "<status> when reading image file":
# "unrecognized data stream contents" for a PNG whose rows name a filter that
# does not exist, "buffer overrun" and so on. Out of memory is the server's.
_CODEC_STATUS = " when reading image file"
_NOT_THE_FILE = "out of memory"

# The decoders that word a failure their own way: (the module that raises it,
# the exception types, how the message starts). Matched only when raised in
# that module, since the same words elsewhere mean something else.
_DECODER_FAILURES = (
    # libtiff, for a compressed strip it cannot decode: "decoder error -2".
    ("PIL.TiffImagePlugin", (OSError,), ("decoder error ",)),
    # libwebp: a file cut short fails as it opens, garbled data as it loads.
    ("PIL.WebPImagePlugin", (OSError,), ("could not create decoder object", "failed to read next frame")),
    # libavif.
    ("PIL.AvifImagePlugin", (RuntimeError,), ("Failed to decode image", "Failed to decode frame",
                                              "Conversion from YUV failed")),
    # Pillow's Python decoders, such as a BMP's run-length data that runs
    # past its rows.
    ("PIL.ImageFile", (ValueError,), ("not enough image data", "cannot decode image data")),
    # libheif, through pillow-heif: a HEIC cut short ("Invalid input:
    # Unexpected end of file: ...") or one whose image data is garbled.
    ("pillow_heif", (ValueError, EOFError), ("Invalid input", "Decoder plugin generated an error")),
)

_STOPS_EARLY = "This image can't be read: its data stops early or is broken. Try the original file."


def _raised_in(exc: BaseException, module: str) -> bool:
    """Whether `exc` was raised in `module` or one of its submodules. A codec
    written in C raises in the Python code that called it."""
    tb = exc.__traceback__
    if tb is None:
        return False
    while tb.tb_next is not None:
        tb = tb.tb_next
    name = tb.tb_frame.f_globals.get("__name__", "")
    return name == module or name.startswith(module + ".")


def _decoder_failed(exc: BaseException) -> bool:
    message = str(exc)
    if isinstance(exc, OSError) and message.endswith(_CODEC_STATUS):
        return not message.startswith(_NOT_THE_FILE)
    return any(
        isinstance(exc, types) and message.startswith(prefixes) and _raised_in(exc, module)
        for module, types, prefixes in _DECODER_FAILURES
    )


def image_read_error(exc: BaseException) -> tuple[int, str] | None:
    """The HTTP status and message for an image Pillow could not read, or None.

    For a file that is not an image Pillow decodes (a text file named .png),
    one that stops part-way through or that its decoder cannot decode, and
    one past the pixel cap. The global catch-all and the routes that catch
    their own errors both use it, so a bad upload gets the same answer
    everywhere instead of a 500 whose page offers a retry that can never
    work. Matched on the class name and words, like the catch-all, so callers
    need not import the codec that raised; never on every OSError, which
    would blame the file for the server's own failures, such as saving a
    picture in a mode its format cannot hold.

    Neither message may say "damaged" or "corrupt": the frontend's
    friendlyError() turns those into its PDF advice. "not an image" maps to
    its image message.

    A library that rewords the error it caught, as ReportLab's ImageReader
    does ("identity=[ImageReader@...] failed to read next frame"), keeps the
    original as the new error's cause or context, which is read too.
    """
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        answer = _image_read_error(exc)
        if answer is not None:
            return answer
        if exc.__cause__ is not None:
            exc = exc.__cause__
        else:
            exc = None if exc.__suppress_context__ else exc.__context__
    return None


def _image_read_error(exc: BaseException) -> tuple[int, str] | None:
    name = type(exc).__name__
    if name == "DecompressionBombError":
        return 413, "Image is too large to process safely. Try a smaller image."
    if name == "UnidentifiedImageError":
        return 400, (
            "This file can't be read as an image: it's not an image, "
            "or it's in a format this tool doesn't read."
        )
    if isinstance(exc, OSError) and str(exc).startswith(_TRUNCATED_MESSAGES):
        return 400, _STOPS_EARLY
    if _decoder_failed(exc):
        return 400, _STOPS_EARLY
    return None


__all__ = ["image_read_error", "open_image_safe"]
