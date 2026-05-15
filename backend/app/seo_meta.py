"""
Server-side SEO meta tag injection.

Provides per-route <title> and <meta name="description"> values
so that search-engine crawlers see the correct metadata without
executing JavaScript.
"""
from __future__ import annotations
import json
import re
from urllib.parse import quote
from .tool_content import TOOL_HOWTO, TOOL_FAQ

BASE_URL = "https://privatools.me"

# ---------------------------------------------------------------------------
# Static page meta
# ---------------------------------------------------------------------------
_STATIC_META: dict[str, tuple[str, str]] = {
    "/": (
        "PrivaTools — Free, Open-Source Privacy-First File Tools",
        "175+ free, open-source file tools — PDF, image, video, audio, and developer utilities. "
        "Self-hostable so your files stay on your own infrastructure. "
        "File content never leaves the processing container; no behavioural tracking; no accounts.",
    ),
    "/privacy": (
        "Privacy Policy — How PrivaTools Handles Your Files | PrivaTools",
        "PrivaTools privacy policy: files are processed in temp memory and deleted on response. No accounts, no behavioural tracking, no ads. Browser-side AI tools process data locally. Last updated May 15, 2026.",
    ),
    "/terms": (
        "Terms of Service — PrivaTools",
        "Terms of service for PrivaTools (privatools.me) — open-source under MIT license, no account required, no warranty, no liability. You retain rights to your files; we claim no ownership.",
    ),
    "/about": (
        "About PrivaTools — How We Handle Your Files | Privacy-First",
        "Learn how PrivaTools processes your files with zero-knowledge architecture. "
        "Files are processed and immediately deleted — never stored, never read, never shared. 100% open source.",
    ),
    "/batch": (
        "Batch Process Files — Apply Tools to Multiple Files | PrivaTools",
        "Upload multiple files and apply the same tool to all of them at once. "
        "Batch compress, convert, or transform PDF, image, and video files privately. Free, no limits.",
    ),
    "/pipeline": (
        "PDF Pipeline — Chain Multiple PDF Tools Together | PrivaTools",
        "Chain multiple PDF tools together into a processing pipeline. "
        "Compress, rotate, watermark, and more — all in one pass. Privacy-first and free.",
    ),
    "/compare": (
        "PrivaTools vs iLovePDF vs Smallpdf vs Adobe — Free Comparison",
        "Compare PrivaTools with iLovePDF, Smallpdf, Adobe Acrobat, Sejda, PDF24, Foxit, and LightPDF. "
        "See which tool is truly free, private, and open source.",
    ),
    "/compare/ilovepdf": (
        "PrivaTools vs iLovePDF — Honest Feature Comparison (2026)",
        "PrivaTools vs iLovePDF compared: pricing, file limits, privacy, features. "
        "PrivaTools is 100% free with no ads, no accounts, and open source. See the full comparison.",
    ),
    "/compare/smallpdf": (
        "PrivaTools vs Smallpdf — Honest Feature Comparison (2026)",
        "PrivaTools vs Smallpdf: no 2-tasks/day limit, no premium upsells, no watermarks. "
        "175+ tools vs 30 tools. See the full comparison.",
    ),
    "/compare/adobe-acrobat": (
        "PrivaTools vs Adobe Acrobat Online — Free Alternative (2026)",
        "PrivaTools is a free, open-source alternative to Adobe Acrobat Online. "
        "No Adobe ID required, no subscription, 175+ tools. Compare features side by side.",
    ),
    "/compare/sejda": (
        "PrivaTools vs Sejda — Free PDF Tool Comparison (2026)",
        "PrivaTools vs Sejda: unlimited tools vs Sejda's 3 tasks/hour limit. "
        "100% free, open source, self-hostable. See how PrivaTools compares to Sejda PDF.",
    ),
    "/compare/pdf24": (
        "PrivaTools vs PDF24 — Free PDF Tools Comparison (2026)",
        "PrivaTools vs PDF24: both free, but PrivaTools is open source, self-hostable, and privacy-first. "
        "Compare features, privacy practices, and tool breadth.",
    ),
    "/compare/foxit": (
        "PrivaTools vs Foxit PDF — Free vs Paid Comparison (2026)",
        "PrivaTools vs Foxit PDF: free, open-source tools vs Foxit's paid subscription. "
        "152+ privacy-first PDF tools with no account required vs Foxit's enterprise pricing.",
    ),
    "/compare/lightpdf": (
        "PrivaTools vs LightPDF — Privacy & Feature Comparison (2026)",
        "PrivaTools vs LightPDF: 100% free and open source vs LightPDF's freemium model. "
        "No file limits, no accounts, no ads. Compare privacy and features.",
    ),
    "/compare/stirling-pdf": (
        "PrivaTools vs Stirling PDF — Open-Source PDF Tools Compared (2026)",
        "PrivaTools vs Stirling PDF: two open-source, self-hostable PDF suites compared. "
        "See which offers more tools, easier setup, and better privacy defaults.",
    ),
    "/compare/dochub": (
        "PrivaTools vs DocHub — Free PDF & Document Tools Compared (2026)",
        "PrivaTools vs DocHub: free, open-source file tools vs DocHub's document workflow platform. "
        "No sign-up, no subscription. Compare 175+ tools vs DocHub's feature set.",
    ),
    "/compare/pdfescape": (
        "PrivaTools vs PDFescape — Free PDF Editor Compared (2026)",
        "PrivaTools vs PDFescape: both free online PDF editors, compared side by side. "
        "PrivaTools is open source with 175+ tools. See which handles your files more privately.",
    ),
    "/compare/nitro-pdf": (
        "PrivaTools vs Nitro PDF — Free vs Paid PDF Tools (2026)",
        "PrivaTools vs Nitro PDF: 100% free open-source tools vs Nitro's paid PDF suite. "
        "No subscription, no account, no file limits. Compare features and pricing.",
    ),
    "/blog": (
        "PrivaTools Blog — PDF & File Tools Tips, Guides & Comparisons",
        "In-depth guides on PDF compression, merging, password removal, and more. "
        "Honest comparisons of free PDF tools. Written by the PrivaTools team.",
    ),
    "/blog/compress-pdf-without-losing-quality": (
        "How to Compress a PDF Without Losing Quality (2026 Guide)",
        "Learn how to reduce PDF file size by up to 90% without visible quality loss. "
        "Three methods compared: online tools, desktop apps, and command-line. Free and instant.",
    ),
    "/blog/merge-pdf-files-online-free": (
        "How to Merge PDF Files Online for Free — No Sign-Up Required",
        "Step-by-step guide to combining PDF files online for free. "
        "Drag, drop, reorder, and merge — no software, no account, no watermarks.",
    ),
    "/blog/best-free-pdf-tools-2026": (
        "Best Free PDF Tools in 2026: Honest Comparison of 8 Options",
        "We tested 8 free PDF tool suites in 2026. Here's the honest verdict: "
        "which are truly free, which have hidden limits, and which respect your privacy.",
    ),
    "/blog/remove-password-from-pdf": (
        "How to Remove a Password from a PDF (3 Methods)",
        "Three ways to remove or bypass a PDF password you own. "
        "Online tool, Adobe Acrobat, and command-line — explained step by step.",
    ),
    "/blog/convert-word-to-pdf-free": (
        "How to Convert Word to PDF for Free (No Microsoft Office Needed)",
        "5 ways to convert .docx files to PDF without Microsoft Office. "
        "Online tools, Google Docs, LibreOffice — plus which method preserves formatting best.",
    ),
    "/blog/edit-pdf-online-free-no-sign-up": (
        "How to Edit a PDF Online for Free — No Sign-Up Required",
        "Step-by-step guide to editing PDF text, images, and annotations online "
        "without creating an account. Compare 5 free methods.",
    ),
    "/blog/split-pdf-online-free": (
        "How to Split a PDF File Online — 3 Free Methods",
        "Three ways to split PDF files for free: by page range, by file size, "
        "and by bookmarks. No software needed, no sign-up.",
    ),
    "/blog/redact-pdf-free-guide": (
        "How to Redact Sensitive Information from PDFs — Free Guide",
        "Learn how to permanently black out names, SSNs, addresses, and confidential text in PDFs. "
        "Understand why covering text with black boxes isn't enough.",
    ),
    "/blog/best-free-online-pdf-editors-2026": (
        "The Best Free Online PDF Editors in 2026 — No Downloads Required",
        "We tested 7 free online PDF editors in 2026. Which ones are truly free, "
        "which add watermarks, and which respect your privacy.",
    ),
    "/blog/ai-pdf-summarizer-browser-2026": (
        "AI PDF Summarizer: How to Summarize Long PDFs in Your Browser (2026 Guide)",
        "How AI-powered PDF summarizers work and how to summarize a 100-page PDF entirely in your browser — "
        "no upload, no API key, no privacy compromise. Step-by-step walkthrough.",
    ),
    "/blog/ilovepdf-alternatives-2026": (
        "10 Best iLovePDF Alternatives in 2026 (Free, Private, Open-Source)",
        "iLovePDF charges, uploads, and shows ads. Here are 10 better alternatives ranked by features, "
        "privacy, and price — including open-source options you can self-host.",
    ),
    "/blog/redact-pdf-permanently-guide": (
        "How to Redact a PDF Properly (Don't Use Black Boxes) — 2026 Guide",
        "Drawing black rectangles over PDF text doesn't redact anything — the text is still under there. "
        "Learn the right way to permanently remove sensitive content from a PDF.",
    ),
    "/blog/online-pdf-tools-tracking-you": (
        "Why Most Online PDF Tools Are Tracking You (And What to Do About It)",
        "A look at what actually happens when you upload a PDF: the trackers, retention windows, "
        "third-party pixels, and how to stay private when working with sensitive documents.",
    ),
    "/blog/heic-conversion-guide-2026": (
        "How to Convert HEIC to PDF, JPG, and PNG on Any Device (2026)",
        "Every way to convert iPhone HEIC photos: online tools, native Mac, Windows extensions, "
        "command line, batch conversion — plus how to stop your iPhone from creating HEIC in the first place.",
    ),
    "/blog/decode-jwt-tokens-safely-guide": (
        "How to Decode a JWT Token Safely (and What Each Part Means)",
        "JWT tokens are everywhere in modern web auth. Learn the structure, how to decode one safely, "
        "what each standard claim means, and why most online JWT decoders are a security risk.",
    ),
}

# ---------------------------------------------------------------------------
# Blog post metadata  (slug → post info dict)
# ---------------------------------------------------------------------------
_BLOG_POSTS: dict[str, dict] = {
    "compress-pdf-without-losing-quality": {
        "title": "How to Compress a PDF Without Losing Quality",
        "description": "Learn how to reduce PDF file size by up to 90% without visible quality loss. Three methods compared: online tools, desktop apps, and command-line.",
        "publishedAt": "2026-03-22",
        "readTime": "5 min read",
        "tags": ["PDF", "Compression", "How-To"],
    },
    "merge-pdf-files-online-free": {
        "title": "How to Merge PDF Files Online for Free",
        "description": "Step-by-step guide to combining PDF files online for free. Drag, drop, reorder, and merge — no software, no account, no watermarks.",
        "publishedAt": "2026-03-22",
        "readTime": "4 min read",
        "tags": ["PDF", "Merge", "How-To"],
    },
    "best-free-pdf-tools-2026": {
        "title": "Best Free PDF Tools in 2026: Honest Comparison",
        "description": "We tested 8 free PDF tool suites in 2026. Honest verdict on which are truly free, which have hidden limits, and which respect your privacy.",
        "publishedAt": "2026-03-22",
        "readTime": "8 min read",
        "tags": ["PDF", "Comparison", "Review"],
    },
    "remove-password-from-pdf": {
        "title": "How to Remove a Password from a PDF",
        "description": "Three ways to remove or bypass a PDF password you own — online tool, Adobe Acrobat, and command-line — explained step by step.",
        "publishedAt": "2026-03-22",
        "readTime": "4 min read",
        "tags": ["PDF", "Security", "How-To"],
    },
    "convert-word-to-pdf-free": {
        "title": "How to Convert Word to PDF for Free",
        "description": "5 ways to convert .docx files to PDF without Microsoft Office — online tools, Google Docs, LibreOffice — plus which preserves formatting best.",
        "publishedAt": "2026-03-22",
        "readTime": "5 min read",
        "tags": ["PDF", "Convert", "How-To"],
    },
    "edit-pdf-online-free-no-sign-up": {
        "title": "How to Edit a PDF Online for Free — No Sign-Up Required",
        "description": "Step-by-step guide to editing PDF text, images, and annotations online without creating an account. Compare 5 free methods.",
        "publishedAt": "2026-03-29",
        "readTime": "5 min read",
        "tags": ["PDF", "Edit", "How-To"],
    },
    "split-pdf-online-free": {
        "title": "How to Split a PDF File Online — 3 Free Methods",
        "description": "Three ways to split PDF files for free: by page range, by file size, and by bookmarks. No software needed, no sign-up.",
        "publishedAt": "2026-03-29",
        "readTime": "4 min read",
        "tags": ["PDF", "Split", "How-To"],
    },
    "redact-pdf-free-guide": {
        "title": "How to Redact Sensitive Information from PDFs — Free Guide",
        "description": "Learn how to permanently black out names, SSNs, addresses, and confidential text in PDFs. Understand why covering text with black boxes isn't enough.",
        "publishedAt": "2026-03-29",
        "readTime": "5 min read",
        "tags": ["PDF", "Security", "Redaction", "How-To"],
    },
    "best-free-online-pdf-editors-2026": {
        "title": "The Best Free Online PDF Editors in 2026 — No Downloads Required",
        "description": "We tested 7 free online PDF editors in 2026. Here's which ones are truly free, which add watermarks, and which respect your privacy.",
        "publishedAt": "2026-03-29",
        "readTime": "7 min read",
        "tags": ["PDF", "Editor", "Comparison", "Review"],
    },
    "ai-pdf-summarizer-browser-2026": {
        "title": "AI PDF Summarizer: How to Summarize Long PDFs in Your Browser (2026 Guide)",
        "description": "How AI-powered PDF summarizers work, why running them in the browser matters, and a step-by-step walkthrough of summarizing a 100-page PDF without any upload.",
        "publishedAt": "2026-05-15",
        "readTime": "9 min read",
        "tags": ["AI", "PDF", "Privacy", "How-To"],
    },
    "ilovepdf-alternatives-2026": {
        "title": "10 Best iLovePDF Alternatives in 2026 (Free, Private, Open-Source)",
        "description": "iLovePDF is popular but it's not free, it uploads your files, and it shows ads. Here are 10 alternatives ranked by features, privacy, and price.",
        "publishedAt": "2026-05-15",
        "readTime": "12 min read",
        "tags": ["Comparison", "PDF", "Alternatives", "iLovePDF"],
    },
    "redact-pdf-permanently-guide": {
        "title": "How to Redact a PDF Properly (Don't Use Black Boxes)",
        "description": "Drawing black boxes over text doesn't redact anything — the text is still under there. How to actually remove sensitive content from a PDF so it can't be recovered.",
        "publishedAt": "2026-05-15",
        "readTime": "8 min read",
        "tags": ["PDF", "Privacy", "Redaction", "Security"],
    },
    "online-pdf-tools-tracking-you": {
        "title": "Why Most Online PDF Tools Are Tracking You (And What to Do About It)",
        "description": "A look at what actually happens when you upload a PDF to a 'free' online tool — the trackers, the retention windows, the third-party pixels — and how to stay private.",
        "publishedAt": "2026-05-15",
        "readTime": "10 min read",
        "tags": ["Privacy", "PDF", "Security", "Tracking"],
    },
    "heic-conversion-guide-2026": {
        "title": "How to Convert HEIC to PDF, JPG, and PNG on Any Device (2026)",
        "description": "Apple's HEIC format is space-efficient but incompatible with most software. How to convert HEIC to PDF, JPG, or PNG online, on Mac, on Windows, and in batch.",
        "publishedAt": "2026-05-15",
        "readTime": "7 min read",
        "tags": ["HEIC", "Image", "Conversion", "How-To"],
    },
    "decode-jwt-tokens-safely-guide": {
        "title": "How to Decode a JWT Token Safely (and What Each Part Means)",
        "description": "JWT tokens are everywhere in modern web auth. How they're structured, how to decode them, what each claim means, and why you should never paste a real JWT into a random online decoder.",
        "publishedAt": "2026-05-15",
        "readTime": "8 min read",
        "tags": ["JWT", "Developer", "Security", "How-To"],
    },
}

