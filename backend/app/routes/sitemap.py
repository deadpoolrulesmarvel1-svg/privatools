"""
Sitemap endpoint — generates sitemap.xml dynamically for all tool pages.

The sitemap body is a deterministic function of `date.today()` and the
in-process slug catalogues — there is no per-request data, so it is
safe to memoize the rendered XML for an entire day. We key the cache on
the date so the lastmod field stays fresh; once the wall-clock rolls
over to a new UTC day we render once and serve the bytes to every
subsequent request until the next rollover.
"""
from datetime import date, datetime, time, timezone
from functools import lru_cache
from fastapi import APIRouter, Request

from ..utils.caching import cache_response
from ..seo_meta import _last_reviewed_for

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
    "pdf-to-jpg", "pdf-to-png", "pdf-to-long-image",
    # v1.2.0 PDF additions
    "web-optimize-pdf", "split-by-text", "pdf-to-html", "pdf-to-rtf",
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
    # Phase 2 conversion alias pack
    "jpg-to-tiff", "png-to-tiff", "webp-to-tiff",
    "jpg-to-bmp", "png-to-bmp", "webp-to-bmp",
    "mp3-to-wav", "wav-to-mp3", "flac-to-mp3", "ogg-to-mp3",
    "aac-to-mp3", "mp3-to-ogg", "mp3-to-flac", "mp3-to-aac",
    "wav-to-flac", "wav-to-ogg",
    "mkv-to-mp4", "mp4-to-mov", "mov-to-webm", "mkv-to-webm",
    "mp4-to-avi", "avi-to-webm", "webm-to-mov", "mov-to-mkv",
    "webm-to-gif", "mov-to-gif",
    # P2 developer micro-tools
    "cron-parser", "sql-formatter", "graphql-formatter",
    "yaml-toml-converter", "gitignore-generator", "semver-bumper",
    "env-validator", "json-to-csv-schema",
    # v1.4.0 additions — browser-only dev converters
    "yaml-to-json", "json-to-yaml", "case-converter",
    # v1.5.0 / phase 7 — competitor-gap tools
    "mute-video", "reverse-video", "video-speed", "audio-trim",
    "image-palette", "pixelate-image",
    # v1.5.1 — image rotate/flip
    "rotate-image", "flip-image",
    # Video / audio / dev tools previously kept in _VIDEO_TOOLS_NEW —
    # merged here so the canonical NON_PDF_TOOLS list matches the frontend
    # data file exactly (used by the test_spa_fallback consistency check).
    "video-to-pdf", "video-converter", "video-resizer", "video-thumbnail",
    "gif-to-mp4", "add-subtitles",
    "video-merge", "audio-merge", "subtitle-converter",
    "password-generator", "uuid-generator", "lorem-ipsum",
    "word-counter", "color-converter", "url-encoder",
]

# v1.2.0 PDF additions (sitemap was missing these)
_PDF_V12 = [
    "web-optimize-pdf", "split-by-text", "pdf-to-html", "pdf-to-rtf",
]

COMPARE_PAGES = [
    "ilovepdf", "smallpdf", "adobe-acrobat", "sejda", "pdf24", "foxit", "lightpdf",
    "stirling-pdf", "dochub", "pdfescape", "nitro-pdf",
]

# Blog posts with their published dates. Must stay in sync with
# _BLOG_POSTS in app/seo_meta.py — otherwise crawlers see meta for a
# post but the sitemap omits the URL (or vice versa).
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
    # May 2026 batch — were present in seo_meta but missing from the
    # sitemap, which meant Google never discovered them via the canonical
    # entry point.
    "ai-pdf-summarizer-browser-2026": "2026-05-15",
    "ilovepdf-alternatives-2026": "2026-05-15",
    "redact-pdf-permanently-guide": "2026-05-15",
    "online-pdf-tools-tracking-you": "2026-05-15",
    "heic-conversion-guide-2026": "2026-05-15",
    "decode-jwt-tokens-safely-guide": "2026-05-15",
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

# Tools that get a priority bump in the sitemap. These are the highest-
# search-volume PDF/utility verbs (merge, compress, split, etc.) — Google
# uses sitemap priority as a soft crawl-budget hint, so giving the
# headline tools 0.9 routes more attention to them than to the long tail.
_HIGH_PRIORITY_TOOLS: set[str] = {
    "merge-pdf", "split-pdf", "compress-pdf",
    "pdf-to-word", "pdf-to-excel", "pdf-to-jpg",
    "jpg-to-pdf", "word-to-pdf", "image-to-pdf",
    "edit-pdf", "sign-pdf", "ocr-pdf",
    "protect-pdf", "unlock-pdf", "rotate-pdf",
    "redact-pdf", "watermark",
    "image-compressor", "image-converter", "heic-to-jpg",
    "remove-background", "video-to-gif",
    # Free-winnable niche dev/utility tools. Per the keyword research, the PDF
    # heads are owned by DA80-90 incumbents, but these niche dev SERPs (GitHub
    # repos + small indie tools) are realistically rankable for a new site — so
    # concentrate crawl-budget priority here, where the wins are actually free.
    "semver-bumper", "env-validator", "cron-parser", "yaml-toml-converter",
    "graphql-formatter", "json-to-csv-schema", "gitignore-generator",
    "sql-formatter", "subtitle-converter", "remove-exif", "view-exif",
    "json-to-yaml", "yaml-to-json",
}


