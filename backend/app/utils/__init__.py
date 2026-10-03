"""Backend utility package.

Side-effect imports here run once at server boot — use them to set
process-wide defaults that every service should inherit, like Pillow's
decompression-bomb cap and its HEIC/HEIF opener. Keeping these centralised
means a new service can't accidentally `Image.open(...)` a 4-GB TIFF and
OOM the worker just because it forgot to set a limit, or reject an iPhone
photo because it forgot to register a codec.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Pillow decompression-bomb cap
# ---------------------------------------------------------------------------
# Pillow normally warns at ~89M pixels and aborts at ~178M. That's too lenient
# for a public web service — a single 16384×16384 RGBA PNG decoded to bitmap
# already eats ~1 GB of RAM. Cap at ~150M pixels so a 12000×12000 image
# (well above any reasonable photo or scan) still works, but a 30000×30000
# image is rejected outright with a DecompressionBombError.
try:
    from PIL import Image as _PILImage

    # Only raise the limit if it's lower (cheap idempotency in tests).
    _CAP = 150_000_000
    if _PILImage.MAX_IMAGE_PIXELS is None or _PILImage.MAX_IMAGE_PIXELS > _CAP:
        _PILImage.MAX_IMAGE_PIXELS = _CAP
except Exception:  # pragma: no cover — Pillow is a hard dep, this is defence-in-depth
    pass

# ---------------------------------------------------------------------------
# Pillow refuses a cut-off picture
# ---------------------------------------------------------------------------
# Pillow's default, so a cut-off upload is a 400 that says so (images.py)
# rather than a picture filled in with blank pixels. WeasyPrint switches it
# off for the whole process when it is imported, so WeasyPrint is only ever
# imported through weasyprint_loader.load_weasyprint(), which switches it back.
try:
    from PIL import ImageFile as _PILImageFile

    _PILImageFile.LOAD_TRUNCATED_IMAGES = False
except Exception:  # pragma: no cover — Pillow is a hard dep
    pass

# ---------------------------------------------------------------------------
# HEIC/HEIF decoding
# ---------------------------------------------------------------------------
# Pillow can't read HEIC on its own. pillow-heif adds the codec, but only in a
# process where `register_heif_opener()` has run. Every worker imports this
# package while loading the app, so any route that `Image.open`s an upload
# (image converter, remove-exif, compressor, image-to-pdf, heic-to-jpg) reads
# iPhone photos from its first request — not only after some other tool
# happened to register the opener earlier in the same process.
try:
    from pillow_heif import register_heif_opener as _register_heif_opener

    _register_heif_opener()
except ImportError:  # pragma: no cover — pillow-heif is a declared dependency
    pass

# ---------------------------------------------------------------------------
# ReportLab: binary streams, not ASCII85
# ---------------------------------------------------------------------------
# ReportLab ASCII85-encodes every image and page stream unless
# `rl_config.useA85` is off, and without its optional C accelerator (not
# installed) it does that in pure Python. In Image to PDF it was 95% of the
# CPU: 100 phone photos took 124 s instead of 6.3 s on the 2-core ARM VM, and
# the PDF came out a quarter bigger than its JPEGs (PR #270). ASCII85 only
# keeps a file 7-bit clean, which no PDF reader needs.
#
# ReportLab has no per-canvas switch. It reads this global when an image is
# drawn and again when pages are saved, so it is set once here instead of
# being toggled around one canvas while other threads build theirs. Every
# module that imports ReportLab imports this package
# (backend/tests/test_reportlab_binary_streams.py checks).
try:
    from reportlab import rl_config as _rl_config

    _rl_config.useA85 = 0
except ImportError:  # pragma: no cover — reportlab is a declared dependency
    pass