# ---------------------------------------------------------------------------
# Tool popularity ranks  (slug → rank; lower = more searched/used).
# Mirrors frontend/src/data/{tools,non-pdf-tools}.ts. Used to sort SSR output
# so crawlers see the same most-popular-first ordering React renders. Missing
# slugs default to 999 (end of list).
# ---------------------------------------------------------------------------
_POPULARITY: dict[str, int] = {
    # ── PDF: organize ──────────────────────────────────────────────────
    "merge-pdf": 10, "split-pdf": 11, "extract-pages": 12, "delete-pages": 13,
    "organize-pages": 14, "remove-blank-pages": 15, "reverse-pdf": 16,
    "split-by-bookmarks": 17, "split-by-size": 18, "split-by-text": 19,
    "split-in-half": 20, "booklet-pdf": 21,
    # ── PDF: edit ──────────────────────────────────────────────────────
    "edit-pdf": 30, "sign-pdf": 31, "esign-pdf": 32, "watermark": 33,
    "annotate-pdf": 34, "highlight-pdf": 35, "page-numbers": 36,
    "header-footer": 37, "add-hyperlinks": 38, "stamp-pdf": 39,
    "whiteout-pdf": 40, "bookmarks": 41, "add-shapes": 42,
    "bates-numbering": 43, "transparent-background": 44, "add-attachment": 45,
    # ── PDF: optimize ──────────────────────────────────────────────────
    "compress-pdf": 50, "resize-pdf": 51, "rotate-pdf": 52, "crop-pdf": 53,
    "auto-crop": 54, "grayscale-pdf": 55, "deskew-pdf": 56, "repair-pdf": 57,
    "flatten-pdf": 58, "web-optimize-pdf": 59, "batch-compress-pdf": 60,
    "invert-colors": 61,
    # ── PDF: security ──────────────────────────────────────────────────
    "unlock-pdf": 70, "protect-pdf": 71, "redact-pdf": 72, "smart-redact": 73,
    "strip-metadata": 74, "metadata": 75, "delete-annotations": 76,
    "set-permissions": 77, "sanitize-pdf": 78, "verify-signature": 79,
    "pdfa-validator": 80,
    # ── PDF: to-pdf ────────────────────────────────────────────────────
    "word-to-pdf": 100, "jpg-to-pdf": 101, "image-to-pdf": 102,
    "png-to-pdf": 103, "excel-to-pdf": 104, "pptx-to-pdf-convert": 105,
    "html-to-pdf": 106, "office-to-pdf": 107, "heic-to-pdf": 108,
    "webp-to-pdf": 109, "tiff-to-pdf": 110, "svg-to-pdf": 111,
    "bmp-to-pdf": 112, "gif-to-pdf": 113, "txt-to-pdf": 114,
    "markdown-to-pdf": 115, "csv-to-pdf": 116, "epub-to-pdf": 117,
    "rtf-to-pdf": 118, "odt-to-pdf": 119, "json-to-pdf": 120, "xml-to-pdf": 121,
    # ── PDF: from-pdf ──────────────────────────────────────────────────
    "pdf-to-word": 130, "pdf-to-jpg": 131, "pdf-to-image": 132,
    "pdf-to-excel": 133, "pdf-to-png": 134, "pdf-to-pptx": 135,
    "pdf-to-text": 136, "pdf-to-html": 137, "pdf-to-markdown": 138,
    "extract-tables": 139, "pdf-to-rtf": 140, "pdf-to-epub": 141,
    "pdf-to-tiff": 142, "pdf-to-svg": 143, "pdf-to-bmp": 144, "pdf-to-gif": 145,
    # ── PDF: advanced ──────────────────────────────────────────────────
    "ocr-pdf": 160, "compare-pdf": 161, "fill-form": 162, "extract-images": 163,
    "summarize-pdf": 164, "qr-code": 165, "pdf-page-counter": 166,
    "nup": 167, "overlay": 168, "alternate-mix": 169, "form-creator": 170,
    "pdf-to-pdfa": 171,
    # ── non-PDF: image ─────────────────────────────────────────────────
    "image-compressor": 210, "image-converter": 211, "resize-crop-image": 212,
    "remove-background": 213, "image-upscaler": 214, "image-watermark": 215,
    "heic-to-jpg": 216, "webp-to-jpg": 217, "png-to-jpg": 218, "jpg-to-png": 219,
    "webp-to-png": 220, "svg-to-png": 221, "tiff-to-jpg": 222, "tiff-to-png": 223,
    "bmp-to-jpg": 224, "bmp-to-png": 225, "heic-to-png": 226, "jpg-to-webp": 227,
    "png-to-webp": 228, "gif-to-jpg": 229, "gif-to-png": 230, "remove-exif": 231,
    "view-exif": 232, "make-collage": 233, "merge-images": 234, "image-ocr": 235,
    "generate-favicon": 236, "qr-reader": 237, "video-to-gif": 238,
    # ── non-PDF: video-audio ───────────────────────────────────────────
    "mp4-to-mp3": 250, "compress-video": 251, "video-converter": 252,
    "mov-to-mp4": 253, "trim-media": 254, "audio-converter": 255,
    "extract-audio": 256, "m4a-to-mp3": 257, "avi-to-mp4": 258,
    "webm-to-mp4": 259, "mp4-to-webm": 260, "gif-to-mp4": 261,
    "video-to-pdf": 262, "video-resizer": 263, "video-thumbnail": 264,
    "add-subtitles": 265, "video-merge": 266, "audio-merge": 267,
    "subtitle-converter": 268,
    # ── non-PDF: developer ─────────────────────────────────────────────
    "base64": 280, "json-xml-formatter": 281, "hash-generator": 282,
    "text-diff": 283, "csv-json": 284, "yaml-to-json": 285, "json-to-yaml": 286,
    "markdown-html": 287, "url-encoder": 288, "case-converter": 289,
    "jwt-decoder": 290, "regex-tester": 291, "timestamp-converter": 292,
    "password-generator": 293, "uuid-generator": 294, "color-converter": 295,
    "word-counter": 296, "lorem-ipsum": 297, "generate-barcode": 298,
    "url-to-pdf": 299,
    # ── non-PDF: archive ───────────────────────────────────────────────
    "extract-archive": 310, "create-zip": 311,
    # ── Phase 7 (competitor-gap, v1.5.0) — image + video/audio gaps ────
    "image-palette": 39, "pixelate-image": 40,
    "mute-video": 53, "video-speed": 55, "audio-trim": 56,
    "reverse-video": 65,
}


def _by_popularity(items):
    """Sort an iterable of (slug, ...) tuples by popularity rank."""
    return sorted(items, key=lambda kv: _POPULARITY.get(kv[0], 999))


