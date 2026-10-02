"""Shared PIL image-open helper.

Centralises the ``Image.open()`` + size-guard + friendly-error pattern
that several services were copy-pasting. The global ``MAX_IMAGE_PIXELS``
cap in :mod:`app.utils.__init__` already protects us from
decompression-bomb OOMs at the bitmap-decode level; this helper adds a
typed error path so services don't all rediscover that ``UnidentifiedImageError``
and ``DecompressionBombError`` need to map to the same 400 status.

Use this from services that open an image file path directly. Code that
already needs raw PIL features (e.g. EXIF, frame iteration) can keep
calling ``Image.open()`` directly — this helper is meant for the common
"open it and convert to RGB" case.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from PIL import Image, UnidentifiedImageError

from .exceptions import UnsupportedFileError, ValidationError


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
        ValidationError: if the image hits the decompression-bomb cap
            or otherwise fails to decode.
    """
    try:
        img = Image.open(path)
    except UnidentifiedImageError as exc:
        raise UnsupportedFileError(image_read_error(exc)[1]) from exc
    except Image.DecompressionBombError as exc:
        raise ValidationError(
            "Image is too large to process safely."
        ) from exc
    except (OSError, ValueError) as exc:
        # Truncated files, broken headers, etc.
        raise ValidationError(f"Couldn't read image: {exc}") from exc

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


def image_read_error(exc: BaseException) -> tuple[int, str] | None:
    """The HTTP status and message for an image Pillow could not read, or None.

    For a file that is not an image Pillow decodes (a text file named .png),
    one that stops part-way through, and one past the pixel cap. The global
    catch-all and the routes that catch their own errors both use it, so a
    bad upload gets the same answer everywhere instead of a 500 whose page
    offers a retry that can never work. Matched on the class name, like the
    catch-all, so callers need not import the codec that raised.

    Neither message may say "damaged" or "corrupt": the frontend's
    friendlyError() turns those into its PDF advice. "not an image" maps to
    its image message.
    """
    name = type(exc).__name__
    if name == "DecompressionBombError":
        return 413, "Image is too large to process safely. Try a smaller image."
    if name == "UnidentifiedImageError":
        return 400, (
            "This file can't be read as an image: it's not an image, "
            "or it's in a format this tool doesn't read."
        )
    if isinstance(exc, OSError) and str(exc).startswith(_TRUNCATED_MESSAGES):
        return 400, (
            "This image is incomplete: the file ends part-way through, so it "
            "can't be read. Try the original file."
        )
    return None


__all__ = ["image_read_error", "open_image_safe"]
