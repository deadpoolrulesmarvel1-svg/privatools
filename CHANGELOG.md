# Changelog

All notable changes to PrivaTools will be documented in this file.

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