# ---------------------------------------------------------------------------
# TL;DR generator — produces a single-sentence, voice-friendly answer for
# the "what does this tool do?" question. AEO/voice-search gold: this is
# the line ChatGPT, Perplexity, Google AI Overviews, and Alexa will read
# back when a user asks "how do I {action} a PDF online?".
# ---------------------------------------------------------------------------
_TLDR_OVERRIDES: dict[str, str] = {
    # Hand-written TL;DRs for the highest-volume tools where the
    # auto-generated one is too generic. AI engines and voice assistants
    # quote these sentences verbatim — they should fully answer "how do I
    # X" in one read.
    # ── PDF: top-volume operations ─────────────────────────────────────
    "merge-pdf":        "Drop two or more PDFs, drag to reorder, click Merge — you get one combined PDF in seconds, no sign-up, no watermarks.",
    "split-pdf":        "Upload a PDF, type the page range you want (e.g. 1-3, 5, 7-end), and download the extracted pages as a new PDF.",
    "compress-pdf":     "Upload a PDF, pick a compression level (Light / Recommended / Extreme), and download the smaller version — typically 50-75% smaller.",
    "unlock-pdf":       "Upload a password-protected PDF, type the password, and download the unlocked version that opens without prompting.",
    "protect-pdf":      "Upload a PDF, set a password (with optional permissions for print/copy/edit), and download the encrypted file.",
    "pdf-to-word":      "Upload a PDF and download an editable .docx with the layout and most formatting preserved — no Acrobat required.",
    "pdf-to-jpg":       "Upload a PDF and download each page as a JPEG image in a ZIP, at the resolution you choose.",
    "word-to-pdf":      "Upload a .docx and download it as a PDF that looks the same on every device.",
    "jpg-to-pdf":       "Upload one or more JPG/JPEG images and download a single PDF, choosing A4, Letter, or fit-to-image page size.",
    "image-to-pdf":     "Upload images (JPG/PNG/HEIC/WebP/TIFF/BMP/GIF/SVG) and combine them into a single PDF with one click.",
    "ocr-pdf":          "Upload a scanned PDF and download a searchable, copy-pasteable PDF — or extract the text directly as .txt/JSON.",
    "rotate-pdf":       "Upload a PDF, choose 90/180/270° (per page or all), and download the rotated copy.",
    "watermark":        "Upload a PDF, type your watermark text (or upload an image), choose position and opacity, and download the watermarked file.",
    "redact-pdf":       "Upload a PDF, draw black-out rectangles over sensitive areas, and download the redacted file with content burnt in.",
    "edit-pdf":         "Upload a PDF and click anywhere on the page to add text, highlights, white-out boxes, or rectangles — then download the edited version.",
    "sign-pdf":         "Upload a PDF, draw or type your signature, place it on any page, and download the signed PDF.",
    "html-to-pdf":      "Paste a URL or HTML snippet and download a paginated PDF rendering of the page.",
    "image-compressor": "Upload JPG/PNG/WebP/BMP, pick a quality from 1-100, and download a smaller version — typically 40-70% lighter.",
    "image-converter":  "Upload an image and choose a target format (JPG/PNG/WebP/AVIF/TIFF/BMP/GIF) to convert it in your browser.",
    "remove-background":"Upload an image and download a version with the background removed as a transparent PNG — uses U²-Net AI, runs server-side.",
    "compress-video":   "Upload a video and pick a CRF quality level — output is smaller MP4 (H.264) that plays everywhere.",
    "mp4-to-mp3":       "Upload an MP4 video and download just the audio track as an MP3 file.",
    "video-to-gif":     "Upload a short MP4/MOV/WebM and download an animated GIF, choosing FPS and width.",
    "heic-to-jpg":      "Upload an iPhone HEIC photo and download a universally-compatible JPEG — no Apple software required.",
    "qr-code":          "Type any URL or text and download a QR code as PNG or PDF — no upload needed.",
    "yaml-to-json":     "Paste YAML and copy the equivalent JSON instantly — runs entirely in your browser, your config never uploads.",
    "json-to-yaml":     "Paste JSON and copy the equivalent YAML instantly — pure browser, perfect for Kubernetes / Compose / GitHub Actions.",
    "case-converter":   "Paste any text and copy the result in 12 different cases (camelCase, snake_case, kebab-case, CONSTANT_CASE, etc.) — 100% in your browser.",
    "password-generator":"Pick a length and character classes, click Generate, and copy a cryptographically-secure password — never leaves your browser.",
    "base64":           "Encode text or files to Base64, or decode Base64 back to the original — runs locally, no upload.",
    "jwt-decoder":      "Paste a JWT and see its header, payload, and signature decoded as readable JSON — claims (exp, iat, sub) highlighted. Stays in your browser.",
    "regex-tester":     "Paste a regex and a test string and see every match highlighted live, with captured groups. Supports all standard JS flags. Browser-only.",
    "url-encoder":      "Encode or decode URLs (percent-encoding) instantly in your browser — perfect for query parameters and form data.",
    "color-converter":  "Pick or type a color and copy it instantly in HEX, RGB, RGBA, HSL, or HSLA. Includes a visual preview.",

    # ── PDF: more high-traffic tools ───────────────────────────────────
    "delete-pages":     "Upload a PDF, type the page numbers to remove (e.g. 2, 5-7), and download the trimmed copy.",
    "extract-pages":    "Upload a PDF, type which pages to keep (e.g. 1-3, 5), and download just those pages as a new PDF.",
    "organize-pages":   "Upload a PDF and drag thumbnails to reorder, rotate, or delete pages visually — download the rearranged copy.",
    "split-by-bookmarks":"Upload a PDF with bookmarks and download a ZIP with one PDF per chapter — perfect for breaking textbooks or manuals apart.",
    "split-by-size":    "Upload a PDF, set a max file size in MB (e.g. 10 MB for email), and download a ZIP of split chunks that all fit the limit.",
    "split-in-half":    "Upload a PDF (typically a two-up scan or booklet) and download a copy with every page cut down the middle.",
    "remove-blank-pages":"Upload a PDF and download a copy with blank pages auto-detected and removed — ideal for cleaning up duplex scans.",
    "reverse-pdf":      "Upload a PDF and download the same content with page order reversed (last page first).",
    "booklet-pdf":      "Upload a multi-page PDF and download a booklet-imposed copy ready for saddle-stitch printing (2-up, page-order corrected).",
    "page-numbers":     "Upload a PDF, pick position (bottom-center, etc.) and starting number, and download a copy with page numbers stamped in.",
    "header-footer":    "Upload a PDF, type header and/or footer text, and download a copy with that text added to every page.",
    "bates-numbering":  "Upload a PDF (or batch), set a prefix and digit count, and download a copy with sequential Bates numbers stamped on every page — the legal-discovery standard.",
    "redact-pdf":       "Upload a PDF, draw black-out rectangles over the areas to hide, and download the redacted file — content is burnt in, not just overlaid.",
    "smart-redact":     "Upload a PDF and let AI find and redact emails, phone numbers, SSNs, names, etc. — all detection happens in your browser via BERT-NER.",
    "strip-metadata":   "Upload a PDF and download a metadata-clean copy — title, author, keywords, software, timestamps, and XMP packets all wiped.",
    "metadata":         "Upload a PDF and edit title, author, subject, and keywords — download the updated copy.",
    "fill-form":        "Upload a fillable PDF form, set values for each field, and download the completed copy. No Acrobat required.",
    "ocr-pdf":          "Upload a scanned PDF and download a searchable, copy-pasteable PDF — or extract the text as .txt/JSON.",
    "pdfa-validator":   "Upload a PDF and find out whether it conforms to PDF/A archival standards — failure reasons listed.",
    "verify-signature": "Upload a PDF and see if it carries digital signatures plus signer names — covers detection, not full cryptographic verification.",
    "sanitize-pdf":     "Upload a PDF and download a sanitized copy with JavaScript, embedded files, forms, and annotations removed — defends against malicious PDFs.",
    "set-permissions":  "Upload a PDF, set an owner password and choose permissions (print, copy, modify) — download the locked copy.",
    "delete-annotations":"Upload a PDF and download a copy with all comments, highlights, and annotations stripped.",
    "auto-crop":        "Upload a scanned PDF and download a copy with whitespace margins auto-detected and cropped — content bounding boxes computed per page.",
    "crop-pdf":         "Upload a PDF, set top/bottom/left/right margins in points, and download the cropped copy.",
    "resize-pdf":       "Upload a PDF and resize all pages to A4, Letter, or custom dimensions — download the resized copy.",
    "deskew-pdf":       "Upload a tilted scan and download a deskewed copy — angle detected automatically and corrected.",
    "flatten-pdf":      "Upload a PDF with form fields or annotations and download a flattened copy where everything is baked into page content.",
    "repair-pdf":       "Upload a damaged or corrupt PDF and download a repaired copy — qpdf rebuilds the xref tables and structures.",
    "web-optimize-pdf": "Upload a PDF and download a linearized copy that streams in the browser (the first page renders before the rest finishes downloading).",
    "grayscale-pdf":    "Upload a color PDF and download a grayscale copy — every page rasterized to neutral grays.",
    "batch-compress-pdf":"Drop up to 50 PDFs and download a ZIP where each is individually compressed — same Light/Recommended/Extreme presets as Compress PDF.",
    "invert-colors":    "Upload a PDF and download a copy with colors inverted (light↔dark) — handy for night reading or printing dark slides.",
    "transparent-background":"Upload a PDF and download a copy where the white background is replaced with transparency — useful for overlay on slides.",
    "add-attachment":   "Upload a PDF, attach any file (image, spreadsheet, zip, even another PDF), and download a PDF with that file embedded as an attachment.",
    "add-hyperlinks":   "Upload a PDF, draw link rectangles over text/images, set URLs, and download a copy with clickable hyperlinks added.",
    "add-shapes":       "Upload a PDF, define rectangles, ellipses, lines, or polygons by page + coords, and download a copy with the shapes drawn in.",
    "annotate-pdf":     "Upload a PDF and add highlights, sticky notes, text boxes, and shapes — download a copy with standard PDF annotations.",
    "stamp-pdf":        "Upload a PDF and stamp every page with a text label like 'DRAFT' or 'CONFIDENTIAL' — download the stamped copy.",
    "whiteout-pdf":     "Upload a PDF and white-out rectangular regions — content beneath is hidden under solid white fills.",
    "form-creator":     "Upload a PDF and define form fields (text/checkbox/radio/dropdown) by page+coords — download a fillable PDF.",
    "esign-pdf":        "Upload a PDF and add e-signature fields for one or more signers — download a copy ready for circulation.",
    "highlight-pdf":    "Upload a PDF, type a search term, and download a copy with every matching occurrence highlighted in yellow.",
    # ── PDF: from-pdf high-traffic ─────────────────────────────────────
    "pdf-to-excel":     "Upload a PDF and download an .xlsx with detected tables — works best with text-PDFs (not scans).",
    "pdf-to-pptx":      "Upload a PDF and download a .pptx where each page becomes a slide — great for converting reports into presentations.",
    "pdf-to-text":      "Upload a PDF and instantly get the extracted text on-screen plus a per-page breakdown — copy anywhere or download as .txt.",
    "pdf-to-image":     "Upload a PDF and download a ZIP where every page is a separate image (JPG/PNG/TIFF/BMP/GIF/SVG) at your chosen DPI.",
    "pdf-to-html":      "Upload a PDF and download a paginated HTML file you can open in any browser — perfect for embedding in webpages.",
    "pdf-to-rtf":       "Upload a PDF and download an RTF file you can open in Word/LibreOffice without conversion artefacts.",
    "pdf-to-epub":      "Upload a PDF (especially text-PDFs of books) and download an EPUB you can read on Kindle, Kobo, or any e-reader.",
    "pdf-to-markdown":  "Upload a PDF and download a Markdown (.md) extraction — preserves headings, lists, and table structure.",
    "extract-tables":   "Upload a PDF with tables and download a CSV of the detected rows and columns.",
    "extract-images":   "Upload a PDF and download a ZIP of every embedded image — at the original resolution and format.",
    "pdf-to-pdfa":      "Upload a PDF and download a PDF/A-compliant copy ready for long-term archiving (fonts embedded, metadata normalized, encryption removed).",
    "pdf-page-counter": "Drop up to 100 PDFs and get a per-file + total page count — instant, reads only metadata not content.",
    "compare-pdf":      "Upload two PDFs and download a side-by-side visual diff with differences highlighted — or get a text-only diff report.",
    "nup":              "Upload a PDF and download an n-up version that fits 2/4/6/8 logical pages onto one physical page — saves paper when printing.",
    "overlay":          "Upload a background PDF and a foreground PDF — download a copy with foreground stamped over every background page.",
    "alternate-mix":    "Upload two PDFs and download a copy that interleaves their pages (1A, 1B, 2A, 2B…) — useful for un-imposing two-sided scans.",
    "summarize-pdf":    "Upload a PDF, click Summarize, and read an extractive summary right on the page — DistilBART runs entirely in your browser, no upload.",
    # ── To PDF: high-volume converters ─────────────────────────────────
    "excel-to-pdf":     "Upload an .xlsx and download a PDF copy with the same formatting — works for multi-sheet workbooks.",
    "pptx-to-pdf-convert":"Upload a .pptx and download a one-slide-per-page PDF — perfect for handouts.",
    "office-to-pdf":    "Upload any Office file (doc/docx/xls/xlsx/ppt/pptx) and download a PDF — LibreOffice handles the conversion server-side.",
    "txt-to-pdf":       "Upload a plain text file and download a formatted PDF — paginated with monospaced font.",
    "markdown-to-pdf":  "Upload a .md (or .json/.yaml/.toml) file and download a rendered PDF — headings, lists, tables, and code blocks all styled.",
    "csv-to-pdf":       "Upload a .csv and download a PDF table — rows are split across pages automatically.",
    "epub-to-pdf":      "Upload an EPUB e-book and download a paginated PDF — preserves headings and chapter breaks.",
    "rtf-to-pdf":       "Upload a Rich Text Format file and download a PDF copy with bold/italic/lists/tables intact.",
    "json-to-pdf":      "Upload a .json file and download a syntax-highlighted PDF rendering — great for documenting API responses.",
    "xml-to-pdf":       "Upload a .xml file and download a colored, indented PDF view — readable for non-developers.",
    "odt-to-pdf":       "Upload an OpenDocument Text (.odt) file and download a PDF — LibreOffice powers the conversion.",
    # ── Non-PDF: high-volume ───────────────────────────────────────────
    "remove-exif":      "Upload an image and download a copy with EXIF metadata (GPS, camera model, timestamps) stripped — protects your privacy when sharing photos.",
    "view-exif":        "Upload an image and read its EXIF metadata — GPS coordinates, camera make/model, lens, ISO, shutter speed, software, timestamps.",
    "resize-crop-image":"Upload an image and resize or crop it to exact pixel dimensions — supports preserve-aspect or stretch.",
    "image-watermark":  "Upload an image, choose text or another image as the watermark, set position + opacity, and download the watermarked file.",
    "image-upscaler":   "Upload an image and upscale 2× or 4× — uses high-quality Lanczos resampling (no AI, but very fast).",
    "image-ocr":        "Upload an image with text and copy the extracted text — Tesseract OCR runs server-side and supports 100+ languages.",
    "make-collage":     "Upload 2+ images and download a single collage PDF/PNG — pick columns, spacing, and background color.",
    "merge-images":     "Upload 2+ images and download a single merged image — horizontal or vertical stitching.",
    "generate-favicon": "Upload a logo image and download a multi-resolution .ico (16/32/48/64/128/192/512 px) ready for web use.",
    "generate-barcode": "Type any data string, pick a barcode type (Code128, EAN-13, UPC, QR, etc.), and download as PNG.",
    "qr-reader":        "Upload an image of a QR code and read the encoded data — runs server-side via zbar, supports rotated/skewed codes.",
    "trim-media":       "Upload a video or audio file, set HH:MM:SS start and end, and download just that segment — re-encodes for frame accuracy.",
    "compress-video":   "Upload a video and pick a CRF quality level — output is smaller H.264 MP4 that plays everywhere.",
    "video-converter":  "Upload a video and pick a target container (MP4/MOV/WebM/MKV/AVI) — FFmpeg handles the conversion server-side.",
    "video-resizer":    "Upload a video and pick a target width (height auto-scales to preserve aspect ratio) — H.264 MP4 output.",
    "video-thumbnail":  "Upload a video and pick a timestamp — download a single JPG screenshot from that moment.",
    "video-to-pdf":     "Upload a video and download a PDF where each page is a frame sampled at your chosen interval — great for highlight reels.",
    "video-to-gif":     "Upload a short video (MP4/MOV/WebM) and download an animated GIF — pick FPS and width.",
    "audio-converter":  "Upload an audio file and pick a target format (MP3/WAV/OGG/FLAC/AAC) + bitrate — FFmpeg converts server-side.",
    "video-merge":      "Upload 2+ videos and download a single merged video — concatenates in upload order.",
    "audio-merge":      "Upload 2+ audio files and download a single merged track — concatenates in upload order.",
    "extract-audio":    "Upload a video file and download just the audio track — pick MP3, WAV, AAC, or FLAC.",
    "add-subtitles":    "Upload a video plus an .srt subtitle file and download a copy with subtitles burned into the picture.",
    "subtitle-converter":"Paste or upload an SRT/VTT/ASS subtitle file and convert it to any of the other formats — pure-browser.",
    "remove-background":"Upload an image of a person, product, or object and download a transparent-background PNG — U²-Net AI runs server-side.",
    "extract-archive":  "Upload a ZIP, TAR, or other archive and download a folder/ZIP of the extracted files.",
    "create-zip":       "Drop any files (any format) and download them packed into a single ZIP archive.",
    "url-to-pdf":       "Type any URL and download a paginated PDF rendering of the page — server-side headless Chrome.",
    # ── Browser-only utilities ─────────────────────────────────────────
    "json-xml-formatter":"Paste JSON or XML and instantly see it pretty-printed with syntax highlighting — runs in your browser.",
    "text-diff":        "Paste two pieces of text and see a line-by-line diff with additions in green and deletions in red — pure browser.",
    "hash-generator":   "Paste text or upload a file and copy MD5, SHA-1, SHA-256, and SHA-512 hashes — all computed locally in your browser.",
    "csv-json":         "Paste CSV or JSON and instantly see the other format — round-trippable, runs in your browser.",
    "markdown-html":    "Paste Markdown and copy the rendered HTML — supports tables, code blocks, and standard CommonMark syntax.",
    "uuid-generator":   "Click Generate and copy a v4 or v7 UUID — bulk-generate up to 500 at a time, pure browser.",
    "lorem-ipsum":      "Pick paragraphs/words/sentences and copy placeholder Lorem Ipsum text instantly — never need to look it up again.",
    "word-counter":     "Paste any text and see live word, character, sentence, paragraph, and reading-time counts — pure browser.",
    # ── Phase 7 — competitor-gap tools (v1.5.0) ────────────────────────
    "mute-video":       "Upload a video and download the same video without its audio track — instant, lossless, no re-encoding.",
    "reverse-video":    "Upload a video and download a copy that plays backwards — both video and audio reversed in sync.",
    "video-speed":      "Upload a video, drag the slider from 0.25× (slow-mo) to 4× (hyperlapse), and download the result — audio pitch-corrected so it doesn't sound chipmunky.",
    "audio-trim":       "Upload an audio file, type start and end timestamps (HH:MM:SS), and download just that segment — lossless stream-copy.",
    "image-palette":    "Upload an image and copy the dominant color HEX/rgb values with coverage percentages — useful for extracting brand colors from a logo.",
    "pixelate-image":   "Upload an image, pick mosaic pixelation or Gaussian blur, set strength, and download a censored copy for privacy-safe sharing.",
}


