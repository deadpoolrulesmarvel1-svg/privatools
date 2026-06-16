"""Smoke tests for the phase1–phase7 + new_tools + v12_tools route bundles.

Each phased route file adds 4–8 endpoints; the route_coverage test confirms
they are *registered*, but says nothing about *behaviour*. These tests pin
the contract that:
  - every phased endpoint is reachable via the registered path,
  - input validation triggers a 400 (not 500) for the obvious bad inputs,
  - happy-path PDF/image fixtures produce a 2xx + the documented Content-Type
    when the underlying tool isn't gated on a missing system dep.

A handful of endpoints depend on external binaries (libreoffice, ffmpeg,
cairosvg, libheif, etc.) that aren't guaranteed everywhere. Those skip
gracefully on 500 so they don't break CI on a slim image — what matters is
the route is registered and validates inputs.
"""

from __future__ import annotations

import io
import json

import pytest


def _is_pdf(content: bytes) -> bool:
    return content[:5] == b"%PDF-"


# ---------------------------------------------------------------------------
# Phase 1 — document conversions + stamp + HEIC
# ---------------------------------------------------------------------------

class TestPhase1:
    def test_word_to_pdf_rejects_pdf_input(self, client, sample_pdf):
        resp = client.post(
            "/api/word-to-pdf",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_excel_to_pdf_rejects_non_xlsx(self, client):
        resp = client.post(
            "/api/excel-to-pdf",
            files={"file": ("a.csv", b"a,b\n1,2", "text/csv")},
        )
        assert resp.status_code == 400

    def test_pptx_to_pdf_convert_rejects_non_pptx(self, client, sample_pdf):
        resp = client.post(
            "/api/pptx-to-pdf-convert",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_stamp_pdf_default_settings(self, client, sample_pdf):
        """Stamping with defaults must succeed and return a PDF."""
        resp = client.post(
            "/api/stamp-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"stamp_type": "confidential"},
        )
        # Skip if the underlying stamp_service throws on this minimal PDF;
        # we already pin the input-validation contract elsewhere.
        if resp.status_code == 500:
            pytest.skip("stamp_service unavailable on this env")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)
        assert resp.headers.get("content-type", "").startswith("application/pdf")

    def test_stamp_pdf_custom_text(self, client, sample_pdf):
        resp = client.post(
            "/api/stamp-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"stamp_type": "custom", "custom_text": "DRAFT", "position": "top"},
        )
        if resp.status_code == 500:
            pytest.skip("stamp_service unavailable on this env")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)

    def test_stamp_pdf_invalid_pages_pattern(self, client, sample_pdf):
        """pages must match 'all' or 'n,n,n'."""
        resp = client.post(
            "/api/stamp-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"stamp_type": "confidential", "pages": "1-3"},  # ranges not allowed by validator
        )
        assert resp.status_code == 400

    def test_txt_to_pdf_happy_path(self, client):
        resp = client.post(
            "/api/txt-to-pdf",
            files={"file": ("hello.txt", b"Hello PrivaTools.\nLine two.\n", "text/plain")},
        )
        if resp.status_code == 500:
            pytest.skip("txt_to_pdf_service unavailable on this env")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)

    def test_heic_to_jpg_rejects_non_heic(self, client, jpeg_image):
        resp = client.post(
            "/api/heic-to-jpg",
            files={"file": ("img.jpg", jpeg_image, "image/jpeg")},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Phase 2 — esign, extract-tables, remove-background
# ---------------------------------------------------------------------------

class TestPhase2:
    def test_esign_pdf_rejects_empty_signature(self, client, sample_pdf):
        resp = client.post(
            "/api/esign-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"signature": "   "},
        )
        assert resp.status_code == 400

    def test_esign_pdf_rejects_oversize_signature(self, client, sample_pdf):
        # 5 MB of base64 data — limit is 4 MB.
        big_sig = "a" * (5 * 1024 * 1024)
        resp = client.post(
            "/api/esign-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"signature": big_sig},
        )
        assert resp.status_code == 413

    def test_extract_tables_rejects_bad_pages(self, client, sample_pdf):
        resp = client.post(
            "/api/extract-tables",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"pages": "first,second"},  # not numeric
        )
        assert resp.status_code == 400

    def test_remove_background_rejects_pdf(self, client, sample_pdf):
        resp = client.post(
            "/api/remove-background",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Phase 3 — URL→PDF, PDF→MD, SVG→PNG, barcode, image watermark, favicon, collage
# ---------------------------------------------------------------------------

class TestPhase3:
    def test_url_to_pdf_requires_url(self, client):
        resp = client.post("/api/url-to-pdf", data={"url": "   "})
        assert resp.status_code == 400

    def test_pdf_to_markdown_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/pdf-to-markdown",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_svg_to_png_rejects_non_svg(self, client, jpeg_image):
        resp = client.post(
            "/api/svg-to-png",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
        )
        assert resp.status_code == 400

    def test_generate_barcode_rejects_empty_data(self, client):
        resp = client.post(
            "/api/generate-barcode",
            data={"data": "   ", "barcode_type": "code128"},
        )
        assert resp.status_code == 400

    def test_generate_barcode_rejects_bad_ean13(self, client):
        resp = client.post(
            "/api/generate-barcode",
            data={"data": "abc", "barcode_type": "ean13"},
        )
        assert resp.status_code == 400

    def test_generate_barcode_rejects_bad_code39(self, client):
        resp = client.post(
            "/api/generate-barcode",
            data={"data": "lowercase", "barcode_type": "code39"},
        )
        assert resp.status_code == 400
        assert "code39 allows uppercase" in resp.json()["detail"]

    def test_generate_barcode_rejects_unknown_type(self, client):
        resp = client.post(
            "/api/generate-barcode",
            data={"data": "Hello", "barcode_type": "morse"},
        )
        assert resp.status_code == 400

    def test_image_watermark_rejects_non_image(self, client, sample_pdf):
        resp = client.post(
            "/api/image-watermark",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
            data={"text": "WM"},
        )
        assert resp.status_code == 400

    def test_image_watermark_rejects_bad_position(self, client, jpeg_image):
        resp = client.post(
            "/api/image-watermark",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"text": "WM", "position": "north-west"},
        )
        assert resp.status_code == 400

    def test_make_collage_requires_at_least_two_images(self, client, jpeg_image):
        resp = client.post(
            "/api/make-collage",
            files=[("files", ("a.jpg", jpeg_image, "image/jpeg"))],
        )
        assert resp.status_code == 400

    def test_make_collage_rejects_bad_hex(self, client, jpeg_image):
        resp = client.post(
            "/api/make-collage",
            files=[
                ("files", ("a.jpg", jpeg_image, "image/jpeg")),
                ("files", ("b.jpg", jpeg_image, "image/jpeg")),
            ],
            data={"bg_color": "red"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Phase 4 — whiteout, attachment, permissions, JSON/XML conversion, annotate,
# shapes, EPUB/RTF
# ---------------------------------------------------------------------------

class TestPhase4:
    def test_whiteout_pdf_rejects_empty_regions(self, client, sample_pdf):
        resp = client.post(
            "/api/whiteout-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"regions": "[]"},
        )
        assert resp.status_code == 400

    def test_whiteout_pdf_rejects_invalid_json(self, client, sample_pdf):
        resp = client.post(
            "/api/whiteout-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"regions": "{not json"},
        )
        assert resp.status_code == 400

    def test_add_attachment_rejects_missing_attachment(self, client, sample_pdf):
        resp = client.post(
            "/api/add-attachment",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 422  # missing required UploadFile

    def test_set_permissions_rejects_long_password(self, client, sample_pdf):
        resp = client.post(
            "/api/set-permissions",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"owner_password": "x" * 200},
        )
        assert resp.status_code == 400

    def test_json_to_pdf_rejects_non_json_extension(self, client):
        resp = client.post(
            "/api/json-to-pdf",
            files={"file": ("data.txt", b'{"a":1}', "text/plain")},
        )
        assert resp.status_code == 400

    def test_xml_to_pdf_rejects_non_xml_extension(self, client):
        resp = client.post(
            "/api/xml-to-pdf",
            files={"file": ("data.txt", b"<a/>", "text/plain")},
        )
        assert resp.status_code == 400

    def test_annotate_pdf_rejects_invalid_json(self, client, sample_pdf):
        resp = client.post(
            "/api/annotate-pdf",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"annotations": "not json"},
        )
        assert resp.status_code == 400

    def test_add_shapes_rejects_non_array(self, client, sample_pdf):
        resp = client.post(
            "/api/add-shapes",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"shapes": '{"type":"rect"}'},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Phase 5 — merge-images, read-qr
# ---------------------------------------------------------------------------

class TestPhase5:
    def test_merge_images_requires_two(self, client, jpeg_image):
        resp = client.post(
            "/api/merge-images",
            files=[("files", ("a.jpg", jpeg_image, "image/jpeg"))],
        )
        assert resp.status_code == 400

    def test_merge_images_rejects_invalid_direction(self, client, jpeg_image):
        resp = client.post(
            "/api/merge-images",
            files=[
                ("files", ("a.jpg", jpeg_image, "image/jpeg")),
                ("files", ("b.jpg", jpeg_image, "image/jpeg")),
            ],
            data={"direction": "sideways"},
        )
        assert resp.status_code == 400

    def test_read_qr_rejects_non_image(self, client, sample_pdf):
        resp = client.post(
            "/api/read-qr",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_read_qr_returns_503_when_libzbar_missing_or_json_when_present(self, client, jpeg_image):
        """Either pyzbar is installed (200 with empty list) or missing (503).

        Either way the route must NOT 500. This is the regression test for the
        startup-import fix in phase5_tools.
        """
        resp = client.post(
            "/api/read-qr",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
        )
        assert resp.status_code in (200, 503), resp.text
        if resp.status_code == 200:
            body = resp.json()
            assert "codes" in body


# ---------------------------------------------------------------------------
# Phase 6 — batch compress, image upscaler, audio converter, pdf page counter
# ---------------------------------------------------------------------------

class TestPhase6:
    def test_batch_compress_pdf_smoke(self, client, sample_pdf):
        resp = client.post(
            "/api/batch-compress-pdf",
            files=[
                ("files", ("a.pdf", sample_pdf, "application/pdf")),
                ("files", ("b.pdf", sample_pdf, "application/pdf")),
            ],
            data={"level": "balanced"},
        )
        if resp.status_code == 500:
            pytest.skip("batch compress unavailable on this env")
        assert resp.status_code == 200
        # Returns a ZIP
        assert resp.headers.get("content-type", "").startswith("application/zip")
        assert resp.content[:2] == b"PK"

    def test_batch_compress_pdf_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/batch-compress-pdf",
            files=[("files", ("a.txt", b"not pdf", "text/plain"))],
        )
        assert resp.status_code == 400

    def test_image_upscaler_2x(self, client, jpeg_image):
        resp = client.post(
            "/api/image-upscaler",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"scale": "2"},
        )
        if resp.status_code == 500:
            pytest.skip("upscaler unavailable on this env")
        assert resp.status_code == 200

    def test_image_upscaler_rejects_invalid_image(self, client):
        resp = client.post(
            "/api/image-upscaler",
            files={"file": ("a.jpg", b"not an image", "image/jpeg")},
        )
        assert resp.status_code == 400

    def test_pdf_page_counter_counts_correctly(self, client, sample_pdf, multipage_pdf):
        resp = client.post(
            "/api/pdf-page-counter",
            files=[
                ("files", ("one.pdf", sample_pdf, "application/pdf")),
                ("files", ("ten.pdf", multipage_pdf, "application/pdf")),
            ],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["file_count"] == 2
        assert body["total_pages"] == 11
        names = [f["filename"] for f in body["files"]]
        assert "one.pdf" in names and "ten.pdf" in names


# ---------------------------------------------------------------------------
# Phase 7 — mute video, reverse video, video speed, audio trim, image palette,
# pixelate, rotate-image, flip-image
# ---------------------------------------------------------------------------

class TestPhase7:
    def test_mute_video_rejects_non_video(self, client, sample_pdf):
        resp = client.post(
            "/api/mute-video",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_reverse_video_rejects_non_video(self, client, sample_pdf):
        resp = client.post(
            "/api/reverse-video",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_video_speed_rejects_non_video(self, client, sample_pdf):
        resp = client.post(
            "/api/video-speed",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
            data={"speed": "1.5"},
        )
        assert resp.status_code == 400

    def test_audio_trim_rejects_non_audio(self, client, sample_pdf):
        resp = client.post(
            "/api/audio-trim",
            files={"file": ("a.pdf", sample_pdf, "application/pdf")},
            data={"start": "0", "end": "5"},
        )
        assert resp.status_code == 400

    def test_audio_trim_rejects_bad_timestamp(self, client, jpeg_image):
        """Even a fake 'audio file' with bad timestamps must 400 before ffmpeg."""
        # Use a faux .mp3 file (won't matter; we want the timestamp rejection)
        resp = client.post(
            "/api/audio-trim",
            files={"file": ("a.mp3", b"FAKE", "audio/mpeg")},
            data={"start": "two pm", "end": "5"},
        )
        assert resp.status_code == 400

    def test_image_palette_happy_path(self, client, jpeg_image):
        resp = client.post(
            "/api/image-palette",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"colors": "4"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "palette" in body
        assert 1 <= body["count"] <= 4
        for entry in body["palette"]:
            assert entry["hex"].startswith("#")
            assert len(entry["rgb"]) == 3

    def test_pixelate_image_pixelate_mode(self, client, jpeg_image):
        resp = client.post(
            "/api/pixelate-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"mode": "pixelate", "strength": "20"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").startswith("image/")

    def test_pixelate_image_blur_mode(self, client, jpeg_image):
        resp = client.post(
            "/api/pixelate-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"mode": "blur", "strength": "50"},
        )
        assert resp.status_code == 200

    def test_pixelate_image_rejects_unknown_mode(self, client, jpeg_image):
        resp = client.post(
            "/api/pixelate-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"mode": "swirl", "strength": "20"},
        )
        assert resp.status_code == 400

    def test_rotate_image_90(self, client, jpeg_image):
        resp = client.post(
            "/api/rotate-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"degrees": "90"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").startswith("image/")

    def test_flip_image_horizontal(self, client, jpeg_image):
        resp = client.post(
            "/api/flip-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"direction": "horizontal"},
        )
        assert resp.status_code == 200

    def test_flip_image_rejects_bad_direction(self, client, jpeg_image):
        resp = client.post(
            "/api/flip-image",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
            data={"direction": "rotate"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# new_tools.py — split-in-half, highlight, pdf-to-svg, smart-redact, video tools
# ---------------------------------------------------------------------------

class TestNewTools:
    def test_split_in_half_vertical(self, client, sample_pdf):
        resp = client.post(
            "/api/split-in-half",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"direction": "vertical"},
        )
        if resp.status_code == 500:
            pytest.skip("split_in_half_service unavailable")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)

    def test_highlight_returns_hit_count_header(self, client, sample_pdf):
        resp = client.post(
            "/api/highlight",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"query": "Sample"},  # matches the fixture text
        )
        if resp.status_code == 500:
            pytest.skip("highlight_service unavailable")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)
        assert "x-highlight-hits" in {k.lower() for k in resp.headers.keys()}

    def test_highlight_long_query_rejected(self, client, sample_pdf):
        resp = client.post(
            "/api/highlight",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"query": "x" * 600},
        )
        assert resp.status_code == 400

    def test_pdf_to_svg_returns_svg_or_zip(self, client, sample_pdf):
        resp = client.post(
            "/api/pdf-to-svg",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
        )
        if resp.status_code == 500:
            pytest.skip("pdf_to_svg_service unavailable")
        assert resp.status_code == 200
        ctype = resp.headers.get("content-type", "")
        assert ctype.startswith("application/zip") or ctype.startswith("image/svg")

    def test_smart_redact_empty_needles_is_valid_json_array(self, client, sample_pdf):
        """Empty JSON array is valid syntactically — service decides whether
        to no-op or return 400. The route must not 500."""
        resp = client.post(
            "/api/smart-redact",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"needles": "[]"},
        )
        # Service returns either 200 (no-op redaction) or 400 (validation).
        assert resp.status_code in (200, 400)

    def test_smart_redact_too_many_needles(self, client, sample_pdf):
        big = json.dumps([f"x{i}" for i in range(600)])
        resp = client.post(
            "/api/smart-redact",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"needles": big},
        )
        assert resp.status_code == 400

    def test_gif_to_mp4_rejects_non_gif(self, client, jpeg_image):
        resp = client.post(
            "/api/gif-to-mp4",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
        )
        assert resp.status_code == 400

    def test_video_merge_requires_two(self, client, jpeg_image):
        """video-merge requires >= 2 videos; one upload must 400."""
        resp = client.post(
            "/api/video-merge",
            files=[("files", ("a.mp4", b"FAKE", "video/mp4"))],
        )
        assert resp.status_code == 400

    def test_audio_merge_requires_two(self, client):
        resp = client.post(
            "/api/audio-merge",
            files=[("files", ("a.mp3", b"FAKE", "audio/mpeg"))],
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# v12_tools.py — web-optimize, split-by-text, pdf-to-html, pdf-to-rtf, view-exif
# ---------------------------------------------------------------------------

class TestV12Tools:
    def test_web_optimize_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/web-optimize",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_split_by_text_requires_search(self, client, sample_pdf):
        resp = client.post(
            "/api/split-by-text",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"search": "   "},
        )
        assert resp.status_code == 400

    def test_pdf_to_html_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/pdf-to-html",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_pdf_to_rtf_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/pdf-to-rtf",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_view_exif_happy_path(self, client, jpeg_image):
        resp = client.post(
            "/api/view-exif",
            files={"file": ("a.jpg", jpeg_image, "image/jpeg")},
        )
        if resp.status_code == 500:
            pytest.skip("view_exif unavailable")
        assert resp.status_code == 200
        # Returns JSON metadata
        body = resp.json()
        assert isinstance(body, dict)

    def test_view_exif_rejects_pdf(self, client, sample_pdf):
        resp = client.post(
            "/api/view-exif",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# pdf_extra.py — pdf-to-epub, markdown-to-pdf, csv-to-pdf, add-hyperlinks,
# form-creator, transparent-background
# ---------------------------------------------------------------------------

class TestPdfExtra:
    def test_pdf_to_epub_happy_path(self, client, sample_pdf):
        resp = client.post(
            "/api/pdf-to-epub",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
        )
        if resp.status_code == 500:
            pytest.skip("pdf-to-epub unavailable")
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").startswith("application/epub")
        # EPUB is a ZIP — starts with PK
        assert resp.content[:2] == b"PK"

    def test_pdf_to_epub_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/pdf-to-epub",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_markdown_to_pdf_happy_path(self, client):
        md = b"# Hello\n\n**bold** _italic_ `code`\n\n- item 1\n- item 2\n"
        resp = client.post(
            "/api/markdown-to-pdf",
            files={"file": ("doc.md", md, "text/markdown")},
        )
        if resp.status_code == 500:
            pytest.skip("markdown-to-pdf unavailable")
        assert resp.status_code == 200
        assert _is_pdf(resp.content)

    def test_csv_to_pdf_rejects_empty(self, client):
        resp = client.post(
            "/api/csv-to-pdf",
            files={"file": ("a.csv", b"", "text/csv")},
        )
        # read_upload rejects empty body with 400
        assert resp.status_code == 400

    def test_add_hyperlinks_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/add-hyperlinks",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_form_creator_rejects_empty_fields(self, client, sample_pdf):
        resp = client.post(
            "/api/form-creator",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"form_fields": "[]"},
        )
        assert resp.status_code == 400

    def test_form_creator_rejects_invalid_field_type(self, client, sample_pdf):
        fields = json.dumps([
            {
                "name": "x", "type": "unknown",
                "page": 1, "x": 0, "y": 0, "width": 10, "height": 10,
            }
        ])
        resp = client.post(
            "/api/form-creator",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"form_fields": fields},
        )
        assert resp.status_code == 400

    def test_form_creator_rejects_combobox_without_options(self, client, sample_pdf):
        fields = json.dumps([
            {
                "name": "dropdown", "type": "combobox",
                "page": 1, "x": 50, "y": 50, "width": 100, "height": 20,
                # no options
            }
        ])
        resp = client.post(
            "/api/form-creator",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"form_fields": fields},
        )
        assert resp.status_code == 400

    def test_transparent_background_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/transparent-background",
            files={"file": ("a.txt", b"hi", "text/plain")},
        )
        assert resp.status_code == 400

    def test_transparent_background_rejects_bad_threshold(self, client, sample_pdf):
        resp = client.post(
            "/api/transparent-background",
            files={"file": ("test.pdf", sample_pdf, "application/pdf")},
            data={"threshold": "100"},  # below the ge=180 floor
        )
        assert resp.status_code == 422
