"""
Server-side SEO meta tag injection.

Provides per-route <title> and <meta name="description"> values
so that search-engine crawlers see the correct metadata without
executing JavaScript.
"""
from __future__ import annotations
import json
import logging
import os
from html import escape, unescape
import re
from datetime import date
from functools import lru_cache
from urllib.parse import quote
from .tool_content import TOOL_HOWTO, TOOL_FAQ

BASE_URL = "https://privatools.me"
BRAND_LOGO_URL = f"{BASE_URL}/brand/privatools-icon-512.png"

# ---------------------------------------------------------------------------
# Static page meta
# ---------------------------------------------------------------------------
_STATIC_META: dict[str, tuple[str, str]] = {
    "/": (
        "PrivaTools — Free, Open-Source Privacy-First File Tools",
        "213 free, open-source file tools for PDF, image, video, audio, and developer "
        "work. Browser-only when possible; isolated temporary processing when needed.",
    ),
    "/tools": (
        "All Free Online Tools — PrivaTools",
        "Browse every free PrivaTools tool by category — PDF, image, video, audio, and "
        "developer utilities. Free file tools with browser and temporary server processing options.",
    ),
    "/privacy": (
        "Privacy Policy — PrivaTools",
        "PrivaTools privacy policy: local-first tools, isolated temporary processing deleted on "
        "response, on-device AI models, and bring-your-own-key AI that talks to your provider "
        "directly — never through us. Updated September 24, 2026.",
    ),
    "/security": (
        "Security & Trust — PrivaTools",
        "Security and threat model as verifiable promises: local tools upload nothing, server tools "
        "disclose themselves first, AI keys go only to your provider under a scoped "
        "content-security policy — every claim ships with the check that proves it.",
    ),
    "/terms": (
        "Terms of Service — PrivaTools",
        "Terms of service for PrivaTools — open-source under MIT license, no account "
        "required, no warranty. You retain rights to your files.",
    ),
    "/support": (
        "Support — PrivaTools",
        "Owner-funded means owner-answered: report a bug, ask a privacy question, or check "
        "the status page. Find contact options and include the details needed to investigate an issue.",
    ),
    "/status": (
        "Status — PrivaTools",
        "Check PrivaTools processing availability, server health, and the limits of browser-local tools.",
    ),
    "/account": (
        "Account — PrivaTools",
        "Manage your optional PrivaTools account, sign-in methods, developer API keys, and usage. File tools remain available to guests.",
    ),
    "/account/keys": (
        "API Keys — PrivaTools",
        "Create, inspect, and revoke your PrivaTools developer API keys. Sign in to manage keys; file tools remain available to guests.",
    ),
    "/account/sign-in": (
        "Sign In — PrivaTools",
        "Sign in to your optional PrivaTools developer account. File tools remain available without an account.",
    ),
    "/account/sign-up": (
        "Create an Account — PrivaTools",
        "Create an optional account for the PrivaTools developer API. No account is required to use the tools.",
    ),
    "/account/settings": (
        "Account Settings — PrivaTools",
        "Manage your PrivaTools account, appearance preferences, and developer API access.",
    ),
    "/settings": (
        "Settings — PrivaTools",
        "Manage your PrivaTools appearance preferences and account settings.",
    ),
    "/ai": (
        "AI Workspace — PrivaTools",
        "Manage on-device AI models and your own provider connections for PrivaTools AI tools. "
        "Review where each model runs before using it.",
    ),
    "/api": (
        "Developer API — PrivaTools",
        "Use PrivaTools from your applications. Explore API requests, authentication, "
        "processing behavior, and developer key management.",
    ),
    "/trust": (
        "Trust Center — PrivaTools",
        "Understand where PrivaTools processes files, what stays in your browser, "
        "and how to review privacy, security, and service status.",
    ),
    "/my-stuff/vault": (
        "Password Vault — PrivaTools",
        "Saved PDF passwords, encrypted on this device with a key your browser will not "
        "export. Import, review, or erase them — nothing syncs, nothing uploads.",
    ),
    "/my-stuff": (
        "My Stuff — PrivaTools",
        "Everything PrivaTools has stored in this browser: saved passwords, signatures, "
        "Bates counters, and tool defaults. Review or erase it all. Never leaves your device.",
    ),
    "/about": (
        "About PrivaTools — How We Handle Your Files | Privacy-First",
        "Owner-funded, open-source file tools built on one rule: your documents are yours. "
        "Browser-first processing, disclosed server fallback, and AI without surrender — "
        "on-device models or your own API key, never our middleman.",
    ),
    "/batch": (
        "Batch Process Files — Apply Tools to Many Files | PrivaTools",
        "Upload multiple files and apply the same tool to all at once. Batch compress, "
        "convert, or transform supported files, review individual results, and download a ZIP.",
    ),
    "/pipeline": (
        "PDF Pipeline — Chain Multiple PDF Tools | PrivaTools",
        "Chain multiple PDF tools together into a processing pipeline. "
        "Compress, rotate, watermark, and more — all in one pass. Privacy-first and free.",
    ),
    # The title matches COMPARE_DIRECTORY_TITLE in frontend/src/data/comparisons.ts,
    # which the React page sets after hydration (test_compare_page_parity.py).
    "/compare": (
        "PrivaTools vs iLovePDF, Smallpdf & Adobe — Compared",
        "Compare PrivaTools with iLovePDF, Smallpdf, Adobe Acrobat, Stirling PDF and other file tools: "
        "plans, limits and where files go, from official pages.",
    ),
    "/blog": (
        "PrivaTools Blog — PDF Tool Tips, Guides & Reviews",
        "In-depth guides on PDF compression, merging, password removal, and more. "
        "Honest comparisons of free PDF tools. Written by the PrivaTools team.",
    ),
}

# Real pages (HTTP 200) that must never be indexed. Everything else is either a
# known page (indexed) or unknown (noindex + 404). /my-stuff is a per-device
# management screen with no content value — surfacing it in search results
# would be confusing, and it must also stay out of the sitemap.
NOINDEX_PATHS: frozenset[str] = frozenset({
    "/my-stuff",
    "/my-stuff/vault",
    "/account",
    "/account/keys",
    "/account/sign-in",
    "/account/sign-up",
    "/account/settings",
    "/settings",
})

# ---------------------------------------------------------------------------
# Blog post metadata  (slug → post info dict)
# ---------------------------------------------------------------------------
_BLOG_POSTS: dict[str, dict] = {
    "transcribe-audio-free-no-upload": {
        "title": "Transcribe Audio to Text Free — Without Uploading the Recording",
        "description": "Run OpenAI's Whisper model inside your browser to transcribe meetings, interviews, and voice notes for free — the recording never uploads. Timestamps, .txt and .srt export, an own-key option for higher accuracy, and the honest limits of both paths.",
        "publishedAt": "2026-09-01",
        "readTime": "8 min read",
        "tags": ["AI", "Audio", "Privacy", "How-To"],
    },
    "ocr-scanned-pdf-free-three-ways": {
        "title": "OCR a Scanned PDF Free: Three Engines, and When Each Wins",
        "description": "PrivaTools OCR PDF ships three engines: server Tesseract with searchable-PDF output, in-browser tesseract.js where nothing uploads, and vision AI through your own key for hard scans. A decision guide, with a trade-off table.",
        "publishedAt": "2026-09-01",
        "readTime": "8 min read",
        "tags": ["PDF", "OCR", "AI", "How-To"],
    },
    "translate-pdf-free-private": {
        "title": "Translate a PDF for Free — Without Uploading It",
        "description": "PrivaTools Translate PDF runs OPUS-MT translation models inside your browser — about 107 MB per language pair, downloaded once — or translates between 30 languages through your own AI key with automatic source detection. What each path sends, and the one Save-as-PDF caveat.",
        "publishedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["PDF", "AI", "Privacy", "How-To"],
    },
    "bring-your-own-ai-key-guide": {
        "title": "Bring Your Own AI Key: The 10-Minute Setup Guide",
        "description": "What bring-your-own-key means, where all eight supported providers issue API keys, the self-hosted Ollama path, where the key is stored, what tasks really cost, and how to verify with DevTools that requests go straight from your browser to your provider.",
        "publishedAt": "2026-09-01",
        "readTime": "9 min read",
        "tags": ["AI", "Privacy", "How-To"],
    },
    "batch-process-files-free": {
        "title": "Batch-Process Files for Free: 25 at a Time, No Quotas",
        "description": "Around 160 of PrivaTools' 223 tools take up to 25 files per run — per-file status, retry-failed, one ZIP. The /batch page swallows folder drops, /pipeline chains tools into one pass, and none of it is metered. How it works, honestly.",
        "publishedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["Productivity", "PDF", "Image", "How-To"],
    },
    "chatpdf-alternatives-private": {
        "title": "ChatPDF Alternatives That Don't Keep Your Documents",
        "description": "Hosted chat-with-PDF services work by holding your file: upload, retention, their model, a subscription above the free tier. Here are the private alternatives — bring-your-own-key chat, an on-device summarizer, or a model on your own machine — with honest pros for both sides.",
        "publishedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["AI", "PDF", "Comparison", "Privacy"],
    },
    "chat-with-pdf-free-private": {
        "title": "How to Chat With a PDF for Free — Without Uploading It",
        "description": "Ask questions about any PDF using your own AI key: the text is extracted in your browser and each question goes straight to the provider you choose, never through PrivaTools. Costs, honest limits, and how it compares with hosted chat services.",
        "publishedAt": "2026-09-01",
        "readTime": "8 min read",
        "tags": ["AI", "PDF", "Privacy", "How-To"],
    },
    "ai-pdf-tools-no-upload-byok": {
        "title": "AI PDF Tools, No Upload Required: Your Own Key or On-Device Models",
        "description": "PrivaTools runs AI two ways without an upload middleman: your own API key, sent browser-to-provider, or free on-device models that download once and then work offline. What each tool uses, model sizes, and how to verify it all in DevTools.",
        "publishedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["AI", "Privacy", "Engineering"],
    },
    "remove-background-without-uploading": {
        "title": "Remove an Image Background Without Uploading It Anywhere",
        "description": "PrivaTools' Background Remover can run the RMBG-1.4 model in your browser — a ~44 MB one-time download that then works offline — with a server engine as the no-download alternative. How that compares with remove.bg's upload model.",
        "publishedAt": "2026-09-01",
        "readTime": "6 min read",
        "tags": ["Image", "AI", "Privacy", "How-To"],
    },
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
    "how-local-first-works": {
        "title": "How Local-First File Tools Actually Work",
        "description": "Your browser can parse, render and rewrite most file formats on its own. Where the local/server line really sits — and why some jobs still need one.",
        "publishedAt": "2026-08-14",
        "readTime": "6 min read",
        "tags": ["Engineering", "Privacy"],
    },
    "what-deleted-means": {
        "title": "What \u201cDeleted After Use\u201d Means on Our Servers",
        "description": "A promise you can't verify from a network tab deserves a precise definition. This is ours, mechanism by mechanism.",
        "publishedAt": "2026-07-02",
        "readTime": "4 min read",
        "tags": ["Trust", "Privacy"],
    },
    "reading-privacy-policies": {
        "title": "Reading a File Tool\u2019s Privacy Policy in 60 Seconds",
        "description": "Four questions cut through any policy: where files go, how long they stay, who else runs code on the page, and what's behind the free tier.",
        "publishedAt": "2026-05-21",
        "readTime": "5 min read",
        "tags": ["Guides", "Privacy"],
    },
    "privatools-vs-ilovepdf": {
        "title": "PrivaTools vs iLovePDF (2026): The Fine Print, Compared",
        "description": "iLovePDF is the biggest name in online PDF tools. We compared free tiers, file handling, limits and privacy line by line — here's where each one wins.",
        "publishedAt": "2026-08-20",
        "updatedAt": "2026-09-01",
        "readTime": "8 min read",
        "tags": ["Comparison", "PDF"],
    },
    "privatools-vs-smallpdf": {
        "title": "PrivaTools vs Smallpdf (2026): Free Tiers Under a Microscope",
        "description": "Smallpdf pioneered the clean one-task-one-page PDF site. We compared its free tier, limits and file handling against PrivaTools, line by line.",
        "publishedAt": "2026-08-24",
        "updatedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["Comparison", "PDF"],
    },
    "privatools-vs-sejda": {
        "title": "PrivaTools vs Sejda (2026): The 3-Tasks-an-Hour Question",
        "description": "Sejda's PDF editor is the best free one on the web — for three tasks an hour. We compared its limits, retention and privacy with PrivaTools.",
        "publishedAt": "2026-08-27",
        "updatedAt": "2026-09-01",
        "readTime": "7 min read",
        "tags": ["Comparison", "PDF"],
    },
    "privatools-vs-ihatepdf": {
        "title": "PrivaTools vs ihatepdf (2026): When Both Sides Are Private",
        "description": "ihatepdf processes everything in your browser — the same privacy bet we make. So the comparison comes down to catalogue depth, heavy jobs and the details.",
        "publishedAt": "2026-08-30",
        "updatedAt": "2026-09-01",
        "readTime": "6 min read",
        "tags": ["Comparison", "PDF"],
    },
}