def _tldr_for(slug: str, name: str) -> str:
    """Return a voice-friendly 1-sentence answer for this tool."""
    if slug in _TLDR_OVERRIDES:
        return _TLDR_OVERRIDES[slug]
    # Fall back to a generic-but-helpful template.
    nice = name.replace(" Online Free", "").replace(" — PrivaTools", "")
    return (
        f"Upload your file, click {nice.split()[0] if nice else 'Run'}, "
        f"and download the result — free, browser-based, no sign-up, no watermarks. "
        f"Files are processed and discarded immediately."
    )


# ---------------------------------------------------------------------------
# PDF tool meta  (slug → (name, long_description))
# ---------------------------------------------------------------------------
_PDF_TOOLS: dict[str, tuple[str, str]] = {
    "merge-pdf": ("Merge PDF", "Merge PDF files online for free — combine multiple PDF documents into a single file in seconds. Drag, drop, and reorder pages before merging. No file size limits, no sign-up, no watermarks. Your files are processed securely and never stored."),
    "split-pdf": ("Split PDF", "Split PDF online for free — divide a PDF into separate files by page range. Extract specific pages or split every page into individual PDFs. No installation, no registration required. Privacy-first: files are never stored on our servers."),
    "split-by-bookmarks": ("Split by Bookmarks", "Split PDF by bookmarks or chapters automatically. Detect table of contents entries and create separate PDFs for each section. Ideal for splitting textbooks, manuals, and reports. Free, private, no sign-up."),
    "split-by-size": ("Split by Size", "Split large PDFs into smaller files by maximum file size. Perfect for email attachments with size limits. Set your target size (e.g., 10 MB) and automatically split into compliant chunks. Free online tool, no registration."),
    "organize-pages": ("Organize Pages", "Rearrange PDF pages online — drag and drop page thumbnails to reorder, delete, rotate, or duplicate pages visually. Free PDF page organizer with no watermarks. Preview every page before saving."),
    "delete-pages": ("Delete Pages", "Remove pages from PDF online for free. Select specific pages or ranges to permanently delete. Preview thumbnails and choose exactly which pages to remove. No sign-up, no watermarks, files never stored."),
    "extract-pages": ("Extract Pages", "Extract pages from PDF online — save specific pages as a new PDF file. Select individual pages or ranges to pull out while keeping the original document intact. Free, fast, and private."),
    "remove-blank-pages": ("Remove Blank Pages", "Remove blank pages from PDF online for free. Automatically scan and delete entirely blank or near-blank pages from scanned documents. Clean up your PDFs by removing empty fillers and scan artifacts."),
    "reverse-pdf": ("Reverse PDF", "Reverse the page order of a PDF online for free. Flip the entire document so the last page becomes first. Useful for fixing duplex scan order or creating back-to-front presentations."),
    "booklet-pdf": ("PDF Booklet", "Rearrange PDF pages for booklet printing online for free. Automatically reorder pages so that when printed and folded, they create a correctly ordered booklet. No software needed."),
    "batch-compress-pdf": ("Batch Compress PDF", "Batch compress multiple PDFs online for free — upload up to 50 files and compress them all in parallel. Choose light, balanced, or extreme compression. Download results as a single ZIP file. No sign-up, 500 MB per file."),
    "pdf-page-counter": ("PDF Page Counter", "Count pages in multiple PDFs online for free — upload up to 100 files and instantly see page counts for each file plus the total. Perfect for print estimates, document audits, and project planning."),
    "image-upscaler": ("Image Upscaler", "Upscale images online for free — enlarge photos 2x or 4x using high-quality Lanczos resampling. Supports JPG, PNG, and WebP. Improve resolution of thumbnails, screenshots, or small images without blur."),
    "audio-converter": ("Audio Converter", "Convert audio files online for free — change between MP3, WAV, OGG, FLAC, and AAC formats. Choose bitrate from 64k to 320k. Powered by FFmpeg for professional-quality conversion. Files up to 200 MB supported."),
    "edit-pdf": ("Edit PDF", "Edit PDF online for free — modify text, images, and content directly inside your PDF. Add new text blocks, replace images, and make changes without converting to Word first. Full-featured PDF editor with no watermarks."),
    "sign-pdf": ("Sign PDF", "Add signature to PDF online for free. Draw, type, or upload your signature image and place it anywhere on the document. Create legally-binding electronic signatures without printing. No account required."),
    "watermark": ("Watermark PDF", "Add watermark to PDF online for free. Apply text or image watermarks to every page with full control over opacity, position, rotation, and font size. Protect your documents from unauthorized use. No sign-up needed."),
    "header-footer": ("PDF Header & Footer", "Add headers and footers to PDF online. Insert custom text, dates, page numbers, or company information in the header and footer of your PDF pages. Free tool with flexible formatting options."),
    "page-numbers": ("Add Page Numbers to PDF", "Add page numbers to PDF online for free. Choose from multiple formats, set starting page and number, position, font, and optional prefix. No watermarks, no sign-up."),
    "bates-numbering": ("Bates Numbering PDF", "Add Bates numbering to PDF for legal document indexing. Apply sequential Bates stamps with custom prefix, suffix, and start number. Essential for legal discovery and court filings. Free online tool."),
    "bookmarks": ("PDF Bookmarks", "Add bookmarks to PDF online — create, rename, reorder, and nest bookmarks for easier navigation in large documents. Build a clickable table of contents for your PDF. Free, no software installation."),
    "stamp-pdf": ("PDF Stamp", "Add stamps to PDF online for free — apply CONFIDENTIAL, DRAFT, APPROVED, COPY, VOID, or custom text stamps to any page. Adjustable opacity, position, and size. No sign-up, no watermarks."),
    "esign-pdf": ("E-Sign PDF", "E-sign PDF online for free — draw your signature with mouse or finger, then place it on any page. The simplest way to electronically sign documents without printing. No account needed."),
    "annotate-pdf": ("Annotate PDF", "Annotate PDF online for free — add highlights, underlines, strikethrough, and sticky notes with customizable colors. Perfect for reviewing documents, studying, and collaborative feedback. No software needed."),
    "add-shapes": ("Add Shapes to PDF", "Add shapes to PDF online — draw rectangles, circles, lines, and arrows with custom colors, fill, and stroke width. Perfect for technical drawings, callouts, and visual annotations. Free tool."),
    "add-attachment": ("Add Attachment to PDF", "Embed files inside a PDF online — attach images, documents, spreadsheets, or any file as an embedded attachment that recipients can extract. Perfect for sending supplementary materials."),
    "add-hyperlinks": ("Add Hyperlinks to PDF", "Add clickable hyperlinks to PDF online for free. Draw link areas over text or images and attach URLs. Create interactive PDFs with internal and external navigation links."),
    "transparent-background": ("PDF Transparent Background", "Convert near-white PDF backgrounds to transparency online for free. Perfect for layering PDF content over colored backgrounds or presentations."),
    "compress-pdf": ("Compress PDF", "Compress PDF online for free — reduce PDF file size by up to 90% without losing quality. Choose from light, balanced, or extreme compression levels. Preview estimated savings before downloading. No file limits, no sign-up."),
    "flatten-pdf": ("Flatten PDF", "Flatten PDF online — permanently merge interactive form fields, annotations, and layers into static page content. Essential for submitting filled forms, preventing further edits. Free tool."),
    "deskew-pdf": ("Deskew PDF", "Deskew scanned PDF pages online for free. Automatically detect and correct the tilt angle of scanned documents so text appears perfectly straight and readable. Ideal for fixing wonky scans."),
    "repair-pdf": ("Repair PDF", "Repair corrupted PDF files online for free. Fix damaged, broken, or unreadable PDFs that won't open in standard PDF readers. Recover content from corrupted documents."),
    "resize-pdf": ("Resize PDF", "Resize PDF pages online — change page dimensions to A4, Letter, Legal, or custom sizes. Scale content to fit new page sizes while maintaining aspect ratio. Free PDF page resizer with no watermarks."),
    "rotate-pdf": ("Rotate PDF", "Rotate PDF pages online for free — rotate individual pages or all pages by 90°, 180°, or 270°. Fix sideways or upside-down scanned documents instantly. Preview each page before saving."),
    "grayscale-pdf": ("Grayscale PDF", "Convert PDF to grayscale online for free — turn color PDFs into black and white. Save ink when printing, reduce file size, or prepare documents for monochrome printing."),
    "crop-pdf": ("Crop PDF", "Crop PDF online for free — trim margins, remove white space, or change the visible area of PDF pages. Draw a crop box to remove unwanted borders. Perfect for removing headers, footers, or excess whitespace."),
    "auto-crop": ("Auto-Crop PDF (Remove Margins)", "Auto-crop PDF online for free — automatically detect the content bounding box on every page and trim the surrounding whitespace. Ideal for reading PDFs on e-readers, tablets, or phones where screen space is limited. Also called Remove Margins. Free tool, no sign-up."),
    "invert-colors": ("Invert PDF Colors", "Invert PDF colors online for a dark mode reading experience. Convert white-background PDFs to dark-background versions to reduce eye strain when reading in the dark."),
    "protect-pdf": ("Protect PDF with Password", "Password protect PDF online for free — encrypt your PDF with AES-256 encryption. Set open passwords, permission passwords, and control printing, copying, and editing access."),
    "unlock-pdf": ("Unlock PDF", "Remove password from PDF online for free. Unlock password-protected PDFs you own by entering the correct password. Remove restrictions on printing, copying, and editing."),
    "redact-pdf": ("Redact PDF", "Redact PDF online for free — permanently black out sensitive information including names, addresses, SSNs, and confidential text. WARNING: Redaction is irreversible."),
    "strip-metadata": ("Strip PDF Metadata", "Remove metadata from PDF online — strip author name, creation date, GPS coordinates, software info, and all hidden metadata for maximum privacy before sharing documents."),
    "delete-annotations": ("Delete PDF Annotations", "Remove all annotations from PDF online — delete highlights, comments, sticky notes, drawings, and markup from your documents. Clean up reviewed PDFs before final distribution."),
    "metadata": ("PDF Metadata Editor", "View and edit PDF metadata online for free — read and modify Title, Author, Subject, Keywords, Creator, and Producer fields. See exactly what information is embedded in your PDF."),
    "set-permissions": ("PDF Permissions", "Set PDF permissions online — control who can print, copy, edit, or annotate your PDF documents. Apply granular access controls with owner password protection."),
    "pdfa-validator": ("PDF/A Validator", "Validate PDF/A compliance online for free. Run basic PDF/A indicator checks to verify your document meets long-term archiving standards. Free tool, no software needed."),
    "verify-signature": ("Verify PDF Digital Signature", "Inspect digital signature fields in a PDF online for free. Verify signature validity, view signer information, and check certificate details."),
    "sanitize-pdf": ("Sanitize PDF", "Aggressively sanitize PDF documents online — remove hidden data, JavaScript, embedded files, and metadata layers for maximum security before sharing or publishing."),
    "html-to-pdf": ("HTML to PDF", "Convert HTML to PDF online for free. Paste a URL or upload an HTML file and render it as a pixel-perfect, print-ready PDF document. Preserves CSS styles, images, and layout."),
    "image-to-pdf": ("Image to PDF", "Convert images to PDF online for free — combine JPG, PNG, TIFF, WebP, or BMP images into a single PDF document. Set page size, orientation, margins, and image quality."),
    "office-to-pdf": ("Office to PDF", "Convert Word, Excel, and PowerPoint to PDF online for free. Upload any Microsoft Office document (.docx, .xlsx, .pptx) and get a perfectly formatted PDF."),
    "markdown-to-pdf": ("Markdown to PDF", "Convert Markdown to PDF online for free. Upload .md, .json, .yaml, or .toml files and render them as beautifully formatted, structured PDF documents."),
    "csv-to-pdf": ("CSV to PDF", "Convert CSV to PDF online for free — upload a CSV spreadsheet and generate a cleanly formatted PDF with tables, invoices, or report layouts."),
    "word-to-pdf": ("Word to PDF", "Convert Word to PDF online for free — upload .docx documents and convert them to high-quality PDFs preserving headings, bold, italic text, images, and paragraph formatting."),
    "excel-to-pdf": ("Excel to PDF", "Convert Excel to PDF online for free — upload .xlsx spreadsheets and convert all sheets into a formatted PDF with headers, grid lines, and automatic column sizing."),
    "pptx-to-pdf-convert": ("PowerPoint to PDF", "Convert PowerPoint to PDF online for free — upload .pptx presentations and get a high-quality PDF preserving slide dimensions, text, headings, and formatting."),
    "txt-to-pdf": ("Text to PDF", "Convert text to PDF online for free — upload .txt files and get a cleanly formatted PDF with monospace font, word wrap, and proper pagination."),
    "json-to-pdf": ("JSON to PDF", "Convert JSON to PDF online for free — upload JSON data and render it as a styled, formatted PDF document. Great for API responses and configuration files."),
    "xml-to-pdf": ("XML to PDF", "Convert XML to PDF online for free — upload XML data and generate a formatted PDF document with proper structure and syntax highlighting."),
    "epub-to-pdf": ("EPUB to PDF", "Convert EPUB to PDF online for free — transform e-books from EPUB format into printable, shareable PDF documents. Preserves chapters, headings, and images."),
    "rtf-to-pdf": ("RTF to PDF", "Convert RTF to PDF online for free — upload Rich Text Format files and convert them to high-quality PDF preserving bold, italic, fonts, and paragraph formatting."),
    "pdf-to-excel": ("PDF to Excel", "Convert PDF to Excel online for free — extract tables and data from PDF documents into editable XLSX spreadsheets. Great for invoices, financial reports, and tabular data."),
    "pdf-to-image": ("PDF to Image", "Convert PDF to images online for free — render each page as a high-resolution JPG or PNG image. Choose DPI (up to 300), color mode, and output format."),
    "pdf-to-pptx": ("PDF to PowerPoint", "Convert PDF to PowerPoint online for free — create a PPTX presentation where each page becomes a slide. Great for presenting PDF content in meetings."),
    "pdf-to-text": ("PDF to Text", "Extract text from PDF online for free — pull all readable text content from your PDF into a clean plain-text document. Works with both text-based and searchable PDFs."),
    "pdf-to-word": ("PDF to Word", "Convert PDF to Word online for free — extract text, paragraphs, and images into an editable DOCX document. No watermarks, no file limits."),
    "pdf-to-epub": ("PDF to EPUB", "Convert PDF to EPUB online for free — transform PDF documents into reflowable e-book format compatible with Kindle, Kobo, Apple Books, and all modern e-reader devices."),
    "pdf-to-markdown": ("PDF to Markdown", "Convert PDF to Markdown online for free — extract content with automatic heading detection, bold text preservation, and clean formatting. Perfect for documentation and wikis."),
    "extract-tables": ("PDF Table Extractor", "Extract tables from PDF to CSV online for free. Automatically detect and extract tabular data from invoices, reports, and financial statements into clean, editable CSV format."),
    "alternate-mix": ("Alternate Mix PDF", "Alternate mix PDF pages online — interleave pages from two or more PDFs for duplex scanning workflows. Combine front-side and back-side scans into the correct page order."),
    "compare-pdf": ("Compare PDF", "Compare two PDFs online for free — upload two versions of a document and get a visual diff highlighting every text change, addition, and deletion. Essential for contract review."),
    "extract-images": ("Extract Images from PDF", "Extract images from PDF online for free — detect and download all embedded images from your PDF as individual PNG or JPEG files."),
    "fill-form": ("Fill PDF Form", "Fill PDF forms online for free — open interactive PDF forms, fill in all text fields, checkboxes, and dropdowns, then save the completed document. No Adobe Acrobat needed."),
    "nup": ("N-Up PDF", "Print multiple PDF pages per sheet online — arrange 2, 4, 6, or 9 pages onto a single sheet for booklet-style printing. Save paper and create handouts."),
    "ocr-pdf": ("OCR PDF", "OCR PDF online for free — convert scanned documents into searchable, selectable text using Tesseract OCR. Supports 100+ languages. Output as searchable PDF or plain text."),
    "overlay": ("Overlay PDF", "Overlay PDF pages online — layer one PDF document on top of another. Perfect for adding letterhead, branded backgrounds, or watermark stamps to existing PDFs."),
    "qr-code": ("QR Code PDF", "Add QR code to PDF online for free — generate a QR code from any URL or text and stamp it onto your PDF pages at a chosen position and size."),
    "pdf-to-pdfa": ("PDF to PDF/A", "Convert PDF to PDF/A online for free — create ISO-standardized archival documents for long-term digital preservation. Essential for legal compliance and government records."),
    "form-creator": ("PDF Form Creator", "Create PDF forms online — add text fields, checkboxes, radio buttons, and dropdown menus to any PDF. Build fillable forms without Adobe Acrobat."),
    "whiteout-pdf": ("PDF White-Out / Eraser", "White-out content in PDF online — place white rectangles over text, images, or any content to permanently hide it. Free digital erasure tool."),
    # ── Image → PDF variants ──────────────────────────────────────────────
    "jpg-to-pdf":  ("JPG to PDF",  "Convert JPG to PDF online for free — combine one or more JPG/JPEG photos into a single PDF document with custom page size and orientation. No sign-up, no watermarks."),
    "png-to-pdf":  ("PNG to PDF",  "Convert PNG to PDF online for free — turn PNG screenshots and graphics into a single PDF with full transparency support. Drag, drop, reorder. No watermarks."),
    "heic-to-pdf": ("HEIC to PDF", "Convert HEIC to PDF online for free — turn iPhone HEIC/HEIF photos into a single PDF document, no Apple device required. Bulk-convert multiple HEIC images."),
    "webp-to-pdf": ("WebP to PDF", "Convert WebP to PDF online for free — turn modern WebP images into a portable PDF document. Preserves transparency and quality. No sign-up."),
    "tiff-to-pdf": ("TIFF to PDF", "Convert TIFF to PDF online for free — combine multi-page TIFF/TIF scans into a single searchable PDF. Perfect for archived scanned documents."),
    "bmp-to-pdf":  ("BMP to PDF",  "Convert BMP to PDF online for free — turn legacy Windows BMP bitmap images into a portable PDF document with custom page sizing. No sign-up."),
    "gif-to-pdf":  ("GIF to PDF",  "Convert GIF to PDF online for free — combine GIF images into a single PDF (uses the first frame of animated GIFs). Drag, drop, and merge in one step."),
    "svg-to-pdf":  ("SVG to PDF",  "Convert SVG to PDF online for free — render scalable vector graphics into a print-ready PDF preserving sharp lines at any scale. No watermarks."),
    "odt-to-pdf":  ("ODT to PDF",  "Convert ODT to PDF online for free — turn OpenDocument Text files (LibreOffice, OpenOffice) into universally-compatible PDFs. Preserves headings and styles."),
    # ── PDF → image variants ──────────────────────────────────────────────
    "pdf-to-jpg":  ("PDF to JPG",  "Convert PDF to JPG online for free — render every page of a PDF as a high-quality JPG image. Choose DPI from 72 to 300. No sign-up, no watermarks."),
    "pdf-to-png":  ("PDF to PNG",  "Convert PDF to PNG online for free — render every page of a PDF as a lossless PNG image with optional transparency. Choose DPI up to 300."),
    "pdf-to-tiff": ("PDF to TIFF", "Convert PDF to TIFF online for free — render PDF pages into multi-page TIFF format ideal for archival, fax, and document management systems."),
    "pdf-to-bmp":  ("PDF to BMP",  "Convert PDF to BMP online for free — render PDF pages into legacy BMP bitmap files. Useful for tools that only accept Windows bitmap input."),
    "pdf-to-gif":  ("PDF to GIF",  "Convert PDF to GIF online for free — render PDF pages as GIF images for inline previews, social posts, or thumbnails."),
    "pdf-to-svg":  ("PDF to SVG",  "Convert PDF to SVG online for free — render PDF pages as scalable SVG vectors that stay sharp at any zoom level. Perfect for web embedding."),
    # ── Advanced & AI tools ───────────────────────────────────────────────
    "split-in-half":  ("Split PDF in Half",   "Split PDF pages in half online for free — split each page horizontally or vertically. Perfect for two-up scans, magazine spreads, and side-by-side layouts."),
    "highlight-pdf":  ("Highlight PDF",       "Highlight every match of a word or phrase in PDF online for free. Auto-find and yellow-highlight all occurrences across the whole document. Free, fast, private."),
    "summarize-pdf":  ("Summarize PDF (AI)",  "Summarize PDF online for free using local AI — distilbart runs entirely in your browser via WebAssembly. Get an extractive summary without uploading the document anywhere."),
    "smart-redact":   ("Smart Redact PDF (AI)", "Auto-redact PII from PDF online for free — local BERT-NER model detects names, emails, phone numbers, addresses, and SSNs in your browser. Nothing is uploaded."),
    # v1.2.0 additions
    "pdf-to-html":     ("PDF to HTML",        "Convert PDF to HTML online for free — turn a PDF into a single HTML file with text, fonts, and inline styles preserved. Useful for web archiving, screen-reader accessibility, and republishing offline PDFs on the web."),
    "pdf-to-rtf":      ("PDF to RTF",         "Convert PDF to RTF online for free — produce a Rich Text Format file that opens in WordPad, Word, Pages, LibreOffice, and every other editor. Preserves page breaks and Unicode text."),
    "split-by-text":   ("Split by Text",      "Split PDF by text or keyword online for free — divide a document at every page that contains a search phrase. Perfect for batch-split statements, contracts, invoices, or any PDF with section headings. Case-sensitive optional."),
    "web-optimize-pdf": ("Web Optimize PDF",  "Optimize PDFs for the web online for free — linearizes the file so the first page renders before the whole document has downloaded. Essential for PDFs served over a CDN or embedded inline. Powered by qpdf."),
}

