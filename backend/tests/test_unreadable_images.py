"""Unreadable images get a 400 that says why, not a 500 that invites a retry.

Routes that hand an upload to Pillow let `UnidentifiedImageError` (a text
file named .png, a format Pillow doesn't decode) and a truncated file's
`OSError` become a 500: through the catch-all ("Server error") or through
their own `except Exception` ("Conversion failed", "Watermark failed" and
so on). The page then offered "Try again" for a file that can never work.
"""

from __future__ import annotations

import base64
import io
import random
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main
from backend.app.utils.images import image_read_error

JUNK = b"just some text, not a picture"

# (route, upload field, file name, extra form fields)
ROUTES = [
    ("/api/image-converter", "file", "notes.png", {"target_format": "jpeg"}),
    ("/api/image-compressor", "file", "notes.png", {}),
    ("/api/generate-favicon", "file", "notes.png", {}),
    ("/api/image-watermark", "file", "notes.png", {"text": "draft"}),
    ("/api/remove-exif", "files", "notes.png", {}),
    ("/api/view-exif", "file", "notes.png", {}),
    ("/api/heic-to-jpg", "file", "notes.heic", {}),
]


@pytest.fixture
def quiet_client():
    # The catch-all re-raises after answering; keep the answer.
    return TestClient(main.app, raise_server_exceptions=False)


def _truncated_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 30, 30)).save(buf, "PNG")
    data = buf.getvalue()
    return data[: len(data) // 2]


@pytest.mark.parametrize("route,field,name,data", ROUTES, ids=[r[0] for r in ROUTES])
def test_a_file_that_is_not_an_image_is_a_400(quiet_client, route, field, name, data):
    response = quiet_client.post(route, files={field: (name, JUNK, "image/png")}, data=data)
    assert response.status_code == 400, response.text
    assert "not an image" in response.json()["detail"]


# View EXIF reads metadata without decoding pixels, so a file cut off in its
# image data still answers 200 there, which is right.
TRUNCATED = [r for r in ROUTES if r[2].endswith(".png") and r[0] != "/api/view-exif"] + [
    # Image OCR checks the magic bytes first, so only a cut-off image reaches Pillow.
    ("/api/image-ocr", "file", "cut.png", {}),
]


@pytest.mark.parametrize("route,field,name,data", TRUNCATED, ids=[r[0] for r in TRUNCATED])
def test_a_truncated_image_is_a_400(quiet_client, route, field, name, data):
    # Whether or not WeasyPrint has loaded in this process: see
    # test_cut_off_image_policy.py.
    response = quiet_client.post(route, files={field: ("cut.png", _truncated_png(), "image/png")}, data=data)
    assert response.status_code == 400, response.text
    assert "stops early or is broken" in response.json()["detail"]


def test_a_real_image_still_converts(quiet_client):
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), (10, 120, 200)).save(buf, "PNG")
    response = quiet_client.post(
        "/api/image-converter", files={"file": ("ok.png", buf.getvalue(), "image/png")}, data={"target_format": "jpeg"},
    )
    assert response.status_code == 200
    assert response.content[:3] == b"\xff\xd8\xff"


# ── Other decoders' failures ─────────────────────────────────────────────────
# Each codec words a broken file its own way, and only Pillow's truncation and
# "broken data stream" were recognised: these still answered 500. The files
# are made here, broken the way the failure needs.

