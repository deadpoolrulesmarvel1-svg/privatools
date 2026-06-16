<div align="center">

# 🛡️ PrivaTools

**Every file task, done privately.**

179 free, open-source tools for PDFs, images, video, audio, and developer work — all running on your own server.
Zero uploads to third parties. No accounts. No watermarks. No premium tier.

[![Live Demo](https://img.shields.io/badge/Live-privatools.me-blue?style=for-the-badge&logo=vercel)](https://privatools.me)
[![MIT License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/deadpoolrulesmarvel1-svg/privatools?style=for-the-badge&logo=github)](https://github.com/deadpoolrulesmarvel1-svg/privatools/stargazers)

</div>

---

## ✨ Why PrivaTools?

| Feature | PrivaTools | iLovePDF / Smallpdf / Adobe |
|---|---|---|
| **Truly free** | 100%, no quota | Limited free / paid tier |
| **No account** | Just open and use | Email / sign-up required |
| **Privacy** | Files processed in an isolated container, deleted on response; many tools never leave your browser | Uploaded to vendor cloud |
| **Tool count** | **179** (PDF + image + video + audio + dev) | 20–95 (PDF only) |
| **Pipeline** | Chain Merge → Compress → Watermark → Sign in one click | Not offered free |
| **Self-hostable** | `docker compose up --build` | No |
| **Open source** | MIT — fork, modify, deploy | Proprietary |
| **In-browser AI** | Summarize PDF + Smart Redact run via WebAssembly — no upload | Cloud APIs |

---

## 🚀 Quick Start

### Option 1: Docker (recommended)

```bash
git clone https://github.com/deadpoolrulesmarvel1-svg/privatools.git
cd privatools
docker compose up --build
```

Open **http://localhost:8080** — that's it!

### Option 2: Manual setup

```bash
git clone https://github.com/deadpoolrulesmarvel1-svg/privatools.git
cd privatools

# Backend
pip install -r requirements.txt
uvicorn backend.app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

### System dependencies (for full feature set)

```bash
# macOS
brew install tesseract ffmpeg qpdf
brew install --cask libreoffice

# Ubuntu / Debian
sudo apt install tesseract-ocr ffmpeg qpdf libreoffice
```

---

## 🛠️ All Tools (179)

### 📄 PDF Tools (101)

<details>
<summary><b>Organize & manage (12)</b></summary>

Merge PDF · Split PDF · Split by Bookmarks · Split by Size · Split in Half · Organize Pages · Delete Pages · Extract Pages · Reverse PDF · Booklet PDF · Alternate Mix · Repair PDF

</details>

<details>
<summary><b>Edit content (16)</b></summary>

Edit PDF · Sign PDF · E-Sign PDF · Watermark · Stamp PDF · Header/Footer · Page Numbers · Bates Numbering · Bookmarks · Fill Form · Form Creator · Add Hyperlinks · Highlight PDF · Whiteout PDF · Annotate PDF · Add Shapes

</details>

<details>
<summary><b>Optimize & fix (12)</b></summary>

Compress · Web Optimize · Flatten · Grayscale · Deskew · Crop · Auto Crop · Resize · Rotate · Remove Blank Pages · Invert Colors · Batch Compress

</details>

<details>
<summary><b>Security & privacy (11)</b></summary>

Protect · Unlock · Redact · Smart Redact (AI/NER) · Sanitize · Strip Metadata · Delete Annotations · Permissions · Verify Signature · Add Attachment · Metadata Editor

</details>

<details>
<summary><b>Convert to PDF (22)</b></summary>

JPG → PDF · PNG → PDF · HEIC → PDF · WebP → PDF · TIFF → PDF · BMP → PDF · GIF → PDF · SVG → PDF · Image → PDF (generic) · HTML → PDF · URL → PDF · Word → PDF · Excel → PDF · PowerPoint → PDF · ODT → PDF · TXT → PDF · Markdown → PDF · CSV → PDF · EPUB → PDF · RTF → PDF · JSON → PDF · XML → PDF

</details>

<details>
<summary><b>Convert from PDF (16)</b></summary>

PDF → JPG · PDF → PNG · PDF → TIFF · PDF → BMP · PDF → GIF · PDF → SVG · PDF → Image (generic) · PDF → Word · PDF → Excel · PDF → PPTX · PDF → Text · PDF → HTML · PDF → RTF · PDF → EPUB · PDF → Markdown · Extract Tables

</details>

<details>
<summary><b>Advanced (12)</b></summary>

OCR · Compare · QR Code · NUP · PDF/A Convert · PDF/A Validator · Split by Text · Transparent Background · Summarize PDF (browser AI) · Extract Images · PDF Page Counter · Page-by-Page Extract

</details>

### 🖼️ Image Tools (33)

Image Compressor · Image Converter · Resize & Crop · Image Watermark · Remove Background (local AI) · Image Upscaler · Remove EXIF · View EXIF · Rotate Image · Flip Image · Pixelate / Blur Image · Image Color Palette · Image OCR · Merge Images · Photo Collage · Favicon Generator · Barcode Generator · QR Reader · SVG → PNG · HEIC → JPG · HEIC → PNG · WebP → JPG · WebP → PNG · JPG → PNG · PNG → JPG · JPG → WebP · PNG → WebP · TIFF → JPG · TIFF → PNG · BMP → JPG · BMP → PNG · GIF → JPG · GIF → PNG

### 🎬 Video & Audio (23)

Video Converter (MP4/WebM/MOV/AVI/MKV) · Video Resizer · Video Merge · Video Thumbnail · Video to GIF · Video to PDF · Mute Video · Reverse Video · Video Speed Changer (0.25× – 4×) · Compress Video · Extract Audio · Audio Converter · Audio Merge · Audio Trimmer · Trim Media · GIF → MP4 · MP4 → MP3 · M4A → MP3 · MOV → MP4 · AVI → MP4 · WebM → MP4 · MP4 → WebM · Subtitle Converter · Burn Subtitles

### 💻 Developer & Text (18)

JSON / XML Formatter · CSV ↔ JSON · YAML ↔ JSON · Markdown ↔ HTML · Case Converter · Text Diff · Word Counter · Base64 Encode/Decode · Hash Generator (MD5 / SHA-1 / SHA-256 / SHA-512) · JWT Decoder · Regex Tester · Timestamp Converter · URL Encoder · Color Converter (HEX ↔ RGB ↔ HSL) · UUID Generator (v4 + v7) · Password Generator · Lorem Ipsum

### 📦 Archive (2)

Extract Archive · Create ZIP

### 🤖 Browser-only AI (no upload)

- **Summarize PDF** — `distilbart-cnn-12-6` running via @huggingface/transformers + WebAssembly. ~250 MB model downloaded once and cached.
- **Smart Redact** — `BERT-base-NER` auto-detects names, emails, phones, SSNs entirely in-browser. Combined with manual rectangle redaction.

---

## 🔗 Power features

### Pipeline

Chain tools sequentially: queue `Merge → Compress → Watermark → Sign` and download one final PDF. No competitor offers this in the free tier. Available at `/pipeline`.

### Batch

Apply one tool to many files at once. Drop 50 PDFs into Batch Compress, get a ZIP of compressed outputs back. Available at `/batch`.

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open Command Palette (multi-token fuzzy search, 145+ synonyms) |
| `↑` `↓` | Navigate results |
| `Enter` | Open selected tool |
| `Escape` | Close palette |
| `⌘↵` / `Ctrl+↵` | Start processing (when a file is selected) |

---

## 📁 Project structure

```
privatools/
├── backend/                  # FastAPI (Python 3.10)
│   ├── app/
│   │   ├── main.py           # Entry point + SPA SEO middleware
│   │   ├── seo_meta.py       # Per-route titles / meta / JSON-LD / SSR content
│   │   ├── tool_content.py   # HowTo steps + FAQ Q&As per tool
│   │   ├── routes/           # API handlers (one file per tool group)
│   │   │   ├── merge.py, split.py, compress.py, ...
│   │   │   ├── phase7_tools.py  # mute/reverse/speed video, audio trim, image palette, pixelate, rotate, flip
│   │   │   ├── v12_tools.py     # web-optimize, split-by-text, pdf-to-html, pdf-to-rtf, view-exif
│   │   │   ├── og_image.py      # Dynamic 1200x630 OG image generator
│   │   │   ├── sitemap.py       # Dynamic sitemap.xml
│   │   │   └── ...
│   │   ├── services/         # Business logic (one file per tool)
│   │   ├── middleware/       # Rate limiting, security headers
│   │   └── utils/            # Temp-file cleanup, route helpers
│   └── tests/
├── frontend/                 # React + Vite + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── tool-ui/         # 130+ per-tool components
│   │   │   ├── CommandPalette.tsx  # ⌘K with multi-token fuzzy scoring
│   │   │   ├── EditorialMasthead.tsx, EditorialFooter.tsx
│   │   │   └── ...
│   │   ├── data/             # tools.ts (101 PDF) + non-pdf-tools.ts (78) + blog.ts (15)
│   │   ├── hooks/            # useHistory, useTheme, useUxHelpers
│   │   ├── pages/            # Index, ToolPage, NonPdfToolPage, Pipeline, Batch, Blog, Compare, About, ...
│   │   └── lib/              # API client, output filename helpers, error mapping
│   ├── public/
│   │   ├── llms.txt          # Auto-generated AI crawler index (~30 KB)
│   │   ├── llms-full.txt     # Verbose AI crawler corpus (~66 KB)
│   │   ├── manifest.json     # PWA
│   │   ├── opensearch.xml
│   │   └── sw.js             # Service worker
│   └── scripts/gen-llms.mjs  # Regenerates llms.txt + llms-full.txt at build time
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## 🔍 SEO / AEO / GEO

PrivaTools ships with serious AI / answer-engine optimisation:

- **SSR meta + JSON-LD** for every route via Python middleware (Organization, WebSite, SoftwareApplication, BreadcrumbList, HowTo, FAQPage, BlogPosting, Article+Review, AboutPage, CollectionPage, ItemList, SpeakableSpecification)
- **`speakable` CSS-selector targets** on every TL;DR and FAQ so voice assistants and featured-snippet pickers get a clean read-aloud target
- **`llms.txt` + `llms-full.txt`** — auto-generated index and full corpus for AI crawlers (ChatGPT, Claude, Perplexity, Gemini)
- **HowTo + FAQ schema** on every one of the 179 tools
- **Dynamic OG images** per route via `/api/og-image?p=<path>`
- **robots.txt** explicitly allows 21 AI crawlers and blocks aggressive ones

---

## 🤝 Contributing

PrivaTools is MIT-licensed and PRs are welcome.

### Adding a new tool — 3-step pattern

**1. Service** — `backend/app/services/my_tool_service.py`

```python
import uuid
from ..utils.cleanup import get_temp_path, ensure_temp_dir

def my_tool(input_path: str, option: str = "default") -> str:
    ensure_temp_dir()
    output_path = get_temp_path(f"output_{uuid.uuid4().hex}.pdf")
    # processing logic
    return str(output_path)
```

**2. Route** — add to an existing `routes/*.py` or create a new module

```python
@router.post("/my-tool")
async def my_tool_endpoint(file: UploadFile = File(...)):
    content = await file.read()
    temp = get_temp_path(f"upload_{uuid.uuid4().hex}.pdf")
    temp.write_bytes(content)
    out = my_tool_service.my_tool(str(temp))
    cleanup = BackgroundTask(remove_files, str(temp), out)
    return FileResponse(out, filename="output.pdf", background=cleanup)
```

**3. Tool entry** — `frontend/src/data/tools.ts` (PDF) or `non-pdf-tools.ts`

```typescript
{
  slug: "my-tool",                  // must match the API path
  icon: FileText,                   // any Lucide icon
  name: "My Tool",
  description: "Short description",
  longDescription: "Detailed description for the tool page.",
  popularity: 42,                   // lower = higher up the listing
  category: "edit",                 // organize | edit | optimize | security | to-pdf | from-pdf | advanced
  accepts: ".pdf",
  outputLabel: "output.pdf",
}
```

Add an endpoint mapping in `frontend/src/lib/tool-endpoints.ts`, a TLDR + display title in `backend/app/seo_meta.py` (`_TLDR_OVERRIDES`, `_TOOL_TITLES`), HowTo steps + FAQs in `backend/app/tool_content.py`, and the slug to `backend/app/routes/sitemap.py`. The `GenericUI` component handles single-file upload/download automatically; for richer interactions add a dedicated component under `frontend/src/components/tool-ui/`.

### Guidelines

- **Privacy first** — never add external API calls that send file content off-server
- **Test before PR** — `pytest` for backend, `npm run build && npm test` for frontend
- **Match the style** — follow existing patterns in similar tools
- **Update docs** — add a CHANGELOG entry and a TLDR in `seo_meta.py`

---

## 🔒 Privacy promise

- ✅ Files processed in an **isolated Docker container**, unlinked from disk immediately after the response
- ✅ Many tools (Summarize PDF, Smart Redact, JWT Decoder, Regex Tester, Password Generator, Hash Generator, Base64, JSON/XML Formatter, and others) **run entirely in your browser** — no upload at all
- ✅ **No accounts, no sign-ups, no email, no payment**
- ✅ **No watermarks, no daily quota, no premium tier**
- ✅ **500 MB upload limit per file**, unlimited files per day
- ✅ AI runs via WebAssembly **in your browser** — no third-party AI APIs
- ✅ The public demo at privatools.me uses **anonymous GA4 pageview telemetry only** (IP-anonymized; blockable by any extension). No other trackers, no ad networks, no behavioural profiling
- ✅ **Open source under MIT** — audit `backend/app/utils/cleanup.py` and `backend/app/main.py` yourself

---

## 📜 License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with care for privacy**

[Live Demo](https://privatools.me) · [Report Bug](https://github.com/deadpoolrulesmarvel1-svg/privatools/issues) · [Request Feature](https://github.com/deadpoolrulesmarvel1-svg/privatools/issues) · [llms.txt](https://privatools.me/llms.txt)

</div>