# ---------------------------------------------------------------------------
# Non-PDF tool meta  (slug → (name, long_description))
# ---------------------------------------------------------------------------
_NONPDF_TOOLS: dict[str, tuple[str, str]] = {
    "image-compressor": ("Image Compressor", "Compress images online for free — reduce JPEG, PNG, and WebP file sizes by up to 80% without visible quality loss. Drag multiple files, see live savings, and download instantly. No upload to external servers."),
    "image-converter": ("Image Format Converter", "Convert images online for free — change between WebP, PNG, JPG, TIFF, BMP and HEIC formats instantly. Perfect for converting iPhone HEIC photos to JPG. No upload required."),
    "remove-exif": ("Remove EXIF Data", "Remove EXIF data from photos online for free — strip GPS location, camera model, timestamps, and all metadata before sharing images online. Protect your privacy with one click."),
    "resize-crop-image": ("Resize & Crop Image", "Resize and crop images online for free — set exact dimensions, aspect ratios, or pixel sizes. Bulk resize multiple images for social media, thumbnails, profile pictures, and websites."),
    "video-to-gif": ("Video to GIF Converter", "Convert video to GIF online for free — upload MP4, MOV, or WebM files, select the clip range, and export a looping animated GIF. Adjust FPS and resolution. No watermarks."),
    "image-ocr": ("Image OCR", "Extract text from images online for free using OCR. Upload photos of documents, screenshots, receipts, or handwritten notes. Supports 40+ languages via Tesseract. Private and instant."),
    "extract-audio": ("Extract Audio from Video", "Extract audio from video online for free — pull the audio track from any MP4, MOV, WebM, or AVI file and save as MP3, WAV, or OGG. No quality loss."),
    "trim-media": ("Cut / Trim Video & Audio", "Cut and trim video or audio online for free — use a visual timeline to set in/out points and export the trimmed clip at full quality without re-encoding."),
    "compress-video": ("Compress Video", "Compress video online for free — reduce video file size for email, messaging, and uploads. Choose quality presets from High Quality to WhatsApp-ready. Supports MP4, MOV, WebM."),
    "json-xml-formatter": ("JSON / XML Formatter", "Format JSON and XML online for free — paste, prettify, validate, and highlight syntax errors instantly. 100% offline processing. Sensitive data never leaves your browser."),
    "text-diff": ("Text Diff / Comparator", "Compare text online for free — paste two versions of text or code and get a line-by-line diff with additions in green and deletions in red. Perfect for code review."),
    "base64": ("Base64 Encoder / Decoder", "Encode and decode Base64 online for free — convert text, files, or binary data to and from Base64 format instantly. Works entirely in your browser, no data sent anywhere."),
    "hash-generator": ("Hash Generator", "Generate cryptographic hashes online for free — compute MD5, SHA-1, SHA-256, SHA-512, and more from text or files. Verify file integrity instantly. 100% private."),
    "extract-archive": ("Extract Archive", "Extract ZIP, RAR, 7Z, and TAR archives online for free — upload compressed files and extract all contents privately in your browser. No server uploads needed."),
    "create-zip": ("Create ZIP Archive", "Create ZIP archives online for free — select multiple files and compress them into a downloadable ZIP file. Fast, private, and no file size limits."),
    "csv-json": ("CSV to JSON Converter", "Convert CSV to JSON online for free — upload a CSV spreadsheet and get a properly formatted JSON array. Also supports JSON to CSV. Perfect for data transformation."),
    "markdown-html": ("Markdown to HTML Converter", "Convert Markdown to HTML online for free — paste Markdown text and get clean, rendered HTML. Preview the output instantly. Also supports HTML to Markdown."),
    "heic-to-jpg": ("HEIC to JPG Converter", "Convert HEIC to JPG online for free — transform iPhone HEIC/HEIF photos into universally compatible JPG format. Bulk convert multiple photos at once. No upload required."),
    "remove-background": ("Remove Image Background", "Remove background from images online for free — automatically detect and delete the background from photos to create transparent PNGs. Perfect for product photos, portraits, and logos."),
    "svg-to-png": ("SVG to PNG Converter", "Convert SVG to PNG online for free — render vector graphics as high-resolution PNG images. Set custom width, height, and DPI. Perfect for using SVG icons in presentations."),
    "image-watermark": ("Add Watermark to Image", "Add text or image watermarks to photos online for free — protect your images with customizable watermarks. Control opacity, position, and size. Batch watermark multiple images at once."),
    "generate-favicon": ("Favicon Generator", "Generate favicons online for free — upload any image and get ICO, PNG, and SVG favicon files for your website in all standard sizes (16x16, 32x32, 48x48, 192x192)."),
    "make-collage": ("Photo Collage Maker", "Create photo collages online for free — arrange multiple images into grid layouts, contact sheets, or custom collages. Download as a high-resolution image file."),
    "generate-barcode": ("Barcode Generator", "Generate barcodes online for free — create Code 128, QR Code, EAN-13, UPC, and other barcode formats. Download as PNG or SVG. Perfect for product labels and inventory."),
    "url-to-pdf": ("URL to PDF Converter", "Convert any web page URL to PDF online for free — enter a URL and get a rendered, print-ready PDF of the full page with styles and images preserved."),
    "qr-reader": ("QR Code Reader", "Read and decode QR codes online for free — upload an image containing a QR code and extract the encoded text, URL, or data instantly. No app or camera required."),
    "merge-images": ("Merge Images", "Merge multiple images online for free — combine JPG, PNG, and WebP files side by side or stacked vertically into a single image. Set spacing, alignment, and background color."),
    # ── Round-N video/audio additions ─────────────────────────────────────
    "video-to-pdf":     ("Video to PDF",         "Convert video to PDF online for free — extract frames from MP4/MOV/WebM at chosen intervals and save them as PDF pages. Perfect for slide capture and reference docs."),
    "video-converter":  ("Video Converter",      "Convert video formats online for free — change between MP4, WebM, MOV, AVI, and MKV with adjustable quality. Powered by FFmpeg, no sign-up required."),
    "video-resizer":    ("Video Resizer",        "Resize video resolution online for free — change video dimensions to 720p, 1080p, square, vertical, or custom sizes while preserving quality. Free FFmpeg-powered tool."),
    "video-thumbnail":  ("Video Thumbnail",      "Generate video thumbnails online for free — extract poster frames from MP4/MOV/WebM at any timestamp. Save as JPG or PNG. Perfect for video previews."),
    "video-merge":      ("Video Merge",          "Merge video files online for free — concatenate multiple MP4/MOV/WebM clips into a single video without re-encoding when possible. Free, no sign-up, no watermarks."),
    "gif-to-mp4":       ("GIF to MP4",           "Convert GIF to MP4 online for free — turn animated GIFs into smaller, higher-quality MP4 video files. Reduce file size by up to 90% while preserving smoothness."),
    "add-subtitles":    ("Burn Subtitles into Video", "Add subtitles to video online for free — burn .srt or .vtt subtitle files directly into MP4/MOV videos. Permanent overlays viewable on any player."),
    "audio-merge":      ("Audio Merge",          "Merge audio files online for free — concatenate MP3, WAV, OGG, FLAC, or AAC tracks into a single seamless audio file. Free FFmpeg-powered tool."),
    # ── Round-O utilities (mostly browser-only) ───────────────────────────
    "subtitle-converter": ("Subtitle Converter", "Convert subtitle files online for free — translate between SRT, VTT, and ASS formats entirely in your browser. Fix timecodes and re-encoding instantly."),
    "password-generator": ("Password Generator", "Generate strong passwords online for free — cryptographically-secure random passwords with custom length, symbols, digits, and exclusion rules. Runs 100% in your browser."),
    "uuid-generator":     ("UUID Generator",     "Generate UUIDs online for free — create v4 (random) UUIDs in bulk with copy-to-clipboard. Browser-only, nothing leaves your device. Perfect for API keys and IDs."),
    "lorem-ipsum":        ("Lorem Ipsum Generator", "Generate Lorem Ipsum placeholder text online for free — by paragraphs, sentences, or words with adjustable length. Browser-only, no sign-up."),
    "word-counter":       ("Word Counter",       "Count words, characters, sentences, paragraphs, and reading time online for free — live updates as you type. Browser-only, perfect for essays and articles."),
    "color-converter":    ("Color Converter",    "Convert colors online for free — translate between HEX, RGB, RGBA, HSL, and HSLA formats with a live picker and preview. 100% in your browser."),
    "url-encoder":        ("URL Encoder / Decoder", "Encode or decode URLs online for free — percent-encode strings for use in query parameters, or decode %20/%26/etc back to readable text. Runs entirely in your browser. For JWT decoding, use the dedicated JWT Decoder."),
    # v1.1.0 / v1.2.0 additions
    "audio-converter":    ("Audio Converter",    "Convert audio files online for free — change between MP3, WAV, OGG, FLAC, and AAC formats. Choose your preferred bitrate (64k to 320k). Powered by FFmpeg for professional-quality conversion. Files up to 200 MB supported."),
    "image-upscaler":     ("Image Upscaler",     "Upscale images online for free — enlarge photos by 2x or 4x using high-quality Lanczos resampling. Supports JPG, PNG, and WebP. Perfect for improving resolution of small images, thumbnails, or screenshots."),
    "heic-to-png":        ("HEIC to PNG",        "Convert HEIC to PNG online for free — change Apple's High Efficiency Image format (the default for iPhone photos) to PNG, which every browser and editor can open. Free, private, no sign-up."),
    "webp-to-jpg":        ("WebP to JPG",        "Convert WebP to JPG online for free — change Google's WebP image format to the universally-compatible JPEG. Drag-and-drop multiple files, no sign-up, no watermarks. Files are processed and discarded immediately."),
    "webp-to-png":        ("WebP to PNG",        "Convert WebP to PNG online for free — change Google's WebP format to lossless PNG, preserving transparency. Free, private, no watermarks."),
    "view-exif":          ("View EXIF Data",     "View EXIF data online for free — see every piece of metadata embedded in a JPEG, PNG, TIFF, or HEIC: GPS coordinates, camera make and model, lens info, ISO, exposure, timestamps, software, and more. Counterpart to Remove EXIF."),
    "jwt-decoder":        ("JWT Decoder",        "Decode a JWT online for free — paste any JSON Web Token and instantly see its header, payload, and signature decoded as readable JSON. Highlights expiry, algorithm, and standard claims. All decoding happens in your browser; tokens never leave."),
    "regex-tester":       ("Regex Tester",       "Test regular expressions online for free — paste a regex and a test string to see every match highlighted in real time, along with captured groups. Supports flags (g, i, m, s, u, y). Works entirely in your browser."),
    "timestamp-converter": ("Timestamp Converter", "Convert between Unix timestamps and human-readable dates online for free — paste an epoch (seconds or milliseconds) or an ISO 8601 string and see all formats side-by-side, in your local time and UTC. Pure-browser, never logs your data."),
    # v1.4.0 — image converter aliases (route to /image-converter)
    "jpg-to-png":         ("JPG to PNG",         "Convert JPG to PNG online for free — change JPEG photos to lossless PNG, preserving every detail and supporting transparency on re-edits. Drag-and-drop multiple files, processed and discarded server-side."),
    "png-to-jpg":         ("PNG to JPG",         "Convert PNG to JPG online for free — turn lossless PNGs into compact JPEGs for faster pages and smaller email attachments. Batch upload, no watermarks, no sign-up."),
    "jpg-to-webp":        ("JPG to WebP",        "Convert JPG to WebP online for free — shrink JPEG photos by 25-35% with Google's modern WebP codec while keeping visual quality. Perfect for faster page loads."),
    "png-to-webp":        ("PNG to WebP",        "Convert PNG to WebP online for free — convert lossless PNGs to WebP for dramatically smaller files while keeping transparency. Ideal for web assets and icons."),
    "tiff-to-jpg":        ("TIFF to JPG",        "Convert TIFF to JPG online for free — turn high-resolution TIFFs (the scan and pro-photo standard) into compact JPEGs you can email, post, or upload anywhere."),
    "tiff-to-png":        ("TIFF to PNG",        "Convert TIFF to PNG online for free — convert multi-page or single-page TIFFs to web-friendly PNG while preserving alpha and color depth."),
    "bmp-to-jpg":         ("BMP to JPG",         "Convert BMP to JPG online for free — shrink Windows bitmap files (often 10-50× larger than JPEG) into compact JPEGs without quality loss for most photos."),
    "bmp-to-png":         ("BMP to PNG",         "Convert BMP to PNG online for free — turn uncompressed Windows BMPs into compressed lossless PNGs, ideal for screenshots, icons, and pixel art."),
    "gif-to-jpg":         ("GIF to JPG",         "Convert GIF to JPG online for free — extract the first frame of a GIF and save it as a smaller JPEG. Great for sharing static stills on platforms that don't support GIF."),
    "gif-to-png":         ("GIF to PNG",         "Convert GIF to PNG online for free — convert single-frame GIFs to lossless PNG with full transparency support. Drag-and-drop, batch-friendly."),
    # v1.4.0 — audio/video converter aliases
    "m4a-to-mp3":         ("M4A to MP3",         "Convert M4A to MP3 online for free — turn Apple's M4A audio (iTunes purchases, voice memos) into universally-supported MP3 at your chosen bitrate. Powered by FFmpeg."),
    "mp4-to-mp3":         ("MP4 to MP3",         "Convert MP4 to MP3 online for free — extract the audio track from any MP4 video and save it as an MP3 file. Perfect for music videos, podcasts, and recorded lectures."),
    "mov-to-mp4":         ("MOV to MP4",         "Convert MOV to MP4 online for free — change Apple QuickTime MOV files to the universally-compatible MP4 (H.264). Works on every platform without re-encoding the audio if compatible."),
    "avi-to-mp4":         ("AVI to MP4",         "Convert AVI to MP4 online for free — modernize old AVI videos to H.264 MP4 for streaming-friendly playback on phones, browsers, and modern TVs."),
    "webm-to-mp4":        ("WebM to MP4",        "Convert WebM to MP4 online for free — turn Google's WebM (VP8/VP9) into H.264 MP4 for compatibility with iOS, older Android, and editing software."),
    "mp4-to-webm":        ("MP4 to WebM",        "Convert MP4 to WebM online for free — re-encode MP4 video as WebM (VP9) for smaller files and royalty-free open-web streaming."),
    # v1.4.0 — browser-only developer converters
    "yaml-to-json":       ("YAML to JSON",       "Convert YAML to JSON online for free — paste any YAML and instantly see the equivalent JSON, validated and pretty-printed. Runs 100% in your browser, never uploads."),
    "json-to-yaml":       ("JSON to YAML",       "Convert JSON to YAML online for free — paste any JSON and see clean YAML with proper indentation, ready to drop into a Kubernetes, GitHub Actions, or Docker Compose file. Pure-browser."),
    "case-converter":     ("Case Converter",     "Convert text case online for free — instantly transform any string between camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE, Title Case, sentence case, and more. Browser-only, never uploads."),
    # v1.5.0 / phase 7 — competitor-gap tools
    "mute-video":         ("Mute Video",         "Mute a video online for free — strip the audio track from MP4, MOV, WebM, MKV, AVI files. Stream-copies the video so it's lossless and instant. No re-encoding, no quality loss."),
    "reverse-video":      ("Reverse Video",      "Reverse a video online for free — play any MP4, MOV, WebM, MKV, or AVI backwards (audio reversed in sync too). Output is universal MP4 with H.264 video and AAC audio."),
    "video-speed":        ("Video Speed Changer","Speed up or slow down videos online for free — 0.25× to 4×, audio pitch-corrected so it doesn't sound chipmunk-y. Powered by FFmpeg's setpts and atempo filters."),
    "audio-trim":         ("Audio Trimmer",      "Trim or cut audio files online for free — MP3, WAV, AAC, FLAC, OGG, M4A. Specify start and end timestamps (HH:MM:SS) and download just the chosen segment. Lossless stream-copy."),
    "image-palette":      ("Image Color Palette","Extract dominant color palette from images online for free — upload any image and get HEX codes, rgb() values, and percentage coverage for the top colors. Perfect for designers extracting brand colors or building UI themes."),
    "pixelate-image":     ("Pixelate / Blur Image","Pixelate or blur images online for free — obscure sensitive content (faces, license plates, addresses) before sharing. Choose mosaic-style pixelation or smooth Gaussian blur with adjustable strength."),
}


