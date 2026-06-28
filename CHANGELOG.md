# Changelog

All notable changes to PrivaTools will be documented in this file.

## [Unreleased] — Security, reliability & trust hardening

### Security
- **SSRF closed on the URL→PDF tools.** url-to-pdf and html-to-pdf now SSRF-validate every WeasyPrint sub-resource and re-validate HTTP redirects, so an attacker-supplied page can no longer pull cloud-metadata or internal hosts into a rendered PDF.

### Reliability
- **Heavy work runs off the event loop.** ~100 route handlers (PDF/image/video processing plus ffmpeg/tesseract subprocesses) now offload to a threadpool, so one large job no longer freezes a worker for every other request.
- Closed pikepdf/Pillow resource leaks; an empty-PDF booklet now returns a friendly 400.

### Infrastructure & supply chain
- Runtime container hardened: loopback-only bind, `cap_drop: ALL`, `no-new-privileges`, real memory/CPU/PID caps, and `--proxy-headers` for correct client IPs behind nginx.
- All GitHub Actions pinned to commit SHAs (OpenSSF Scorecard).
- Auto-deploy gained an opt-in release-tag gate so an unreviewed push to `main` no longer ships to prod automatically.
- Removed the dead `backend/requirements.txt` mirror; `.env.example` domains and upload limit aligned with the live `privatools.me` / 500 MB config.

### Note on tool count
- Current total is **213** tools (PDF + image + video/audio + dev + archive). The "179"/"total now 179" figures in the historical entries below predate the Phase-2 tool slices and are kept for historical accuracy.

## [1.5.2] — 2026-05-20 — Workshop UI overhaul + production hardening

### Frontend

- Workshop UI overhaul completed: ~180 files now use signal-green § / Fraunces / corner-marks aesthetic
- `friendlyError` + Cmd+Enter + `<kbd>⌘↵</kbd>` hint backfilled across all 68 stateful tool-UIs (was 39)
- Sticky reading-progress + TOC on blog/legal pages with hand-rolled rAF smooth-scroll
- Inline synonyms on all 179 tools (powers Cmd+K fuzzy search)
- PDF.js + Hugging Face Transformers now truly lazy-loaded
- Removed dead `@tanstack/react-query` and `EditorialMasthead`/`EditorialFooter` imports
- Multi-file support on 12 tools via shared `useMultiFileProcessor` + queue + pure-JS STORE-mode zip writer (`lib/zip.ts`)
- **ErrorBoundary** (class component, 208 LOC) wrapping app root AND each tool — one tool's render crash no longer white-screens the shell. Workshop-styled fallback + Reload/Go-home buttons + dev-only stack trace.
- **ToolSkeleton** suspense fallback replaces the blank-screen lazy-chunk load
- **useFocusTrap** hook + applied to NameDialog (PipelinePage); ShortcutsHelp/OnboardingTour/CommandPalette already had complete focus traps from earlier rounds
- Memory-leak audit: 6 fixes (object-URL revokes via `downloadBlob` helper in MarkdownHtmlUI + CsvJsonUI; stale-closure unmount cleanup in MergeImagesUI + ImageCompressorUI; AbortController unmount aborts on PipelinePage + BatchPage). Full inventory: 100 `addEventListener`, 8 rAF, 25 setTimeout, 22 object URLs — all paired with cleanup.
- Persistence: useFormPersist (400ms debounced localStorage envelope), useOnline, useGlobalErrorHandler, BatchResumeBanner for crash recovery
- Service worker: SWR app shell + last-10-tool-routes cache + `/api/*` bypass; CACHE_VERSION = "v1.5.0"
- First-run welcome card + sample files (`public/samples/`) + first-success toast
- 12 new keyframe animations (copy-flash, dragging, queue-row-enter, processing-pulse, dropzone-landed, button-press-ring, underline-reveal, toc-rail-marker) — all respect `prefers-reduced-motion`

### Backend

