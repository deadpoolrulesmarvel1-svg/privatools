"""
Sitemap endpoint — generates sitemap.xml dynamically for all tool pages.
"""
from datetime import date
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

# All tool slugs — must match frontend routes exactly
PDF_TOOLS = [
    "merge-pdf", "split-pdf", "split-by-bookmarks", "split-by-size",
    "organize-pages", "delete-pages", "extract-pages",
    "edit-pdf", "sign-pdf", "watermark", "header-footer",
    "page-numbers", "bates-numbering", "bookmarks",
    "compress-pdf", "flatten-pdf", "deskew-pdf", "repair-pdf",
    "resize-pdf", "rotate-pdf", "grayscale-pdf", "crop-pdf",
    "protect-pdf", "unlock-pdf", "redact-pdf", "strip-metadata",
    "delete-annotations", "metadata",
    "html-to-pdf", "image-to-pdf", "office-to-pdf",
    "pdf-to-excel", "pdf-to-image", "pdf-to-pptx", "pdf-to-text", "pdf-to-word",
    "alternate-mix", "compare-pdf", "extract-images", "fill-form",
    "nup", "ocr-pdf", "overlay", "qr-code", "pdf-to-pdfa",
    "remove-blank-pages", "auto-crop",
    "pdf-to-epub", "markdown-to-pdf", "csv-to-pdf",
    "invert-colors", "pdfa-validator", "verify-signature",
    "sanitize-pdf", "add-hyperlinks", "form-creator",
    "transparent-background", "stamp-pdf", "esign-pdf",
    "word-to-pdf", "excel-to-pdf", "pptx-to-pdf-convert",
    "txt-to-pdf", "json-to-pdf", "xml-to-pdf", "epub-to-pdf", "rtf-to-pdf",
    "extract-tables", "pdf-to-markdown",
    "whiteout-pdf", "annotate-pdf", "add-shapes",
    "set-permissions", "add-attachment",
    "reverse-pdf", "booklet-pdf",
    "batch-compress-pdf", "pdf-page-counter",
    # Newly added — keep in sync with frontend/src/data/tools.ts
    "jpg-to-pdf", "png-to-pdf", "heic-to-pdf",
    "webp-to-pdf", "tiff-to-pdf", "bmp-to-pdf", "gif-to-pdf", "svg-to-pdf",
    "odt-to-pdf",
    "pdf-to-tiff", "pdf-to-bmp", "pdf-to-gif", "pdf-to-svg",
    "split-in-half", "highlight-pdf", "summarize-pdf",
    "smart-redact",
    # Round-O additions
    "pdf-to-jpg", "pdf-to-png",
]

# Newly-added video tools (also non-PDF — listed here so the route map stays
# in one place; sitemap iteration uses both lists).
VIDEO_TOOLS = [
    "video-to-pdf", "video-converter", "video-resizer", "video-thumbnail",
    "gif-to-mp4", "add-subtitles",
]

_VIDEO_TOOLS_NEW = [
    "video-to-pdf", "video-converter", "video-resizer", "video-thumbnail",
    "gif-to-mp4", "add-subtitles",
    # Round-O additions
    "video-merge", "audio-merge", "subtitle-converter",
    "password-generator", "uuid-generator", "lorem-ipsum",
    "word-counter", "color-converter", "url-encoder",
]

NON_PDF_TOOLS = [
    "image-compressor", "image-converter", "remove-exif", "resize-crop-image",
    "video-to-gif", "image-ocr",
    "extract-audio", "trim-media", "compress-video",
    "json-xml-formatter", "text-diff", "base64", "hash-generator",
    "extract-archive", "create-zip",
    "csv-json", "markdown-html", "heic-to-jpg",
    "remove-background", "svg-to-png", "image-watermark",
    "generate-favicon", "make-collage", "generate-barcode",
    "url-to-pdf", "qr-reader", "merge-images",
    "image-upscaler", "audio-converter",
    # v1.2.0 additions
    "webp-to-jpg", "webp-to-png", "heic-to-png", "view-exif",
    "jwt-decoder", "regex-tester", "timestamp-converter",
    # v1.4.0 additions — image converter aliases
    "jpg-to-png", "png-to-jpg", "jpg-to-webp", "png-to-webp",
    "tiff-to-jpg", "tiff-to-png", "bmp-to-jpg", "bmp-to-png",
    "gif-to-jpg", "gif-to-png",
    # v1.4.0 additions — audio/video converter aliases
    "m4a-to-mp3", "mp4-to-mp3", "mov-to-mp4", "avi-to-mp4",
    "webm-to-mp4", "mp4-to-webm",
    # v1.4.0 additions — browser-only dev converters
    "yaml-to-json", "json-to-yaml", "case-converter",
    # v1.5.0 / phase 7 — competitor-gap tools
    "mute-video", "reverse-video", "video-speed", "audio-trim",
    "image-palette", "pixelate-image",
]