def _tool_title(name: str) -> str:
    return f"{name} Online Free — No Sign Up | PrivaTools"


def _tool_desc(desc: str) -> str:
    return desc[:160] if len(desc) > 160 else desc


def path_is_known(path: str) -> bool:
    """
    Return True iff the path resolves to a real, content-bearing route.

    Used by the SPA middleware to decide whether to return HTTP 200 with
    SEO-injected content, or HTTP 404 — so Google doesn't flag /tool/foo
    (where foo doesn't exist) as a Soft 404.
    """
    p = path.rstrip("/") or "/"
    if p in _STATIC_META:
        return True
    if p.startswith("/tool/"):
        return p[len("/tool/"):] in _PDF_TOOLS
    if p.startswith("/tools/"):
        return p[len("/tools/"):] in _NONPDF_TOOLS
    if p.startswith("/blog/"):
        return p[len("/blog/"):] in _BLOG_POSTS
    if p.startswith("/compare/"):
        # Static-meta covers /compare/ilovepdf etc. /compare itself is in _STATIC_META.
        return p in _STATIC_META
    # Top-level SPA routes the frontend handles
    if p in ("/", "/about", "/privacy", "/terms", "/blog", "/compare", "/pipeline", "/batch"):
        return True
    return False


def get_meta_for_path(path: str) -> tuple[str, str]:
    """Return (title, description) for the given URL path."""
    path = path.rstrip("/") or "/"

    # Static page lookup
    if path in _STATIC_META:
        return _STATIC_META[path]

    # /tool/<slug>
    if path.startswith("/tool/"):
        slug = path[len("/tool/"):]
        if slug in _PDF_TOOLS:
            name, desc = _PDF_TOOLS[slug]
            return _tool_title(name), _tool_desc(desc)
        # Unknown slug — still return a reasonable fallback
        readable = slug.replace("-", " ").title()
        return (
            f"{readable} Online Free | PrivaTools",
            f"Use {readable} online for free on PrivaTools. Privacy-first file processing — no sign-up, no uploads stored.",
        )

    # /tools/<slug>
    if path.startswith("/tools/"):
        slug = path[len("/tools/"):]
        if slug in _NONPDF_TOOLS:
            name, desc = _NONPDF_TOOLS[slug]
            return _tool_title(name), _tool_desc(desc)
        readable = slug.replace("-", " ").title()
        return (
            f"{readable} Online Free | PrivaTools",
            f"Use {readable} online for free on PrivaTools. Privacy-first file processing — no sign-up, no uploads stored.",
        )

    # /blog listing and /blog/<slug>
    if path == "/blog" or path.startswith("/blog/"):
        if path in _STATIC_META:
            return _STATIC_META[path]
        return _STATIC_META["/blog"]

    # Fallback
    return _STATIC_META["/"]