# ---------------------------------------------------------------------------
# Blog post bodies — full HTML article content for SSR injection.
# Without injecting the body, Google sees only <h1> + lead and flags the page
# as thin ("Crawled - currently not indexed"). The JSON is emitted at build
# time by frontend/scripts/gen-llms.mjs (the prebuild step), keeping
# frontend/src/data/blog.ts as the single source of truth.
# ---------------------------------------------------------------------------
from pathlib import Path as _Path

_CONTENT_DIR = _Path(os.environ.get("FRONTEND_PATH", str(_Path(__file__).parent.parent.parent / "frontend" / "dist")))
_BLOG_JSON = _CONTENT_DIR / "blog-content.json"
_COMPARE_JSON = _CONTENT_DIR / "compare-content.json"
_TOOL_JSON = _CONTENT_DIR / "tool-content.json"
# gen-llms.mjs writes the tool manifest into the source tree, where it is
# committed, and the build copies it into dist. A checkout without a build
# reads the committed copy, so category, popularity, search copy and review
# dates match a build instead of dropping to the no-manifest fallbacks.
_SOURCE_TOOL_JSON = _Path(__file__).parent.parent.parent / "frontend" / "public" / "tool-content.json"
if not _TOOL_JSON.exists() and _SOURCE_TOOL_JSON.exists():
    _TOOL_JSON = _SOURCE_TOOL_JSON


def _mtime(path: _Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def blog_content_mtime_ns() -> int:
    """Opaque cache revision for generated articles, comparisons and tools."""
    return hash((str(_BLOG_JSON), _mtime(_BLOG_JSON), str(_COMPARE_JSON), _mtime(_COMPARE_JSON), str(_TOOL_JSON), _mtime(_TOOL_JSON)))


@lru_cache(maxsize=16)
def _load_manifest(path: str, revision: int) -> dict[str, dict] | None:
    """Build-owned JSON is authoritative, including an intentionally empty list.

    A missing/invalid artifact falls back to the legacy registry. No legacy
    entries are merged into a valid artifact, so removed articles stay removed.
    """
    try:
        data = json.loads(_Path(path).read_text(encoding="utf-8"))
        if isinstance(data, dict):
            rows = [{**value, "slug": key} for key, value in data.items() if isinstance(value, dict)]
            if len(rows) != len(data):
                raise ValueError("Editorial manifest values must be objects")
        elif isinstance(data, list):
            rows = data
        else:
            raise ValueError("Editorial manifest must be an array or a slug-keyed object")
        result = {}
        for row in rows:
            if not isinstance(row, dict) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", row.get("slug", "")):
                raise ValueError("Editorial manifest has an invalid slug")
            if path.endswith("tool-content.json") and isinstance(row.get("name"), str):
                row = {**row, "title": row.get("title") or row["name"]}
            if not isinstance(row.get("title"), str) or not row["title"].strip():
                raise ValueError("Editorial manifest has no title")
            if row["slug"] in result:
                raise ValueError("Editorial manifest has duplicate slugs")
            result[row["slug"]] = row
        return result
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError):
        logging.getLogger(__name__).warning("Cannot read editorial manifest %s", path)
        return None


@lru_cache(maxsize=8)
def _load_blog_bodies(_revision: int) -> dict[str, dict]:
    return _load_manifest(str(_BLOG_JSON), _revision) or {}


def _blog_posts() -> dict[str, dict]:
    data = _load_manifest(str(_BLOG_JSON), blog_content_mtime_ns())
    return data if data is not None else _BLOG_POSTS


def _blog_bodies() -> dict[str, dict]:
    return _load_blog_bodies(blog_content_mtime_ns())


def _comparisons() -> dict[str, dict]:
    data = _load_manifest(str(_COMPARE_JSON), blog_content_mtime_ns())
    return data if data is not None else _COMPARE_DATA


def _tool_tables(data: dict[str, dict]) -> tuple[dict[str, tuple[str, str]], dict[str, tuple[str, str]]] | None:
    """Split tool manifest rows by route into PDF and non-PDF tables, or None if a route is invalid."""
    pdf, nonpdf = {}, {}
    for slug, row in data.items():
        prefix = (row.get("path") or "").rsplit("/", 1)[0]
        if prefix not in ("/tool", "/tools"):
            logging.getLogger(__name__).warning("Tool manifest has an invalid path for %s", slug)
            return None
        (pdf if prefix == "/tool" else nonpdf)[slug] = (row.get("name") or row["title"], row.get("longDescription") or row.get("description") or "")
    return pdf, nonpdf


def _tool_registries() -> tuple[dict[str, tuple[str, str]], dict[str, tuple[str, str]]]:
    data = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    tables = _tool_tables(data) if data is not None else None
    return tables or (_PDF_TOOLS, _NONPDF_TOOLS)


_SEO_FIELDS = ("seoTitle", "metaDescription", "lastReviewed")


def _tool_seo_fields(slug: str) -> dict[str, str]:
    """seoTitle and metaDescription search copy, plus lastReviewed, that the
    registries carry through the build manifest. lastReviewed is carried here
    for callers that need all three fields."""
    data = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    row = (data or {}).get(slug) or {}
    return {key: str(row[key]).strip() for key in _SEO_FIELDS if row.get(key) not in (None, "")}


def _reviewed_date(entry: dict) -> str | None:
    for field in ("reviewedAt", "dateModified", "updatedAt", "publishedAt", "date"):
        value = entry.get(field)
        if isinstance(value, str):
            try:
                return date.fromisoformat(value[:10]).isoformat()
            except ValueError:
                pass
    return None


def _sources(entry: dict) -> list[dict]:
    sources = []
    for source in entry.get("sources") or []:
        if not isinstance(source, dict) or not isinstance(source.get("url"), str):
            continue
        url = source["url"]
        if "\\" in url or any(ord(char) < 32 for char in url):
            continue
        if url.startswith("/") and not url.startswith("//"):
            # Editorial sources can cite our own processing/privacy documents.
            # Canonical absolute URLs work in both visible links and JSON-LD.
            url = BASE_URL + url
        if url.startswith(("https://", "http://")):
            sources.append({**source, "url": url})
    return sources


def _source_html(entry: dict) -> str:
    sources = _sources(entry)
    if not sources:
        return ""
    return '<h2>Sources</h2><ul>' + ''.join(
        f'<li><a href="{escape(source["url"], quote=True)}">{escape(source.get("label") or source["url"])}</a></li>'
        for source in sources) + '</ul>'


def _organization() -> dict:
    return {"@type": "Organization", "@id": f"{BASE_URL}/#organization", "name": "PrivaTools", "url": BASE_URL,
            "logo": {"@type": "ImageObject", "url": BRAND_LOGO_URL, "width": 512, "height": 512}}


# Reverse map: tool_slug -> list of blog post dicts that reference it via the
# blog's `relatedTools` array. Used to inject "Mentioned in our guides" links
# on each tool page — gives the long-tail tools inbound internal links from
# authoritative blog content, which helps Google allocate crawl budget.
#
# Matches the client's `postsForTool(slug, 4)` (frontend/src/data/blog.ts):
# newest `publishedAt` first, capped at four. Sorting/capping here (once, on
# the cached build) keeps every call site — currently just _tool_page_body —
# from having to remember to do it.
@lru_cache(maxsize=8)
def _tool_to_blogs_for_mtime(_mtime_ns: int) -> dict[str, list[dict]]:
    tool_to_blogs: dict[str, list[dict]] = {}
    for slug, post in _load_blog_bodies(_mtime_ns).items():
        for tool_slug in post.get("relatedTools") or []:
            tool_to_blogs.setdefault(tool_slug, []).append({
                "slug": slug,
                "title": post.get("title", slug),
                "publishedAt": post.get("publishedAt") or post.get("date") or "",
            })
    for tool_slug, posts in tool_to_blogs.items():
        posts.sort(key=lambda post: post["publishedAt"], reverse=True)
        tool_to_blogs[tool_slug] = posts[:4]
    return tool_to_blogs


def _tool_to_blogs() -> dict[str, list[dict]]:
    return _tool_to_blogs_for_mtime(blog_content_mtime_ns())


# ---------------------------------------------------------------------------
# Tool popularity  (lower = more searched/used) lives in the registries,
# frontend/src/data/{tools,non-pdf-tools}.ts, and reaches the server through
# the build manifest. There is deliberately no copy of the ranks here: the
# one this module used to keep had drifted on more than half the catalogue.
# ---------------------------------------------------------------------------
def _by_popularity(items):
    """Sort (slug, ...) tuples the way the client sorts its registries.

    Manifest `popularity` ascending, unranked slugs last, equal ranks left in
    the order given — callers pass manifest order, so this matches a stable JS
    sort over the registry and crawlers see the ordering React renders.
    If no tool manifest can be read, nothing is ranked and the registry
    tables' own order stands.
    """
    manifest = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns()) or {}
    return sorted(items, key=lambda kv: (manifest.get(kv[0]) or {}).get("popularity", 999))


def _tool_registry_short_description(slug: str) -> str | None:
    data = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    row = (data or {}).get(slug) or {}
    return row.get("description") or None


def _tool_category(slug: str) -> str | None:
    data = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    row = (data or {}).get(slug) or {}
    return row.get("category") or None


def _related_tools(slug: str, registry: dict, prefix: str) -> list[tuple[str, str, str]]:
    """The three most popular tools in the same category, matching the workspace's afterword.

    Mirrors `SkinApp.tsx`'s `related` list exactly: same category, popularity
    ascending (manifest iteration order breaks ties, same as a stable JS sort
    over `ALL_TOOLS`), excluding the tool itself, first three. Reads the same
    build-owned manifest the client's registry is generated from, so this
    can't drift from what the workspace's afterword actually shows. If no
    manifest can be read there is no category or popularity, so it falls
    back to the first three other tools in the registry table. A checkout
    without a build reads the committed manifest, and the app will not start
    when no manifest is readable, so in practice only tests and a corrupt
    dist manifest reach this path.
    """
    manifest = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    if manifest is not None:
        category = (manifest.get(slug) or {}).get("category")
        candidates = [
            (s, row) for s, row in manifest.items()
            if s != slug and s in registry and (category is None or row.get("category") == category)
        ]
        return [(s, row.get("name") or row["title"], f"/{prefix}/{s}") for s, row in _by_popularity(candidates)[:3]]
    category = _tool_category(slug)
    candidates = [(s, name) for s, (name, _) in registry.items()
                  if s != slug and (category is None or _tool_category(s) == category)]
    return [(s, name, f"/{prefix}/{s}") for s, name in _by_popularity(candidates)[:3]]


# Registry category (`Category` in tools.ts, `NonPdfCategory` in
# non-pdf-tools.ts) → the subcategory label search and answer engines read.
_APPLICATION_SUBCATEGORIES = {
    "organize": "PDF organization tools",
    "edit": "PDF editing tools",
    "optimize": "PDF optimization tools",
    "security": "PDF security tools",
    "to-pdf": "Convert to PDF tools",
    "from-pdf": "Convert from PDF tools",
    "advanced": "Advanced PDF tools",
    "document-office": "Document and data tools",
    "archive": "Archive tools",
    "image": "Image tools",
    "video-audio": "Video and audio tools",
    "developer": "Developer tools",
}


_BROWSER_ONLY_FEATURE = "Runs in your browser; files are never uploaded"
_SERVER_FEATURE = "Server processing in temporary storage, removed after the response"
_PROVIDER_FEATURE = "Optional AI provider mode sends content only to the AI provider you choose"


def _processing_features(slug: str) -> list[str]:
    """Where a tool's files go, for its structured data.

    Follows the registry's `clientOnly` and `byok` flags from the tool manifest,
    the same flags that choose the badge on the tool page. Server tools delete
    their temporary files once the response is sent, and the janitor in main.py
    sweeps leftovers; that is a cleanup policy, so never promise "immediately".
    """
    row = (_load_manifest(str(_TOOL_JSON), blog_content_mtime_ns()) or {}).get(slug) or {}
    features = [_BROWSER_ONLY_FEATURE if row.get("clientOnly") else _SERVER_FEATURE]
    if row.get("byok"):
        features.append(_PROVIDER_FEATURE)
    return features