def _entry(url: str, lastmod: str, priority: str, changefreq: str) -> str:
    return (
        f"  <url>\n"
        f"    <loc>{url}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        f"  </url>\n"
    )


def _tool_priority(slug: str) -> str:
    return "0.9" if slug in _HIGH_PRIORITY_TOOLS else "0.8"


@lru_cache(maxsize=8)
def _build_sitemap_xml(today_iso: str) -> bytes:
    """Render the sitemap XML for the given ISO date.

    Pure function of the date string and the module-level slug lists.
    Cached in an LRU keyed on the date — most days we serve from the
    first entry; older keys age out when the date rolls over. Size 8
    is more than enough headroom (current + 7 retained days) while
    keeping the cache small. At ~30-50 KB per entry, the cap is well
    under 1 MB total.
    """
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

    # Static pages — homepage updated daily. Other pages get today's date
    # too because we ship multiple improvements per day; sitemap.lastmod
    # is meant to signal "this content has been touched recently".
    xml += _entry(BASE_URL, today_iso, "1.0", "daily")
    xml += _entry(f"{BASE_URL}/about", today_iso, "0.6", "monthly")
    xml += _entry(f"{BASE_URL}/privacy", "2026-03-29", "0.4", "yearly")
    xml += _entry(f"{BASE_URL}/terms", "2026-03-29", "0.4", "yearly")
    xml += _entry(f"{BASE_URL}/batch", today_iso, "0.7", "weekly")
    xml += _entry(f"{BASE_URL}/pipeline", today_iso, "0.7", "weekly")
    xml += _entry(f"{BASE_URL}/compare", today_iso, "0.7", "monthly")
    xml += _entry(f"{BASE_URL}/blog", today_iso, "0.8", "weekly")
    # All-tools directory hub — a high-value internal-linking surface. Like the
    # homepage it genuinely changes as the catalogue grows, so today is honest.
    xml += _entry(f"{BASE_URL}/tools", today_iso, "0.9", "weekly")

    # Blog posts — use actual published date
    for slug, published in BLOG_POSTS.items():
        xml += _entry(f"{BASE_URL}/blog/{slug}", published, "0.8", "weekly")

    # Compare pages
    for slug in COMPARE_PAGES:
        xml += _entry(f"{BASE_URL}/compare/{slug}", today_iso, "0.8", "monthly")

    # Tool pages — lastmod reflects the tool's real last-reviewed date
    # (_last_reviewed_for), NOT today. Stamping every URL with today's date on
    # every render makes Google distrust lastmod as a freshness hint; a stable
    # per-tool date keeps it meaningful so a genuine content change is believed.
    # High-volume tools get priority 0.9 (vs 0.8 for long tail).
    # Dedupe across the source lists so each canonical URL appears exactly once
    # — duplicate entries are valid XML but waste crawl budget and split signals.
    seen_pdf: set[str] = set()
    for slug in (*PDF_TOOLS, *_PDF_V12):
        if slug in seen_pdf:
            continue
        seen_pdf.add(slug)
        xml += _entry(f"{BASE_URL}/tool/{slug}", _last_reviewed_for(slug), _tool_priority(slug), "weekly")
    seen_nonpdf: set[str] = set()
    for slug in (*NON_PDF_TOOLS, *_VIDEO_TOOLS_NEW):
        if slug in seen_nonpdf:
            continue
        seen_nonpdf.add(slug)
        xml += _entry(f"{BASE_URL}/tools/{slug}", _last_reviewed_for(slug), _tool_priority(slug), "weekly")

    xml += "</urlset>"

    return xml.encode("utf-8")


@router.get("/sitemap.xml")
async def sitemap(request: Request):
    today = date.today()
    body = _build_sitemap_xml(today.isoformat())
    # Last-Modified = start of today UTC — a stable validator that only
    # changes when the sitemap's content can have changed (the cache key
    # rolls over at midnight, so the timestamp tracks it).
    last_modified = datetime.combine(today, time.min, tzinfo=timezone.utc)
    return cache_response(
        body,
        media_type="application/xml",
        max_age=3600,             # 1 hour
        stale_while_revalidate=3600,
        request=request,
        last_modified=last_modified,
    )