def _picture(size=(96, 64)) -> Image.Image:
    img = Image.new("RGB", size)
    img.putdata([((x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256) for y in range(size[1]) for x in range(size[0])])
    return img


def _encoded(fmt: str, **options) -> bytes:
    buf = io.BytesIO()
    if fmt == "HEIF":
        import pillow_heif

        pillow_heif.from_pillow(_picture()).save(buf, quality=80)
    else:
        _picture().save(buf, fmt, **options)
    return buf.getvalue()


def _garbled(data: bytes, start: int, seed: int, length: int | None = None) -> bytes:
    """`data` with random bytes from `start`, for `length` bytes or to the end."""
    end = len(data) if length is None else start + length
    rnd = random.Random(seed)
    return data[:start] + bytes(rnd.randrange(256) for _ in range(end - start)) + data[end:]


def _png_with_rows(data: bytes, rows: bytes) -> bytes:
    """`data` with its image data replaced by `rows`, compressed and checksummed."""
    out, pos = bytearray(data[:8]), 8
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        payload = data[pos + 8:pos + 8 + length]
        if kind == b"IDAT":
            payload, rows = zlib.compress(rows), b""
        if payload or kind != b"IDAT":
            out += struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        pos += 12 + length
    return bytes(out)


def _bmp_rle8_overrun() -> bytes:
    """An 8-bit RLE BMP whose runs go past the end of its rows."""
    width, height = 16, 4
    palette = b"".join(bytes((i, i, i, 0)) for i in range(256))
    pixels = bytes([200, 5]) * 20 + b"\x00\x01"
    offset = 14 + 40 + len(palette)
    header = struct.pack("<2sIHHI", b"BM", offset + len(pixels), 0, 0, offset)
    info = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 8, 1, len(pixels), 2835, 2835, 256, 0)
    return header + info + palette + pixels