def get_jsonld_for_path(path: str) -> dict | None:
    """Return a JSON-LD dict for the given URL path, or None."""
    path = path.rstrip("/") or "/"
    title, description = get_meta_for_path(path)
    canonical_url = BASE_URL + (path if path != "/" else "")

    breadcrumbs: list[dict] = [
        {"@type": "ListItem", "position": 1, "name": "PrivaTools", "item": BASE_URL}
    ]

    if path == "/":
        # ItemList of headline tools — gives Google a clean enumerated grid
        # of WebApplications that AI engines can also cite as "what does the
        # site offer". We include a curated top-25 rather than all 152.
        featured_slugs = [
            ("merge-pdf", "/tool/merge-pdf"),
            ("split-pdf", "/tool/split-pdf"),
            ("compress-pdf", "/tool/compress-pdf"),
            ("pdf-to-word", "/tool/pdf-to-word"),
            ("pdf-to-excel", "/tool/pdf-to-excel"),
            ("pdf-to-jpg", "/tool/pdf-to-jpg"),
            ("jpg-to-pdf", "/tool/jpg-to-pdf"),
            ("edit-pdf", "/tool/edit-pdf"),
            ("sign-pdf", "/tool/sign-pdf"),
            ("ocr-pdf", "/tool/ocr-pdf"),
            ("protect-pdf", "/tool/protect-pdf"),
            ("unlock-pdf", "/tool/unlock-pdf"),
            ("rotate-pdf", "/tool/rotate-pdf"),
            ("watermark", "/tool/watermark"),
            ("redact-pdf", "/tool/redact-pdf"),
            ("smart-redact", "/tool/smart-redact"),
            ("summarize-pdf", "/tool/summarize-pdf"),
            ("highlight-pdf", "/tool/highlight-pdf"),
            ("image-compressor", "/tools/image-compressor"),
            ("image-converter", "/tools/image-converter"),
            ("heic-to-jpg", "/tools/heic-to-jpg"),
            ("video-converter", "/tools/video-converter"),
            ("audio-converter", "/tools/audio-converter"),
            ("jwt-decoder", "/tools/jwt-decoder"),
            ("regex-tester", "/tools/regex-tester"),
        ]
        featured = []
        for i, (slug, urlpath) in enumerate(featured_slugs, start=1):
            tool_name, tool_desc = _PDF_TOOLS.get(slug) or _NONPDF_TOOLS.get(slug) or (slug.replace("-", " ").title(), "")
            featured.append({
                "@type": "ListItem",
                "position": i,
                "item": {
                    "@type": "SoftwareApplication",
                    "name": tool_name,
                    "url": BASE_URL + urlpath,
                    "applicationCategory": "UtilitiesApplication",
                    "operatingSystem": "Any (browser-based)",
                    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                },
            })

        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebSite",
                    "@id": f"{BASE_URL}/#website",
                    "url": BASE_URL,
                    "name": "PrivaTools",
                    "description": description,
                    "inLanguage": "en",
                    "publisher": {"@id": f"{BASE_URL}/#organization"},
                    "potentialAction": {
                        "@type": "SearchAction",
                        "target": {"@type": "EntryPoint", "urlTemplate": f"{BASE_URL}/?q={{search_term_string}}"},
                        "query-input": "required name=search_term_string",
                    },
                },
                {
                    "@type": "Organization",
                    "@id": f"{BASE_URL}/#organization",
                    "name": "PrivaTools",
                    "alternateName": ["PrivaTools.me", "Priva Tools"],
                    "url": BASE_URL,
                    "logo": {
                        "@type": "ImageObject",
                        "url": f"{BASE_URL}/icons/icon-512.png",
                        "width": 512,
                        "height": 512,
                    },
                    "email": "hello@privatools.me",
                    "foundingDate": "2026-03-01",
                    "description": "Free, open-source, privacy-first file tools — PDF, image, video, audio, and developer utilities. MIT-licensed and self-hostable via Docker.",
                    "license": "https://opensource.org/licenses/MIT",
                    "sameAs": [
                        "https://github.com/taiyeba-dg/privatools",
                        "https://privatools.me",
                    ],
                    "contactPoint": {
                        "@type": "ContactPoint",
                        "email": "hello@privatools.me",
                        "contactType": "customer support",
                        "availableLanguage": ["English"],
                    },
                },
                {
                    "@type": "ItemList",
                    "name": "Featured tools",
                    "description": "A curated subset of the 175+ free PDF, image, video, audio, and developer tools on PrivaTools.",
                    "numberOfItems": len(featured),
                    "itemListElement": featured,
                },
            ],
        }

    if path.startswith("/tool/") or path.startswith("/tools/"):
        prefix = "/tool/" if path.startswith("/tool/") else "/tools/"
        slug = path[len(prefix):]
        if prefix == "/tool/":
            name = _PDF_TOOLS.get(slug, (slug.replace("-", " ").title(), ""))[0]
            category = "BusinessApplication"  # PDF utilities — knowledge-work / business category
        else:
            name = _NONPDF_TOOLS.get(slug, (slug.replace("-", " ").title(), ""))[0]
            category = "UtilitiesApplication"

        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": name, "item": canonical_url})

        # SoftwareApplication is more specific than WebApplication and is the
        # recommended type for installable / web-based file tools per Google's
        # rich-results docs.
        graph: list[dict] = [
            {
                "@type": "SoftwareApplication",
                "@id": f"{canonical_url}#app",
                "name": f"{name} — PrivaTools",
                "url": canonical_url,
                "description": description,
                "applicationCategory": category,
                "applicationSubCategory": "PDF & file tools",
                "operatingSystem": "Web Browser (any)",
                "browserRequirements": "Requires JavaScript and a modern browser (Chrome, Firefox, Safari, Edge).",
                "isAccessibleForFree": True,
                "permissions": "No permissions required",
                "softwareVersion": "1.2",
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock",
                    "category": "Free",
                },
                "provider": {"@id": f"{BASE_URL}/#organization"},
                "datePublished": "2026-03-15",
                "dateModified": "2026-05-15",
                "inLanguage": "en",
            },
            {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
        ]
        # FAQPage schema. We attach `speakable` so voice assistants (Google
        # Assistant, Alexa) can read the Q&A aloud.
        if slug in TOOL_FAQ:
            graph.append({
                "@type": "FAQPage",
                "speakable": {
                    "@type": "SpeakableSpecification",
                    "cssSelector": [".tool-faq", "h2", "h3"],
                },
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": faq["q"],
                        "acceptedAnswer": {"@type": "Answer", "text": faq["a"]},
                    }
                    for faq in TOOL_FAQ[slug]
                ],
            })
        return {"@context": "https://schema.org", "@graph": graph}

    if path.startswith("/compare/"):
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": "Compare", "item": f"{BASE_URL}/compare"})
        breadcrumbs.append({"@type": "ListItem", "position": 3, "name": title, "item": canonical_url})
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": ["Article", "Review"],
                    "headline": title,
                    "description": description,
                    "url": canonical_url,
                    "datePublished": "2026-03-22",
                    "dateModified": "2026-05-15",
                    "inLanguage": "en",
                    "author": {
                        "@type": "Organization",
                        "name": "PrivaTools",
                        "url": BASE_URL,
                    },
                    "publisher": {"@id": f"{BASE_URL}/#organization"},
                    "mainEntityOfPage": {
                        "@type": "WebPage",
                        "@id": canonical_url,
                    },
                    "speakable": {
                        "@type": "SpeakableSpecification",
                        "cssSelector": ["h1", "h2", ".tagline"],
                    },
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path.startswith("/blog/"):
        slug = path[len("/blog/"):]
        post = _BLOG_POSTS.get(slug)
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": "Blog", "item": f"{BASE_URL}/blog"})
        if post:
            breadcrumbs.append({"@type": "ListItem", "position": 3, "name": post["title"], "item": canonical_url})
            return {
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "BlogPosting",
                        "headline": post["title"],
                        "description": post["description"],
                        "url": canonical_url,
                        "image": f"{BASE_URL}/api/og-image?p={path}",
                        "datePublished": post["publishedAt"],
                        "dateModified": post["publishedAt"],
                        "inLanguage": "en",
                        "wordCount": post.get("wordCount"),
                        "keywords": ", ".join(post.get("tags", [])),
                        "author": {
                            "@type": "Person",
                            "@id": f"{BASE_URL}/about#author",
                            "name": post.get("author") or "PrivaTools Team",
                            "url": f"{BASE_URL}/about",
                            "sameAs": ["https://github.com/taiyeba-dg/privatools"],
                            "worksFor": {"@id": f"{BASE_URL}/#organization"},
                        },
                        "publisher": {"@id": f"{BASE_URL}/#organization"},
                        "mainEntityOfPage": {
                            "@type": "WebPage",
                            "@id": canonical_url,
                        },
                        "speakable": {
                            "@type": "SpeakableSpecification",
                            "cssSelector": ["h1", ".post-tldr", "h2"],
                        },
                    },
                    {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
                ],
            }
        return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": breadcrumbs}

    return None


# ---------------------------------------------------------------------------
# Comparison page data (mirrors frontend ComparePage.tsx for SSR)
# ---------------------------------------------------------------------------
_PRIVATOOLS_FEATURES: dict[str, str] = {
    "Free to use": "Yes — 100% free",
    "No account required": "Yes",
    "No file size limits": "Yes (500 MB per file)",
    "No ads": "Yes",
    "Open source": "Yes (MIT license)",
    "Self-hostable": "Yes (Docker)",
    "Files processed privately": "Yes (server-side, deleted within minutes)",
    "No watermarks on free tier": "Yes",
    "175+ tools (PDF, image, video, audio, dev)": "Yes (175+ tools)",
    "Works offline / client-side tools": "Some tools (client-side)",
    "Desktop app included": "No (web-based)",
    "API available": "Self-hosted API",
    "E-signatures": "Yes (free)",
    "JSON-LD structured data": "Yes",
}