def _application_subcategory_for(slug: str, is_pdf_tool: bool) -> str:
    """Return a precise SoftwareApplication subcategory for SEO/answer engines.

    The label follows the tool's registry category, read from the tool
    manifest. If no manifest can be read there is no category, only the
    registry table the slug came from, hence the generic fallback.
    """
    generic = "PDF tools" if is_pdf_tool else "File tools"
    return _APPLICATION_SUBCATEGORIES.get(_tool_category(slug) or "", generic)


# ---------------------------------------------------------------------------
# Fallback tool tables  (slug → (name, long_description))
#
# `_tool_registries()` serves these when the tool manifest cannot be loaded,
# and the tool counts below are taken from them at import. They hold no text
# of their own: gen-llms.mjs writes the registries
# (frontend/src/data/{tools,non-pdf-tools}.ts) to the committed
# frontend/public/tool-content.json, and that file is read here. The
# hand-written copy it replaces had drifted on most tools and still carried
# claims the registries had corrected. The image ships the build but not
# frontend/public, so there the build manifest is read instead.
# ---------------------------------------------------------------------------
def _fallback_tool_tables(*paths: _Path) -> tuple[dict[str, tuple[str, str]], dict[str, tuple[str, str]]]:
    """The tables of the first readable tool manifest in `paths`.

    With none, the site would claim zero tools and 404 every tool page, so
    refuse to start instead."""
    for path in paths:
        data = _load_manifest(str(path), _mtime(path))
        tables = _tool_tables(data) if data is not None else None
        if tables is not None:
            return tables
    raise RuntimeError(
        f"No readable tool manifest at {' or '.join(map(str, paths))}. "
        "Run `npm run gen:llms` in frontend/ to write it from the registries."
    )


_PDF_TOOLS, _NONPDF_TOOLS = _fallback_tool_tables(_SOURCE_TOOL_JSON, _TOOL_JSON)


_TOOL_ALIASES: dict[str, list[str]] = {
    "merge-pdf":       ["Combine PDF", "Join PDF", "Concatenate PDF", "PDF Merger", "Add PDFs together"],
    "split-pdf":       ["Separate PDF", "Divide PDF", "PDF Splitter", "Break PDF apart"],
    "compress-pdf":    ["Reduce PDF size", "Shrink PDF", "Make PDF smaller", "PDF Compressor", "Optimize PDF size"],
    "edit-pdf":        ["PDF Editor", "Modify PDF", "Change PDF text", "PDF text editor"],
    "sign-pdf":        ["Add signature to PDF", "Electronic signature PDF", "E-sign PDF", "Digital signature"],
    "watermark":       ["Add watermark to PDF", "PDF watermark tool", "Stamp PDF"],
    "ocr-pdf":         ["Make PDF searchable", "Scanned PDF to text", "PDF text recognition", "OCR scanned PDF"],
    "redact-pdf":      ["Black out PDF", "Remove text from PDF", "Hide sensitive info in PDF", "PDF redaction"],
    "protect-pdf":     ["Password protect PDF", "Encrypt PDF", "Lock PDF", "Add password to PDF"],
    "unlock-pdf":      ["Remove PDF password", "Decrypt PDF", "Unlock password protected PDF"],
    "rotate-pdf":      ["Rotate PDF pages", "Turn PDF sideways", "Fix PDF orientation"],
    "pdf-to-word":     ["Convert PDF to DOCX", "PDF to DOC", "Extract text from PDF to Word", "PDF to Microsoft Word"],
    "pdf-to-excel":    ["Convert PDF to XLSX", "PDF to spreadsheet", "Extract tables from PDF", "PDF table to Excel"],
    "pdf-to-jpg":      ["Convert PDF to JPEG", "PDF to image", "PDF pages as JPG", "Save PDF as JPG"],
    "pdf-to-png":      ["Convert PDF to PNG", "PDF pages as PNG", "Save PDF as PNG image"],
    "pdf-to-image":    ["Convert PDF to images", "Render PDF as JPG", "Render PDF as PNG", "PDF page screenshots"],
    "jpg-to-pdf":      ["Convert JPEG to PDF", "Image to PDF", "JPG image to PDF", "Photo to PDF"],
    "png-to-pdf":      ["Convert PNG to PDF", "Screenshot to PDF", "Save PNG as PDF"],
    "image-to-pdf":    ["Photos to PDF", "Pictures to PDF", "Combine images into PDF"],
    "word-to-pdf":     ["Convert DOCX to PDF", "Convert DOC to PDF", "Microsoft Word to PDF"],
    "excel-to-pdf":    ["Convert XLSX to PDF", "Spreadsheet to PDF", "Excel sheet to PDF"],
    "html-to-pdf":     ["Webpage to PDF", "URL to PDF", "Save web page as PDF"],
    "heic-to-jpg":     ["iPhone photo to JPG", "Convert HEIC to JPEG", "HEIF to JPG"],
    "heic-to-pdf":     ["iPhone photo to PDF", "HEIF to PDF"],
    "remove-exif":     ["Strip EXIF data", "Remove image metadata", "Clear photo GPS data"],
    "remove-background":["Background remover", "Cut out subject", "Transparent background", "Erase background"],
    "image-compressor":["Compress image", "Reduce image size", "Shrink photo", "Optimize JPEG", "Minify PNG"],
    "image-converter": ["Image format converter", "Convert image format", "Change image type"],
    "compress-video":  ["Reduce video size", "Shrink MP4", "Make video smaller", "Video compressor"],
    "video-to-gif":    ["MP4 to GIF", "Convert video to animated GIF", "Make GIF from video"],
    "mp4-to-mp3":      ["Extract MP3 from MP4", "Convert MP4 to audio", "Get audio from video"],
    "pdf-to-text":     ["Extract text from PDF", "PDF to TXT", "Copy text from PDF"],
    "pdf-to-pptx":     ["PDF to PowerPoint", "Convert PDF slides"],
    "pdf-to-epub":     ["Convert PDF to e-book", "PDF to Kindle format"],
    "summarize-pdf":   ["AI PDF summary", "Summarize PDF with AI", "PDF executive summary"],
    "smart-redact":    ["Auto-redact PDF", "AI redaction", "Detect PII in PDF", "Automatic redaction"],
    "jwt-decoder":     ["JWT parser", "Decode JSON Web Token", "Read JWT", "JWT inspector"],
    "regex-tester":    ["Regular expression tester", "Test regex", "Regex match checker"],
    "json-xml-formatter":["Pretty print JSON", "JSON beautifier", "XML formatter", "JSON validator"],
    "base64":          ["Base64 encoder", "Base64 decoder", "Encode to Base64", "Decode Base64 to text"],
    "hash-generator":  ["MD5 generator", "SHA-256 calculator", "File hash checker", "SHA-1 generator"],
    "password-generator":["Strong password generator", "Random password", "Secure password creator"],
    "uuid-generator":  ["UUID v4 generator", "Random GUID", "GUID generator"],
    "qr-code":         ["QR code generator", "Make QR code", "Create QR from URL"],
    "qr-reader":       ["QR code scanner", "Read QR code", "Decode QR from image"],
    "url-encoder":     ["URL encode", "Percent encode", "URI decode", "Encode query parameters"],
    "generate-favicon":["Make favicon", "Favicon converter", "Create site icon"],
    "yaml-to-json":    ["Convert YAML to JSON", "YAML parser to JSON"],
    "json-to-yaml":    ["Convert JSON to YAML", "JSON to Kubernetes YAML"],
}


def _aliases_for(slug: str, name: str) -> list[str]:
    """Return the hand-curated alias list for a tool, or a sensible fallback."""
    if slug in _TOOL_ALIASES:
        return _TOOL_ALIASES[slug]
    # Fallback: lower-case alias + slug-as-words.
    aliases = []
    lower = name.lower()
    if lower != name:
        aliases.append(lower)
    nice = slug.replace("-", " ")
    if nice not in (name.lower(),):
        aliases.append(nice)
    return aliases


# Reusable keyword tail that boosts privacy/free intent across every tool.
_KEYWORD_TAIL = ["free online", "no sign up", "no watermark", "open source", "privacy first"]


def _keywords_for(slug: str, name: str, long_description: str) -> list[str]:
    """Return the keyword list to embed in JSON-LD `keywords`."""
    kws: list[str] = [name, name.lower()]
    kws.extend(_aliases_for(slug, name))
    # Pull the first noun phrase of the description (cheap heuristic: chars before the em dash).
    if long_description and "—" in long_description:
        head = long_description.split("—", 1)[0].strip().rstrip(".")
        if head and head.lower() not in {k.lower() for k in kws}:
            kws.append(head)
    kws.extend(_KEYWORD_TAIL)
    # Dedupe case-insensitively, preserve order.
    seen: set[str] = set()
    out: list[str] = []
    for k in kws:
        kl = k.lower()
        if kl not in seen:
            seen.add(kl)
            out.append(k)
    return out


# Title and description limits enforced for every tool entry. Google truncates
# titles around 60 chars on desktop and descriptions around 155–160 chars in
# SERP snippets — going past these caps means the field is silently truncated
# (often mid-word) and burns away differentiation.
_TITLE_MAX = 60
_DESC_MAX = 160


def _tool_title(name: str) -> str:
    """Build the `<title>` for a tool page, capped at 60 chars.

    Google truncates SERP titles around 60 chars on desktop. The previous
    formula ("X Online Free — No Sign Up, No Watermark | PrivaTools") was 51
    chars of fixed suffix, which guaranteed almost every tool busted the cap.
    The new formula keeps the brand suffix but trims the marketing tail; if a
    rare long tool name still pushes the title over 60 chars we hard-truncate
    with an ellipsis so the SERP rendering stays clean.
    """
    title = f"{name} — Free Online | PrivaTools"
    if len(title) <= _TITLE_MAX:
        return title
    # Trim the tool name, keep the brand. "… | PrivaTools" is 14 chars.
    brand = " | PrivaTools"
    budget = _TITLE_MAX - len(brand) - 1  # one char for the ellipsis
    return f"{name[:budget]}…{brand}"


def _howto_name_for(name: str) -> str:
    """Build a readable HowTo title for action-style and noun-style tools."""
    normalized = re.sub(r"\s+", " ", name).strip()
    return f"How to use {normalized}"


def _tool_desc(desc: str) -> str:
    if len(desc) <= _DESC_MAX:
        return desc
    # Cut at the last word boundary within budget so we don't end mid-word.
    cut = desc[: _DESC_MAX - 1]
    sp = cut.rfind(" ")
    if sp > _DESC_MAX - 30:  # only word-boundary if it's close enough
        cut = cut[:sp]
    return cut.rstrip(" ,;:—-") + "…"


# ---------------------------------------------------------------------------
# TOOL_META — flat, slug-keyed view of every tool's rendered SEO meta.
#
# Built once at import time from `_PDF_TOOLS` + `_NONPDF_TOOLS` so external
# callers (audit scripts, tests, prerender jobs) can introspect the exact
# title + description strings that will be emitted in the `<head>` without
# re-implementing the length-capping logic. Each entry conforms to the
# 60-char title / 160-char description SERP budgets — this is enforced at
# module load by `_tool_title()` / `_tool_desc()`. The category is mirrored
# from the source dict so external consumers can group tools (PDF vs
# utilities) without parsing slugs.
# ---------------------------------------------------------------------------
TOOL_META: dict[str, dict[str, str]] = {}
for _slug, (_name, _desc) in _tool_registries()[0].items():
    TOOL_META[_slug] = {
        "name": _name,
        "title": _tool_title(_name),
        "description": _tool_desc(_desc),
        "long_description": _desc,
        "url_path": f"/tool/{_slug}",
        "category": "pdf",
    }
for _slug, (_name, _desc) in _tool_registries()[1].items():
    TOOL_META[_slug] = {
        "name": _name,
        "title": _tool_title(_name),
        "description": _tool_desc(_desc),
        "long_description": _desc,
        "url_path": f"/tools/{_slug}",
        "category": "non-pdf",
    }


