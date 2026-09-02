"""
Dynamic OG image generator.

Returns a 1200x630 PNG for the standard Open Graph / Twitter Card size.
Uses PrivaTools' signal-green / editorial-bone palette so the social
preview matches the actual workshop branding (and is visually distinct
from the generic indigo cards every other tool site emits).

Aggressive caching: 7-day public TTL since the underlying title/description
only changes on deploys. Pillow generation runs in ~30-80ms per image so
even a cache miss is cheap, but we still let Cloudflare/CDN absorb the
hot path for free. Plus an in-memory LRU keeps even CDN misses near-zero
cost when several hot paths get hit in quick succession.
"""
from __future__ import annotations
import io
import textwrap
from datetime import datetime, timezone
from functools import lru_cache
from fastapi import APIRouter, Query, Request
from PIL import Image, ImageDraw, ImageFont

from ..seo_meta import get_meta_for_path
from ..utils.caching import cache_response, etag_for

router = APIRouter()

# Process boot time — fed to Last-Modified so CDNs that prefer date-based
# validation (some older proxies) still get a stable validator that
# rotates on every deploy along with the ETag (because APP_VERSION
# changes). We use the boot timestamp instead of "now" so two near-
# simultaneous requests don't end up with different Last-Modified values
# for the same cache entry.
_BOOT_TIME = datetime.now(tz=timezone.utc)

# DejaVu is what the Docker base image ships. Don't add to requirements —
# we accept the bitmap fallback as a graceful degradation path.
_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Palette mirrors the frontend `index.css` editorial workshop tokens.
# Bone background + ink foreground reads like a printed broadsheet,
# which differentiates the card from the generic dark-card you see from
# every iLovePDF / Smallpdf / Adobe knock-off.
_INK       = (24, 22, 18)        # near-black ink for body type
_BONE      = (246, 240, 228)     # cream paper background
_SIGNAL    = (15, 157, 88)       # #0F9D58 signal-green — privacy check
_COPPER    = (183, 89, 26)       # #B7591A used sparingly for category accent
_MUTED     = (95, 87, 75)        # warm slate for subtitles
_PAPER_LINE= (210, 200, 184)     # thin divider rule

W, H = 1200, 630

# Category color hints — the category accent paints the brand tag + the
# bottom-bar so the social card visually groups tools (PDF vs image vs
# video vs developer). The signal-green stays on top for the privacy
# mark so users see "PrivaTools = the green-check tool" no matter the
# section.
_CATEGORY_HINTS = {
    "/tool/":  ("PDF · ", _COPPER),
    "/tools/": ("UTILITY · ", _SIGNAL),
    "/blog/":  ("ESSAY · ", _COPPER),
    "/compare/": ("COMPARISON · ", _COPPER),
}


def _category_for(path: str) -> tuple[str, tuple[int, int, int]]:
    for prefix, hint in _CATEGORY_HINTS.items():
        if path.startswith(prefix):
            return hint
    return ("", _SIGNAL)


def _make_og_image(title: str, subtitle: str, category_label: str, category_color: tuple[int, int, int]) -> bytes:
    img = Image.new("RGB", (W, H), _BONE)
    draw = ImageDraw.Draw(img)

    # Thin signal-green rule across the top — the privacy stripe.
    draw.rectangle([(0, 0), (W, 8)], fill=_SIGNAL)
    # Subtle paper-fold rule under the brand tag.
    draw.rectangle([(60, 110), (W - 60, 111)], fill=_PAPER_LINE)

    try:
        font_title  = ImageFont.truetype(_FONT_BOLD, 60)
        font_sub    = ImageFont.truetype(_FONT_REG,  28)
        font_brand  = ImageFont.truetype(_FONT_BOLD, 22)
        font_domain = ImageFont.truetype(_FONT_REG,  22)
    except OSError:
        font_title = font_sub = font_brand = font_domain = ImageFont.load_default()

    # Brand tag (top-left) — "PRIVATOOLS · CATEGORY"
    brand_text = f"PRIVATOOLS · {category_label}".rstrip(" ·")
    draw.text((60, 56), brand_text, font=font_brand, fill=category_color)

    # Title — word-wrap at ~28 chars per line, max 3 lines.
    lines = textwrap.wrap(title, width=28)[:3]
    y = 170
    for line in lines:
        draw.text((60, y), line, font=font_title, fill=_INK)
        y += 78

    # Subtitle / description.
    if subtitle:
        sub_lines = textwrap.wrap(subtitle, width=58)[:2]
        y += 18
        for line in sub_lines:
            draw.text((60, y), line, font=font_sub, fill=_MUTED)
            y += 38

    # Bottom paper-fold rule + footer line.
    draw.rectangle([(60, H - 78), (W - 60, H - 77)], fill=_PAPER_LINE)
    draw.text((60, H - 56), "privatools.me", font=font_domain, fill=_INK)
    # Trust badge: signal-green dot + claim.
    draw.ellipse([(W - 480, H - 50), (W - 466, H - 36)], fill=_SIGNAL)
    draw.text((W - 458, H - 56), "Free · Open Source · Privacy-First", font=font_domain, fill=_INK)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@lru_cache(maxsize=512)
def _render_cached(path: str) -> tuple[bytes, str]:
    """Render the OG PNG for `path` and return (png_bytes, etag).

    Cached because the same paths are hit over and over by social-preview
    crawlers when the URL is shared. 512 entries × ~60 KB ≈ 30 MB worst-
    case — fits comfortably inside the global 64 MB cache budget alongside
    the sitemap + meta caches.
    """
    title, description = get_meta_for_path(path)
    display_title = (
        title.replace(" | PrivaTools", "")
             .replace(" — PrivaTools", "")
             .replace(" — No Sign Up, No Watermark", "")
             .replace(" — No Sign Up", "")
    )
    subtitle = description.split(".")[0] + "." if description else ""
    if len(subtitle) > 100:
        subtitle = subtitle[:97] + "…"
    category_label, category_color = _category_for(path)
    png = _make_og_image(display_title, subtitle, category_label, category_color)
    # ETag folds in APP_VERSION via etag_for so deploys auto-invalidate
    # even though the rendered bytes happen to be identical.
    etag = etag_for(png)
    return png, etag


@router.get("/api/og-image")
async def og_image(request: Request, p: str = Query(default="/", alias="p")):
    # Defend against unbounded input — paths past 256 chars almost certainly
    # mean someone is probing the surface, not a real tool slug.
    if len(p) > 256:
        p = p[:256]
    png, _etag = _render_cached(p)
    # 7-day public cache + 1-day SWR — image content only changes when
    # the tool's title/description changes (i.e. when seo_meta.py
    # changes), which is a deploy event. The deploy bumps APP_VERSION,
    # which rotates the ETag, which makes every CDN node re-fetch.
    return cache_response(
        png,
        media_type="image/png",
        max_age=604800,           # 7 days
        stale_while_revalidate=86400,  # 1 day
        request=request,
        last_modified=_BOOT_TIME,
        # These are social preview cards, not pages. Google was crawling one
        # per tool and filing every one under "Crawled - currently not
        # indexed": 209 of the 284 URLs in that report, three quarters of an
        # indexing problem that was never a page problem. noindex keeps them
        # fetchable — Slack, X and LinkedIn still render previews — while
        # taking them out of the index entirely.
        extra_headers={"X-Robots-Tag": "noindex"},
    )