_COMPARE_DATA: dict[str, dict] = {
    "ilovepdf": {"name": "iLovePDF", "features": {"Free to use": "Limited", "No account required": "No", "No file size limits": "No (25 MB free)", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (files uploaded to their servers)", "No watermarks on free tier": "Limited", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "smallpdf": {"name": "Smallpdf", "features": {"Free to use": "Limited (2 tasks/day)", "No account required": "No", "No file size limits": "No", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (files uploaded to their servers)", "No watermarks on free tier": "Limited", "175+ tools (PDF, image, video, audio, dev)": "No (21 tools, PDF only)"}},
    "adobe-acrobat": {"name": "Adobe Acrobat Online", "features": {"Free to use": "Very limited", "No account required": "No (Adobe ID required)", "No file size limits": "No", "No ads": "Yes", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (Adobe cloud)", "No watermarks on free tier": "Limited", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "sejda": {"name": "Sejda PDF", "features": {"Free to use": "Limited (3 tasks/hour)", "No account required": "No", "No file size limits": "No (50 MB free)", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (files uploaded to their servers)", "No watermarks on free tier": "Yes", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "pdf24": {"name": "PDF24", "features": {"Free to use": "Yes", "No account required": "Yes", "No file size limits": "Limited", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (files uploaded to their servers)", "No watermarks on free tier": "Yes", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "foxit": {"name": "Foxit PDF", "features": {"Free to use": "No (paid subscription)", "No account required": "No", "No file size limits": "No", "No ads": "Yes", "Open source": "No", "Self-hostable": "Enterprise only", "Files processed privately": "No (Foxit cloud)", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "lightpdf": {"name": "LightPDF", "features": {"Free to use": "Limited", "No account required": "No", "No file size limits": "No", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (files uploaded to their servers)", "No watermarks on free tier": "Limited", "175+ tools (PDF, image, video, audio, dev)": "No (PDF + basic image)"}},
    "stirling-pdf": {"name": "Stirling PDF", "features": {"Free to use": "Yes", "No account required": "Yes (self-hosted)", "No file size limits": "Depends on your server", "No ads": "Yes", "Open source": "Yes (GPL-3.0)", "Self-hostable": "Yes (Docker required)", "Files processed privately": "Yes (your own server)", "No watermarks on free tier": "Yes", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
    "dochub": {"name": "DocHub", "features": {"Free to use": "Limited (1 user, 5 docs/month)", "No account required": "No", "No file size limits": "No", "No ads": "Yes", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (DocHub cloud)", "175+ tools (PDF, image, video, audio, dev)": "No (document editing only)"}},
    "pdfescape": {"name": "PDFescape", "features": {"Free to use": "Limited (10 MB, 100 pages)", "No account required": "Yes (online version)", "No file size limits": "No (10 MB limit free)", "No ads": "No", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (uploaded to their servers)", "175+ tools (PDF, image, video, audio, dev)": "No (basic PDF editing only)"}},
    "nitro-pdf": {"name": "Nitro PDF", "features": {"Free to use": "No (paid subscription)", "No account required": "No", "No file size limits": "No", "No ads": "Yes", "Open source": "No", "Self-hostable": "No", "Files processed privately": "No (Nitro cloud)", "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)"}},
}


def _build_ssr_content(path: str, title: str, description: str) -> str:
    """
    Build server-rendered HTML content that crawlers (including AI crawlers)
    can read without executing JavaScript.  This content is placed inside
    <div id="root"> so that React hydration replaces it once JS loads.
    """
    parts: list[str] = []

    # ── Homepage ───────────────────────────────────────────────────────────
    if path == "/":
        parts.append(f"<h1>PrivaTools — Free, Open-Source Privacy-First File Tools</h1>")
        parts.append(
            f"<p>PrivaTools provides {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)} free online file tools — {len(_PDF_TOOLS)} PDF tools and {len(_NONPDF_TOOLS)} image, video, audio, "
            "and developer utilities. The entire stack is open source under the MIT license and "
            "self-hostable via Docker, so files stay on your own infrastructure. On the public demo, "
            "files are processed in an isolated container and deleted immediately after the response "
            "is returned — never stored, never shared with third parties. The public site uses anonymous "
            "Google Analytics 4 pageview telemetry only (IP-anonymized; blockable). No accounts, no behavioural profiling.</p>"
        )
        parts.append("<h2>PDF Tools</h2><ul>")
        for slug, (name, desc) in _by_popularity(_PDF_TOOLS.items()):
            parts.append(f'<li><a href="/tool/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        parts.append("<h2>Image, Video & Developer Tools</h2><ul>")
        for slug, (name, desc) in _by_popularity(_NONPDF_TOOLS.items()):
            parts.append(f'<li><a href="/tools/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        return "\n".join(parts)

    # ── Individual tool pages (/tool/<slug> and /tools/<slug>) ─────────────
    if path.startswith("/tool/"):
        slug = path[len("/tool/"):]
        if slug in _PDF_TOOLS:
            name, desc = _PDF_TOOLS[slug]
            parts.append(f"<h1>{name} Online Free — PrivaTools</h1>")
            # TL;DR — voice-friendly 1-2 sentence answer for AEO/voice-search.
            tldr = _tldr_for(slug, name)
            parts.append(f'<p class="tool-tldr" data-speakable="true"><strong>TL;DR:</strong> {tldr}</p>')
            parts.append(f"<p>{desc}</p>")
            parts.append(
                f"<p>{name} is one of {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)}+ free file tools on PrivaTools. All processing happens "
                "on our servers with zero-knowledge architecture — your files are never stored, "
                "never read, and never shared with third parties. No account required.</p>"
            )
            # HowTo section
            if slug in TOOL_HOWTO:
                parts.append(f"<h2>How to {name} with PrivaTools</h2><ol>")
                for step in TOOL_HOWTO[slug]:
                    parts.append(f"<li><strong>{step['name']}</strong> — {step['text']}</li>")
                parts.append("</ol>")
            # FAQ section
            if slug in TOOL_FAQ:
                parts.append(f'<h2 class="tool-faq">Frequently Asked Questions</h2>')
                for faq in TOOL_FAQ[slug]:
                    parts.append(f"<h3>{faq['q']}</h3><p>{faq['a']}</p>")
            # Trust signals: last-updated date + author + open-source link.
            from datetime import date as _date
            today = _date.today().isoformat()
            parts.append(
                f'<p class="meta-trust"><em>Last reviewed {today} by the PrivaTools maintainers. '
                f'Source code on '
                f'<a href="https://github.com/taiyeba-dg/privatools" rel="author">GitHub</a> '
                f'(MIT-licensed, self-hostable).</em></p>'
            )
            # Related tools for internal linking — most-popular first
            category_tools = [(s, n) for s, (n, _) in _by_popularity(_PDF_TOOLS.items()) if s != slug][:8]
            if category_tools:
                parts.append("<h2>Related PDF Tools</h2><ul>")
                for s, n in category_tools:
                    parts.append(f'<li><a href="/tool/{s}">{n}</a></li>')
                parts.append("</ul>")
            return "\n".join(parts)

    if path.startswith("/tools/"):
        slug = path[len("/tools/"):]
        if slug in _NONPDF_TOOLS:
            name, desc = _NONPDF_TOOLS[slug]
            parts.append(f"<h1>{name} Online Free — PrivaTools</h1>")
            # TL;DR — voice-friendly 1-2 sentence answer for AEO/voice-search.
            tldr = _tldr_for(slug, name)
            parts.append(f'<p class="tool-tldr" data-speakable="true"><strong>TL;DR:</strong> {tldr}</p>')
            parts.append(f"<p>{desc}</p>")
            parts.append(
                f"<p>{name} is one of {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)}+ free file tools on PrivaTools. All processing happens "
                "on our servers with zero-knowledge architecture — your files are never stored, "
                "never read, and never shared with third parties. No account required.</p>"
            )
            # HowTo section
            if slug in TOOL_HOWTO:
                parts.append(f"<h2>How to Use {name}</h2><ol>")
                for step in TOOL_HOWTO[slug]:
                    parts.append(f"<li><strong>{step['name']}</strong> — {step['text']}</li>")
                parts.append("</ol>")
            # FAQ section
            if slug in TOOL_FAQ:
                parts.append(f'<h2 class="tool-faq">Frequently Asked Questions</h2>')
                for faq in TOOL_FAQ[slug]:
                    parts.append(f"<h3>{faq['q']}</h3><p>{faq['a']}</p>")
            # Trust signals
            from datetime import date as _date
            today = _date.today().isoformat()
            parts.append(
                f'<p class="meta-trust"><em>Last reviewed {today} by the PrivaTools maintainers. '
                f'Source code on '
                f'<a href="https://github.com/taiyeba-dg/privatools" rel="author">GitHub</a> '
                f'(MIT-licensed, self-hostable).</em></p>'
            )
            related = [(s, n) for s, (n, _) in _by_popularity(_NONPDF_TOOLS.items()) if s != slug][:8]
            if related:
                parts.append("<h2>Related Tools</h2><ul>")
                for s, n in related:
                    parts.append(f'<li><a href="/tools/{s}">{n}</a></li>')
                parts.append("</ul>")
            return "\n".join(parts)

    # ── Compare pages ──────────────────────────────────────────────────────
    if path.startswith("/compare/") or path == "/compare":
        parts.append(f"<h1>{title}</h1>")
        parts.append(f"<p>{description}</p>")
        parts.append(
            "<p>PrivaTools is a free, open-source alternative with 152 file tools, "
            "no file limits, no sign-ups, and no behavioural tracking. Compare features, pricing, "
            "and privacy practices side by side.</p>"
        )
        slug = path[len("/compare/"):] if path.startswith("/compare/") else ""
        if slug and slug in _COMPARE_DATA:
            comp = _COMPARE_DATA[slug]
            parts.append(f"<h2>PrivaTools vs {comp['name']} — Feature Comparison</h2>")
            parts.append("<table><thead><tr><th>Feature</th><th>PrivaTools</th>"
                         f"<th>{comp['name']}</th></tr></thead><tbody>")
            for feature, their_val in comp["features"].items():
                our_val = _PRIVATOOLS_FEATURES.get(feature, "Yes")
                parts.append(f"<tr><td>{feature}</td><td>{our_val}</td><td>{their_val}</td></tr>")
            parts.append("</tbody></table>")
            parts.append(
                f"<h2>Why Choose PrivaTools Over {comp['name']}?</h2>"
                f"<p>Unlike {comp['name']}, PrivaTools is 100% free with no premium tiers, "
                "no file size limits (up to 500 MB per file), no account required, and no ads. "
                "Files are processed in an isolated container and deleted immediately after the "
                "response is returned — never stored, never shared with third parties. PrivaTools "
                "is open source under the MIT license and self-hostable via Docker, so you can "
                "run the entire stack on your own infrastructure for complete control.</p>"
            )
        if not slug:
            parts.append("<h2>All Comparisons</h2><ul>")
            for cslug, cdata in _COMPARE_DATA.items():
                parts.append(f'<li><a href="/compare/{cslug}">PrivaTools vs {cdata["name"]}</a></li>')
            parts.append("</ul>")
        return "\n".join(parts)

    # ── Blog pages ─────────────────────────────────────────────────────────
    if path.startswith("/blog/"):
        slug = path[len("/blog/"):]
        post = _BLOG_POSTS.get(slug)
        if post:
            parts.append(f"<h1>{post['title']}</h1>")
            parts.append(f"<p>{post['description']}</p>")
            parts.append(f"<p>Published: {post['publishedAt']} · {post['readTime']}</p>")
            return "\n".join(parts)
    elif path == "/blog":
        parts.append("<h1>PrivaTools Blog — PDF & File Tools Tips, Guides & Comparisons</h1>")
        parts.append("<ul>")
        for slug, post in _BLOG_POSTS.items():
            parts.append(f'<li><a href="/blog/{slug}">{post["title"]}</a> — {post["description"]}</li>')
        parts.append("</ul>")
        return "\n".join(parts)

    # ── About page ─────────────────────────────────────────────────────────
    if path == "/about":
        parts.append("<h1>About PrivaTools</h1>")
        parts.append(f"<p>{description}</p>")
        parts.append(
            "<p>PrivaTools is a free, open-source suite of 152+ file tools — PDF, image, video, "
            "audio, and developer utilities. MIT-licensed and self-hostable via Docker. Files "
            "uploaded to the public demo are processed in an isolated container and deleted on "
            "response; many tools run entirely in your browser and never upload anything.</p>"
        )
        return "\n".join(parts)

    # ── Privacy page ───────────────────────────────────────────────────────
    if path == "/privacy":
        parts.append("<h1>Privacy Policy</h1>")
        parts.append("<p><strong>Last updated:</strong> May 15, 2026</p>")
        parts.append(
            "<p>Your files are private. They are processed in temporary server memory and deleted "
            "immediately after the response is delivered — never written to disk, never inspected, "
            "never retained. We collect only anonymous Google Analytics 4 pageview telemetry "
            "(IP-anonymized; blockable by any standard tracking blocker).</p>"
        )
        parts.append("<h2>1. Files You Upload</h2>")
        parts.append(
            "<p>Server-side tools (Merge, Compress, OCR, etc.) hold your file in temp memory only "
            "for the duration of processing. The moment the response is delivered, the file is "
            "unlinked from the temp directory; a cleanup task purges any stragglers every 5 minutes. "
            "No backups, thumbnails, or metadata are retained.</p>"
        )
        parts.append("<h2>2. Client-Side Tools (Zero Upload)</h2>")
        parts.append(
            "<p>Many tools run entirely in your browser: JSON / XML Formatter, Text Diff, Base64, "
            "Hash Generator, CSV ↔ JSON, Markdown ↔ HTML, JWT Decoder, Regex Tester, Timestamp "
            "Converter, URL Encoder, Word Counter, Color Converter, UUID Generator, Lorem Ipsum, "
            "Password Generator. The two browser-side AI tools (Summarize PDF, Smart Redact) "
            "download their models once from Hugging Face and then run inference offline.</p>"
        )
        parts.append("<h2>3. What We Don't Collect</h2>")
        parts.append(
            "<p>No accounts, no email addresses, no behavioural profiling, no advertising cookies, "
            "no remarketing audiences, no session recordings, no file metadata, no canvas / browser "
            "fingerprints. Just anonymous pageview counts via GA4.</p>"
        )
        parts.append("<h2>4. Open Source &amp; Self-Hosting</h2>")
        parts.append(
            "<p>The entire stack is MIT-licensed at "
            "<a href='https://github.com/taiyeba-dg/privatools'>github.com/taiyeba-dg/privatools</a>. "
            "If you don't want to trust our deployment, "
            "<code>docker compose up --build</code> runs the whole thing on your own server.</p>"
        )
        return "\n".join(parts)

    # ── Terms page ─────────────────────────────────────────────────────────
    if path == "/terms":
        parts.append("<h1>Terms of Service</h1>")
        parts.append("<p><strong>Last updated:</strong> March 29, 2026</p>")
        parts.append("<h2>1. Acceptance of Terms</h2>")
        parts.append(
            "<p>By accessing PrivaTools (privatools.me) you agree to these Terms of Service. "
            "The service is free and open-source under the MIT license — no account required.</p>"
        )
        parts.append("<h2>2. Description of Service</h2>")
        parts.append(
            "<p>PrivaTools provides browser-based file processing for PDF, image, video, audio, "
            "and developer workflows. Server-side tools hold files in temp memory only and delete "
            "them immediately after the response. Many tools run entirely in your browser with no "
            "server interaction. Free, no limits, no registration.</p>"
        )
        parts.append("<h2>3. Acceptable Use</h2>")
        parts.append(
            "<p>Do not use the service to process unlawful content, abuse the infrastructure, or "
            "redistribute the service under another name while claiming original authorship. The "
            "MIT license grants you full rights to fork, modify, and self-host the codebase.</p>"
        )
        parts.append("<h2>4. No Warranty &amp; Limitation of Liability</h2>")
        parts.append(
            "<p>PrivaTools is provided 'as is' without warranty. Maintainers are not liable for "
            "any indirect, incidental, or consequential damages arising from use of the service. "
            "See <a href='/privacy'>Privacy Policy</a> for file handling details.</p>"
        )
        parts.append("<h2>5. Intellectual Property</h2>")
        parts.append(
            "<p>The PrivaTools codebase is open source under the MIT license. You retain all "
            "rights to files you upload and outputs you download.</p>"
        )
        return "\n".join(parts)

    # Fallback: just title + description
    parts.append(f"<h1>{title}</h1>")
    parts.append(f"<p>{description}</p>")
    return "\n".join(parts)


def inject_seo(html: str, path: str) -> str:
    """
    Inject server-side <title>, <meta name="description">,
    <meta property="og:*">, and visible SSR content into the HTML string.
    """
    title, description = get_meta_for_path(path)
    canonical_url = BASE_URL + (path if path != "/" else "")

    # Escape for HTML attribute context
    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

    t = esc(title)
    d = esc(description)
    u = esc(canonical_url)

    # Replace <title>
    html = re.sub(r"<title>[^<]*</title>", f"<title>{t}</title>", html, count=1)

    # Update meta description
    html = _set_meta(html, 'name="description"', d)

    # Update OG tags
    html = _set_meta(html, 'property="og:title"', t)
    html = _set_meta(html, 'property="og:description"', d)
    html = _set_meta(html, 'property="og:url"', u)

    # Update Twitter tags
    html = _set_meta(html, 'name="twitter:title"', t)
    html = _set_meta(html, 'name="twitter:description"', d)

    # Update / add canonical
    if 'rel="canonical"' in html:
        html = re.sub(r'<link rel="canonical"[^>]*/?\s*>', f'<link rel="canonical" href="{u}" />', html, count=1)
    else:
        html = html.replace("</head>", f'  <link rel="canonical" href="{u}" />\n</head>', 1)

    # Dynamic OG image
    og_image_url = esc(f"{BASE_URL}/api/og-image?p={quote(path)}")
    html = _set_meta(html, 'property="og:image"', og_image_url)

    # Inject JSON-LD structured data
    jsonld = get_jsonld_for_path(path)
    if jsonld:
        jsonld_tag = f'<script type="application/ld+json" id="jsonld-seo">{json.dumps(jsonld, ensure_ascii=False, separators=(",", ":"))}</script>'
        html = html.replace("</head>", f"  {jsonld_tag}\n</head>", 1)

    # Inject SSR content into <div id="root"> so crawlers see real content.
    # React will hydrate over this once JavaScript loads for real users.
    ssr_content = _build_ssr_content(path, title, description)
    if ssr_content:
        html = html.replace('<div id="root"></div>', f'<div id="root">{ssr_content}</div>', 1)

    return html


def _set_meta(html: str, attr: str, value: str) -> str:
    """Update the content attribute of a meta tag identified by `attr`."""
    pattern = rf'(<meta\s+{re.escape(attr)}\s+content=")[^"]*(")'
    replacement = rf'\g<1>{value}\g<2>'
    new_html, n = re.subn(pattern, replacement, html, count=1)
    if n == 0:
        # Also try reversed attribute order: content="..." name="..."
        pattern2 = rf'(<meta\s+content=")[^"]*("\s+{re.escape(attr)}[^>]*>)'
        new_html, n2 = re.subn(pattern2, rf'\g<1>{value}\g<2>', html, count=1)
        return new_html if n2 else html
    return new_html