# v1.2.0 PDF additions (sitemap was missing these)
_PDF_V12 = [
    "web-optimize-pdf", "split-by-text", "pdf-to-html", "pdf-to-rtf",
]

COMPARE_PAGES = [
    "ilovepdf", "smallpdf", "adobe-acrobat", "sejda", "pdf24", "foxit", "lightpdf",
    "stirling-pdf", "dochub", "pdfescape", "nitro-pdf",
]

# Blog posts with their published dates
BLOG_POSTS: dict[str, str] = {
    "compress-pdf-without-losing-quality": "2026-03-22",
    "merge-pdf-files-online-free": "2026-03-22",
    "best-free-pdf-tools-2026": "2026-03-22",
    "remove-password-from-pdf": "2026-03-22",
    "convert-word-to-pdf-free": "2026-03-22",
    "edit-pdf-online-free-no-sign-up": "2026-03-29",
    "split-pdf-online-free": "2026-03-29",
    "redact-pdf-free-guide": "2026-03-29",
    "best-free-online-pdf-editors-2026": "2026-03-29",
}

BASE_URL = "https://privatools.me"

# Dates for different content types
# Pages were originally added at these dates. We bump lastmod to today
# on every served sitemap so AI/search engines see fresh content
# (PrivaTools is iterated daily). If a particular page becomes legitimately
# stale, drop its slug into _FROZEN below.
_TOOLS_LAUNCH_DATE = "2026-03-15"
_COMPARE_DATE = "2026-03-22"
_FROZEN: set[str] = set()


def _entry(url: str, lastmod: str, priority: str, changefreq: str) -> str:
    return (
        f"  <url>\n"
        f"    <loc>{url}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        f"  </url>\n"
    )


@router.get("/sitemap.xml")
async def sitemap():
    today = date.today().isoformat()

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

    # Static pages — homepage updated daily. Other pages get today's date
    # too because we ship multiple improvements per day; sitemap.lastmod
    # is meant to signal "this content has been touched recently".
    xml += _entry(BASE_URL, today, "1.0", "daily")
    xml += _entry(f"{BASE_URL}/about", today, "0.6", "monthly")
    xml += _entry(f"{BASE_URL}/privacy", "2026-03-29", "0.4", "yearly")
    xml += _entry(f"{BASE_URL}/terms", "2026-03-29", "0.4", "yearly")
    xml += _entry(f"{BASE_URL}/batch", today, "0.7", "weekly")
    xml += _entry(f"{BASE_URL}/pipeline", today, "0.7", "weekly")
    xml += _entry(f"{BASE_URL}/compare", today, "0.7", "monthly")
    xml += _entry(f"{BASE_URL}/blog", today, "0.8", "weekly")

    # Blog posts — use actual published date
    for slug, published in BLOG_POSTS.items():
        xml += _entry(f"{BASE_URL}/blog/{slug}", published, "0.8", "weekly")

    # Compare pages
    for slug in COMPARE_PAGES:
        xml += _entry(f"{BASE_URL}/compare/{slug}", today, "0.8", "monthly")

    # Tool pages — bump lastmod daily (we iterate constantly).
    for slug in PDF_TOOLS:
        xml += _entry(f"{BASE_URL}/tool/{slug}", today, "0.8", "weekly")
    for slug in _PDF_V12:
        xml += _entry(f"{BASE_URL}/tool/{slug}", today, "0.8", "weekly")
    for slug in NON_PDF_TOOLS:
        xml += _entry(f"{BASE_URL}/tools/{slug}", today, "0.8", "weekly")
    for slug in _VIDEO_TOOLS_NEW:
        xml += _entry(f"{BASE_URL}/tools/{slug}", today, "0.8", "weekly")

    xml += "</urlset>"

    return Response(content=xml, media_type="application/xml")