def _broken_samples() -> dict[str, tuple[bytes, str]]:
    """file name -> (bytes, what Pillow or its plugin raises for it)."""
    webp, heic = _encoded("WEBP", quality=80), _encoded("HEIF")
    tiff = _encoded("TIFF", compression="tiff_deflate")
    png, jpeg = _encoded("PNG"), _encoded("JPEG", quality=90)
    rows = b"".join(b"\x07" + b"\x10" * (96 * 3) for _ in range(64))  # filter type 7 does not exist
    samples = {
        "cut-off.jpg": (jpeg[: len(jpeg) // 2], "image file is truncated"),
        "cut-off.webp": (webp[: len(webp) // 2], "could not create decoder object"),
        "garbled.webp": (_garbled(webp, 40, 11), "failed to read next frame"),
        # The strips, not the directory, which Pillow writes after them.
        "garbled.tiff": (_garbled(tiff, 8, 13, length=len(tiff) // 2), "decoder error -2"),
        "bad-filter.png": (_png_with_rows(png, rows), "unrecognized data stream contents when reading image file"),
        "rle-overrun.bmp": (_bmp_rle8_overrun(), "not enough image data"),
        "cut-off.heic": (heic[: len(heic) // 2], "Invalid input"),
        "garbled.heic": (_garbled(heic, heic.find(b"mdat") + 4, 17), "Decoder plugin generated an error"),
    }
    try:
        avif = _encoded("AVIF", quality=60)
    except Exception:  # Pillow built without an AVIF encoder
        return samples
    samples["garbled.avif"] = (_garbled(avif, avif.find(b"mdat") + 4, 19), "Failed to decode frame")
    return samples


BROKEN = _broken_samples()
STOPS_EARLY = "This image can't be read: its data stops early or is broken. Try the original file."


@pytest.mark.parametrize("name", list(BROKEN))
def test_each_broken_sample_fails_in_its_codec_the_way_it_is_meant_to(name):
    data, raised = BROKEN[name]
    with pytest.raises(Exception) as caught:
        with Image.open(io.BytesIO(data)) as picture:
            picture.load()
            picture.convert("RGB")
    assert str(caught.value).startswith(raised)
    assert image_read_error(caught.value) == (400, STOPS_EARLY)


# route -> (upload field, extensions it accepts or None for any, form fields, copies of the file)
DECODING_ROUTES = {
    "/api/image-converter": ("file", None, {"target_format": "png"}, 1),
    "/api/image-compressor": ("file", None, {}, 1),
    "/api/remove-exif": ("files", None, {}, 1),
    "/api/resize-crop-image": ("file", None, {}, 1),
    "/api/image-palette": ("file", None, {}, 1),
    "/api/rotate-image": ("file", {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}, {}, 1),
    "/api/image-upscaler": ("file", None, {}, 1),
    "/api/heic-to-jpg": ("file", {".heic", ".heif"}, {}, 1),
    "/api/image-ocr": ("file", {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}, {}, 1),
    "/api/generate-favicon": ("file", {".jpg", ".jpeg", ".png", ".webp", ".bmp"}, {}, 1),
    "/api/image-watermark": ("file", {".jpg", ".jpeg", ".png", ".webp", ".bmp"}, {"text": "draft"}, 1),
    "/api/merge-images": ("files", {".jpg", ".jpeg", ".png", ".webp", ".bmp"}, {}, 2),
}
DECODING_CASES = [
    (route, name)
    for route, (_, accepts, _, _) in DECODING_ROUTES.items()
    for name in BROKEN
    if accepts is None or name[name.rindex("."):] in accepts
]


@pytest.mark.parametrize("route,name", DECODING_CASES)
def test_a_picture_its_codec_cannot_decode_is_a_400(quiet_client, route, name):
    field, _, data, copies = DECODING_ROUTES[route]
    files = [(field, (name, BROKEN[name][0], "application/octet-stream")) for _ in range(copies)]
    response = quiet_client.post(route, files=files, data=data)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


def test_view_exif_refuses_a_webp_it_cannot_open(quiet_client):
    # View EXIF reads metadata without decoding pixels; a WebP cut short
    # fails as Pillow opens it.
    response = quiet_client.post("/api/view-exif", files={"file": ("cut-off.webp", BROKEN["cut-off.webp"][0], "image/webp")})
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


def test_a_signature_its_codec_cannot_decode_is_a_400(quiet_client, sample_pdf):
    # verify() lets a picture whose data is broken through; signing decodes it.
    response = quiet_client.post(
        "/api/sign-pdf",
        files={"file": ("doc.pdf", sample_pdf, "application/pdf"),
               "signature": ("sig.webp", BROKEN["garbled.webp"][0], "image/webp")},
        data={"page": "1", "x": "50", "y": "50", "width": "100", "height": "40"},
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


@pytest.mark.parametrize("name", ["cut-off.jpg", "garbled.webp", "bad-filter.png", "rle-overrun.bmp"])
def test_a_watermark_picture_its_codec_cannot_decode_is_a_400(quiet_client, sample_pdf, name):
    # Watermark PDF only verify()s the picture, which reads its structure,
    # and answered 500 once the watermark was drawn.
    response = quiet_client.post(
        "/api/watermark",
        files={"file": ("doc.pdf", sample_pdf, "application/pdf"),
               "watermark_image": (name, BROKEN[name][0], "application/octet-stream")},
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


def test_a_watermark_picture_past_the_pixel_cap_is_a_413(quiet_client, sample_pdf):
    response = quiet_client.post(
        "/api/watermark",
        files={"file": ("doc.pdf", sample_pdf, "application/pdf"), "watermark_image": ("huge.png", _bomb_png(), "image/png")},
    )
    assert response.status_code == 413, response.text
    assert response.json()["detail"] == "Image is too large to process safely. Try a smaller image."


def _esign(quiet_client, sample_pdf, picture: bytes):
    signature = "data:image/png;base64," + base64.b64encode(picture).decode()
    return quiet_client.post("/api/esign-pdf", files={"file": ("doc.pdf", sample_pdf, "application/pdf")},
                             data={"signature": signature, "page": "1", "x": "100", "y": "600"})


@pytest.mark.parametrize("name", ["cut-off.jpg", "garbled.webp", "bad-filter.png", "garbled.heic"])
def test_an_uploaded_signature_its_codec_cannot_decode_is_a_400(quiet_client, sample_pdf, name):
    # E-Sign's service raised a ValidationError the route's `except ValueError`
    # missed (500), worded with Pillow's own words.
    response = _esign(quiet_client, sample_pdf, BROKEN[name][0])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


def test_an_uploaded_signature_that_is_not_a_picture_is_a_400(quiet_client, sample_pdf):
    response = _esign(quiet_client, sample_pdf, JUNK)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Signature isn't a recognised image format."


def test_remove_background_answers_a_decoder_failure_with_a_400(quiet_client, monkeypatch):
    # The model behind it is not downloaded here: decode the picture the way
    # rembg does, without the model.
    from backend.app.services import bg_remover_service

    def decode(path):
        with Image.open(path) as picture:
            picture.convert("RGB")

    monkeypatch.setattr(bg_remover_service, "remove_background", decode)
    response = quiet_client.post("/api/remove-background", files={"file": ("garbled.webp", BROKEN["garbled.webp"][0], "image/webp")})
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == STOPS_EARLY


def _raised(error: Exception) -> Exception:
    try:
        raise error
    except Exception as caught:
        return caught


@pytest.mark.parametrize("error", [
    # Pillow out of memory is the server's problem, not the file's.
    OSError("out of memory when reading image file"),
    # The same words raised by anything but the codec that uses them.
    OSError("decoder error -2"),
    OSError("failed to read next frame"),
    ValueError("Invalid input: the page range"),
    RuntimeError("Failed to decode frame 0: this one is ours"),
    ValueError("not enough image data"),
], ids=["out-of-memory", "tiff-words", "webp-words", "heif-words", "avif-words", "pil-words"])
def test_only_the_codecs_own_failures_are_blamed_on_the_file(error):
    assert image_read_error(_raised(error)) is None


def _error_while_handling_a_decode_error() -> KeyError:
    """A KeyError raised in an `except` around a failed Image.open: a bug in
    a fallback, which happened while the decode error was being handled."""
    try:
        try:
            Image.open(io.BytesIO(JUNK))
        except Exception:
            {}["fallback"]
    except KeyError as caught:
        return caught
    raise AssertionError("no KeyError")


def test_an_error_raised_while_handling_a_decode_error_is_not_blamed_on_the_file():
    assert image_read_error(_error_while_handling_a_decode_error()) is None


def test_the_catch_all_answers_it_with_a_logged_500(caplog):
    import asyncio

    from starlette.requests import Request

    from backend.app.middleware.error_handlers import builtin_exception_handler

    request = Request({"type": "http", "method": "POST", "path": "/api/example", "raw_path": b"/api/example",
                       "query_string": b"", "headers": [], "scheme": "http", "server": ("testserver", 80), "root_path": ""})
    with caplog.at_level("ERROR", logger="privatools.errors"):
        response = asyncio.run(builtin_exception_handler(request, _error_while_handling_a_decode_error()))
    assert response.status_code == 500
    assert "Unhandled exception" in caplog.text


def test_a_decode_error_reworded_by_the_code_that_caught_it_is_still_recognised():
    # ReportLab's ImageReader re-raises the same type with its own words in
    # front of the original's: "\nidentity=[ImageReader@...] failed to read next frame".
    try:
        try:
            with Image.open(io.BytesIO(BROKEN["garbled.webp"][0])) as picture:
                picture.load()
        except OSError as inner:
            raise OSError(f"\nidentity=[ImageReader@0x0 filename='sig.webp'] {inner}")
    except OSError as caught:
        assert image_read_error(caught) == (400, STOPS_EARLY)


def test_a_pillow_error_on_the_way_out_is_not_blamed_on_the_file():
    with pytest.raises(OSError) as caught:
        Image.new("RGBA", (4, 4)).save(io.BytesIO(), "JPEG")  # cannot write mode RGBA as JPEG
    assert image_read_error(caught.value) is None
    with pytest.raises(ValueError) as caught:
        Image.frombytes("RGB", (4, 4), b"\0")  # not enough image data, from the server's own bytes
    assert image_read_error(caught.value) is None


# ── Decompression bombs ──────────────────────────────────────────────────────

def _bomb_png() -> bytes:
    """A PNG that says it is 20000 x 20000 pixels, past the cap at open."""
    head = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 20000, 20000, 8, 0, 0, 0, 0)
    idat = zlib.compress(b"\0" * 1024)

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    return head + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.mark.parametrize("route,data", [
    # Generate Favicon and Image Watermark answered 400, Image Upscaler 400
    # "Invalid image file", where the other routes answer 413.
    ("/api/generate-favicon", {}),
    ("/api/image-watermark", {"text": "draft"}),
    ("/api/image-upscaler", {}),
    ("/api/image-converter", {"target_format": "png"}),
], ids=["favicon", "image-watermark", "image-upscaler", "image-converter"])
def test_a_decompression_bomb_is_a_413_everywhere(quiet_client, route, data):
    response = quiet_client.post(route, files={"file": ("huge.png", _bomb_png(), "image/png")}, data=data)
    assert response.status_code == 413, response.text
    assert response.json()["detail"] == "Image is too large to process safely. Try a smaller image."