TOOL_LAST_REVIEWED_DEFAULT = "2026-05-01"
TOOL_LAST_REVIEWED: dict[str, str] = {
    # No-manifest fallback only: `_last_reviewed_for` reads the registry's
    # own `lastReviewed` through the build manifest first. These dates are
    # NOT the review cadence and are NOT auto-bumped on every render — they
    # only matter when a slug is missing from the manifest.
    "compress-pdf":     "2026-05-15",
    "merge-pdf":        "2026-05-10",
    "split-pdf":        "2026-05-08",
    "pdf-to-word":      "2026-05-12",
    "pdf-to-excel":     "2026-04-28",
    "pdf-to-jpg":       "2026-04-22",
    "jpg-to-pdf":       "2026-04-18",
    "edit-pdf":         "2026-05-05",
    "sign-pdf":         "2026-05-02",
    "ocr-pdf":          "2026-05-14",
    "protect-pdf":      "2026-04-12",
    "unlock-pdf":       "2026-04-10",
    "rotate-pdf":       "2026-03-25",
    "watermark":        "2026-04-05",
    "redact-pdf":       "2026-05-09",
    "smart-redact":     "2026-05-13",
    "summarize-pdf":    "2026-05-16",
    "highlight-pdf":    "2026-03-20",
    "image-compressor": "2026-05-11",
    "image-converter":  "2026-04-15",
    "heic-to-jpg":      "2026-04-02",
    "remove-background":"2026-05-06",
    "remove-exif":      "2026-03-28",
    "video-converter":  "2026-04-25",
    "audio-converter":  "2026-04-20",
    "compress-video":   "2026-04-08",
    "video-to-gif":     "2026-03-30",
    "jwt-decoder":      "2026-02-15",
    "regex-tester":     "2026-02-22",
    "password-generator":"2026-02-10",
    # Additional well-trafficked tools — second-tier popularity
    "pdf-to-text":      "2026-03-15",
    "pdf-to-image":     "2026-03-12",
    "word-to-pdf":      "2026-03-18",
    "excel-to-pdf":     "2026-03-08",
    "html-to-pdf":      "2026-03-05",
    "extract-pages":    "2026-02-28",
    "delete-pages":     "2026-02-26",
    "compare-pdfs":     "2026-02-20",
    "batch-compress-pdf":"2026-04-30",
    "hash-generator":   "2026-01-25",
    "base64":           "2026-01-22",
    "qr-code":          "2026-01-18",
    "qr-reader":        "2026-01-15",
    "uuid-generator":   "2026-01-12",
    # Phase 2 conversion aliases — reviewed when added.
    "jpg-to-tiff":      "2026-06-18",
    "png-to-tiff":      "2026-06-18",
    "webp-to-tiff":     "2026-06-18",
    "jpg-to-bmp":       "2026-06-18",
    "png-to-bmp":       "2026-06-18",
    "webp-to-bmp":      "2026-06-18",
    "mp3-to-wav":       "2026-06-18",
    "wav-to-mp3":       "2026-06-18",
    "flac-to-mp3":      "2026-06-18",
    "ogg-to-mp3":       "2026-06-18",
    "aac-to-mp3":       "2026-06-18",
    "mp3-to-ogg":       "2026-06-18",
    "mp3-to-flac":      "2026-06-18",
    "mp3-to-aac":       "2026-06-18",
    "wav-to-flac":      "2026-06-18",
    "wav-to-ogg":       "2026-06-18",
    "mkv-to-mp4":       "2026-06-18",
    "mp4-to-mov":       "2026-06-18",
    "mov-to-webm":      "2026-06-18",
    "mkv-to-webm":      "2026-06-18",
    "mp4-to-avi":       "2026-06-18",
    "avi-to-webm":      "2026-06-18",
    "webm-to-mov":      "2026-06-18",
    "mov-to-mkv":       "2026-06-18",
    "webm-to-gif":      "2026-06-18",
    "mov-to-gif":       "2026-06-18",
    "cron-parser":      "2026-06-18",
    "sql-formatter":    "2026-06-18",
    "graphql-formatter":"2026-06-18",
    "yaml-toml-converter":"2026-06-18",
    "gitignore-generator":"2026-06-18",
    "semver-bumper":    "2026-06-18",
    "env-validator":    "2026-06-18",
    "json-to-csv-schema":"2026-06-18",
}


def _last_reviewed_for(slug: str) -> str:
    """The registry's `lastReviewed`, read through the build manifest, is the
    source of truth. TOOL_LAST_REVIEWED is only the fallback for a slug the
    manifest doesn't cover, or whose lastReviewed can't be parsed as a date."""
    manifest = _load_manifest(str(_TOOL_JSON), blog_content_mtime_ns())
    if manifest is not None and slug in manifest:
        reviewed = _reviewed_date({"reviewedAt": manifest[slug].get("lastReviewed")})
        if reviewed is not None:
            return reviewed
    return TOOL_LAST_REVIEWED.get(slug, TOOL_LAST_REVIEWED_DEFAULT)


_TOP_LEVEL_SPA_ROUTES = frozenset({
    "/",
    "/about",
    "/privacy",
    "/security",
    "/terms",
    "/blog",
    "/compare",
    "/pipeline",
    "/batch",
    "/tools",
    "/my-stuff",
    "/my-stuff/vault",
    "/account",
    "/account/keys",
    "/account/sign-in",
    "/account/sign-up",
    "/account/settings",
    "/settings",
    "/ai",
    "/api",
    "/trust",
    "/status",
    "/support",
})


def path_is_known(path: str) -> bool:
    """Whether the current frontend build has this route, without a soft 404."""
    _PDF_TOOLS, _NONPDF_TOOLS = _tool_registries()
    p = path.rstrip("/") or "/"
    if p.startswith("/blog/"):
        return p[len("/blog/"):] in _blog_posts()
    if p.startswith("/compare/"):
        return p[len("/compare/"):] in _comparisons()
    if p in _STATIC_META:
        return True
    if p.startswith("/tool/"):
        return p[len("/tool/"):] in _PDF_TOOLS
    if p.startswith("/tools/"):
        return p[len("/tools/"):] in _NONPDF_TOOLS
    # Top-level SPA routes the frontend handles.
    #
    # Kept in step with App.tsx's <Route path=...> declarations by
    # tests/test_spa_routes_are_known.py, which parses them out rather than
    # holding a second copy — a copy is what let /account, /account/keys,
    # /my-stuff/vault, /status and /support ship 404ing, two of them linked
    # from the main nav. They rendered fine once React Router took over, so
    # the only symptoms were the status code, a flash of "Page Not Found" in
    # the tab title, and crawlers seeing a 404.
    if p in _TOP_LEVEL_SPA_ROUTES:
        return True
    return False


# Meta returned when the path doesn't resolve to a known route. Previously
# unknown paths inherited the homepage title/description, which made HTTP 404
# responses LOOK like the homepage to Google's content-based 404 detection —
# tripping the Soft 404 report.
_NOT_FOUND_META: tuple[str, str] = (
    "Page Not Found (404) | PrivaTools",
    "The page you requested doesn't exist on PrivaTools. Browse 213 free PDF, "
    "image, video, audio, and developer tools from the homepage, or check the "
    "blog for guides.",
)


# The tool total is derived, never written down — the site once advertised a
# count it didn't ship. Patch the two module-top literals that predate the
# registries being defined.
_TOTAL_TOOLS = len(_PDF_TOOLS) + len(_NONPDF_TOOLS)
_STATIC_META["/"] = (
    _STATIC_META["/"][0],
    f"{_TOTAL_TOOLS} free, open-source file tools for PDF, image, video, audio, and developer "
    "work. AI two private ways — on-device models or your own API key. Browser-only when "
    "possible; isolated temporary processing when needed.",
)
_NOT_FOUND_META = (_NOT_FOUND_META[0], _NOT_FOUND_META[1].replace("213", str(_TOTAL_TOOLS)))
# Compare-page descriptions predate the registries too; normalise every stale
# hand-written count to the derived one.
_STATIC_META = {
    k: (t, d.replace("213 tools", f"{_TOTAL_TOOLS} tools")
            .replace("213 privacy-first tools", f"{_TOTAL_TOOLS} privacy-first tools"))
    for k, (t, d) in _STATIC_META.items()
}

def get_meta_for_path(path: str) -> tuple[str, str]:
    """Return current build metadata, or a genuine not-found response."""
    _PDF_TOOLS, _NONPDF_TOOLS = _tool_registries()
    path = path.rstrip("/") or "/"

    for prefix, entries in (("/blog/", _blog_posts), ("/compare/", _comparisons)):
        if path.startswith(prefix):
            entry = entries().get(path[len(prefix):])
            if entry is None:
                return _NOT_FOUND_META
            return (entry["title"], entry.get("description") or entry.get("summary") or "")

    # Static page lookup
    if path in _STATIC_META:
        return _STATIC_META[path]

    # /tool/<slug>
    if path.startswith("/tool/"):
        slug = path[len("/tool/"):]
        if slug in _PDF_TOOLS:
            name, desc = _PDF_TOOLS[slug]
            fields = _tool_seo_fields(slug)
            return fields.get("seoTitle") or _tool_title(name), fields.get("metaDescription") or _tool_desc(desc)
        # Unknown slug — explicit 404 so HTTP status and body content match
        return _NOT_FOUND_META

    # /tools/<slug>
    if path.startswith("/tools/"):
        slug = path[len("/tools/"):]
        if slug in _NONPDF_TOOLS:
            name, desc = _NONPDF_TOOLS[slug]
            fields = _tool_seo_fields(slug)
            return fields.get("seoTitle") or _tool_title(name), fields.get("metaDescription") or _tool_desc(desc)
        return _NOT_FOUND_META

    # Any other unknown top-level path
    return _NOT_FOUND_META


_HOME_FAQ = [
    ("Is PrivaTools really free?", "The file tools are free to use without an account and do not add PrivaTools watermarks. Server capacity limits apply. The developer API has per-key quotas, and optional AI providers may bill your own account."),
    ("Do you upload my files anywhere?", "It depends on the tool and processing option. Browser tools keep input on this device. Server tools upload files for temporary processing and remove temporary files after the response completes; periodic cleanup handles leftovers. Optional bring-your-own-key AI sends the disclosed input directly to your selected provider. Review the processing notice before starting."),
    ("Can I self-host PrivaTools?", f"Yes. PrivaTools is MIT-licensed and ships as a Docker Compose project. See github.com/ethereaglehq/privatools to host all {_TOTAL_TOOLS} tools on your own infrastructure. Some optional models, providers and external URLs still require network access."),
    ("What file size limit does PrivaTools have?", "The default server upload limit is 500 MB. Individual tools and browser memory can impose lower limits, and server rate or capacity limits can delay processing. Developer API requests have separate daily quotas."),
    ("Does PrivaTools use AI?", "AI tools offer browser models and, where supported, your own OpenAI, Anthropic or Gemini connection. Review the selected model and processing notice first. Smart Redact detects suggestions locally or through the selected provider; applying approved redactions sends the PDF to the backend."),
    ("How does PrivaTools compare to other file tools?", "Our comparison pages explain practical workflows, processing choices, and tradeoffs with links to source documentation. Review the sources and date because competitors' plans and features can change."),
]


def get_jsonld_for_path(path: str) -> dict | None:
    """Return a JSON-LD dict for the given URL path, or None."""
    return _get_jsonld_for_path(path, blog_content_mtime_ns())