- 12 typed exceptions matching frontend `friendlyError` patterns (PdfEncryptedError, PageRangeError, FileTooLargeError, ToolTimeoutError, ExternalToolError, …)
- N-up orientation parameter (side / stack)
- QR code FG/BG colors + logo embed
- Create-ZIP compression level (0–9)
- Round 1 security: XXE (defusedxml), zip-slip, SSRF, command-injection, path-traversal
- **Round 2 security**: CRLF/header injection in 21 routes via centralized `safe_stem`/`safe_header_filename` helpers; MIME magic-byte validation (PNG/JPEG/GIF/BMP/TIFF/WEBP/HEIC + ZIP); tempfile race fixed (atomic `mkstemp` w/ 0600 perms); SSRF expanded to CGNAT, TEST-NET, IPv6 link-local, IPv4-mapped, IPv6-translation ranges; cache-control `no-store` on every `/api/*` dynamic output; ReDoS fix in phase7 timestamp regex; `TrustedHostMiddleware` with env-driven allowlist
- **Resource caps**: `Image.MAX_IMAGE_PIXELS = 150M` (decompression-bomb guard) + `DecompressionBombError` → 413 handler; tesseract timeout 90s; ffmpeg/LibreOffice/Ghostscript subprocess timeouts verified; per-IP rate limiting via slowapi (`@limiter.limit("5/minute")`) on `/api/ocr`, `/api/smart-redact`, `/api/pdf-to-word`, `/api/pdf-to-excel`, `/api/url-to-pdf`, `/api/extract-audio`; `UploadSizeLimitMiddleware` enforces `MAX_UPLOAD_MB` (default 500 MB) both at Content-Length pre-check and during streaming
- **Observability**: JSON structured logger (`utils/logging.py`) + `contextvars` propagation so every log line auto-tags `request_id`; `AccessLogMiddleware` logs one INFO per request with `duration_ms`, WARNING for `>5s`; `RequestTimeoutMiddleware` returns 504 with friendly message after 120s; all `print()` removed from `app/`
- **Health endpoints**: `/healthz` (liveness, always 200) + `/readyz` (readiness — checks pikepdf/fitz/PIL importability + tessdata path + temp-dir writable)
- **`X-Request-ID`** on every response
- **Shared utils**: `route_helpers.py` (safe_stem, read_upload, unique_arcname), `cleanup.py` (temp-file cleanup, MIME validation, content sniffing), `health.py`, `logging.py`, `caching.py` (ETag/304/Vary + 7d cache on OG images + 1h on sitemap), `filenames.py` (`temp_output` consolidating 113 call sites), `images.py` (`open_image_safe` context manager), `page_range.py`, `colors.py`, `exceptions.py`
- `/api/<unknown>` returns JSON 404 (not SPA HTML shell)
- Test count: 197 passed, 40 skipped (integration-gated), 0 failed (was 118 at round-3 start; +79 in this release)

### SEO + meta