@lru_cache(maxsize=512)
def _get_jsonld_for_path(path: str, _blog_mtime_ns: int) -> dict | None:
    """Return a JSON-LD dict for the given URL path, or None.

    The returned dict is shared across all callers (via ``lru_cache``) —
    DO NOT mutate it; the only intended use is to JSON-serialise it.
    Mutating a cached entry would corrupt every subsequent response that
    hits the same cache key.

    Building the JSON-LD for a tool page touches ~30+ helpers and string
    builders that all run on every SSR render. Memoising the final dict
    cuts the per-request cost to a hash lookup.
    """
    _PDF_TOOLS, _NONPDF_TOOLS = _tool_registries()
    path = path.rstrip("/") or "/"
    title, description = get_meta_for_path(path)
    canonical_url = BASE_URL + (path if path != "/" else "")

    breadcrumbs: list[dict] = [
        {"@type": "ListItem", "position": 1, "name": "PrivaTools", "item": BASE_URL}
    ]

    if path == "/":
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
            ("semver-bumper", "/tools/semver-bumper"),
            ("env-validator", "/tools/env-validator"),
            ("cron-parser", "/tools/cron-parser"),
            ("yaml-toml-converter", "/tools/yaml-toml-converter"),
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
                    "alternateName": ["Priva Tools", "PrivaTools.me"],
                    "description": description,
                    "inLanguage": "en",
                    "publisher": {"@type": "Organization", "name": "PrivaTools", "url": BASE_URL, "logo": {"@type": "ImageObject", "url": BRAND_LOGO_URL}},
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
                        "url": BRAND_LOGO_URL,
                        "width": 512,
                        "height": 512,
                    },
                    "image": BRAND_LOGO_URL,
                    "email": "hello@privatools.me",
                    "foundingDate": "2026-03-01",
                    "description": "Free, open-source, privacy-first file tools — PDF, image, video, audio, and developer utilities. MIT-licensed and self-hostable via Docker.",
                    "license": "https://opensource.org/licenses/MIT",
                    "knowsAbout": [
                        {"@type": "Thing", "name": "PDF",
                         "sameAs": "https://en.wikipedia.org/wiki/PDF"},
                        {"@type": "Thing", "name": "Optical character recognition",
                         "sameAs": "https://en.wikipedia.org/wiki/Optical_character_recognition"},
                        {"@type": "Thing", "name": "Image compression",
                         "sameAs": "https://en.wikipedia.org/wiki/Image_compression"},
                        {"@type": "Thing", "name": "Data conversion",
                         "sameAs": "https://en.wikipedia.org/wiki/Data_conversion"},
                        {"@type": "Thing", "name": "Redaction",
                         "sameAs": "https://en.wikipedia.org/wiki/Redaction"},
                        {"@type": "Thing", "name": "Privacy by design",
                         "sameAs": "https://en.wikipedia.org/wiki/Privacy_by_design"},
                        {"@type": "Thing", "name": "Open-source software",
                         "sameAs": "https://en.wikipedia.org/wiki/Open-source_software"},
                        {"@type": "Thing", "name": "Self-hosting (web services)",
                         "sameAs": "https://en.wikipedia.org/wiki/Self-hosting_(web_services)"},
                        "PDF compression",
                        "PDF merging",
                    ],
                    # sameAs anchors the ORG entity itself. The GitHub repo is
                    # the strongest current node; add a Wikidata Q-number here
                    # once minted (see docs/seo/geo-runbook.md) for full KG linkage.
                    "sameAs": [
                        "https://github.com/ethereaglehq/privatools",
                        "https://x.com/ethereaglehq",
                        "https://privatools.me",
                    ],
                    "contactPoint": {
                        "@type": "ContactPoint",
                        "email": "hello@privatools.me",
                        "contactType": "customer support",
                        "availableLanguage": ["English"],
                        "url": f"{BASE_URL}/about",
                    },
                    "slogan": "Free, Open-Source, Privacy-First File Tools",
                },
                {
                    "@type": "ItemList",
                    "name": "Featured tools",
                    "description": f"A curated subset of the {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)}+ free PDF, image, video, audio, and developer tools on PrivaTools.",
                    "numberOfItems": len(featured),
                    "itemListElement": featured,
                },
                {
                    "@type": "FAQPage",

                    "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in _HOME_FAQ],
                },
            ],
        }

    if path == "/tools":
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "CollectionPage",
                    "@id": f"{BASE_URL}/tools#webpage",
                    "url": f"{BASE_URL}/tools",
                    "name": title,
                    "description": description,
                    "inLanguage": "en",
                    "isPartOf": {"@id": f"{BASE_URL}/#website"},
                    "about": {"@id": f"{BASE_URL}/#organization"},

                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"@type": "ListItem", "position": 1, "name": "PrivaTools", "item": BASE_URL},
                        {"@type": "ListItem", "position": 2, "name": "All Tools", "item": f"{BASE_URL}/tools"},
                    ],
                },
                {
                    "@type": "ItemList",
                    "name": "All PrivaTools tools",
                    "description": f"All {_TOTAL_TOOL_COUNT} free PDF, image, video, audio, and developer tools on PrivaTools.",
                    "numberOfItems": _TOTAL_TOOL_COUNT,
                },
            ],
        }

    if path.startswith("/tool/") or path.startswith("/tools/"):
        prefix = "/tool/" if path.startswith("/tool/") else "/tools/"
        slug = path[len(prefix):]
        # Skip JSON-LD entirely for unknown slugs — we don't want to emit a
        # SoftwareApplication node that points at a 404. Soft-404s like that
        # tank crawl budget because Google interprets them as duplicate
        # content (every fake URL claims to be a different tool but the
        # body is identical 404 copy).
        if prefix == "/tool/":
            if slug not in _PDF_TOOLS:
                return None
            is_pdf_tool = True
            tool_entry = _PDF_TOOLS[slug]
            name = tool_entry[0]
            long_description = tool_entry[1]
            category = "BusinessApplication"  # PDF utilities — knowledge-work / business category
        else:
            if slug not in _NONPDF_TOOLS:
                return None
            is_pdf_tool = False
            tool_entry = _NONPDF_TOOLS[slug]
            name = tool_entry[0]
            long_description = tool_entry[1]
            category = "UtilitiesApplication"

        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": name, "item": canonical_url})

        # Build a feature-list from the tool's universal capabilities.
        # featureList is one of the highest-cited fields by Bing AI and
        # Perplexity when summarizing "what does this tool do" — the
        # bullets get pulled directly into the model's answer.
        feature_list = [
            "Free file tools; server limits apply",
            "No account, email, or sign-up required",
            "No watermarks on output",
            *_processing_features(slug),
            "Open source (MIT license) and self-hostable",
            "Works in any modern browser — no install",
        ]
        # Keyword set drawn from the long description + name + obvious aliases.
        keywords = _keywords_for(slug, name, long_description)

        # SoftwareApplication is more specific than WebApplication and is the
        # recommended type for installable / web-based file tools per Google's
        # rich-results docs.
        #
        # `lastReviewed` and `dateModified` come from the registry's own
        # `lastReviewed` field through the build manifest (not date.today()),
        # with TOOL_LAST_REVIEWED as the no-manifest fallback, so freshness
        # signals are honest and don't get devalued by Google for inflation.
        reviewed = _last_reviewed_for(slug)
        graph: list[dict] = [
            {
                "@type": "WebPage",
                "@id": f"{canonical_url}#webpage",
                "url": canonical_url,
                "name": title,
                "description": description,
                "inLanguage": "en",
                "isPartOf": {"@id": f"{BASE_URL}/#website"},
                "primaryImageOfPage": {
                    "@type": "ImageObject",
                    "url": f"{BASE_URL}/api/og-image?p={quote(path)}",
                    "width": 1200,
                    "height": 630,
                },
                "datePublished": "2026-03-15",
                "dateModified": reviewed,
                "lastReviewed": reviewed,
                "reviewedBy": {"@id": f"{BASE_URL}/#organization"},

                "mainEntity": {"@id": f"{canonical_url}#app"},
            },
            {
                "@type": "SoftwareApplication",
                "@id": f"{canonical_url}#app",
                "name": f"{name} — PrivaTools",
                "alternateName": _aliases_for(slug, name),
                "url": canonical_url,
                "description": long_description or description,
                "image": f"{BASE_URL}/api/og-image?p={quote(path)}",
                "applicationCategory": category,
                "applicationSubCategory": _application_subcategory_for(slug, is_pdf_tool),
                "featureList": feature_list,
                "keywords": ", ".join(keywords),
                "operatingSystem": "Web Browser (any)",
                "browserRequirements": "Requires JavaScript and a modern browser (Chrome, Firefox, Safari, Edge).",
                "isAccessibleForFree": True,
                "permissions": "No permissions required",
                "softwareVersion": "1.5",
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock",
                    "category": "Free",
                },
                "provider": {"@id": f"{BASE_URL}/#organization"},
                "creator": {
                    "@type": "Organization",
                    "name": "PrivaTools",
                    "url": BASE_URL,
                    "sameAs": ["https://github.com/ethereaglehq/privatools"],
                },
                "datePublished": "2026-03-15",
                "dateModified": reviewed,
                "inLanguage": "en",
            },
            {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
        ]
        if slug in TOOL_HOWTO:
            steps_count = len(TOOL_HOWTO[slug])
            # Rough estimate: each step ~30s of read+do time. Tools that
            # involve waiting on a long server roundtrip (OCR, summarize,
            # remove-bg) get a generous 90s/step.
            slow_tools = {"ocr-pdf", "summarize-pdf", "remove-background", "smart-redact", "compress-video", "video-converter", "extract-audio", "audio-converter", "video-to-gif", "video-merge"}
            per_step = 90 if slug in slow_tools else 30
            graph.append({
                "@type": "HowTo",
                "name": _howto_name_for(name),
                "description": long_description or description,
                "totalTime": f"PT{steps_count * per_step}S",
                "image": f"{BASE_URL}/api/og-image?p={quote(path)}",
                "supply": [{"@type": "HowToSupply", "name": "Your file"}],
                "tool": [{"@type": "HowToTool", "name": "Web browser (Chrome, Firefox, Safari, Edge)"}],
                "step": [
                    {
                        "@type": "HowToStep",
                        "position": i + 1,
                        "name": step["name"],
                        "text": step["text"],
                        "url": f"{canonical_url}#step-{i + 1}",
                    }
                    for i, step in enumerate(TOOL_HOWTO[slug])
                ],
            })
        if slug in TOOL_FAQ:
            graph.append({
                "@type": "FAQPage",

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
        entry = _comparisons().get(path[len("/compare/"):])
        if entry is None:
            return None
        breadcrumbs.extend([
            {"@type": "ListItem", "position": 2, "name": "Compare", "item": f"{BASE_URL}/compare"},
            {"@type": "ListItem", "position": 3, "name": title, "item": canonical_url},
        ])
        article = {
            "@type": "Article", "@id": f"{canonical_url}#article",
            "headline": title, "description": description, "url": canonical_url,
            "image": f"{BASE_URL}/api/og-image?p={quote(path)}", "inLanguage": "en",
            "author": _organization(), "publisher": _organization(),
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical_url},
        }
        if reviewed := _reviewed_date(entry):
            article["dateModified"] = reviewed
        if sources := _sources(entry):
            article["citation"] = [source["url"] for source in sources]
        return {"@context": "https://schema.org", "@graph": [article,
            {"@type": "BreadcrumbList", "itemListElement": breadcrumbs}]}

    if path.startswith("/blog/"):
        post = _blog_posts().get(path[len("/blog/"):])
        if post is None:
            return None
        breadcrumbs.extend([
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": f"{BASE_URL}/blog"},
            {"@type": "ListItem", "position": 3, "name": post["title"], "item": canonical_url},
        ])
        article = {
            "@type": "BlogPosting", "@id": f"{canonical_url}#article",
            "headline": post["title"], "description": description, "url": canonical_url,
            "image": f"{BASE_URL}/api/og-image?p={quote(path)}", "inLanguage": "en",
            "articleSection": "Blog", "keywords": ", ".join(post.get("tags", [])),
            "author": _organization(), "publisher": _organization(),
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical_url},
        }
        if published := post.get("publishedAt") or post.get("date"):
            article["datePublished"] = published
        if reviewed := _reviewed_date(post):
            article["dateModified"] = reviewed
        if sources := _sources(post):
            article["citation"] = [source["url"] for source in sources]
        body = unescape(re.sub(r"<[^>]*>", " ", post.get("body") or ""))
        if body.strip():
            article["wordCount"] = len(re.findall(r"\w+", body))
        return {"@context": "https://schema.org", "@graph": [article,
            {"@type": "BreadcrumbList", "itemListElement": breadcrumbs}]}

    if path == "/blog":
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": "Blog", "item": canonical_url})
        blog_items = []
        for i, (slug, post) in enumerate(_blog_posts().items(), start=1):
            blog_items.append({
                "@type": "ListItem",
                "position": i,
                "url": f"{BASE_URL}/blog/{slug}",
                "name": post["title"],
            })
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "Blog",
                    "@id": f"{canonical_url}#blog",
                    "name": "PrivaTools Blog",
                    "description": description,
                    "url": canonical_url,
                    "inLanguage": "en",
                    "publisher": {"@type": "Organization", "name": "PrivaTools", "url": BASE_URL, "logo": {"@type": "ImageObject", "url": BRAND_LOGO_URL}},
                    "blogPost": [
                        {
                            "@type": "BlogPosting",
                            "headline": p["title"],
                            "description": p["description"],
                            "url": f"{BASE_URL}/blog/{s}",
                            "dateModified": _reviewed_date(p),
                            "author": _organization(),
                        }
                        for s, p in _blog_posts().items()
                    ],
                },
                {
                    "@type": "ItemList",
                    "name": "PrivaTools Blog Posts",
                    "numberOfItems": len(_blog_posts()),
                    "itemListElement": blog_items,
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path == "/about":
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": "About", "item": canonical_url})
        about_faqs = [
            {
                "q": "Who runs PrivaTools?",
                "a": "PrivaTools is an open-source project under the MIT license — see the code on GitHub at ethereaglehq/privatools. The public demo at privatools.me is maintained by independent contributors and funded by no advertisers, investors, or data brokers.",
            },
            {
                "q": "What happens to files I upload?",
                "a": "Server tools use temporary input and output files, removed after the response completes. Periodic cleanup handles leftovers. Browser tools keep input on the device; optional AI provider connections send the disclosed input directly to that provider. Read the selected tool’s processing notice.",
            },
            {
                "q": "Is PrivaTools really free?",
                "a": "File tools are free to use without an account. Server rate, upload, and capacity limits apply. Developer API keys have quotas, and optional AI providers may charge your account.",
            },
            {
                "q": "Can I self-host PrivaTools?",
                "a": "Yes. The full stack is MIT-licensed and ships as a Docker Compose project. Clone the repo and run docker compose up --build to host the whole thing on your own server.",
            },
            {
                "q": "What's the difference between PrivaTools and Smallpdf, iLovePDF, or Adobe?",
                "a": "PrivaTools offers free guest file tools and an open-source, self-hostable codebase. Review our dated comparison pages and their source links to choose an appropriate workflow.",
            },
        ]
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "AboutPage",
                    "@id": f"{canonical_url}#about",
                    "name": title,
                    "description": description,
                    "url": canonical_url,
                    "inLanguage": "en",
                    "isPartOf": {"@id": f"{BASE_URL}/#website"},
                    "about": {"@id": f"{BASE_URL}/#organization"},
                    "mainEntity": {"@id": f"{BASE_URL}/#organization"},

                },
                {
                    "@type": "FAQPage",
                    "mainEntity": [
                        {
                            "@type": "Question",
                            "name": faq["q"],
                            "acceptedAnswer": {"@type": "Answer", "text": faq["a"]},
                        }
                        for faq in about_faqs
                    ],
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path in ("/privacy", "/terms"):
        page_name = "Privacy Policy" if path == "/privacy" else "Terms of Service"
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": page_name, "item": canonical_url})
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebPage",
                    "@id": f"{canonical_url}#webpage",
                    "name": title,
                    "description": description,
                    "url": canonical_url,
                    "inLanguage": "en",
                    "isPartOf": {"@id": f"{BASE_URL}/#website"},
                    "datePublished": "2026-03-15",
                    "dateModified": "2026-09-24" if path == "/privacy" else "2026-03-29",
                    "publisher": {"@type": "Organization", "name": "PrivaTools", "url": BASE_URL, "logo": {"@type": "ImageObject", "url": BRAND_LOGO_URL}},
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path in ("/pipeline", "/batch"):
        page_name = "Pipeline" if path == "/pipeline" else "Batch"
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": page_name, "item": canonical_url})
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": ["WebPage", "WebApplication"],
                    "@id": f"{canonical_url}#webapp",
                    "name": title,
                    "description": description,
                    "url": canonical_url,
                    "inLanguage": "en",
                    "isPartOf": {"@id": f"{BASE_URL}/#website"},
                    "applicationCategory": "BusinessApplication",
                    "operatingSystem": "Any (browser-based)",
                    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                    "publisher": {"@type": "Organization", "name": "PrivaTools", "url": BASE_URL, "logo": {"@type": "ImageObject", "url": BRAND_LOGO_URL}},
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path == "/compare":
        breadcrumbs.append({"@type": "ListItem", "position": 2, "name": "Compare", "item": canonical_url})
        compare_items = []
        for i, (cslug, cdata) in enumerate(_comparisons().items(), start=1):
            compare_items.append({
                "@type": "ListItem",
                "position": i,
                "url": f"{BASE_URL}/compare/{cslug}",
                "name": f"PrivaTools vs {cdata['name']}",
            })
        return {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "CollectionPage",
                    "@id": f"{canonical_url}#collection",
                    "name": title,
                    "description": description,
                    "url": canonical_url,
                    "inLanguage": "en",
                    "isPartOf": {"@id": f"{BASE_URL}/#website"},
                },
                {
                    "@type": "ItemList",
                    "name": "PrivaTools competitor comparisons",
                    "numberOfItems": len(_comparisons()),
                    "itemListElement": compare_items,
                },
                {"@type": "BreadcrumbList", "itemListElement": breadcrumbs},
            ],
        }

    if path in _STATIC_META and path not in NOINDEX_PATHS:
        return {"@context": "https://schema.org", "@graph": [{
            "@type": "WebPage", "@id": canonical_url + "#webpage", "url": canonical_url,
            "name": title, "description": description, "inLanguage": "en", "publisher": _organization(),
        }]}
    return None


# ---------------------------------------------------------------------------
# Comparison page data (mirrors frontend ComparePage.tsx for SSR)
# ---------------------------------------------------------------------------
_TOTAL_TOOL_COUNT = len(_PDF_TOOLS) + len(_NONPDF_TOOLS)
_TOOL_BREADTH_FEATURE = f"{_TOTAL_TOOL_COUNT} tools (PDF, image, video, audio, dev)"

_PRIVATOOLS_FEATURES: dict[str, str] = {
    "Free to use": "Yes — 100% free",
    "No account required": "Yes",
    "Upload limits": "Default server limit 500 MB; tool-specific limits may be lower",
    "No ads": "Yes",
    "Open source": "Yes (MIT license)",
    "Self-hostable": "Yes (Docker)",
    "Processing": "Browser-local, temporary server processing, or optional direct AI provider connection",
    "No watermarks on free tier": "Yes",
    _TOOL_BREADTH_FEATURE: f"Yes ({_TOTAL_TOOL_COUNT} tools)",
    "Works offline / client-side tools": "Some tools (client-side)",
    "Desktop app included": "No (web-based)",
    "API available": "Key-authenticated hosted API and self-hosting",
    "E-signatures": "Yes (free)",
    "JSON-LD structured data": "Yes",
}

_COMPARE_DATA: dict[str, dict] = {'ilovepdf': {'name': 'iLovePDF', 'title': 'PrivaTools vs iLovePDF', 'description': 'Compare PrivaTools and iLovePDF for your file workflow.', 'features': [], 'sources': []}, 'smallpdf': {'name': 'Smallpdf', 'title': 'PrivaTools vs Smallpdf', 'description': 'Compare PrivaTools and Smallpdf for your file workflow.', 'features': [], 'sources': []}, 'adobe-acrobat': {'name': 'Adobe Acrobat Online', 'title': 'PrivaTools vs Adobe Acrobat Online', 'description': 'Compare PrivaTools and Adobe Acrobat Online for your file workflow.', 'features': [], 'sources': []}, 'sejda': {'name': 'Sejda PDF', 'title': 'PrivaTools vs Sejda PDF', 'description': 'Compare PrivaTools and Sejda PDF for your file workflow.', 'features': [], 'sources': []}, 'tinywow': {'name': 'TinyWow', 'title': 'PrivaTools vs TinyWow', 'description': 'Compare PrivaTools and TinyWow for your file workflow.', 'features': [], 'sources': []}, 'ihatepdf': {'name': 'ihatepdf.cv', 'title': 'PrivaTools vs ihatepdf.cv', 'description': 'Compare PrivaTools and ihatepdf.cv for your file workflow.', 'features': [], 'sources': []}, 'pdf24': {'name': 'PDF24', 'title': 'PrivaTools vs PDF24', 'description': 'Compare PrivaTools and PDF24 for your file workflow.', 'features': [], 'sources': []}, 'foxit': {'name': 'Foxit PDF', 'title': 'PrivaTools vs Foxit PDF', 'description': 'Compare PrivaTools and Foxit PDF for your file workflow.', 'features': [], 'sources': []}, 'lightpdf': {'name': 'LightPDF', 'title': 'PrivaTools vs LightPDF', 'description': 'Compare PrivaTools and LightPDF for your file workflow.', 'features': [], 'sources': []}, 'stirling-pdf': {'name': 'Stirling PDF', 'title': 'PrivaTools vs Stirling PDF', 'description': 'Compare PrivaTools and Stirling PDF for your file workflow.', 'features': [], 'sources': []}, 'dochub': {'name': 'DocHub', 'title': 'PrivaTools vs DocHub', 'description': 'Compare PrivaTools and DocHub for your file workflow.', 'features': [], 'sources': []}, 'pdfescape': {'name': 'PDFescape', 'title': 'PrivaTools vs PDFescape', 'description': 'Compare PrivaTools and PDFescape for your file workflow.', 'features': [], 'sources': []}, 'nitro-pdf': {'name': 'Nitro PDF', 'title': 'PrivaTools vs Nitro PDF', 'description': 'Compare PrivaTools and Nitro PDF for your file workflow.', 'features': [], 'sources': []}}


def _tool_page_body(slug: str, name: str, desc: str, registry: dict, prefix: str, related_heading: str) -> str:
    """Build the SSR body shared by /tool/<slug> and /tools/<slug> pages.

    `registry` and `prefix` feed `_related_tools` (same-category candidates
    and the href prefix); `related_heading` is the only visible-text
    difference between the PDF and non-PDF branches.

    Every interpolated value is hand-written editorial prose (TOOL_HOWTO,
    TOOL_FAQ) or a tool/post name — both have contained literal `<tag>`
    examples and a bare `&`, which would otherwise render as real (broken)
    markup instead of visible text. `escape()` everywhere, including href
    attribute values built from already-validated slugs: harmless, and one
    less thing to prove safe by other means. The JSON-LD emitted elsewhere
    for the same content is untouched by this — it's JSON, not HTML.
    """
    parts: list[str] = []
    parts.append(f"<h1>{escape(_tool_seo_fields(slug).get('seoTitle') or name)}</h1>")
    short = _tool_registry_short_description(slug) or desc
    parts.append(f'<p class="tool-summary">{escape(short)}</p>')
    parts.append(f'<p class="tool-intro">{escape(desc)}</p>')
    if slug in TOOL_HOWTO:
        parts.append(f'<section class="tool-steps"><h2>{escape(_howto_name_for(name))}</h2><ol>')
        for i, step in enumerate(TOOL_HOWTO[slug]):
            # id="step-N" matches the JSON-LD HowToStep.url anchor (#step-N) below.
            parts.append(f'<li id="step-{i + 1}"><strong>{escape(step["name"])}</strong> {escape(step["text"])}</li>')
        parts.append("</ol></section>")
    if slug in TOOL_FAQ:
        parts.append(f'<section class="tool-faq"><h2>Questions about {escape(name)}</h2>')
        for faq in TOOL_FAQ[slug]:
            parts.append(f"<h3>{escape(faq['q'])}</h3><p>{escape(faq['a'])}</p>")
        parts.append("</section>")
    mentioning_posts = _tool_to_blogs().get(slug, [])
    if mentioning_posts:
        parts.append('<section class="tool-guides"><h2>Mentioned in our guides</h2><ul>')
        for post in mentioning_posts:
            parts.append(f'<li><a href="/blog/{escape(post["slug"], quote=True)}">{escape(post["title"])}</a></li>')
        parts.append("</ul></section>")
    related = _related_tools(slug, registry, prefix)
    if related:
        parts.append(f'<section class="tool-related"><h2>{escape(related_heading)}</h2><ul>')
        for related_slug, related_name, href in related:
            parts.append(f'<li><a href="{escape(href, quote=True)}">{escape(related_name)}</a></li>')
        parts.append("</ul></section>")
    reviewed = _last_reviewed_for(slug)
    parts.append(
        f'<p class="meta-trust"><em>Last reviewed {escape(reviewed)} by the PrivaTools maintainers. '
        f'Source code on <a href="https://github.com/ethereaglehq/privatools" rel="author">GitHub</a> '
        f'(MIT-licensed, self-hostable).</em></p>'
    )
    return "\n".join(parts)


def _strings(entry: dict, field: str) -> list[str]:
    values = entry.get(field) or []
    return [value for value in values if isinstance(value, str) and value.strip()] if isinstance(values, list) else []