- Tool title length: 174 over-60 → 0; tool descriptions: 113 over-160 → 0
- Sitemap: 202 → 213 URLs (added 11 `/compare/<competitor>` pages, real blog `publishedAt` dates, per-tool priority bumping)
- Static `public/sitemap.xml` written at build time + matching backend `/sitemap.xml` route (parity verified)
- All 179 tool pages have `SoftwareApplication` JSON-LD with inline `creator`. `aggregateRating` deliberately omitted (would violate Google's structured-data guidelines without a real review corpus).
- Per-competitor `reviewRating` on `/compare/*` pages with `ratingExplanation`
- `TOOL_LAST_REVIEWED` per-tool dict (44 entries) drives sitemap lastmod
- NotFound page: `noindex,nofollow` via React `useNoIndexMeta()` hook AND backend SSR for unknown paths
- FAQ depth (6–8 Q&A) on top 20 tools
- llms-full.txt (66 KB) verbose per-tool reference

### Deploy

- `deploy/nginx.conf` — TLS 1.2/1.3, HSTS preload-ready (2yr), strict CSP, security headers, gzip + brotli (commented), `/assets` 1yr immutable, `/sw.js` no-store, API proxy with 120s timeouts and 110MB body limit
- `deploy/privatool-backend.service` — systemd unit with hardening (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `MemoryMax=4G`, `CPUQuota=300%`, `TimeoutStopSec=60` for graceful shutdown)
- `deploy/deploy.sh` — minimal-blast-radius: git fetch + reset + frontend build + systemd restart + nginx reload + `/healthz` smoke check
- `deploy/README.md` — one-time setup + day-2 ops + rollback + troubleshooting
- `.env.example` — every tunable (APP_VERSION, MAX_UPLOAD_BYTES, TESSDATA_PREFIX, TRUSTED_HOSTS, ALLOWED_ORIGINS, LOG_LEVEL, EXPENSIVE_RATE_LIMIT)

## [1.5.1] — 2026-05-16 — UX polish + a11y + AEO/GEO push

### 🆕 New tools (2) — total now 179

- **Rotate Image** (`/tools/rotate-image`) — 90 / 180 / 270 / arbitrary angle via Pillow `Transpose` + `rotate(expand=True)`. Canvas auto-expands so nothing is cropped at non-right angles. Transparency preserved for PNG and WEBP.
- **Flip Image** (`/tools/flip-image`) — horizontal or vertical mirror.

### 🔍 SEO / AEO / GEO

- **Blog index, About, Compare hub, Privacy, Terms, Pipeline, Batch** — 7 pages that had no JSON-LD now have proper schema (`Blog` + `BlogPosting` list, `AboutPage` + `FAQPage`, `CollectionPage` + `ItemList`, `WebPage`, `WebApplication`, `BreadcrumbList`).
- **Homepage `FAQPage`** added with 6 voice-friendly Q&As, matched by visible SSR `<h3>/<p>` so Google's FAQ rich-result rules hold.
- **Homepage SSR** now explicitly surfaces **Pipeline** and **Batch** as differentiators that no competitor offers free.
- **`llms-full.txt`** (66 KB) added alongside `/llms.txt`. Verbose per-tool reference, architecture explainer, and citation-ready statements for AI crawlers. `robots.txt` advertises both.
- Stale "152+ / 90+ / 105 / 141+" tool counts swept across `LandingPage`, `ComparePage`, `DynamicHead`, `opensearch.xml`, `manifest.json`, and the Foxit compare meta — all now use dynamic counts or the current canonical number.

### ♿ Accessibility

- **Real skip-link** in `EditorialMasthead` (`sr-only focus:not-sr-only`) jumping to `#main-content`. `id="main-content"` added to `<main>` across all 12 page components. Index.html SSR fallback skip-link harmonised to the same target.
- **`inputMode="numeric"`** added to all 48 `type="number"` inputs across 19 tool components → triggers numeric keypad on mobile.

### 🐛 Bugs

- **File inputs across 60+ components** now reset `e.target.value = ""` in `onChange`. Re-selecting the same file after clearing it (X button or post-process) used to silently no-op because the browser short-circuits `onChange` on identical values.
- **404 page rebuilt** with a fuzzy match over all 179 tools against the requested URL's last segment — surfaces a top-6 "Did you mean…" list and a Cmd-K trigger. Tool count is now dynamic.

### ⌨️ UX

- **Command Palette: category chips** (PDF / Image / Video-Audio / Dev / Docs / Archive) shown on the right of each result for disambiguation when two tools share a name. Hidden on mobile to keep rows uncluttered.
- **Cmd-K synonyms** added for `rotate-image` (turn / spin / tilt / sideways) and `flip-image` (mirror / unmirror / selfie / reflect).

## [1.5.0] — 2026-05-15 — Phase 7: competitor-gap tools

### 🆕 New tools (6) — total now 177

Six tools competitors offer that PrivaTools didn't:

- **Mute Video** — stream-copy strips the audio track (lossless, instant) — MP4 / MOV / WebM / MKV / AVI
- **Reverse Video** — plays backwards with audio reversed in sync, output H.264 + AAC
- **Video Speed Changer** — 0.25× (slow-mo) to 4× (hyperlapse), audio pitch-corrected via FFmpeg's `atempo` so it doesn't sound chipmunk-y
- **Audio Trimmer** — standalone audio cutter, lossless stream-copy on MP3 / WAV / AAC / FLAC / OGG / M4A
- **Image Color Palette** — extract dominant colours from any image with HEX codes, `rgb()` values, and coverage percentages (octree quantisation)
- **Pixelate / Blur Image** — mosaic pixelation or Gaussian blur with adjustable strength for privacy-safe sharing (block faces, license plates, addresses)

### ⌨️ Discoverability

- **Command Palette rewrite** — multi-token fuzzy scoring with 6-tier rank (exact name → prefix → slug-exact → contains → synonym phrase → multi-token AND) plus a popularity tie-breaker. `SYNONYMS` map tripled from 39 entries to 145+. Result cap 12 → 16. Verified 16/18 (89%) fuzzy match rate on test queries.

### 💬 UX

- **Human-readable HTTP errors** in `lib/api.ts` — `describeError()` maps 413 / 415 / 422 / 429 / 502 / 503 / 504 each to tailored user-facing copy instead of `Request failed (500)`. The error card got a "Try again" + "Copy error" affordance.
- **Filename preservation** across server-side tools — output filenames are derived from the source name + a suffix (`document.pdf` → `document_compressed.pdf`), not generic `output.pdf`.

### 🔍 SEO / AEO / GEO

- **Hand-written TL;DRs expanded from 30 to 141 tools** with voice-friendly, 1-2 sentence answers tagged `data-speakable`.
- **HowTo JSON-LD** added to every tool's `@graph` with 3 step entries each.
- **`dateModified` dynamic** — uses `date.today()` so all tool pages show today's date as last-reviewed.
- **sitemap `lastmod` = today** for all evergreen content (tool pages, blog index, compare, etc.) so search engines see fresh signals.

### ♿ Accessibility

- **Colour contrast** bumped to WCAG-AA across compare / blog / tool pages: `text-green-600` → `text-green-700 dark:text-green-400`, `text-red-500` → `text-red-700 dark:text-red-400`, accent badges from `bg-accent/15 text-accent` to `bg-accent/25 text-foreground border-accent/40`.
- **Sidebar headings** changed from `<h3>` to `<h2>` for correct heading order on tool pages.
- **Form labels** added with `htmlFor` / `id` pairs and `aria-label` on the YAML-to-JSON textarea and password-generator input.
- **Icon-only `<a>`** on the blog "next post" arrow gained `aria-label="Read {title}"`.

### 📱 Mobile

- **CategoryToolNav overflow** — changed from `min-w-0 max-w-full` (didn't clip on certain viewports) to `-mx-4 sm:mx-0 overflow-hidden` edge-to-edge scroll pattern.
- **Wide markdown tables** in blog posts get `display: block; overflow-x: auto` so they don't horizontal-scroll the whole page.

## [1.4.0] — 2026-05-12 — Converter aliases + browser-only utilities

### 🆕 New tools (20+)

**Image converter aliases** (each is its own SEO landing page hitting the unified `image-converter` backend):

JPG ↔ PNG · JPG → WebP · PNG → WebP · TIFF → JPG/PNG · BMP → JPG/PNG · GIF → JPG/PNG

**Audio / video converter aliases:**

M4A → MP3 · MP4 → MP3 · MOV → MP4 · AVI → MP4 · WebM → MP4 · MP4 → WebM

**Browser-only dev tools:**

YAML ↔ JSON · Case Converter (camelCase ↔ snake_case ↔ kebab-case ↔ PascalCase ↔ CONSTANT_CASE ↔ Title Case ↔ sentence case)

### 🔍 SEO

- Each alias gets a dedicated landing page with its own meta, TLDR, HowTo, and FAQ — surfaces in long-tail "convert X to Y" searches without duplicating backend code.

## [1.3.0] — 2026-05-15 — SEO / AEO / GEO sweep

### 🔍 SEO (technical)

- **robots.txt rewritten** with explicit allows for every major AI crawler: GPTBot, ChatGPT-User, OAI-SearchBot, Google-Extended, GoogleOther, PerplexityBot, Perplexity-User, ClaudeBot, anthropic-ai, Claude-Web, Claude-SearchBot, cohere-ai, Cohere-Web, CCBot, Applebot, Applebot-Extended, Meta-ExternalAgent/Fetcher, FacebookBot, Mistral-AI, YouBot, Diffbot, PetalBot. Yandex/Baidu/DDG explicitly allowed. Aggressive crawlers (Bytespider, AhrefsBot, SemrushBot, MJ12bot, DotBot) blocked.
- **Google Search Console verification fix**: SPA middleware was intercepting `/google*.html` paths and returning index.html shell instead of the 53-byte verification token. Now passes through (`/google`, `/BingSiteAuth`, `/yandex`, `/baidu_verify`).
- **Schema upgrades** (`seo_meta.py`):
  - Tool pages: `WebApplication` → `SoftwareApplication` with richer fields (`applicationSubCategory`, `browserRequirements`, `isAccessibleForFree`, `softwareVersion`, full `Offer` with `availability` + `category`)
  - Homepage: new `ItemList` schema enumerating 25 featured tools as `SoftwareApplication`s
  - Organization: enriched with `alternateName`, `foundingDate`, `license`, `description`, `ImageObject` logo, `ContactPoint`
  - Blog posts: author upgraded from `Organization` to `Person` with `sameAs` + `worksFor`; added `image`, `keywords`, `mainEntityOfPage`
  - Compare pages: `Article` → `["Article", "Review"]` with `mainEntityOfPage` + `author`

### 🎙️ AEO (Answer Engine Optimisation)

- **`speakable` JSON-LD** added to FAQ entries on tool pages, blog posts, and compare pages — gives voice assistants and featured-snippet pickers an explicit "read this aloud" target.
- **TL;DR / Key facts boxes** on every blog post (15/15). Short, snippet-optimised summary at the top of each article, with `.post-tldr` CSS class referenced by the `speakable` selector.
- **Visible author byline** with semantic `<time>` elements (E-E-A-T signal).

### 🤖 GEO (Generative Engine Optimisation)

- **`llms.txt` substantially enriched** (now ~30 KB):
  - Quick-answer comparison matrix (PrivaTools vs 7 competitors)
  - "What makes PrivaTools different (for AI citation)" section with three architectural commitments + auditable source paths
  - Auto-generated section with the 10 most-recent blog posts including their TL;DRs (parsed from `blog.ts`)
  - Inline FAQ section with 7 direct-answer Q&As
  - All competitor comparison links with one-liner verdicts

### 🔗 Internal linking

- **Auto-derived "Related articles" sidebar** on every tool page (PDF + non-PDF) from each post's `relatedTools` field — replaces a stale hand-maintained map.
- **"Tools mentioned in this article" panel** at the bottom of every blog post (15/15), with cards linking to the specific tools each post references.
- All 15 blog posts now have a `relatedTools` array — distributes link equity + gives AI engines a clean entity graph.

### 📊 By the numbers

- AI crawlers explicitly allowed: 21 (was 9)
- TL;DR boxes on blog posts: 15/15
- Blog post → tool internal links: 15 posts × avg 4 tools = ~60 new internal links
- JSON-LD types emitted: SoftwareApplication, BreadcrumbList, FAQPage, BlogPosting, Article+Review, Organization, WebSite, Person, ImageObject, ItemList, SpeakableSpecification, ContactPoint, Offer

## [1.2.1] — 2026-05-15 — SEO content push

### 📝 6 new long-form blog posts (~17,000 words of new content)

- **AI PDF Summarizer: How to Summarize Long PDFs in Your Browser (2026 Guide)** — explains browser-side distilbart, step-by-step walkthrough, what cloud summarizers do with your data
- **10 Best iLovePDF Alternatives in 2026 (Free, Private, Open-Source)** — full comparison matrix, ranked
- **How to Redact a PDF Properly (Don't Use Black Boxes)** — proper redaction technique, common pitfalls, verification steps
- **Why Most Online PDF Tools Are Tracking You (And What to Do About It)** — privacy-policy analysis, tracker breakdown, the open-source test
- **How to Convert HEIC to PDF, JPG, and PNG on Any Device (2026)** — online + Mac + Windows + CLI + iPhone settings
- **How to Decode a JWT Token Safely (and What Each Part Means)** — JWT structure, claims reference, why public decoders are unsafe

### 🔍 Rich-result schemas added

- **HowTo + FAQPage JSON-LD** for 18 additional tools: highlight-pdf, summarize-pdf, smart-redact, split-in-half, pdf-to-svg, pdf-to-html, pdf-to-rtf, web-optimize-pdf, split-by-text, view-exif, jwt-decoder, regex-tester, timestamp-converter, batch-compress-pdf, pdf-page-counter, webp-to-jpg, webp-to-png, heic-to-png — for richer Google SERPs.
- All 6 new blog posts wired into seo_meta `_BLOG_POSTS` for BlogPosting + Article JSON-LD.

### 📊 Numbers

- HowTo coverage: 42 → **60** tools (39% of 152 → 76% of high-traffic tools)
- FAQ coverage: 42 → **60** tools
- Blog posts: 9 → **15**
- Words of content on the site: roughly doubled

## [1.2.0] — 2026-05-15

### 🆕 New tools (11) — total now 152

**PDF**
- **Web Optimize PDF** — `qpdf --linearize` for fast byte-range / first-page-fast-render serving
- **Split by Text** — split a PDF at every page containing a search keyword (with case-sensitive toggle)
- **PDF to HTML** — full HTML export preserving fonts and positioning
- **PDF to RTF** — Rich Text Format extraction, opens in WordPad / Pages / Word / LibreOffice

**Image**
- **View EXIF Data** — counterpart to Remove EXIF; inspect GPS / camera / timestamps / IPTC / XMP metadata as JSON
- **WebP to JPG** — SEO landing page hitting the existing image-converter
- **WebP to PNG** — same, target PNG
- **HEIC to PNG** — same, HEIC input

**Browser-only dev utilities**
- **JWT Decoder** — paste a JWT, see header + payload + signature + expiry status (decoded entirely client-side)
- **Regex Tester** — live JavaScript RegExp tester with match highlighting and capture groups
- **Timestamp Converter** — Unix epoch ↔ ISO 8601 ↔ UTC ↔ local ↔ relative ("in 3 days")

### 🐛 Bug fixes

- **office-to-pdf no longer 500s.** The LibreOffice path was failing with "User installation could not be completed" because the container's appuser had no `$HOME`. Each call now gets its own per-conversion `-env:UserInstallation` profile dir under `/tmp`.

### 🛠️ Backend

- New router `v12_tools.py` with `/api/web-optimize`, `/api/split-by-text`, `/api/pdf-to-html`, `/api/pdf-to-rtf`, `/api/view-exif`
- `pdf-to-html` uses PyMuPDF's HTML exporter; `pdf-to-rtf` does its own minimal RTF generation with Unicode escapes; `view-exif` uses PIL's getexif + GPS sub-IFD

## [1.1.0] — 2026-05-04

### 🆕 New tools (33)

**PDF**
- Image-to-PDF variants: JPG, PNG, HEIC, WebP, TIFF, BMP, GIF, SVG, ODT
- PDF-to-image variants: JPG, PNG, TIFF, BMP, GIF, SVG
- Split in Half — split each page horizontally or vertically (for two-up scans)
- Highlight PDF — yellow-highlight every match of a phrase
- Summarize PDF (AI) — local distilbart, runs in your browser via WebAssembly
- Smart Redact (AI) — local BERT-NER auto-detects PII (names, emails, phones, SSNs)
- Batch Compress PDF — compress up to 50 PDFs in parallel
- PDF Page Counter — count pages across up to 100 PDFs at once

**Video & Audio**
- Video to PDF — extract frames as PDF pages
- Video Converter — MP4/WebM/MOV/AVI/MKV via FFmpeg
- Video Resizer — change resolution/aspect ratio
- Video Thumbnail — extract poster frames at any timestamp
- Video Merge — concatenate clips
- GIF to MP4 — animated GIF → smaller, smoother MP4
- Burn Subtitles — embed .srt or .vtt into MP4
- Audio Converter — MP3/WAV/OGG/FLAC/AAC with bitrate control
- Audio Merge — concatenate audio tracks
- Image Upscaler — 2x or 4x with Lanczos resampling

**Browser-only utilities**
- Subtitle Converter — SRT ↔ VTT ↔ ASS in browser
- Password Generator — cryptographically-secure with custom rules
- UUID Generator — bulk v4 UUIDs
- Lorem Ipsum — placeholder text by paragraph/sentence/word
- Word Counter — live word/character/sentence/reading-time
- Color Converter — HEX ↔ RGB ↔ HSL with picker
- URL & JWT Encoder — percent-encode + JWT decode

### 🎨 Redesign
- Linear/Vercel/Smallpdf-inspired complete UI overhaul (monochrome primary + amber accent)
- 21 custom per-tool SVG illustrations replacing generic icons (Merge, Compress, Rotate, Sign, Watermark, Convert, OCR, Highlight, Lock, Unlock, Summarize, ImageCompress, RemoveBg, VideoToGif, QrCode, Hash, Base64, PageCounter, MergeMedia, etc.)
- Animated SVG hero artwork with floating category chips orbiting a shield
- Animated Pipeline diagram (CSS-keyframed file particle drifting through stages)
- Asymmetric homepage hero, 88px H1, search-shaped CTA opening ⌘K
- Dropzone-style skeleton loaders

### ⌨️ UX
- ⌘K palette: synonym scoring (typing "join" finds Merge, "shrink" finds Compress, "md5" finds Hash, etc.)
- Onboarding tour for first-time visitors (5 cards — keyboard-dismissible)
- Reduced-motion compliance — global safety net disables decorative animations
- Light + dark themes both at zero accessibility violations (axe-core verified)

### ♿ Accessibility
- WCAG-AA color contrast across all routes in both themes
- Proper landmark structure: every page wrapped in `<main>` with aria-labelled `<section>` children
- ARIA dialog semantics on CommandPalette + OnboardingTour
- All sliders forward `aria-label` to the Radix thumb
- Focus rings via `:focus-visible`
- 0 serious + 0 moderate axe violations across 6 audited routes × 2 themes

### 🔍 SEO / AI Discoverability
- llms.txt auto-generated from data files at build time (always in sync, currently 141 tools)
- Per-tool SEO meta on all 141 tools (title + 140-160 char description)
- Dynamic OG images per route via `/api/og-image?p=<path>`
- robots.txt allows GPTBot/Claudebot/Perplexity, blocks aggressive crawlers
- JSON-LD: Organization, Person, BlogPosting, BreadcrumbList, ItemList

### 🛠️ Backend
- Mtime-keyed SEO HTML cache → frontend deploys no longer need a worker restart
- 17 Tesseract language packs baked into image
- rembg model pre-warmed at build time (`/tmp/u2net`, NUMBA_DISABLE_JIT)
- Memory-safety caps on collage, json-to-pdf, split-by-size, compare
- video-merge auto-detects audio tracks (anullsrc padding for silent inputs)
- 6 dedicated UIs replacing single-file GenericUI fallback for batch/multi-file tools
- 94/94 endpoints pass regression sweep

## [1.0.0] — 2026-03-05

### 🚀 Launch

**90+ privacy-first file tools** — all processing happens locally.

### PDF Tools (70+)
- Organize: Merge, Split, Split by Bookmarks, Split by Size, Organize Pages, Delete Pages, Extract Pages, Alternate Mix, Overlay, Repair
- Edit: Edit PDF, Sign, E-Sign, Watermark, Stamp, Header/Footer, Page Numbers, Bates Numbering, Fill Form, Bookmarks, Add Hyperlinks, White-Out, Annotate, Add Shapes, Add Attachment
- Optimize: Compress, Flatten, Grayscale, Deskew, Crop, Auto Crop, Resize, Remove Blank Pages, Invert Colors
- Security: Protect, Unlock, Redact, Strip Metadata, Delete Annotations, Sanitize, Permissions, Verify Signature
- Convert to PDF: Image, HTML, Word, Excel, PowerPoint, TXT, Markdown, CSV, EPUB, RTF, JSON, XML
- Convert from PDF: Image, Text, Word, Excel, PPTX, EPUB, Markdown, Extract Tables

### Non-PDF Tools (16)
- Image: Compressor, Converter, Remove EXIF, Resize & Crop
- Video/Audio: Video→GIF, Extract Audio, Trim Media, Compress Video
- Developer: JSON/XML Formatter, Text Diff, Base64, Hash Generator
- Archive: Extract Archive, Create ZIP
- Document: CSV↔JSON, Markdown→HTML

### App Features
- ⌘K Command Palette with keyboard navigation
- History / Recent Tools tracking
- Dark/Light mode toggle with persistence
- Batch Process — apply one tool to many files
- PDF Pipeline — chain tools sequentially
- PWA support — install as desktop/mobile app
- Per-tool SEO (dynamic meta tags)
- Dynamic sitemap.xml
- Custom 404 page