def _comparison_body(entry: dict) -> str:
    """The detail comparison in the order ComparePage.tsx renders it.

    Every string is editorial data from frontend/src/data/comparisons.ts via
    compare-content.json, so all of it is escaped. Competitor facts carry
    their own official source link beside the row they support.
    """
    name = entry["name"]
    parts: list[str] = []
    if reviewed := _reviewed_date(entry):
        parts.append(f'<p>By PrivaTools · Facts about {escape(name)} checked on <time datetime="{reviewed}">{reviewed}</time> '
                     'against its official pages, which are listed under Sources and linked beside each row of the '
                     'side-by-side table.</p>')
    if summary := entry.get("summary"):
        parts.append(f"<h2>Where each one fits</h2><p>{escape(summary)}</p>")
    if overview := _strings(entry, "overview"):
        parts.append(f"<h2>About {escape(name)}</h2>" + "".join(f"<p>{escape(text)}</p>" for text in overview))
    features = [feature for feature in entry.get("features") or [] if isinstance(feature, dict)]
    if features:
        parts.append(f'<h2>{escape(name)} and PrivaTools side by side</h2><table><thead><tr><th scope="col">Topic</th>'
                     f'<th scope="col">PrivaTools</th><th scope="col">{escape(name)}</th></tr></thead><tbody>')
        for feature in features:
            source = feature.get("sourceUrl") or ""
            citation = f' <a href="{escape(source, quote=True)}">Source</a>' if source.startswith(("https://", "http://")) else ""
            parts.append(f'<tr><th scope="row">{escape(feature.get("label", ""))}</th><td>{escape(feature.get("privatools", ""))}</td>'
                         f'<td>{escape(feature.get("competitor", ""))}{citation}</td></tr>')
        parts.append("</tbody></table>")
    for section in entry.get("sections") or []:
        if isinstance(section, dict) and isinstance(section.get("heading"), str):
            parts.append(f'<h2>{escape(section["heading"])}</h2>' + "".join(f"<p>{escape(text)}</p>" for text in _strings(section, "body")))
    for field, heading in (("chooseCompetitor", f"Choose {name} when…"),
                           ("choosePrivaTools", "Choose PrivaTools when…"),
                           ("tradeoffs", "Before you decide")):
        if values := _strings(entry, field):
            parts.append(f"<h2>{escape(heading)}</h2><ul>" + "".join(f"<li>{escape(value)}</li>" for value in values) + "</ul>")
    links = [link for link in entry.get("relatedLinks") or []
             if isinstance(link, dict) and isinstance(link.get("url"), str) and link["url"].startswith("/") and not link["url"].startswith("//")]
    if links:
        parts.append("<h2>Related PrivaTools tools and guides</h2><ul>" + "".join(
            f'<li><a href="{escape(link["url"], quote=True)}">{escape(link.get("label") or link["url"])}</a></li>' for link in links) + "</ul>")
    parts.append(_source_html(entry))
    return "\n".join(part for part in parts if part)


def _comparison_directory_body() -> str:
    """/compare: every comparison with the points that set it apart, grouped by workflow."""
    entries = _comparisons()
    groups: dict[str, list[tuple[str, dict]]] = {}
    for cslug, cdata in entries.items():
        groups.setdefault(str(cdata.get("category") or "More comparisons"), []).append((cslug, cdata))
    reviewed = sorted(filter(None, (_reviewed_date(cdata) for cdata in entries.values())))
    parts = [
        "<p>Each comparison sets PrivaTools beside one product and answers practical questions such as what it costs, "
        "which limits apply to free and paid use, where your files are processed, whether you need an account and "
        "which platforms it runs on. Every fact about another product comes from its own official pages. Each row of "
        "a comparison's side-by-side table links its source, every comparison lists all the pages it used, and each "
        "one says when to choose that product and when to choose PrivaTools.</p>",
    ]
    if reviewed:
        parts.append(f'<p>Most recent check: <time datetime="{reviewed[-1]}">{reviewed[-1]}</time>.</p>')
    for category, rows in groups.items():
        parts.append(f"<h2>{escape(category)}</h2><ul>")
        for cslug, cdata in sorted(rows, key=lambda row: str(row[1].get("name", row[0])).lower()):
            points = "".join(f"<li>{escape(point)}</li>" for point in _strings(cdata, "highlights"))
            parts.append(f'<li><a href="/compare/{escape(cslug, quote=True)}">{escape(cdata["title"])}</a>: '
                         f'{escape(cdata.get("description", ""))}' + (f"<ul>{points}</ul>" if points else "") + "</li>")
        parts.append("</ul>")
    parts.append(
        "<h2>How to read these comparisons</h2><p>We publish PrivaTools, so this is our editorial perspective. Plans, "
        "limits, processing locations and platforms for other products come only from their official pages, checked on "
        "the date each comparison shows; a fact we could not confirm there is left out. Prices appear in the currency "
        "the vendor displayed to us and can differ by country. We did not benchmark speed, output quality or accuracy, "
        "so try a representative file before moving a regular workflow.</p>"
    )
    return "\n".join(parts)


def _build_ssr_content(path: str, title: str, description: str) -> str:
    """
    Build server-rendered HTML content that crawlers (including AI crawlers)
    can read without executing JavaScript.  This content is placed inside
    <div id="root"> so that React hydration replaces it once JS loads.
    """
    _PDF_TOOLS, _NONPDF_TOOLS = _tool_registries()
    parts: list[str] = []

    # ── 404 / unknown route ────────────────────────────────────────────────
    # Render a real "Page not found" body so that HTTP 404 responses don't
    # carry the homepage's title and H1, which Google interprets as a Soft 404.
    if not path_is_known(path):
        parts.append("<h1>Page Not Found</h1>")
        parts.append(
            "<p>The page you requested doesn't exist on PrivaTools. The link "
            "may be outdated or the URL may be typed incorrectly.</p>"
        )
        parts.append('<h2>Try one of these instead</h2>')
        parts.append('<ul>')
        parts.append(f'<li><a href="/">Homepage</a> — browse all {_TOTAL_TOOL_COUNT} free tools</li>')
        parts.append('<li><a href="/tool/merge-pdf">Merge PDF</a></li>')
        parts.append('<li><a href="/tool/compress-pdf">Compress PDF</a></li>')
        parts.append('<li><a href="/tool/pdf-to-word">PDF to Word</a></li>')
        parts.append('<li><a href="/tools/image-compressor">Image Compressor</a></li>')
        parts.append('<li><a href="/tools/jwt-decoder">JWT Decoder</a></li>')
        parts.append('<li><a href="/blog">PrivaTools Blog</a> — guides and comparisons</li>')
        parts.append('<li><a href="/compare">Comparisons</a> — PrivaTools vs iLovePDF, Smallpdf, Adobe, and more</li>')
        parts.append('</ul>')
        return "\n".join(parts)

    # ── Homepage ───────────────────────────────────────────────────────────
    if path == "/":
        parts.append('<h1>PrivaTools — Free, Open-Source File Tools</h1>')
        parts.append(f'<p>Browse {_TOTAL_TOOL_COUNT} tools for PDFs, images, video, audio, archives, and developer tasks. Use file tools without an account. Choose Air or Play and the appearance that feels comfortable for your work.</p>')
        parts.append('<h2>Choose where your files are processed</h2><ul><li>Browser tools keep the input on your device.</li><li>Server tools upload files for temporary processing. Cleanup runs after responses and periodically for leftovers.</li><li>Optional AI providers receive the disclosed input directly when you connect your own key. Local models depend on your device and may need a model download.</li></ul>')
        parts.append('<p>Open source under the MIT license and self-hostable. The hosted service has upload, rate, and capacity limits; developer API keys have separate quotas. Read the <a href="/privacy">privacy policy</a> and <a href="/security">security approach</a> before processing sensitive files.</p>')
        parts.append('<h2><a href="/pipeline">Build a PDF pipeline</a></h2><p>Chain compatible steps such as compression, rotation, and metadata removal. Save a recipe in this browser or share its tool sequence without including your file.</p>')
        parts.append('<h2><a href="/batch">Process a batch</a></h2><p>Apply a supported operation to several files, review individual results, and download completed outputs together.</p>')
        parts.append('<p><a href="/tools">Browse all tools</a> · <a href="/ai">AI Studio</a> · <a href="/api">Developer API</a> · <a href="/blog">Practical guides</a> · <a href="/compare">Compare options</a></p>')
        parts.append("<h2>PDF Tools</h2><ul>")
        for slug, (name, desc) in _by_popularity(_PDF_TOOLS.items()):
            parts.append(f'<li><a href="/tool/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        parts.append("<h2>Image, Video & Developer Tools</h2><ul>")
        for slug, (name, desc) in _by_popularity(_NONPDF_TOOLS.items()):
            parts.append(f'<li><a href="/tools/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        # FAQ section so the JSON-LD FAQPage above has matching visible content.
        parts.append('<h2 class="tool-faq">Frequently Asked Questions</h2>')
        for q, a in _HOME_FAQ:
            parts.append(f"<h3>{q}</h3><p>{a}</p>")
        return "\n".join(parts)

    if path == "/tools":
        parts.append("<h1>All Free Online Tools</h1>")
        parts.append('<p><a href="/">PrivaTools</a> &rsaquo; All Tools</p>')
        parts.append(
            f"<p>Every one of the {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)} PrivaTools utilities, grouped by category. "
            "Free and open source under the MIT license. File tools need no account; server limits and developer API quotas apply. "
            "Browser-only where possible; server tools process files in temporary storage and remove them "
            "after the response, with a background sweep for leftovers.</p>"
        )
        parts.append(f"<h2>PDF Tools ({len(_PDF_TOOLS)})</h2><ul>")
        for slug, (name, desc) in _by_popularity(_PDF_TOOLS.items()):
            parts.append(f'<li><a href="/tool/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        parts.append(f"<h2>Image, Video, Audio &amp; Developer Tools ({len(_NONPDF_TOOLS)})</h2><ul>")
        for slug, (name, desc) in _by_popularity(_NONPDF_TOOLS.items()):
            parts.append(f'<li><a href="/tools/{slug}">{name}</a> — {desc[:120]}</li>')
        parts.append("</ul>")
        parts.append(
            '<p>Looking for guides? Visit the <a href="/blog">PrivaTools blog</a>, or see how PrivaTools '
            '<a href="/compare">compares to iLovePDF, Smallpdf, and Adobe</a>.</p>'
        )
        return "\n".join(parts)

    # ── Individual tool pages (/tool/<slug> and /tools/<slug>) ─────────────
    if path.startswith("/tool/"):
        slug = path[len("/tool/"):]
        if slug in _PDF_TOOLS:
            name, desc = _PDF_TOOLS[slug]
            return _tool_page_body(slug, name, desc, _PDF_TOOLS, "tool", "Related PDF Tools")

    if path.startswith("/tools/"):
        slug = path[len("/tools/"):]
        if slug in _NONPDF_TOOLS:
            name, desc = _NONPDF_TOOLS[slug]
            return _tool_page_body(slug, name, desc, _NONPDF_TOOLS, "tools", "Related Tools")

    # ── Compare pages ──────────────────────────────────────────────────────
    if path.startswith("/compare/") or path == "/compare":
        parts.extend([f"<h1>{escape(title)}</h1>", f"<p>{escape(description)}</p>"])
        slug = path[len("/compare/"):] if path.startswith("/compare/") else ""
        entry = _comparisons().get(slug)
        parts.append(_comparison_body(entry) if entry else _comparison_directory_body())
        parts.append('<p><a href="/compare">Compare file tools</a> · <a href="/tools">Browse all PrivaTools tools</a></p>')
        return "\n".join(parts)

    # ── Blog pages ─────────────────────────────────────────────────────────
    if path.startswith("/blog/"):
        slug = path[len("/blog/"):]
        post = _blog_posts().get(slug)
        if post:
            parts.append(f'<h1>{escape(post["title"])}</h1>')
            if post.get("tldr"):
                parts.append(f'<p class="post-tldr">{escape(post["tldr"])}</p>')
            parts.append(f'<p class="post-intro">{escape(post.get("description", ""))}</p>')
            parts.append('<p class="post-meta">By PrivaTools</p>')
            if published := post.get("publishedAt") or post.get("date"):
                parts.append(f'<p>Published: <time datetime="{escape(published)}">{escape(published)}</time></p>')
            if reviewed := _reviewed_date(post):
                parts.append(f'<p>Last reviewed: <time datetime="{reviewed}">{reviewed}</time></p>')
            # HTML is generated from the same source-controlled body as the React page.
            if body := (post.get("body") or "").strip():
                parts.append(f'<article class="post-body">{body}</article>')
            parts.append(_source_html(post))
            related = [TOOL_META[tool] for tool in post.get("relatedTools", []) if tool in TOOL_META]
            if related:
                parts.append('<h2>Tools in this guide</h2><ul>' + ''.join(f'<li><a href="{tool["url_path"]}">{escape(tool["name"])}</a></li>' for tool in related) + '</ul>')
            others = [(s, p) for s, p in _blog_posts().items() if s != slug][:6]
            if others:
                parts.append('<h2>More guides</h2><ul>' + ''.join(f'<li><a href="/blog/{s}">{escape(p["title"])}</a></li>' for s, p in others) + '</ul>')
            return "\n".join(parts)
    elif path == "/blog":
        parts.append('<h1>PrivaTools guides</h1><p>Practical file workflows, processing choices, and comparisons.</p><ul>')
        for slug, post in _blog_posts().items():
            parts.append(f'<li><a href="/blog/{slug}">{escape(post["title"])}</a> — {escape(post.get("description", ""))}</li>')
        parts.append('</ul>')
        return "\n".join(parts)

    # ── About page ─────────────────────────────────────────────────────────
    if path == "/about":
        parts.append("<h1>About PrivaTools</h1>")
        parts.append(
            '<p class="about-tldr"><strong>TL;DR:</strong> '
            "PrivaTools is a free, open-source, privacy-first suite of "
            f"{len(_PDF_TOOLS) + len(_NONPDF_TOOLS)}+ file tools. "
            "MIT-licensed, self-hostable, no account needed, no ads, no data resale. "
            "Files uploaded to the public demo use isolated temporary storage and are deleted on response — "
            "many tools never upload at all.</p>"
        )
        parts.append(f"<p>{description}</p>")
        parts.append("<h2>What PrivaTools is</h2>")
        parts.append(
            f"<p>PrivaTools provides {len(_PDF_TOOLS) + len(_NONPDF_TOOLS)} free online file tools across PDF, "
            "image, video, audio, archive, and developer workflows. The codebase is MIT-licensed and "
            "self-hostable via Docker, so the implementation can be reviewed. The public demo "
            "at privatools.me processes server-side tasks inside an isolated container and deletes the input "
            "the moment the response leaves the server.</p>"
        )
        parts.append("<h2>Frequently Asked Questions</h2>")
        for q, a in [
            ("Who runs PrivaTools?", "PrivaTools is an open-source project under the MIT license — see the code on GitHub at ethereaglehq/privatools. The public demo at privatools.me is maintained by independent contributors, with no advertisers, investors, or data brokers in the picture."),
            ("What happens to files I upload?", "Server tools use temporary input and output files, removed after the response completes. Periodic cleanup handles leftovers. Browser tools keep input on the device; optional AI provider connections send the disclosed input directly to that provider. Read the selected tool’s processing notice."),
            ("Is PrivaTools really free?", "File tools are free to use without an account. Server rate, upload, and capacity limits apply. Developer API keys have quotas, and optional AI providers may charge your account."),
            ("Can I self-host PrivaTools?", "Yes. The full stack is MIT-licensed and ships as a Docker Compose project. Clone the repo and run docker compose up --build to host the whole thing on your own server."),
        ]:
            parts.append(f"<h3>{q}</h3><p>{a}</p>")
        return "\n".join(parts)

    # ── Privacy page ───────────────────────────────────────────────────────
    if path == "/privacy":
        parts.append("<h1>Privacy Policy</h1>")
        parts.append("<p><strong>Last updated:</strong> September 24, 2026</p>")
        parts.append(
            "<p>Browser tools process files on your device. Server tools upload files for temporary processing: "
            "response cleanup removes them, and a background sweep removes files left by interrupted requests. "
            "Google Analytics is on by default and measures public page visits, sessions, engagement, where a "
            "visit came from and each tool run: which tool, how it ran, how many files, whether it succeeded "
            "and, for most failed runs, a fixed failure category (too_large, rate_limited, bad_input, timeout, "
            "server, network, provider or browser), never the error message. It uses pseudonymous browser identifiers "
            "and cookies, and it never receives file contents, filenames, document text or account identity. "
            "Advertising features and Google Signals are off. Turn analytics off at any time with the switch "
            "on this page.</p>"
        )
        parts.append(
            "<p>Page views use canonical page addresses without fragments or query parameters, except the first "
            "page view each time a page loads (when you arrive, open a page in a new tab or reload). That one "
            "keeps any utm_source, utm_medium, utm_campaign, utm_term and utm_content campaign tags in its "
            "address whose value has at most 64 characters, all of them letters, digits, spaces or . _ ~ -, "
            "with fewer than 9 digits and no unbroken run of 16 or more characters that mixes letters and "
            "digits, rules meant to keep out phone numbers, identifiers and tokens. It also records where you "
            "came from: another site or app by its origin only, for example https://www.google.com/, never the "
            "page you came from there or your search terms, and nothing when the address names only a private "
            "host (an IP address, localhost or a name without a dot). When the page was opened from another "
            "public PrivaTools page, for example through a link opened in a new tab, it records that page's "
            "address without its query, and so does a reload of the page. "
            "Every other query parameter is removed. Browsers that identify themselves as automated "
            "(navigator.webdriver) or headless (a HeadlessChrome or PhantomJS user agent) do not load Google "
            "Analytics at all.</p>"
        )
        parts.append("<h2>1. Files You Upload</h2>")
        parts.append(
            "<p>Server-side tools (Merge, Compress, OCR, etc.) hold your file in isolated temporary storage "
            "for the duration of processing. The moment the response is delivered, the file is "
            "unlinked from the temp directory; a periodic cleanup task handles leftover temporary files. "
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
            "<p>No account needed, no behavioural profiling, no advertising cookies, "
            "no remarketing audiences, no session recordings, no file metadata, no canvas / browser "
            "fingerprints. Google Analytics, on by default and switchable off on this page, receives technical connection and browser data, but never file contents, filenames, error messages, account identity, passwords, or API keys. Advertising features are disabled.</p>"
        )
        parts.append("<h2>4. Open Source &amp; Self-Hosting</h2>")
        parts.append(
            "<p>The entire stack is MIT-licensed at "
            "<a href='https://github.com/ethereaglehq/privatools'>github.com/ethereaglehq/privatools</a>. "
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
            "and developer workflows. Server-side tools use isolated temporary storage and remove "
            "files after the response, with a background sweep for leftovers. Many tools run entirely "
            "in your browser with no server interaction. Free to use with fair-use limits; the tools "
            "need no registration.</p>"
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


_ROOT_OPEN_RE = re.compile(r'<div\s+id=(["\'])root\1\s*>')
_DIV_TAG_RE = re.compile(r"<(/?)div\b[^>]*>", re.IGNORECASE)


def _inject_into_root(html: str, ssr_content: str) -> str:
    """Replace the inner content of <div id="root"> with server-rendered HTML.

    Finds root's matching </div> by counting <div>/</div> nesting, so it works
    no matter what the build puts INSIDE root (a pre-hydration brand shell) or
    AFTER it (an HTML comment, a hoisted module <script>, an inline <script>).

    History: two earlier regex-anchored versions broke in production because the
    BUILT frontend/dist/index.html differs from the SOURCE frontend/index.html —
    Vite hoists the entry module script into <head> and an HTML comment, not the
    module script, follows root. Balanced matching does not depend on any of
    that. React replaces #root's children on mount, so this stays hydration-safe.
    """
    m = _ROOT_OPEN_RE.search(html)
    if not m:
        return html
    depth = 1
    for tag in _DIV_TAG_RE.finditer(html, m.end()):
        depth += -1 if tag.group(1) else 1
        if depth == 0:
            return f'{html[:m.start()]}<div id="root">{ssr_content}</div>{html[tag.end():]}'
    return html  # unbalanced markup — leave the document untouched rather than corrupt it


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

    # Robots directive — for unknown paths, force noindex,nofollow so 404 URLs
    # never get indexed. Real pages keep the index.html default
    # (index,follow,max-image-preview:large).
    if not path_is_known(path):
        html = _ensure_meta(html, 'name="robots"', "noindex,nofollow")
    elif path.rstrip("/") in NOINDEX_PATHS:
        html = _ensure_meta(html, 'name="robots"', "noindex,follow")

    # Replace <title>
    html = re.sub(r"<title>[^<]*</title>", lambda _match: f"<title>{t}</title>", html, count=1)

    # Update meta description
    html = _set_meta(html, 'name="description"', d)

    # Update OG tags. og:type swaps from "website" (homepage) to "article"
    # for blog posts and compare pages so social-card crawlers (Twitter,
    # LinkedIn, Slack) render the larger article preview.
    html = _set_meta(html, 'property="og:title"', t)
    html = _set_meta(html, 'property="og:description"', d)
    html = _set_meta(html, 'property="og:url"', u)
    og_type = "article" if (path.startswith("/blog/") and path != "/blog") or path.startswith("/compare/") else "website"
    html = _set_meta(html, 'property="og:type"', og_type)

    # Update Twitter tags
    html = _set_meta(html, 'name="twitter:title"', t)
    html = _set_meta(html, 'name="twitter:description"', d)

    # Update / add canonical — but NEVER self-canonicalize an unknown/404 URL.
    # A 404 page that points its canonical at itself is the classic Soft-404
    # trigger; for unknown paths we strip the canonical entirely and rely on
    # the noindex,nofollow set above.
    if path_is_known(path) and path.rstrip("/") not in NOINDEX_PATHS:
        if 'rel="canonical"' in html:
            html = re.sub(r'<link rel="canonical"[^>]*/?\s*>', f'<link rel="canonical" href="{u}" />', html, count=1)
        else:
            html = html.replace("</head>", f'  <link rel="canonical" href="{u}" />\n</head>', 1)
    elif 'rel="canonical"' in html:
        html = re.sub(r'\s*<link rel="canonical"[^>]*/?\s*>', "", html, count=1)

    # Dynamic OG + Twitter image — both point to the same generated PNG.
    # Twitter requires twitter:image to be set separately, even though it
    # falls back to og:image when missing — explicit is more reliable on
    # LinkedIn and Slack previewers as well.
    og_image_url = esc(f"{BASE_URL}/api/og-image?p={quote(path)}")
    html = _set_meta(html, 'property="og:image"', og_image_url)
    html = _ensure_meta(html, 'name="twitter:image"', og_image_url)
    # Image alt text is a legitimate accessibility + AI-discovery signal.
    html = _ensure_meta(html, 'property="og:site_name"', 'PrivaTools')
    html = _ensure_meta(html, 'property="og:image:alt"', t)
    html = _ensure_meta(html, 'name="twitter:image:alt"', t)

    # Inject JSON-LD structured data
    jsonld = get_jsonld_for_path(path)
    if jsonld:
        jsonld_tag = f'<script type="application/ld+json" id="jsonld-seo">{json.dumps(jsonld, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")}</script>'
        html = html.replace("</head>", f"  {jsonld_tag}\n</head>", 1)

    # Inject SSR content into <div id="root"> so crawlers see real content.
    # React replaces #root's children on mount, so this is hydration-safe.
    ssr_content = _build_ssr_content(path, title, description)
    if ssr_content:
        html = _inject_into_root(html, ssr_content)

    return html


def _set_meta(html: str, attr: str, value: str) -> str:
    """Update the content attribute of a meta tag identified by `attr`."""
    pattern = rf'(<meta\s+{re.escape(attr)}\s+content=")[^"]*(")'
    replacement = lambda match: match[1] + value + match[2]
    new_html, n = re.subn(pattern, replacement, html, count=1)
    if n == 0:
        # Also try reversed attribute order: content="..." name="..."
        pattern2 = rf'(<meta\s+content=")[^"]*("\s+{re.escape(attr)}[^>]*>)'
        new_html, n2 = re.subn(pattern2, replacement, html, count=1)
        return new_html if n2 else html
    return new_html


def _ensure_meta(html: str, attr: str, value: str) -> str:
    """Update meta tag if present; otherwise inject before </head>.

    Used for tags that may not be in the static index.html template (e.g.
    og:image:alt, twitter:image:alt) — they should still ship for every
    SSR response so social-card crawlers and AI engines see the alt text.
    """
    updated = _set_meta(html, attr, value)
    if updated != html or re.search(rf'<meta\b[^>]*{re.escape(attr)}(?=\s|/?>)', html):
        return updated
    # Tag was missing — inject a fresh one. Value is already HTML-escaped by
    # the caller via esc().
    tag = f'<meta {attr} content="{value}" />'
    return html.replace("</head>", f"  {tag}\n</head>", 1)
