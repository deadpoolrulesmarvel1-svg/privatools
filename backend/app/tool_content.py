"""
Structured HowTo steps and FAQ entries for each tool.

Used for:
- Server-side rendering (visible to crawlers)
- JSON-LD HowTo and FAQPage schema markup
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# HowTo steps  –  tool slug → list of {name, text}
# ---------------------------------------------------------------------------
TOOL_HOWTO: dict[str, list[dict[str, str]]] = {
    # ── PDF manipulation ──────────────────────────────────────────────
    "merge-pdf": [
        {"name": "Add PDF files", "text": "Drop or select two or more PDF files into the upload area. There is no page-count limit; the max per file is 500 MB."},
        {"name": "Reorder the files", "text": "Drag the thumbnail cards to set the order in which the PDFs will be joined."},
        {"name": "Merge and download", "text": "Click Merge. The server concatenates the files, preserving bookmarks and links, and returns a single PDF."},
    ],
    "split-pdf": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. The page-count preview loads automatically."},
        {"name": "Choose split mode", "text": "Pick 'Fixed range' to split every N pages, 'Custom ranges' to specify exact page numbers (e.g. 1-3, 7-10), or 'Extract every page' to get individual pages."},
        {"name": "Split and download", "text": "Click Split. Each resulting PDF is packaged into a ZIP file for convenient downloading."},
    ],
    "split-by-size": [
        {"name": "Upload the PDF", "text": "Select a PDF file up to 500 MB that you want to split into smaller chunks."},
        {"name": "Set the target chunk size", "text": "Enter the maximum file size per chunk in megabytes (e.g. 10 MB). The tool will split at page boundaries to stay under the limit."},
        {"name": "Download the parts", "text": "Click Split. The server breaks the PDF into parts that respect your size target and delivers them in a ZIP archive."},
    ],
    "compress-pdf": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Large scanned documents benefit the most from compression."},
        {"name": "Pick a compression level", "text": "Choose Low (best quality, modest reduction), Medium (balanced), or High (smallest file, some quality loss on images)."},
        {"name": "Download the compressed file", "text": "Click Compress. The result shows the new file size and the percentage saved compared to the original."},
    ],
    "edit-pdf": [
        {"name": "Drop your PDF", "text": "Upload a PDF up to 500 MB. The editor renders each page in a scrolling canvas ready for annotation. No account required."},
        {"name": "Choose an annotation tool", "text": "Pick text box, highlighter, freehand pen, rectangle, circle, line, or arrow from the toolbar. Set color, opacity, and font size before drawing."},
        {"name": "Add your annotations", "text": "Click on the page to drop text, drag to draw shapes, or hold-and-drag for freehand strokes. Move, resize, or delete any annotation before saving."},
        {"name": "Download the edited PDF", "text": "Click Save. Annotations are flattened into the document so they appear identically in Adobe Reader, Preview, Chrome, and every mobile reader."},
    ],
    "sign-pdf": [
        {"name": "Upload the document", "text": "Select the PDF you need to sign. The first page is displayed in the signing canvas."},
        {"name": "Create your signature", "text": "Draw your signature with a mouse or finger, type it using a handwriting font, or upload a signature image."},
        {"name": "Place and resize the signature", "text": "Drag the signature to the correct position on the page. Resize it to fit the signing area."},
        {"name": "Download the signed PDF", "text": "Click Apply. The signature is embedded into the PDF and the file is ready to share."},
    ],
    "protect-pdf": [
        {"name": "Drop your PDF", "text": "Select a PDF up to 500 MB that you want to password-protect. The file enters an isolated Docker container only for the encryption pass."},
        {"name": "Choose your password", "text": "Enter a strong password (12+ characters, mixed case, numbers, symbols recommended). Save it in a password manager — there is no recovery."},
        {"name": "Set permission restrictions", "text": "Optionally restrict printing, text copying, form filling, content modification, and page extraction independently. Defaults to 'all allowed once unlocked'."},
        {"name": "Download the encrypted PDF", "text": "Click Protect. The output uses AES-256 encryption (bank-grade) and requires your password to open in any PDF reader."},
    ],
    "unlock-pdf": [
        {"name": "Drop the locked PDF", "text": "Select the password-protected PDF file. The encrypted PDF enters isolated per-request storage only for the decryption pass."},
        {"name": "Enter the password", "text": "Type the document password. PrivaTools does not store or log the password — it travels over HTTPS, is used only in memory for decryption, then discarded."},
        {"name": "Click Unlock", "text": "The server decrypts the PDF, removing both the open password and any permission restrictions (no-print, no-copy, no-edit)."},
        {"name": "Download the unlocked PDF", "text": "The resulting PDF behaves like any unencrypted file — open it in any reader without a password."},
    ],
    "rotate-pdf": [
        {"name": "Drop your PDF", "text": "Select a PDF up to 500 MB. Thumbnail previews of every page load automatically so you can see what needs rotating."},
        {"name": "Select pages to rotate", "text": "Click individual page thumbnails to target specific pages, or 'Select all' for whole-document rotation. Mix-and-match is supported (different angles per page)."},
        {"name": "Choose the rotation angle", "text": "Pick 90° clockwise, 180° (upside-down), or 270° clockwise (equivalent to 90° counter-clockwise). PDF only allows 90° increments."},
        {"name": "Apply and download", "text": "Click Rotate. The server applies the rotation permanently (not just a viewer toggle) and returns the updated PDF — orientation sticks in every reader."},
    ],
    "watermark": [
        {"name": "Drop your PDF", "text": "Select a PDF up to 500 MB that needs a watermark. The file enters isolated per-request storage only for the watermarking pass."},
        {"name": "Pick watermark type", "text": "Choose text (e.g. 'CONFIDENTIAL', 'DRAFT', 'COPY') or upload an image like a company logo with transparency. Both can be applied in separate passes."},
        {"name": "Configure styling", "text": "Set opacity (5-100%), font size, color, rotation angle, and position (diagonal across page, center, top header, bottom footer, or custom coordinates)."},
        {"name": "Choose page range", "text": "Apply to all pages by default, or specify ranges like '1-5', '7,12,15', or 'odd' / 'even' for selective stamping."},
        {"name": "Apply and download", "text": "Click Apply. Watermarks are flattened into the page content so they can't be toggled off in any reader."},
    ],
    "ocr-pdf": [
        {"name": "Upload a scanned PDF or image-based PDF", "text": "Select a PDF containing scanned pages. Files up to 500 MB are supported."},
        {"name": "Select the document language", "text": "Choose the primary language (or multiple languages) so the OCR engine uses the correct dictionary for accuracy."},
        {"name": "Run OCR and download", "text": "Click Process. Tesseract extracts text and creates an invisible text layer, making the PDF fully searchable and copyable."},
    ],
    "redact-pdf": [
        {"name": "Upload the PDF", "text": "Select the document containing sensitive information you need to permanently remove."},
        {"name": "Mark areas to redact", "text": "Draw rectangles over text, images, or regions on each page. You can also search for a word or phrase to auto-select all occurrences."},
        {"name": "Preview the redactions", "text": "Toggle the preview to verify that the correct areas are blacked out before committing."},
        {"name": "Apply redactions and download", "text": "Click Redact. The underlying content is permanently destroyed — it cannot be recovered, even by removing the black boxes."},
    ],
    "flatten-pdf": [
        {"name": "Upload the PDF", "text": "Select a PDF that contains form fields, annotations, or layers you want to flatten."},
        {"name": "Choose flattening options", "text": "Decide whether to flatten form fields only, annotations only, or everything. Flattening converts interactive elements into static page content."},
        {"name": "Download the flattened PDF", "text": "Click Flatten. The result is a clean PDF where all content is baked into the pages, preventing further edits."},
    ],
    "bookmarks": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Existing bookmarks, if any, are listed automatically."},
        {"name": "Edit the bookmark tree", "text": "Add, rename, reorder, or delete bookmarks. Set the target page number for each entry. You can nest bookmarks to create a multi-level table of contents."},
        {"name": "Save and download", "text": "Click Save. The updated bookmark tree is embedded into the PDF for easy navigation in any reader."},
    ],
    "form-creator": [
        {"name": "Upload a PDF or start blank", "text": "Upload an existing PDF to add form fields on top, or start with a blank page."},
        {"name": "Add form fields", "text": "Drag text inputs, checkboxes, dropdowns, radio buttons, or signature fields onto the page. Set field names and validation rules."},
        {"name": "Configure form properties", "text": "Set tab order, default values, and required-field flags. Preview the form to test interactivity."},
        {"name": "Export the fillable PDF", "text": "Click Save. The PDF contains standard AcroForm fields that work in any PDF reader."},
    ],
    "extract-tables": [
        {"name": "Upload the PDF", "text": "Select a PDF that contains one or more tables you need to extract as structured data."},
        {"name": "Select pages", "text": "Choose specific pages or let the tool auto-detect all tables across the entire document."},
        {"name": "Pick the output format", "text": "Choose CSV, Excel (.xlsx), or JSON. Each detected table becomes a separate sheet or file."},
        {"name": "Download the extracted data", "text": "Click Extract. Tables are parsed using Camelot/Tabula and delivered in the chosen format inside a ZIP."},
    ],
    "pdf-to-pdfa": [
        {"name": "Upload the PDF", "text": "Select a standard PDF you want to convert into the PDF/A archival format."},
        {"name": "Choose the conformance level", "text": "Select PDF/A-1b (basic), PDF/A-2b (supports transparency and JPEG2000), or PDF/A-3b (allows embedded files)."},
        {"name": "Convert and download", "text": "Click Convert. The tool embeds fonts, converts color spaces to sRGB, and validates compliance before returning the PDF/A file."},
    ],

    # ── PDF conversion ────────────────────────────────────────────────
    "image-to-pdf": [
        {"name": "Upload images", "text": "Select one or more images (JPG, PNG, WebP, BMP, TIFF). Each image can be up to 500 MB."},
        {"name": "Arrange and configure", "text": "Reorder images by dragging thumbnails. Set page size (A4, Letter, or fit-to-image) and orientation."},
        {"name": "Convert to PDF", "text": "Click Convert. Each image becomes a full page in the resulting PDF, maintaining original resolution."},
    ],
    "txt-to-pdf": [
        {"name": "Upload a text file or paste text", "text": "Select a .txt file up to 500 MB or paste plain text directly into the editor."},
        {"name": "Choose formatting", "text": "Pick the font family, font size, page size, and margins. Monospace fonts work best for code or tabular content."},
        {"name": "Generate the PDF", "text": "Click Convert. The text is reflowed into paginated PDF pages with the selected formatting."},
    ],
    "office-to-pdf": [
        {"name": "Upload an Office document", "text": "Select a Word (.docx), Excel (.xlsx), or PowerPoint (.pptx) file up to 500 MB."},
        {"name": "Convert via LibreOffice", "text": "The server uses LibreOffice in headless mode for high-fidelity conversion, preserving fonts, tables, charts, and layouts."},
        {"name": "Download the PDF", "text": "Click Convert. The resulting PDF is ready within seconds for most documents."},
    ],
    "word-to-pdf": [
        {"name": "Upload the Word document", "text": "Select a .doc or .docx file up to 500 MB."},
        {"name": "Conversion runs automatically", "text": "LibreOffice converts the document server-side, preserving formatting, images, headers, footers, and table-of-contents links."},
        {"name": "Download the PDF", "text": "Click Convert and save the result. Hyperlinks and bookmarks from the original document are preserved."},
    ],
    "epub-to-pdf": [
        {"name": "Upload an EPUB file", "text": "Select an .epub e-book file up to 500 MB."},
        {"name": "Choose page layout", "text": "Select a page size (A4, Letter, or custom dimensions). The tool reflows text and embeds images to match the chosen layout."},
        {"name": "Convert and download", "text": "Click Convert. Chapters, formatting, and embedded images are preserved in the output PDF."},
    ],
    "html-to-pdf": [
        {"name": "Enter a URL or paste HTML", "text": "Type a public URL to render, or paste raw HTML/CSS directly into the editor."},
        {"name": "Configure rendering options", "text": "Set page size, margins, and whether to include background graphics. JavaScript rendering is supported for dynamic pages."},
        {"name": "Generate the PDF", "text": "Click Convert. The server uses a headless browser to render the page and produce a pixel-perfect PDF."},
    ],
    "xml-to-pdf": [
        {"name": "Upload an XML file", "text": "Select an .xml file up to 500 MB. Common schemas like RSS, Atom, and XHTML are supported."},
        {"name": "Choose display format", "text": "Select tree view (collapsible hierarchy) or formatted table view for structured data."},
        {"name": "Convert and download", "text": "Click Convert. The XML is rendered into a readable, paginated PDF document."},
    ],
    "csv-to-pdf": [
        {"name": "Upload a CSV file", "text": "Select a .csv or .tsv file up to 500 MB. The first row is treated as column headers by default."},
        {"name": "Customize table appearance", "text": "Set font size, enable zebra striping, choose landscape or portrait orientation. Wide tables automatically wrap or scale to fit."},
        {"name": "Convert to PDF", "text": "Click Convert. The data is rendered into a clean, paginated table in the output PDF."},
    ],
    "json-to-pdf": [
        {"name": "Upload a JSON file or paste JSON", "text": "Select a .json file up to 500 MB or paste JSON directly into the editor."},
        {"name": "Choose the rendering style", "text": "Pick syntax-highlighted code view for developers or a table/tree view for structured data."},
        {"name": "Convert and download", "text": "Click Convert. The JSON is rendered into a paginated, readable PDF with proper indentation and optional line numbers."},
    ],
    "pdf-to-word": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Both text-based and scanned PDFs are supported (scanned PDFs go through OCR first)."},
        {"name": "Convert to Word", "text": "Click Convert. The server extracts text, images, and tables and reconstructs them in a .docx file preserving layout as closely as possible."},
        {"name": "Download the Word document", "text": "Save the .docx file. Open it in Microsoft Word, Google Docs, or LibreOffice for editing."},
    ],
    "pdf-to-excel": [
        {"name": "Drop your PDF", "text": "Select a PDF up to 500 MB that contains tables or tabular data. Scanned PDFs need OCR first via the OCR PDF tool."},
        {"name": "Choose pages to scan", "text": "Pick specific pages with tables, or let the tool auto-detect tables across the whole document using Camelot and Tabula libraries."},
        {"name": "Tune detection (optional)", "text": "For borderless or unusual tables, switch detection mode (lattice for ruled tables, stream for whitespace-separated). Default auto-selects the best."},
        {"name": "Convert and download", "text": "Click Convert. Each detected table becomes a separate sheet in the resulting .xlsx file, with rows and columns preserved. Multiple tables across pages are combined into one workbook."},
    ],
    "pdf-to-text": [
        {"name": "Upload the PDF", "text": "Select a text-based or scanned PDF up to 500 MB."},
        {"name": "Choose extraction mode", "text": "Select plain text extraction for text-based PDFs, or enable OCR for scanned documents. Pick the OCR language if needed."},
        {"name": "Download the text", "text": "Click Convert. The extracted text is returned as a .txt file with page breaks preserved."},
    ],
    "pdf-to-image": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. The tool displays a page-count summary."},
        {"name": "Configure output settings", "text": "Choose the image format (PNG, JPG, or WebP), resolution (72–600 DPI), and which pages to convert."},
        {"name": "Convert and download", "text": "Click Convert. Each page becomes a separate image file, delivered in a ZIP archive."},
    ],

    # ── Image tools ───────────────────────────────────────────────────
    "heic-to-jpg": [
        {"name": "Upload HEIC/HEIF images", "text": "Select one or more .heic or .heif files from your iPhone or camera. Each file can be up to 500 MB."},
        {"name": "Choose output format and quality", "text": "Select JPG or PNG output. For JPG, set the quality slider (1–100). Higher values preserve detail at larger file sizes."},
        {"name": "Convert and download", "text": "Click Convert. EXIF orientation is applied automatically so images display correctly. Multiple files are delivered in a ZIP."},
    ],
    "remove-exif": [
        {"name": "Upload images", "text": "Select one or more JPG, PNG, or WebP images containing EXIF metadata."},
        {"name": "Preview metadata", "text": "The tool displays found metadata: GPS coordinates, camera model, date taken, software, and more."},
        {"name": "Strip metadata and download", "text": "Click Remove. All EXIF, IPTC, and XMP metadata is permanently stripped. The pixel data is untouched."},
    ],
    "image-compressor": [
        {"name": "Upload images", "text": "Select one or more images (JPG, PNG, WebP). Each file can be up to 500 MB."},
        {"name": "Set compression level", "text": "Choose a quality target or let the tool auto-optimize. For PNG, lossless compression is applied; for JPG, you can set the quality percentage."},
        {"name": "Download compressed images", "text": "Click Compress. The tool shows the original and compressed sizes side by side. Multiple files are returned in a ZIP."},
    ],
    "remove-background": [
        {"name": "Upload an image", "text": "Select a JPG, PNG, or WebP image up to 500 MB. Photos of people, products, and animals work best."},
        {"name": "Background removal runs automatically", "text": "The server uses an AI model to detect the foreground subject and remove the background. No manual tracing is needed."},
        {"name": "Download the result", "text": "Save the transparent PNG. You can also choose a solid-color replacement background before downloading."},
    ],

    # ── Video/media tools ─────────────────────────────────────────────
    "video-to-gif": [
        {"name": "Upload a video", "text": "Select an MP4, WebM, MOV, or AVI file up to 500 MB."},
        {"name": "Set GIF parameters", "text": "Choose the start time, duration (max 30 seconds recommended for file size), frame rate (10–30 fps), and output width."},
        {"name": "Convert and download", "text": "Click Convert. FFmpeg extracts the frames and optimizes the color palette for the smallest possible GIF."},
    ],
    "compress-video": [
        {"name": "Upload a video", "text": "Select an MP4, WebM, MOV, or AVI file up to 500 MB."},
        {"name": "Choose compression preset", "text": "Pick Light, Medium, or Heavy compression. Heavier settings reduce file size more but lower visual quality."},
        {"name": "Compress and download", "text": "Click Compress. The server re-encodes the video using FFmpeg with H.264/H.265. The result shows the file size reduction."},
    ],
    "trim-media": [
        {"name": "Upload an audio or video file", "text": "Select an MP4, MP3, WAV, WebM, or other media file up to 500 MB."},
        {"name": "Set the trim range", "text": "Use the waveform/timeline to set precise start and end times, or type timestamps manually (e.g. 00:30 to 02:15)."},
        {"name": "Trim and download", "text": "Click Trim. The server extracts the selected segment without re-encoding when possible, preserving original quality."},
    ],

    # ── Developer tools ───────────────────────────────────────────────
    "base64": [
        {"name": "Choose encode or decode mode", "text": "Select whether you want to encode data to Base64 or decode a Base64 string back to its original form."},
        {"name": "Enter input", "text": "Paste text into the editor, or upload a file (image, PDF, binary — up to 500 MB). For decoding, paste the Base64 string."},
        {"name": "Get the result", "text": "The output appears instantly. Copy the Base64 string to your clipboard, or download the decoded file."},
    ],
    "text-diff": [
        {"name": "Enter the two texts", "text": "Paste the original text on the left and the modified text on the right, or upload two text files."},
        {"name": "View the diff", "text": "Differences are highlighted inline: green for additions, red for deletions, and yellow for modifications."},
        {"name": "Choose diff mode", "text": "Switch between side-by-side and unified views. Line numbers help locate changes in large documents."},
        {"name": "Copy or download the diff", "text": "Copy the highlighted diff to your clipboard or download it as an HTML file for sharing."},
    ],
    "batch-compress-pdf": [
        {"name": "Upload PDF files", "text": "Select or drag up to 50 PDF files into the upload area. Each file can be up to 500 MB."},
        {"name": "Choose compression level", "text": "Select Light (minimal quality loss), Balanced (recommended), or Extreme (maximum size reduction)."},
        {"name": "Compress and download", "text": "Click Compress All. The server processes all files in parallel using 4-core processing and returns a ZIP with all compressed PDFs."},
    ],
    "pdf-page-counter": [
        {"name": "Upload PDFs", "text": "Select or drag up to 100 PDF files. Any mix of sizes and page counts is supported."},
        {"name": "View page counts", "text": "The tool instantly displays a table with each filename and its page count, plus the total across all files."},
        {"name": "Use the results", "text": "Copy the table for print quotes, billing, or document inventory. No download needed — results are shown on screen."},
    ],
    "image-upscaler": [
        {"name": "Upload an image", "text": "Select a JPG, PNG, or WebP image. The tool shows the current dimensions."},
        {"name": "Choose the scale", "text": "Select 2x (double) or 4x (quadruple) enlargement. The tool uses Lanczos resampling for sharp, artifact-free results."},
        {"name": "Download the upscaled image", "text": "Click Upscale. The enlarged image downloads in the same format as the original with the scale factor in the filename."},
    ],
    "audio-converter": [
        {"name": "Upload an audio file", "text": "Select an MP3, WAV, OGG, FLAC, AAC, or M4A file up to 200 MB."},
        {"name": "Choose output format and bitrate", "text": "Select the target format (MP3, WAV, OGG, FLAC, AAC) and bitrate (64k to 320k). Default is MP3 at 192k."},
        {"name": "Convert and download", "text": "Click Convert. FFmpeg processes the audio and the converted file downloads automatically."},
    ],

    # ── v1.1.0 + v1.2.0 additions ─────────────────────────────────────────
    "highlight-pdf": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB containing the text you want to highlight."},
        {"name": "Enter your search phrase", "text": "Type the word or phrase to highlight. Use the case-sensitive toggle for exact matches."},
        {"name": "Pick a highlight color", "text": "Choose yellow, green, pink, blue, or orange. Highlights are added as real PDF annotations."},
        {"name": "Download the highlighted PDF", "text": "Click Highlight. The tool finds every occurrence on every page and writes a new PDF with permanent highlight annotations."},
    ],
    "summarize-pdf": [
        {"name": "Open the tool and accept the model download", "text": "On first use the page downloads a ~250 MB AI summarization model (distilbart-cnn) into your browser. It caches in IndexedDB so subsequent visits are instant."},
        {"name": "Upload your PDF", "text": "Drag a PDF (any length, any topic) into the upload area. Text is extracted page-by-page using pdf.js — entirely in the browser."},
        {"name": "Choose a summary length", "text": "Pick short (paragraph), medium (page), or long (multi-page) depending on the source size and how much detail you want."},
        {"name": "Run summarization", "text": "Click Summarize. The transformer runs in WebAssembly inside your browser, processing chunks at sentence boundaries. No data leaves your machine."},
        {"name": "Copy or download the summary", "text": "When done, the summary appears below. Copy to clipboard or download as a text file."},
    ],
    "smart-redact": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. The first visit downloads a BERT NER model (~250 MB) into your browser; cached for future use."},
        {"name": "Wait for the NER scan", "text": "The model scans your document for names, emails, phone numbers, addresses, SSNs, credit cards, and other PII. Entirely client-side."},
        {"name": "Review and uncheck false positives", "text": "Proposed redactions are grouped by entity type. Uncheck anything that shouldn't be redacted."},
        {"name": "Apply redactions", "text": "Click Redact. The backend applies real PyMuPDF redactions — permanently removing the underlying content, not just covering it."},
    ],
    "split-in-half": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Best for two-up scans or scanned booklets."},
        {"name": "Choose direction", "text": "Vertical splits each page down the middle (left → right halves). Horizontal splits across the middle (top → bottom)."},
        {"name": "Split and download", "text": "Click Split. The result is a new PDF where each original page is replaced by its two halves in reading order."},
    ],
    "pdf-to-svg": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Best results come from vector PDFs."},
        {"name": "Convert and download", "text": "Click Convert. The tool extracts vector graphics page-by-page using PyMuPDF and packages the SVGs into a ZIP."},
    ],
    "pdf-to-html": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. PyMuPDF's HTML exporter preserves fonts and positioning."},
        {"name": "Download the HTML", "text": "Click Convert. The result is a single self-contained HTML file with inline styles — open it in any browser without needing the PDF."},
    ],
    "pdf-to-rtf": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB."},
        {"name": "Download the RTF", "text": "Click Convert. The RTF file opens in WordPad, Microsoft Word, Pages, LibreOffice, and any other RTF-aware editor. Unicode is preserved via RTF escape sequences."},
    ],
    "web-optimize-pdf": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB that you serve over the web or via a CDN."},
        {"name": "Linearize and download", "text": "Click Optimize. qpdf reorganizes the file structure so the first page renders before the whole document downloads — perfect for inline embeds and CDN-hosted PDFs."},
    ],
    "split-by-text": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB. Best for batch-style documents: monthly statements, multi-invoice exports, chapter-divided manuscripts."},
        {"name": "Enter the search phrase", "text": "Type the keyword that appears at the start of each section (e.g. 'Invoice #', 'Statement of', 'Chapter')."},
        {"name": "Toggle case sensitivity", "text": "Enable case-sensitive matching if your keyword's capitalization matters."},
        {"name": "Split and download", "text": "Click Split. Every page containing the keyword starts a new chunk. The result is a ZIP of part1.pdf, part2.pdf, etc."},
    ],
    "view-exif": [
        {"name": "Upload an image", "text": "Select a JPG, PNG, TIFF, WebP, HEIC, or BMP up to 500 MB."},
        {"name": "Inspect the metadata", "text": "The tool reads every EXIF, IPTC, and XMP field: camera make and model, lens info, ISO, exposure, GPS coordinates, capture timestamps, software versions, embedded copyright."},
        {"name": "Decide what to do next", "text": "If GPS coordinates are present they reveal where the photo was taken. Use Remove EXIF before publishing to strip them."},
    ],
    "jwt-decoder": [
        {"name": "Paste your JWT", "text": "Copy the full token (three dot-separated base64url segments) into the input area."},
        {"name": "Inspect the decoded structure", "text": "Header, payload, and signature are decoded in your browser. Standard claims (iss, sub, aud, exp, iat, nbf, jti) are highlighted; expiry status is shown."},
        {"name": "Copy decoded values", "text": "Click Copy on any section to grab the JSON. Decoding never sends your token to a server."},
    ],
    "regex-tester": [
        {"name": "Enter your regex pattern", "text": "Type the pattern. JavaScript RegExp syntax (same as in MDN docs)."},
        {"name": "Set flags", "text": "Combine g (global), i (case-insensitive), m (multiline), s (dotall), u (unicode), y (sticky)."},
        {"name": "Paste test text", "text": "Drop the text to match against. Matches highlight in real time as you edit either field."},
        {"name": "Read match details", "text": "Each match is listed with its offset, captured groups, and matched substring."},
    ],
    "timestamp-converter": [
        {"name": "Paste a timestamp", "text": "Enter a Unix epoch (seconds or milliseconds — auto-detected) or an ISO 8601 date string. Click Now to insert the current time."},
        {"name": "Read all formats side-by-side", "text": "The tool displays Unix seconds, Unix milliseconds, ISO 8601 (UTC), UTC string, local timezone, and a relative phrase ('in 3 hours', '2 days ago')."},
        {"name": "Copy what you need", "text": "Click Copy on any row. Useful for filling Cron entries, debugging API timestamps, or formatting logs."},
    ],
    "batch-compress-pdf": [
        {"name": "Upload multiple PDFs", "text": "Drag up to 50 PDF files. Up to 500 MB per file."},
        {"name": "Pick compression level", "text": "Light (modest reduction, best quality), Recommended (balanced — default), Extreme (smallest files, some image-quality loss)."},
        {"name": "Compress and download as ZIP", "text": "Click Compress. Files are processed in parallel across 4 workers. Results are bundled into a ZIP with a savings summary."},
    ],
    "pdf-page-counter": [
        {"name": "Upload up to 100 PDFs", "text": "Drag up to 100 PDF files. The tool reads only metadata, not content — page counts come back almost instantly."},
        {"name": "Read the per-file count", "text": "Each filename appears with its page count. The total across all files appears at the bottom — ideal for print quotes."},
    ],
    "webp-to-jpg": [
        {"name": "Upload a WebP image", "text": "Select a WebP file from your iPhone, Android, or any camera/browser export."},
        {"name": "Convert and download", "text": "Click Convert. The image becomes a JPEG with the same dimensions and aspect ratio. Default quality is 85 — visually identical for most uses."},
    ],
    "webp-to-png": [
        {"name": "Upload a WebP image", "text": "Select a WebP file. PNG conversion preserves transparency if the original has any."},
        {"name": "Convert and download", "text": "Click Convert. The result is a lossless PNG, typically 3–5x larger than the WebP source but universally compatible."},
    ],
    "heic-to-png": [
        {"name": "Upload a HEIC image", "text": "Select a HEIC or HEIF file (e.g., from an iPhone photo export)."},
        {"name": "Convert and download", "text": "Click Convert. The tool decodes via libheif and writes a PNG that opens in every browser and image editor."},
    ],

    # ── v1.4.0 — additional format converter aliases ─────────────────────
    "jpg-to-png": [
        {"name": "Upload a JPG image", "text": "Drag or select one or more .jpg / .jpeg files."},
        {"name": "Convert and download", "text": "Click Convert. PrivaTools re-encodes the JPEG as a lossless PNG, preserving every pixel and supporting transparency in re-edits."},
    ],
    "png-to-jpg": [
        {"name": "Upload a PNG image", "text": "Drop one or more PNG files — up to 200 MB total."},
        {"name": "Convert and download", "text": "Click Convert. Transparency is flattened to white and the result is saved as a JPEG at quality 85 — typically 70–90% smaller than the source PNG."},
    ],
    "jpg-to-webp": [
        {"name": "Upload a JPG", "text": "Select a JPEG file from camera, phone, or web."},
        {"name": "Convert and download", "text": "Click Convert. PrivaTools encodes the image as WebP, typically saving 25–35% in file size at the same visual quality."},
    ],
    "png-to-webp": [
        {"name": "Upload a PNG", "text": "Drop a PNG — transparency is preserved in the WebP output."},
        {"name": "Convert and download", "text": "Click Convert. The result is a WebP that is usually 60–80% smaller than the source PNG."},
    ],
    "tiff-to-jpg": [
        {"name": "Upload a TIFF", "text": "Select a .tif or .tiff file from a scanner or photo library."},
        {"name": "Convert and download", "text": "Click Convert. The first page (for multi-page TIFFs) is re-encoded as a JPEG at quality 85."},
    ],
    "tiff-to-png": [
        {"name": "Upload a TIFF", "text": "Select a .tif or .tiff file."},
        {"name": "Convert and download", "text": "Click Convert. The image is decoded with libtiff and written as a lossless PNG with full color depth preserved."},
    ],
    "bmp-to-jpg": [
        {"name": "Upload a BMP", "text": "Drop a Windows bitmap (.bmp) file."},
        {"name": "Convert and download", "text": "Click Convert. The uncompressed BMP is re-encoded as a JPEG — typically 10–50× smaller for photographs."},
    ],
    "bmp-to-png": [
        {"name": "Upload a BMP", "text": "Drop a Windows bitmap file (any depth: 1-bit, 8-bit, 24-bit, or 32-bit)."},
        {"name": "Convert and download", "text": "Click Convert. The BMP is re-encoded as a compressed lossless PNG, ideal for screenshots and pixel art."},
    ],
    "gif-to-jpg": [
        {"name": "Upload a GIF", "text": "Drop a GIF file. For animated GIFs, only the first frame is converted."},
        {"name": "Convert and download", "text": "Click Convert. PrivaTools extracts the first frame, flattens transparency to white, and saves as JPEG."},
    ],
    "gif-to-png": [
        {"name": "Upload a GIF", "text": "Drop a GIF — single-frame GIFs convert cleanly with transparency preserved."},
        {"name": "Convert and download", "text": "Click Convert. The first frame becomes a lossless PNG, perfect for icons and animated avatars converted to stills."},
    ],
    "m4a-to-mp3": [
        {"name": "Upload an M4A audio file", "text": "Drop a .m4a file (iTunes purchases, GarageBand exports, iPhone voice memos)."},
        {"name": "Convert and download", "text": "Click Convert. FFmpeg re-encodes the AAC audio inside the M4A container as a 192 kbps MP3, compatible with every player on earth."},
    ],
    "mp4-to-mp3": [
        {"name": "Upload an MP4 video", "text": "Drop an MP4 file up to 200 MB — music videos, lecture recordings, podcasts, anything with audio."},
        {"name": "Extract audio and download", "text": "Click Convert. PrivaTools extracts the audio track and re-encodes it as MP3, perfect for offline listening on any device."},
    ],
    "mov-to-mp4": [
        {"name": "Upload a MOV", "text": "Drop a QuickTime .mov file (the default format for iPhone/Mac screen recordings)."},
        {"name": "Convert and download", "text": "Click Convert. FFmpeg remuxes (or re-encodes when needed) the streams into an MP4 with H.264 video — universally playable."},
    ],
    "avi-to-mp4": [
        {"name": "Upload an AVI", "text": "Drop an .avi video — typical for older Windows captures."},
        {"name": "Convert and download", "text": "Click Convert. The result is an MP4 with H.264 video and AAC audio, ready for streaming on phones, browsers, and modern TVs."},
    ],
    "webm-to-mp4": [
        {"name": "Upload a WebM video", "text": "Drop a WebM file (VP8 or VP9). Browser screen recorders and many web exports use WebM by default."},
        {"name": "Convert and download", "text": "Click Convert. The video is re-encoded as H.264 MP4 for compatibility with iOS, older Android, and most editing software."},
    ],
    "mp4-to-webm": [
        {"name": "Upload an MP4 video", "text": "Drop an .mp4 file (H.264 or H.265)."},
        {"name": "Convert and download", "text": "Click Convert. The video is re-encoded as VP9 WebM — smaller files at the same quality, ideal for HTML5 video on the open web."},
    ],
    "yaml-to-json": [
        {"name": "Paste YAML", "text": "Drop any YAML document into the left textarea — a Kubernetes manifest, GitHub Actions workflow, Docker Compose file, or any configuration."},
        {"name": "Read JSON instantly", "text": "Equivalent JSON appears on the right, pretty-printed and validated. Click Copy to grab it. 100% in your browser — your config never touches our servers."},
    ],
    "json-to-yaml": [
        {"name": "Paste JSON", "text": "Drop valid JSON into the left textarea."},
        {"name": "Read YAML instantly", "text": "Clean YAML with proper indentation appears on the right, ready to paste into a Kubernetes, GitHub Actions, or Compose file. Click Copy to grab it. Pure-browser conversion."},
    ],
    "case-converter": [
        {"name": "Paste your text", "text": "Drop any string — a variable name, sentence, or paragraph — into the input box."},
        {"name": "Copy any case format", "text": "All 12 case variants (camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE, Title Case, sentence case, dot.case, path/case, and more) appear instantly. Click Copy on the one you want."},
    ],
    "cron-parser": [
        {"name": "Paste a cron expression", "text": "Enter a standard 5-field cron schedule: minute, hour, day of month, month, and weekday."},
        {"name": "Read the explanation", "text": "The tool validates each field and explains the schedule in plain language."},
        {"name": "Preview upcoming runs", "text": "Next run times are calculated locally in your browser timezone so you can verify the schedule before shipping it."},
    ],
    "sql-formatter": [
        {"name": "Paste SQL", "text": "Drop a compact SELECT, INSERT, UPDATE, DELETE, or JOIN-heavy query into the editor."},
        {"name": "Review formatted SQL", "text": "Keywords, clauses, commas, and boolean operators are line-broken into a readable layout."},
        {"name": "Copy the result", "text": "Use the formatted SQL in reviews, docs, migrations, dashboards, or database consoles."},
    ],
    "graphql-formatter": [
        {"name": "Paste GraphQL", "text": "Enter a query, mutation, fragment, or selection set in compact form."},
        {"name": "Format the operation", "text": "Braces, arguments, arrays, and comma-separated fields are indented in a readable shape."},
        {"name": "Copy the formatted query", "text": "Paste the result into your app, GraphiQL, Apollo Studio, or pull request."},
    ],
    "yaml-toml-converter": [
        {"name": "Choose a direction", "text": "Switch between YAML to TOML and TOML to YAML depending on the config format you need."},
        {"name": "Paste config", "text": "Common nested maps, strings, numbers, booleans, and arrays are parsed directly in your browser."},
        {"name": "Copy converted output", "text": "Use the converted config in pyproject.toml, Cargo.toml, app config, or deployment files."},
    ],
    "gitignore-generator": [
        {"name": "Pick stack templates", "text": "Choose templates such as Node, Python, Vite, Docker, Terraform, Go, Rust, macOS, or Windows."},
        {"name": "Review the generated file", "text": "The selected templates are combined into one readable .gitignore with section comments."},
        {"name": "Copy or download", "text": "Copy the text or download it directly as .gitignore for your repository root."},
    ],
    "semver-bumper": [
        {"name": "Enter the current version", "text": "Use a SemVer value such as 1.2.3 or v1.2.3-beta.1."},
        {"name": "Compare bump types", "text": "Patch, minor, major, and prerelease candidates are calculated side-by-side."},
        {"name": "Copy the release version", "text": "Use the chosen value in package manifests, tags, changelogs, and release notes."},
    ],
    "env-validator": [
        {"name": "Paste a .env file", "text": "Drop environment variable lines into the browser-only editor."},
        {"name": "Review warnings", "text": "The validator catches missing equals signs, invalid names, duplicate keys, empty values, unquoted spaces, and short-looking secrets."},
        {"name": "Fix and copy", "text": "Update your .env file until the report is clean, then copy the corrected content back to your project."},
    ],
    "json-to-csv-schema": [
        {"name": "Paste JSON", "text": "Enter a JSON object or array of objects. Nested objects are flattened to dot-notation columns."},
        {"name": "Inspect the inferred schema", "text": "Each column shows its inferred type and how many rows contain a value."},
        {"name": "Copy or download CSV", "text": "Export the flattened CSV for spreadsheets, BI tools, QA fixtures, or one-off data migrations."},
    ],
    # ── Phase 7 — competitor-gap tools (v1.5.0) ──────────────────────────
    "mute-video": [
        {"name": "Upload your video", "text": "Drag-and-drop MP4, MOV, WebM, MKV, AVI, or M4V — up to 200 MB."},
        {"name": "Click Mute Video", "text": "PrivaTools stream-copies the video and strips the audio track. The operation is lossless and takes about a second per minute of video."},
    ],
    "reverse-video": [
        {"name": "Upload a video", "text": "Drop an MP4/MOV/WebM/MKV/AVI file. Best with short clips — long files take exponentially longer."},
        {"name": "Click Reverse", "text": "Both video and audio are reversed in sync. Output is universal MP4 (H.264 + AAC) playable on every device."},
    ],
    "video-speed": [
        {"name": "Upload a video", "text": "Drop any MP4/MOV/WebM/MKV/AVI file."},
        {"name": "Pick a speed", "text": "Drag the slider from 0.25× (slow-mo) to 4× (hyperlapse). 1× is original speed."},
        {"name": "Click Change speed", "text": "FFmpeg's setpts filter handles the video and atempo filter handles audio pitch-correction so it doesn't sound like a chipmunk."},
    ],
    "audio-trim": [
        {"name": "Upload an audio file", "text": "Drop MP3, WAV, AAC, FLAC, OGG, or M4A — up to 200 MB."},
        {"name": "Set start and end", "text": "Type the start and end timestamps in HH:MM:SS format (e.g. 00:01:30 to 00:02:45)."},
        {"name": "Click Trim audio", "text": "Stream-copy preserves the original quality — no re-encoding."},
    ],
    "image-palette": [
        {"name": "Upload an image", "text": "Drop a JPG, PNG, WebP, BMP, TIFF, or GIF — up to 50 MB."},
        {"name": "Set the color count", "text": "Drag the slider from 2 to 24 colors. 6 is a good default for most brand/UI work."},
        {"name": "Copy any color", "text": "The dominant colors appear as swatches with HEX, rgb(), and coverage percentage. Click Copy on the one you want."},
    ],
    "pixelate-image": [
        {"name": "Upload an image", "text": "Drop a JPG, PNG, WebP, or BMP file with sensitive content you want to obscure."},
        {"name": "Choose effect + strength", "text": "Pick Pixelate (mosaic, still readable as 'something censored') or Blur (Gaussian, smoother). Strength slider 1-100."},
        {"name": "Download the result", "text": "The processed image downloads immediately. The original is deleted from the server seconds later."},
    ],
    "rotate-image": [
        {"name": "Upload an image", "text": "Drop a JPG, PNG, WEBP, HEIC, BMP, GIF, or TIFF — up to 50 MB."},
        {"name": "Pick a rotation angle", "text": "Click 90° (left/right), 180°, 270°, or enter any custom angle (e.g. 13° to straighten a tilted scan). The canvas auto-expands so nothing is cropped off."},
        {"name": "Click Rotate", "text": "Output downloads as the same format you uploaded; transparency is preserved for PNG and WEBP."},
    ],
    "flip-image": [
        {"name": "Upload an image", "text": "Drop a JPG, PNG, WEBP, HEIC, BMP, GIF, or TIFF up to 50 MB."},
        {"name": "Pick horizontal or vertical", "text": "Horizontal flips left↔right (mirror). Vertical flips top↔bottom (upside down)."},
        {"name": "Click Flip", "text": "The mirrored copy downloads instantly. Original quality and transparency are preserved."},
    ],

    # ── Auto-generated content for v1.3.1 SEO coverage push ──────────────
    "add-attachment": [
        {"name": "Upload the host PDF", "text": "Drop the PDF you want to embed a file inside (up to 500 MB)."},
        {"name": "Add the file to attach", "text": "Drop any file — image, spreadsheet, .zip, even another PDF. PrivaTools embeds it without altering the visible content."},
        {"name": "Download the result", "text": "Click Attach. The output PDF has your file embedded as an attachment; readers like Acrobat show it in the Attachments panel."},
    ],
    "add-hyperlinks": [
        {"name": "Upload your PDF", "text": "Select a PDF up to 500 MB."},
        {"name": "Define each link", "text": "Specify the page, rectangle coordinates (x, y, width, height in PDF points), and target URL. Coordinates use the PDF coordinate system where (0,0) is bottom-left."},
        {"name": "Download the linked PDF", "text": "Click Add Links. PrivaTools embeds clickable hyperlink annotations at each rectangle, opening the target URL on click in any PDF reader."},
    ],
    "add-shapes": [
        {"name": "Upload the PDF", "text": "Select a PDF up to 500 MB."},
        {"name": "Define shapes", "text": "For each shape, specify type (rectangle, ellipse, line, polygon), page number, coordinates, color, and stroke width."},
        {"name": "Apply and download", "text": "Click Add Shapes. The shapes are drawn directly onto the page content; they survive copy-paste, printing, and PDF/A conversion."},
    ],
    "alternate-mix": [
        {"name": "Upload two PDFs", "text": "Select two PDFs to interleave. They don't need the same page count."},
        {"name": "Choose mode", "text": "Alternate: page 1A, 1B, 2A, 2B… Reverse-alternate: same, but the second PDF is reversed first (useful for double-sided scans where the back side scans bottom-to-top)."},
        {"name": "Download the mixed PDF", "text": "Click Mix. The output is a single PDF with pages interleaved from both inputs."},
    ],
    "annotate-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Add annotations", "text": "Use the toolbar to add highlights, underlines, strikethroughs, sticky notes, and text boxes. Each annotation has a position, page, content, and color."},
        {"name": "Save and download", "text": "Click Save. Annotations are added as standard PDF annotation objects — they appear in every PDF reader and can be edited later."},
    ],
    "auto-crop": [
        {"name": "Upload the PDF", "text": "Drop a PDF up to 500 MB. Best for scanned documents with consistent margins."},
        {"name": "Let auto-detection scan", "text": "PrivaTools analyses the bounding box of actual content on each page using PyMuPDF — ignoring whitespace, page numbers in margins, and scan-edge artifacts."},
        {"name": "Download the cropped PDF", "text": "Click Auto Crop. Each page's MediaBox is shrunk to the detected content bounding box, eliminating dead margins."},
    ],
    "bates-numbering": [
        {"name": "Upload the PDF (or batch)", "text": "Drop a PDF up to 500 MB. Multi-PDF Bates batches are coming."},
        {"name": "Configure the Bates format", "text": "Set the prefix (e.g. BATES), starting number, padding digits (e.g. 0001), and position on the page (top/bottom × left/center/right)."},
        {"name": "Download with stamps", "text": "Click Apply. PrivaTools stamps each page with the next Bates number — e.g. BATES0001, BATES0002, etc."},
    ],
    "bmp-to-pdf": [
        {"name": "Upload BMP images", "text": "Drop one or many .bmp files. BMP is the legacy Windows bitmap format — uncompressed and lossless."},
        {"name": "Choose page size", "text": "Letter (8.5 × 11 in) or A4 (210 × 297 mm). Each BMP scales to fit the page while preserving aspect ratio."},
        {"name": "Download the PDF", "text": "Click Convert. All input images are combined into a single PDF, one image per page in upload order."},
    ],
    "booklet-pdf": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB. The page count is automatically padded to a multiple of 4 with blanks if needed."},
        {"name": "PrivaTools reorders pages for saddle-stitch", "text": "For an 8-page booklet, the output order is 8,1, 2,7, 6,3, 4,5 — so when printed double-sided and folded in half, the pages read in sequence."},
        {"name": "Download and print double-sided", "text": "Print the result two pages per sheet, double-sided, then fold in half. You get a perfect-bound booklet."},
    ],
    "compare-pdf": [
        {"name": "Upload two PDFs", "text": "The first is the baseline; the second is the revised version."},
        {"name": "Choose comparison mode", "text": "Text: word-level diff. Visual: side-by-side rendered pages with changes highlighted."},
        {"name": "Download or view the diff", "text": "PrivaTools returns a report PDF with additions in green and deletions in red, plus a summary of changed pages and word counts."},
    ],
    "crop-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Set crop margins", "text": "Specify top / bottom / left / right margins to remove, in PDF points (1 pt = 1/72 inch)."},
        {"name": "Download the cropped PDF", "text": "Click Crop. Each page's MediaBox + CropBox is shrunk by the specified margins."},
    ],
    "delete-annotations": [
        {"name": "Upload the PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Strip annotations", "text": "Click Delete. PrivaTools removes every annotation object (highlights, comments, sticky notes, form fields, links)."},
        {"name": "Download the cleaned PDF", "text": "The visible page content is unchanged; all interactive annotations are gone."},
    ],
    "delete-pages": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Specify pages to remove", "text": "Comma-separated list and/or ranges, e.g. '2, 5, 10-12'. The remaining pages keep their relative order."},
        {"name": "Download the trimmed PDF", "text": "Click Delete. PrivaTools returns a PDF with those pages removed; bookmarks pointing to deleted pages are rewritten to the next valid page."},
    ],
    "deskew-pdf": [
        {"name": "Upload a scanned PDF", "text": "Drop a scanned PDF up to 500 MB. Works best on documents where text lines are visible."},
        {"name": "PrivaTools detects skew per page", "text": "The algorithm analyses the text line angle on each page and computes the rotation needed to straighten it."},
        {"name": "Download the deskewed PDF", "text": "Each page is rotated by its detected angle (typically -5° to +5°) and the corners are cropped to fit. Result: text rows are perfectly horizontal."},
    ],
    "esign-pdf": [
        {"name": "Upload the PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Draw or type your signature", "text": "Use the canvas to draw with a finger or stylus, or type your name in a handwriting font."},
        {"name": "Place and apply", "text": "Drag the signature to where you want it, resize as needed, click Sign. The PDF is returned with the signature stamped on the selected page."},
    ],
    "excel-to-pdf": [
        {"name": "Upload an .xlsx file", "text": "Drop an Excel workbook up to 500 MB."},
        {"name": "PrivaTools converts each sheet to a PDF page", "text": "Cell values, formulas (as computed), formatting, and column widths are preserved. Each worksheet becomes one or more pages depending on content size."},
        {"name": "Download the PDF", "text": "Click Convert. The output PDF has one section per worksheet."},
    ],
    "extract-images": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "PrivaTools pulls out every image", "text": "Each embedded image (raster or vector) is extracted at its native resolution, with original format preserved (JPEG, PNG, TIFF, etc.)."},
        {"name": "Download as ZIP", "text": "All extracted images are bundled into a ZIP archive, named by page and order."},
    ],
    "extract-pages": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Specify pages to keep", "text": "Comma-separated list and/or ranges, e.g. '1, 3-5, 10'. Only those pages will be in the output."},
        {"name": "Download the extract", "text": "Click Extract. The output PDF contains only the specified pages in their original order."},
    ],
    "fill-form": [
        {"name": "Upload a fillable PDF form", "text": "Drop a PDF with AcroForm fields up to 500 MB. The tool detects form fields automatically."},
        {"name": "Fill in the values", "text": "Provide a JSON object mapping field names to values: text strings for text fields, true/false for checkboxes, option labels for radio buttons / dropdowns."},
        {"name": "Download the filled form", "text": "Click Fill. The PDF is returned with values populated. Field structure is preserved so the form can be filled again later."},
    ],
    "gif-to-pdf": [
        {"name": "Upload GIF images", "text": "Drop one or many .gif files. Animated GIFs use only the first frame."},
        {"name": "Choose page size", "text": "Letter or A4. Each GIF scales to fit while preserving aspect ratio."},
        {"name": "Download the PDF", "text": "All GIFs are combined into one PDF, one image per page in upload order."},
    ],
    "grayscale-pdf": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Convert all content to grayscale", "text": "PrivaTools renders each page at the source DPI, converts to single-channel grayscale, and re-embeds. Text, images, and vector content all become greyscale."},
        {"name": "Download the grayscale PDF", "text": "File size typically drops 30–50% because color channels are eliminated."},
    ],
    "header-footer": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Enter header and footer text", "text": "Optional left/center/right slots for both header and footer. Use placeholders like {page}, {total}, {date} for dynamic content."},
        {"name": "Apply and download", "text": "Click Apply. The text is stamped at the top and bottom of every page in the chosen font size."},
    ],
    "heic-to-pdf": [
        {"name": "Upload HEIC images", "text": "Drop one or many .heic / .heif files (e.g. from iPhone photos)."},
        {"name": "Choose page size", "text": "Letter or A4. Each HEIC is decoded via libheif and scaled to fit."},
        {"name": "Download the PDF", "text": "All images become one PDF, one photo per page. EXIF metadata is stripped by default."},
    ],
    "invert-colors": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose DPI for rendering", "text": "Higher DPI gives sharper output but larger file size. 150 DPI is the default; 300 for archival, 96 for web previews."},
        {"name": "Download the inverted PDF", "text": "Each page is rendered, inverted (white↔black, colors mapped to complements), and re-embedded."},
    ],
    "jpg-to-pdf": [
        {"name": "Drop your JPG images", "text": "Upload one or many .jpg / .jpeg files (PNG also works) up to 500 MB total. Photos enter isolated per-request storage only for the conversion pass."},
        {"name": "Reorder if needed", "text": "Drag thumbnails to set the page order. Each photo becomes one page in the output PDF."},
        {"name": "Choose page size", "text": "Letter, A4, or fit-to-image (where each page matches its source image dimensions exactly). EXIF orientation is honored automatically."},
        {"name": "Set margins (optional)", "text": "None (image edge-to-edge), small, medium, large, or custom. Useful for binding margins on printed copies."},
        {"name": "Download the PDF", "text": "Click Convert. All photos become a single PDF in your chosen order. EXIF GPS and camera metadata are stripped for privacy."},
    ],
    "markdown-to-pdf": [
        {"name": "Upload a Markdown file", "text": "Drop a .md file up to 500 MB."},
        {"name": "PrivaTools renders to HTML, then PDF", "text": "Standard Markdown syntax: headings, lists, links, images, code blocks, tables, blockquotes. GitHub-flavored extensions supported."},
        {"name": "Download the styled PDF", "text": "The output has a clean typographic style with proper headings, monospace code, and clickable links."},
    ],
    "metadata": [
        {"name": "Upload the PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "View the metadata", "text": "PrivaTools displays the document's Title, Author, Subject, Keywords, Producer, Creator, Creation Date, Modified Date, and any custom XMP fields."},
        {"name": "Decide what to do next", "text": "If you want to strip the metadata, use Strip Metadata. To set new values, use Update Metadata."},
    ],
    "nup": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose pages-per-sheet", "text": "2, 4, 6, 8, 9, or 16. Each input page is shrunk to fit; output pages are filled left-to-right, top-to-bottom."},
        {"name": "Download the n-up PDF", "text": "Use this to save paper when printing or to create thumbnail-style overviews."},
    ],
    "odt-to-pdf": [
        {"name": "Upload an .odt file", "text": "Drop an OpenDocument Text file (LibreOffice / OpenOffice) up to 500 MB."},
        {"name": "PrivaTools renders via LibreOffice headless", "text": "Fonts, styles, embedded images, tables, footnotes, and bibliography are preserved."},
        {"name": "Download the PDF", "text": "Click Convert. The output PDF matches the on-screen rendering closely."},
    ],
    "organize-pages": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB. Each page renders as a thumbnail."},
        {"name": "Drag and rearrange", "text": "Reorder, rotate, or delete pages visually. Use Duplicate to repeat a page."},
        {"name": "Apply and download", "text": "Click Save. The output PDF has pages in your specified order."},
    ],
    "overlay": [
        {"name": "Upload the base PDF", "text": "The PDF that forms the background."},
        {"name": "Upload the overlay PDF", "text": "A PDF whose pages will be layered on top of the base."},
        {"name": "Choose mode and download", "text": "Overlay: foreground on top. Underlay: behind. Stamp: applied to every page repeatedly. Output: a merged PDF with the overlay rendered onto each base page."},
    ],
    "page-numbers": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose position and starting number", "text": "Position: top-left/top-center/top-right/bottom-left/bottom-center/bottom-right. Starting number: defaults to 1, but use any integer to continue a multi-document sequence."},
        {"name": "Apply and download", "text": "PrivaTools stamps each page with its number in the chosen position and font size."},
    ],
    "pdf-to-bmp": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose DPI", "text": "Higher DPI gives sharper output. 150 DPI for screen, 300 for print, 600 for archival."},
        {"name": "Download a ZIP of BMPs", "text": "Each page becomes one BMP file. BMP is uncompressed so files are LARGE — typically 5-30 MB per page at 300 DPI."},
    ],
    "pdf-to-epub": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB. Works best on text-heavy PDFs with a clear structure."},
        {"name": "PrivaTools extracts text and reflows it", "text": "Headings, paragraphs, lists, and embedded images are identified and converted into EPUB chapter structure."},
        {"name": "Download the EPUB", "text": "Open in any e-reader (Kindle, Apple Books, calibre) for a reflowable reading experience."},
    ],
    "pdf-to-gif": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose DPI", "text": "Lower DPI for smaller files; GIF is limited to 256 colors so detail loss is acceptable for previews."},
        {"name": "Download a ZIP of GIFs", "text": "Each page becomes one GIF file. Useful for embedding PDF previews in legacy systems."},
    ],
    "pdf-to-jpg": [
        {"name": "Drop your PDF", "text": "Upload a PDF up to 500 MB. The file enters isolated per-request storage only for the conversion pass — no copy is kept after your download."},
        {"name": "Choose DPI", "text": "96 DPI for web preview/thumbnails, 150 DPI for general on-screen viewing (default), 300 DPI for printable copies, 600 DPI for archival. Higher DPI means larger files."},
        {"name": "Set JPEG quality", "text": "Quality 70-95 (default 85). Lower values produce smaller files with more visible compression artifacts; higher values are nearly indistinguishable from the source."},
        {"name": "Pick pages (optional)", "text": "Enter ranges like '1-3, 7, 12-15' to convert only specific pages, or leave blank to convert every page."},
        {"name": "Convert and download", "text": "Click Convert. Each page becomes one JPG. Multi-page PDFs return as a ZIP; single-page PDFs return as a single JPG file."},
    ],
    "pdf-to-markdown": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB. Text-heavy PDFs convert best."},
        {"name": "PrivaTools extracts and structures text", "text": "Headings, paragraphs, lists, code blocks, and tables are identified by typographic cues (font size, weight, indentation)."},
        {"name": "Download the .md file", "text": "Open in any Markdown editor for editing or further conversion to HTML / EPUB / DOCX."},
    ],
    "pdf-to-png": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose DPI", "text": "Higher DPI = sharper PNG. 96 for screen, 150 default, 300 for print archival."},
        {"name": "Download a ZIP of PNGs", "text": "Each page becomes one PNG file with lossless compression. PNG preserves transparency if present."},
    ],
    "pdf-to-pptx": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "PrivaTools creates one slide per page", "text": "Each page is rendered to an image and placed as the slide background. Text is also extracted as separate slide text boxes for editability."},
        {"name": "Download the .pptx file", "text": "Open in PowerPoint / Keynote / Google Slides for further editing."},
    ],
    "pdf-to-tiff": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose DPI", "text": "Higher DPI = sharper TIFF. 300 DPI is standard for archival; 600 for high-resolution professional output."},
        {"name": "Download the TIFF", "text": "PrivaTools produces a single multi-page TIFF (one image per PDF page) or a ZIP of individual TIFFs."},
    ],
    "pdfa-validator": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB to check whether it conforms to PDF/A archive standards."},
        {"name": "PrivaTools runs a conformance check", "text": "Tests against PDF/A-1, PDF/A-2, and PDF/A-3 requirements: embedded fonts, color profiles, no JavaScript, no encryption, no external references."},
        {"name": "Read the validation report", "text": "Either 'compliant' with the highest PDF/A level achieved, or a list of specific violations preventing compliance."},
    ],
    "png-to-pdf": [
        {"name": "Upload PNG images", "text": "Drop one or many .png files up to 500 MB total."},
        {"name": "Choose page size", "text": "Letter or A4. Transparency in PNGs renders against a white page background."},
        {"name": "Download the PDF", "text": "All images become a single PDF, one per page. Lossless — PNG pixels map directly to PDF image objects."},
    ],
    "pptx-to-pdf-convert": [
        {"name": "Upload a .pptx file", "text": "Drop a PowerPoint presentation up to 500 MB."},
        {"name": "Each slide becomes one PDF page", "text": "PrivaTools renders fonts, animations (first state), embedded images, and SmartArt diagrams."},
        {"name": "Download the PDF", "text": "The output preserves slide aspect ratio (16:9 or 4:3 as designed)."},
    ],
    "qr-code": [
        {"name": "Enter the data to encode", "text": "URL, contact card (vCard), wifi credentials, plain text, or any string up to ~2,500 characters."},
        {"name": "Choose size and format", "text": "Pixel dimensions of the output QR. Format: PNG (raster) or SVG (vector, scales infinitely)."},
        {"name": "Download the QR", "text": "PrivaTools generates a QR code with error correction level L (default; supports up to 7% damage)."},
    ],
    "remove-blank-pages": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB. Best for scanned documents with intermittent blank pages."},
        {"name": "Set sensitivity", "text": "1-99. Higher values delete only entirely-blank pages; lower values also delete pages with very little content (good for scanner artifacts)."},
        {"name": "Download the cleaned PDF", "text": "PrivaTools removes pages whose content density is below the threshold."},
    ],
    "repair-pdf": [
        {"name": "Upload the corrupt PDF", "text": "Drop a PDF up to 500 MB that won't open or shows errors in your viewer."},
        {"name": "PrivaTools rebuilds the file structure", "text": "Uses pikepdf to parse the PDF tolerantly, recover damaged cross-reference tables, and rewrite the file with a clean structure."},
        {"name": "Download the repaired PDF", "text": "Most viewer-breaking issues (broken xref, missing trailer, corrupted streams) are fixable."},
    ],
    "resize-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose target page size", "text": "A4, Letter, Legal, Tabloid, or custom dimensions in millimeters/inches."},
        {"name": "Download the resized PDF", "text": "PrivaTools scales each page's MediaBox to the target. Content is preserved at relative position; aspect ratio is maintained."},
    ],
    "reverse-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Reverse the page order", "text": "Page N becomes page 1, page N-1 becomes page 2, etc."},
        {"name": "Download the reversed PDF", "text": "Useful for fixing back-to-front scans, creating countdown documents, or reverse-chronological annual reports."},
    ],
    "rtf-to-pdf": [
        {"name": "Upload an .rtf file", "text": "Drop a Rich Text Format file (Word, WordPad, TextEdit, Pages all save in RTF)."},
        {"name": "PrivaTools renders to PDF", "text": "Bold, italic, underline, paragraph styles, lists, tables, and embedded images transfer faithfully."},
        {"name": "Download the PDF", "text": "Click Convert. Open in any PDF viewer."},
    ],
    "sanitize-pdf": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB containing potentially risky elements."},
        {"name": "PrivaTools removes risky content", "text": "Strips embedded JavaScript, executable links to external apps, embedded files marked for auto-launch, and hidden 'flash' (deprecated SWF) content."},
        {"name": "Download the sanitized PDF", "text": "Visible content is preserved; security-risky elements are gone."},
    ],
    "set-permissions": [
        {"name": "Upload a PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Set an owner password and permissions", "text": "Choose which operations are allowed for users without the owner password: print, copy text, modify, annotate."},
        {"name": "Download the protected PDF", "text": "Anyone without the owner password is limited to the allowed operations. The PDF itself still opens without a password (use Protect PDF if you want a user password too)."},
    ],
    "split-by-bookmarks": [
        {"name": "Upload a PDF with bookmarks", "text": "Drop a PDF whose Table of Contents uses bookmarks to mark chapters/sections."},
        {"name": "PrivaTools splits at every top-level bookmark", "text": "Each section between consecutive bookmarks becomes its own PDF file."},
        {"name": "Download the ZIP", "text": "Each chapter is named after its bookmark text (sanitized for filesystem safety)."},
    ],
    "stamp-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Choose a stamp", "text": "Preset: APPROVED, CONFIDENTIAL, COPY, DRAFT, FINAL, NOT APPROVED, SAMPLE, VOID. Or custom: your own text."},
        {"name": "Set opacity and position", "text": "Opacity 0-1 (default 0.5). Position: top/middle/bottom × left/center/right. Click Apply."},
    ],
    "strip-metadata": [
        {"name": "Upload PDF(s)", "text": "Drop one or many PDFs up to 500 MB each. Multi-file batches are supported."},
        {"name": "PrivaTools removes all metadata", "text": "Title, Author, Subject, Keywords, Producer, Creator, Creation Date, Modified Date, all XMP fields, and any custom-defined metadata."},
        {"name": "Download the clean PDF (or ZIP)", "text": "Single file → single PDF; multiple files → ZIP. Visible content is unchanged."},
    ],
    "svg-to-pdf": [
        {"name": "Upload SVG images", "text": "Drop one or many .svg files. Vector content scales infinitely."},
        {"name": "Choose page size", "text": "Letter or A4. Each SVG scales proportionally to fit while preserving aspect ratio."},
        {"name": "Download the PDF", "text": "All SVGs become one PDF, one per page. Vector content stays vector — no rasterization."},
    ],
    "tiff-to-pdf": [
        {"name": "Upload TIFF images", "text": "Drop .tif / .tiff files. Multi-page TIFFs are supported and each page becomes a PDF page."},
        {"name": "Choose page size", "text": "Letter or A4. Single-page TIFFs scale; multi-page TIFFs preserve their per-page sizes."},
        {"name": "Download the PDF", "text": "All TIFFs become one PDF. Compression (LZW, Deflate, JPEG inside TIFF) is converted to PDF-native equivalents."},
    ],
    "transparent-background": [
        {"name": "Upload a PDF (or image)", "text": "Drop a PDF up to 500 MB. PrivaTools renders each page and detects the background color."},
        {"name": "Set threshold", "text": "How close to pure white (or off-white) should be treated as background. 240 (default) catches most scanned documents."},
        {"name": "Download with transparency", "text": "The output has white/off-white pixels converted to alpha=0. Useful for overlaying scans on dark backgrounds."},
    ],
    "verify-signature": [
        {"name": "Upload a signed PDF", "text": "Drop a PDF with one or more digital signatures."},
        {"name": "PrivaTools verifies each signature", "text": "Checks that the signed content hasn't been modified since signing, the certificate chain is intact, and the signing date is consistent."},
        {"name": "Read the report", "text": "For each signature: signer name, signing time, certificate authority, validity status (valid / modified / expired / untrusted CA)."},
    ],
    "webp-to-pdf": [
        {"name": "Upload WebP images", "text": "Drop one or many .webp files up to 500 MB total."},
        {"name": "Choose page size", "text": "Letter or A4. Transparency in WebP is rendered against a white page background."},
        {"name": "Download the PDF", "text": "All images become one PDF in upload order. WebP's smaller size is reflected in a smaller PDF."},
    ],
    "whiteout-pdf": [
        {"name": "Upload your PDF", "text": "Drop a PDF up to 500 MB."},
        {"name": "Draw white-out rectangles", "text": "Specify region(s) per page to cover with white (or chosen color). Content underneath is permanently hidden from view."},
        {"name": "Download the cleaned PDF", "text": "Hidden regions are covered with the chosen color in the rendered output."},
    ],
    "add-subtitles": [
        {"name": "Upload a video", "text": "Drop an MP4/MOV/MKV file up to 500 MB."},
        {"name": "Upload an SRT subtitle file", "text": "Standard SubRip Text format with timestamps and dialogue."},
        {"name": "Choose to burn-in or soft-encode and download", "text": "Burn-in: subtitles are rendered into the video pixels (permanent, plays everywhere). Soft: subtitles are a separate track (toggleable in supporting players)."},
    ],
    "audio-merge": [
        {"name": "Upload audio files", "text": "Drop 2 or more audio files (MP3, WAV, OGG, FLAC, AAC). Maximum 200 MB per file."},
        {"name": "Reorder if needed", "text": "Drag thumbnails to set the concatenation order."},
        {"name": "Download the merged audio", "text": "FFmpeg concatenates the files into one output. Format defaults to the first input's format."},
    ],
    "color-converter": [
        {"name": "Enter a color in any format", "text": "HEX (#FF5733), RGB (255, 87, 51), HSL (10, 100%, 60%), or named (coral, tomato, etc.)."},
        {"name": "PrivaTools shows the same color in every format", "text": "Live conversion: HEX, RGB, RGBA, HSL, HSLA, HSV, CMYK, and named-color match (if any)."},
        {"name": "Copy the value you need", "text": "Click any value to copy. Runs entirely in your browser — no network roundtrip."},
    ],
    "create-zip": [
        {"name": "Upload files", "text": "Drop multiple files of any type, up to 500 MB per file."},
        {"name": "Choose compression level", "text": "Use Store for speed, Balanced for everyday ZIPs, or Maximum for the smallest output."},
        {"name": "Download the ZIP", "text": "All files are bundled into a single .zip with their original filenames and extensions."},
    ],
    "csv-json": [
        {"name": "Paste your CSV or JSON", "text": "Or upload a file. Auto-detects the format."},
        {"name": "Click Convert", "text": "CSV → JSON: each row becomes an object using the first row as keys. JSON → CSV: array of objects → rows; keys → header."},
        {"name": "Copy or download the result", "text": "Runs entirely in your browser. Your data never leaves your device."},
    ],
    "extract-archive": [
        {"name": "Upload an archive", "text": "Drop a .zip, .tar, .tar.gz, .tar.bz2, or .tar.xz archive up to 500 MB."},
        {"name": "PrivaTools extracts and returns each file", "text": "All files inside are extracted and bundled into a folder-style download."},
        {"name": "Download the extracted folder as a ZIP", "text": "Or download individual files from the result preview."},
    ],
    "extract-audio": [
        {"name": "Upload a video file", "text": "Drop an MP4/MOV/MKV/WebM file up to 500 MB."},
        {"name": "Choose output format", "text": "MP3 (universal), WAV (uncompressed), OGG (open), FLAC (lossless), AAC (high quality)."},
        {"name": "Download the audio track", "text": "FFmpeg extracts the audio stream and re-encodes (or copies, for matching formats) to the chosen format."},
    ],
    "generate-barcode": [
        {"name": "Enter the data to encode", "text": "The string or number you want to encode. Format limits vary (e.g. EAN-13 needs exactly 12-13 digits)."},
        {"name": "Choose barcode type", "text": "Code 128 (most flexible), Code 39, EAN-13 (retail), UPC-A (US retail), QR code (also available via the QR tool)."},
        {"name": "Download as PNG", "text": "Configurable size; ready for printing on labels or embedding in documents."},
    ],
    "generate-favicon": [
        {"name": "Upload a square image", "text": "PNG, JPG, or SVG. PrivaTools resizes to favicon dimensions automatically."},
        {"name": "PrivaTools generates the favicon bundle", "text": "Multiple resolutions (16×16, 32×32, 48×48, 192×192, 512×512) plus Apple Touch Icon + manifest.json + meta tags HTML snippet."},
        {"name": "Download the bundle", "text": "Drop into your site's public/ folder, paste the meta tags into <head>."},
    ],
    "gif-to-mp4": [
        {"name": "Upload an animated GIF", "text": "Drop a .gif file up to 500 MB."},
        {"name": "PrivaTools converts via FFmpeg", "text": "GIF frames become MP4 frames at the source frame rate. H.264 codec for universal compatibility."},
        {"name": "Download the MP4", "text": "Typically 5-10x smaller than the source GIF, with smoother playback."},
    ],
    "hash-generator": [
        {"name": "Type or paste your input", "text": "Or upload a file. Files are read into the browser via FileReader."},
        {"name": "Choose hash algorithm", "text": "MD5, SHA-1, SHA-256, SHA-384, SHA-512. SHA-256 is the modern recommendation."},
        {"name": "Copy the hex digest", "text": "Runs entirely in your browser using the Web Crypto API. Input never leaves your machine."},
    ],
    "image-converter": [
        {"name": "Upload an image", "text": "PNG, JPG, WebP, BMP, TIFF, GIF, HEIC."},
        {"name": "Choose target format", "text": "Convert to any other supported format. Quality slider available for JPG output."},
        {"name": "Download the converted image", "text": "Dimensions preserved; metadata stripped by default."},
    ],
    "image-ocr": [
        {"name": "Upload an image", "text": "JPG, PNG, TIFF, WebP up to 500 MB."},
        {"name": "Select OCR language", "text": "17 Tesseract languages available: English, French, German, Spanish, Italian, Portuguese, Dutch, Russian, Polish, Turkish, Japanese, Korean, Chinese Simplified, Chinese Traditional, Arabic, Hindi, Vietnamese."},
        {"name": "Download as text or JSON", "text": "Plain text: all detected text. JSON: text + per-word bounding boxes for layout-aware processing."},
    ],
    "image-watermark": [
        {"name": "Upload an image", "text": "JPG, PNG, WebP up to 500 MB."},
        {"name": "Enter watermark text and styling", "text": "Text, opacity (0-1), position (corners or center), font size."},
        {"name": "Download the watermarked image", "text": "PrivaTools overlays the text at the chosen position with the chosen opacity. Original is unchanged."},
    ],
    "json-xml-formatter": [
        {"name": "Paste JSON or XML", "text": "Or upload a file. Auto-detects format from braces / tags."},
        {"name": "Click Format", "text": "Adds indentation, proper line breaks, sorted keys (optional). Removes extra whitespace."},
        {"name": "Copy or download the result", "text": "Runs entirely in your browser."},
    ],
    "lorem-ipsum": [
        {"name": "Choose paragraphs, sentences, or words", "text": "Specify how much placeholder text you need."},
        {"name": "Click Generate", "text": "Standard Lorem Ipsum (Cicero's De Finibus, scrambled) — the publishing industry standard since the 1500s."},
        {"name": "Copy and use in your mockups", "text": "Runs entirely in your browser."},
    ],
    "make-collage": [
        {"name": "Upload 2+ images", "text": "Drop multiple JPG/PNG/WebP images, up to 500 MB total."},
        {"name": "Set columns + spacing + background", "text": "Columns: how wide the collage is. Spacing: gap between images. Background color: visible in the spacing."},
        {"name": "Download the collage", "text": "PrivaTools arranges the images in a grid and outputs one JPG file."},
    ],
    "markdown-html": [
        {"name": "Paste Markdown or HTML", "text": "Auto-detects direction. Markdown → HTML for publishing; HTML → Markdown for content extraction."},
        {"name": "Click Convert", "text": "Standard CommonMark spec for Markdown. HTML converts to GitHub-flavored Markdown."},
        {"name": "Copy the result", "text": "Runs entirely in your browser."},
    ],
    "merge-images": [
        {"name": "Upload 2+ images", "text": "JPG, PNG, WebP — at least 2 files."},
        {"name": "Choose direction", "text": "Vertical: top-to-bottom (good for screenshots in sequence). Horizontal: side-by-side (good for before/after)."},
        {"name": "Download the merged image", "text": "Each input is scaled to a common dimension and concatenated."},
    ],
    "password-generator": [
        {"name": "Choose length and character classes", "text": "Length 8-100. Include uppercase / lowercase / digits / symbols / exclude ambiguous (1lI0O)."},
        {"name": "Click Generate", "text": "Uses Web Crypto API's secureRandomValues — cryptographically strong random."},
        {"name": "Copy the password", "text": "Runs entirely in your browser. The password is never logged anywhere."},
    ],
    "qr-reader": [
        {"name": "Upload an image with a QR code", "text": "JPG, PNG, WebP, or BMP. The QR code should be reasonably in-focus."},
        {"name": "PrivaTools decodes via pyzbar", "text": "Detects the QR code anywhere in the image, regardless of orientation or partial occlusion (up to ~30%)."},
        {"name": "Read the decoded data", "text": "Plain text, URL, vCard, WiFi credentials, or whatever the QR encoded."},
    ],
    "resize-crop-image": [
        {"name": "Upload an image", "text": "JPG, PNG, WebP up to 500 MB."},
        {"name": "Set target dimensions and mode", "text": "Resize: scale to fit (preserves aspect ratio with padding) or fill (crops to fill). Crop: cut to exact dimensions from the center."},
        {"name": "Download the result", "text": "Single processed image at the specified dimensions."},
    ],
    "subtitle-converter": [
        {"name": "Upload an SRT / VTT / ASS subtitle file", "text": "Auto-detects format from extension and content."},
        {"name": "Choose target format", "text": "SRT (universal). VTT (web video). ASS (advanced styling)."},
        {"name": "Download the converted subtitles", "text": "Runs entirely in your browser."},
    ],
    "svg-to-png": [
        {"name": "Upload an SVG", "text": "Drop a .svg file."},
        {"name": "Choose scale factor", "text": "1x = SVG native size. 2x, 3x, 4x for higher-resolution exports."},
        {"name": "Download the PNG", "text": "PrivaTools rasterizes the vector via cairosvg at the chosen scale with anti-aliasing."},
    ],
    "url-encoder": [
        {"name": "Paste a string, URL, or JWT", "text": "Auto-detects the input type."},
        {"name": "Choose encode or decode", "text": "URL encode: spaces → %20, etc. URL decode: %20 → spaces. JWT decode: header.payload.signature → parsed JSON."},
        {"name": "Copy the result", "text": "Runs entirely in your browser."},
    ],
    "url-to-pdf": [
        {"name": "Enter the URL to convert", "text": "Any public web page."},
        {"name": "PrivaTools fetches and renders", "text": "WeasyPrint loads the page (with CSS, images, fonts) and renders it as a print-quality PDF."},
        {"name": "Download the PDF", "text": "Click Convert. Pagination follows print CSS rules; links remain clickable."},
    ],
    "uuid-generator": [
        {"name": "Choose UUID version", "text": "v4 (random — most common). v1 (time + MAC — rare). v7 (time-sortable random — modern recommendation)."},
        {"name": "Choose bulk count", "text": "1 to 1000 UUIDs at once."},
        {"name": "Copy or download as text", "text": "Runs entirely in your browser using Web Crypto API."},
    ],
    "video-converter": [
        {"name": "Upload a video", "text": "MP4, WebM, MOV, AVI, MKV — up to 500 MB."},
        {"name": "Choose target format", "text": "MP4 (universal), WebM (open, smaller), MOV (Apple), AVI (legacy), MKV (open container)."},
        {"name": "Download the converted video", "text": "FFmpeg transcodes via the appropriate codec (H.264 for MP4, VP9/Opus for WebM, etc.)."},
    ],
    "video-merge": [
        {"name": "Upload 2+ videos", "text": "MP4 / MOV / MKV / WebM, up to 500 MB each."},
        {"name": "Reorder if needed", "text": "Drag to set concatenation order."},
        {"name": "Download the merged video", "text": "FFmpeg concatenates the videos. If audio formats differ, audio is re-encoded to AAC."},
    ],
    "video-resizer": [
        {"name": "Upload a video", "text": "MP4 / MOV / MKV / WebM up to 500 MB."},
        {"name": "Choose preset", "text": "480p (SD), 720p (HD), 1080p (Full HD), 1440p (QHD), 2160p (4K)."},
        {"name": "Download the resized video", "text": "FFmpeg scales the video to the target height while preserving aspect ratio."},
    ],
    "video-thumbnail": [
        {"name": "Upload a video", "text": "MP4 / MOV / MKV / WebM up to 500 MB."},
        {"name": "Choose timestamp", "text": "Time in seconds (e.g. 5.5 = 5.5 seconds in). Default is the middle of the video."},
        {"name": "Download the frame as PNG", "text": "FFmpeg extracts the exact frame at that timestamp."},
    ],
    "video-to-pdf": [
        {"name": "Upload a video", "text": "MP4 / MOV / MKV / WebM up to 500 MB."},
        {"name": "Choose number of frames", "text": "3-30. PrivaTools picks evenly-spaced keyframes across the video."},
        {"name": "Download the PDF", "text": "Each frame becomes one PDF page. Useful for storyboards, content review, or accessibility."},
    ],
    "word-counter": [
        {"name": "Paste your text", "text": "Or type directly. Counter updates as you type."},
        {"name": "Read live stats", "text": "Word count, character count (with/without spaces), sentence count, paragraph count, reading time at 200 wpm."},
        {"name": "Optional metrics", "text": "Average word length, longest word, most-frequent words."},
    ],
}


# ---------------------------------------------------------------------------
# FAQ  –  tool slug → list of {q, a}
# ---------------------------------------------------------------------------
TOOL_FAQ: dict[str, list[dict[str, str]]] = {
    "merge-pdf": [
        {"q": "How many PDFs can I merge at once?", "a": "There is no hard cap on the number of files. Each individual file must be under 500 MB. We routinely handle merges of 30–50 files in one call; if you need more, run the merge twice."},
        {"q": "Are bookmarks and hyperlinks preserved?", "a": "Yes. Existing bookmarks, internal links, and external hyperlinks from every input file are preserved in the merged output. Bookmarks are renamed with a numeric prefix so two PDFs with the same chapter titles don't collide."},
        {"q": "Will PrivaTools watermark the merged PDF?", "a": "No. The output has zero watermarks, no PrivaTools tag in the metadata, and no header/footer added. iLovePDF and Smallpdf both add a watermark or limit free merges to 2 files; PrivaTools has no such limit."},
        {"q": "Is it safe to upload sensitive PDFs to be merged?", "a": "Yes. Files enter an isolated Docker container, are processed in temporary per-request storage, and are unlinked the moment the response is delivered. They are never written to permanent storage, never logged, and never used to train any model. The merger code is open source on GitHub."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no per-day or per-month quota. The merged output can be any size — the only constraint is each input file."},
        {"q": "Do I need to create an account to merge PDFs?", "a": "No. No account, no email, no sign-up. Drop the files, drag to reorder, click Merge, and download. The privacy guarantees come from the architecture, not from a user profile."},
    ],
    "split-pdf": [
        {"q": "Can I split a PDF into individual pages?", "a": "Yes — pick the 'Extract every page' option to get every page as a separate PDF file, all packaged into a ZIP download. There is no cap on the number of pages."},
        {"q": "Can I extract non-consecutive pages like 1, 5, and 12?", "a": "Yes. Switch to 'Custom ranges' and enter exact page numbers or ranges: e.g. `1, 5, 12` or `1-3, 12-15`. Each range becomes a separate PDF in the output ZIP."},
        {"q": "What happens to bookmarks and hyperlinks when I split?", "a": "Bookmarks inside the extracted page range are preserved with adjusted page numbers. Bookmarks pointing outside the range are dropped. Internal hyperlinks to pages outside the range are removed; external hyperlinks are kept intact."},
        {"q": "Is the original PDF modified?", "a": "No. The split is non-destructive — the original is read, the output is written to a fresh file, and the input file is deleted from the server within minutes of the response. Your original on your device is untouched."},
        {"q": "Is my PDF uploaded to the cloud?", "a": "It is uploaded to PrivaTools' own isolated container for processing, held in temporary per-request storage, then unlinked immediately. It is never kept in permanent storage, never inspected, never shared with any third party. The split logic is open source on GitHub for verification."},
        {"q": "What's the difference between Split, Split by Size, and Split by Bookmarks?", "a": "Split lets you pick page ranges manually. Split by Size keeps each chunk under a target file size (e.g. 10 MB for email). Split by Bookmarks auto-splits at every chapter using the PDF's existing outline tree."},
    ],
    "split-by-size": [
        {"q": "How does size-based splitting work?", "a": "The tool splits at page boundaries to keep each chunk under your target size. It cannot split in the middle of a page, so some chunks may be slightly under the target."},
        {"q": "What is the minimum chunk size I can set?", "a": "The minimum is effectively the size of the largest single page. If one page is 5 MB, you cannot create chunks smaller than 5 MB."},
        {"q": "Is this useful for email attachment limits?", "a": "Yes. Set the chunk size to your email provider's attachment limit (e.g. 25 MB for Gmail) and each part will be small enough to attach."},
    ],
    "compress-pdf": [
        {"q": "How much smaller will my PDF actually get?", "a": "Most PDFs shrink 50–75%. Scanned PDFs with large embedded images often see 70–90% reduction; text-heavy PDFs with vector graphics may only shrink 5–15% because the text is already minimally encoded."},
        {"q": "Will I lose quality when I compress?", "a": "Text and vector graphics are always lossless — you cannot tell them apart from the original. Only embedded raster images are recompressed, and only at the Recommended or Extreme presets. Use the Light preset to keep images untouched."},
        {"q": "Is it safe to upload a sensitive PDF here?", "a": "Yes. The compressed file is processed in an isolated Docker container, held in temporary per-request storage for the duration of the request, and unlinked the moment the response is delivered. The file is never written to permanent storage, never logged, and never used to train any model. The entire stack is open source so you can verify this on GitHub."},
        {"q": "What's the file size limit?", "a": "500 MB per file. There is no daily, weekly, or monthly quota — you can compress unlimited files. If you need to compress dozens of files at once, use the Batch Compress PDF tool which accepts up to 50 PDFs in one go."},
        {"q": "Can I compress a password-protected PDF?", "a": "Not directly — encryption prevents the compressor from rewriting the content streams. Use the Unlock PDF tool first (you'll need the password), compress the unlocked version, then re-protect with the Protect PDF tool if needed."},
        {"q": "How is this different from iLovePDF or Smallpdf?", "a": "Free with no daily quota (iLovePDF and Smallpdf cap free tier at 2 files/day), no watermark, no account required, no file size limit beyond 500 MB, and the entire compressor is open source under the MIT license so you can self-host it."},
    ],
    "edit-pdf": [
        {"q": "Can I edit the existing text in a PDF?", "a": "The editor supports adding new text, shapes, highlights, and freehand drawings on top of the page. Direct editing of existing text glyphs requires re-authoring the document because PDF stores text as positioned glyphs, not as flowing paragraphs."},
        {"q": "Are my annotations permanent?", "a": "Yes. When you save, annotations are flattened into the PDF so they appear identically in every viewer (Adobe Reader, Preview, Chrome, mobile readers) and cannot be removed by toggling annotation visibility."},
        {"q": "What annotation types are available?", "a": "Text boxes, freehand pen, highlighter, rectangles, circles, lines, and arrows. You can set color, opacity, line thickness, and font size for each. Move and resize freely before saving."},
        {"q": "Is it safe to edit a confidential PDF here?", "a": "Yes. The PDF is held in temporary per-request storage inside an isolated Docker container only for the duration of your edit session — both input and output are unlinked the moment your download begins. No copy remains in permanent storage, logs, or backups. The editor code is open source under MIT for verification."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no page-count cap; very long PDFs render page-by-page as you scroll."},
        {"q": "Do I need an account or sign-up?", "a": "No. No account, no email, no sign-up. The editor loads directly in your browser; the privacy guarantees come from the architecture, not from a user profile."},
        {"q": "How is this different from Adobe Acrobat or PDFescape?", "a": "Free with no daily limit (PDFescape caps free use at 10 MB / 100 pages, Adobe requires a paid subscription for full editing), no account required, and the entire editor is open source so you can self-host it. We don't store your file or send it to any third-party API."},
    ],
    "sign-pdf": [
        {"q": "Is this a legally binding electronic signature?", "a": "PrivaTools creates a visual signature embedded in the PDF, plus an audit trail in the document metadata (signer name, timestamp). Whether it qualifies as legally binding depends on your jurisdiction — for most informal agreements, internal sign-offs, and consent forms in the US, EU, UK, India, and Australia, it is widely accepted under ESIGN and eIDAS frameworks. For court-grade qualified signatures, you need a certified eID provider."},
        {"q": "Can I sign multiple pages or multiple signatures on one page?", "a": "Yes. After creating your signature, you can place it on any page by navigating through the document preview. Add as many signatures as needed (e.g. initial-each-page or multi-party contracts)."},
        {"q": "Is my signature stored on the server?", "a": "No. Your signature exists only in your browser session — drawn on a canvas, kept in memory while you place it. The server receives the signature image only for the brief moment it embeds it into the PDF, then unlinks both input and output within seconds of your download. The signature image is never kept after the response."},
        {"q": "Is it safe to sign a sensitive contract here?", "a": "Yes. The PDF and signature image are held in temporary per-request storage inside an isolated Docker container for the duration of the request only; both are unlinked the moment your download begins. Nothing is logged, indexed, or sent to a third-party API. The signing pipeline is open source on GitHub and you can self-host the entire stack."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no cap on the number of signatures you can place."},
        {"q": "Do I need an account?", "a": "No — no account, no email, no sign-up. Upload, draw, place, download. DocuSign and Adobe Sign both require accounts; we don't."},
        {"q": "How is this different from DocuSign or Adobe Sign?", "a": "Free with no daily limit and no account required. PrivaTools handles single-signer documents extremely well; for multi-party serial signing with email reminders and a portal-style workflow, DocuSign or Adobe Sign remain more featureful. We don't retain the file or have access to it after delivery."},
    ],
    "protect-pdf": [
        {"q": "What encryption does PrivaTools use?", "a": "PDFs are encrypted with AES-256 (the same standard used by banks and governments) by default. AES-128 is available for backward compatibility with older PDF readers, though AES-256 is supported by every reader from the last decade. RC4 is explicitly NOT offered — it's been broken since the 2000s."},
        {"q": "Can I allow printing but block copying text?", "a": "Yes. You can set granular permissions independently: allow or deny printing (with optional 'low-resolution print only'), text copying, form filling, content modification, page extraction, and accessibility/screen-reader access."},
        {"q": "What happens if I forget the password?", "a": "PrivaTools does not store your password. If you lose it, there is no way to recover it — AES-256 has no backdoor. Save your password in a password manager like 1Password, Bitwarden, or your browser's built-in store before you encrypt."},
        {"q": "Is it safe to upload a sensitive PDF for encryption?", "a": "Yes. The PDF enters temporary per-request storage inside an isolated Docker container for the encryption pass only, and your chosen password is used only for that pass. Both the input plaintext and the password are discarded the moment the encrypted file is delivered. Nothing is logged. The encryption pipeline is open source on GitHub."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no page-count limit."},
        {"q": "Can I batch-protect multiple PDFs?", "a": "Yes — upload multiple files and they will each be encrypted with the same password, then bundled into a ZIP. Use different passwords for different files by running the tool separately."},
        {"q": "How is this different from Adobe Acrobat or Smallpdf encryption?", "a": "Same AES-256 cryptography, but free with no daily limit (Smallpdf caps free use at 2 protections/day, Adobe requires a subscription) and no account required. The protection code is open source so you can verify the encryption is real and not a backdoored stub."},
    ],
    "unlock-pdf": [
        {"q": "Can I unlock a PDF without the password?", "a": "No. PrivaTools requires you to enter the correct password — it does not crack, brute-force, or bypass passwords. There are no shortcuts: AES-256 is mathematically infeasible to break without the key. If you've forgotten your password, recovery is only possible if you saved it somewhere."},
        {"q": "Does unlocking remove all restrictions?", "a": "Yes. Both the open password (which controls who can view the file) and the permission restrictions (no-print, no-copy, no-edit) are removed from the output. The unlocked PDF behaves like any unencrypted file."},
        {"q": "Is the password transmitted securely?", "a": "Yes. The password travels over HTTPS (TLS 1.2+) and is used only in memory for decryption. It is never stored on disk, never logged, and never written to any audit trail. The password is discarded immediately after decryption completes."},
        {"q": "Is it safe to upload a sensitive locked PDF?", "a": "Yes. The encrypted PDF enters temporary per-request storage inside an isolated Docker container for the decryption pass only, and your password is used only for that pass. Both are discarded the moment your download begins. Nothing is logged, indexed, or sent to a third-party API. The decryption pipeline is open source on GitHub for verification."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. Decryption typically takes 1-5 seconds regardless of file size."},
        {"q": "Do I need an account?", "a": "No — no account, no email, no sign-up. Upload, enter password, download. The privacy guarantees come from the architecture, not from a user profile."},
        {"q": "How is this different from Smallpdf or iLovePDF unlock?", "a": "Same correctness (only the correct password works), but free with no daily limit (iLovePDF caps free use to 2 unlocks/day), no account required, and the unlock code is open source — you can read every line on GitHub and verify the password is never persisted."},
    ],
    "rotate-pdf": [
        {"q": "Can I rotate individual pages instead of the entire PDF?", "a": "Yes. Click individual page thumbnails to select specific pages, then apply the rotation angle only to those pages. Mix-and-match is supported: rotate page 3 by 90°, page 7 by 180°, leave the rest untouched."},
        {"q": "Does rotation affect text searchability?", "a": "No. The text layer is preserved exactly. Rotation only changes the visual display orientation of each page; the underlying text glyphs, search index, and bookmark positions are kept intact."},
        {"q": "What rotation angles are supported?", "a": "90° clockwise, 180° (upside-down), and 270° clockwise (equivalent to 90° counter-clockwise). PDF only allows rotations in 90° increments per the spec — arbitrary angles aren't supported."},
        {"q": "Is it safe to rotate a confidential PDF?", "a": "Yes. The PDF is held in temporary per-request storage inside an isolated Docker container for the rotation pass only — both input and output are unlinked the moment your download begins. Nothing is logged or kept. The rotation pipeline is open source on GitHub."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. Rotation is near-instant: typically under 1 second for a 100-page PDF."},
        {"q": "Does rotation preserve bookmarks, hyperlinks, and form fields?", "a": "Yes. All structural metadata — bookmarks, internal hyperlinks, external hyperlinks, form fields, and annotations — is preserved through rotation. Only the display orientation of the page content changes."},
        {"q": "How is this different from rotating in Adobe Acrobat?", "a": "Same outcome, but free with no daily limit and no Adobe subscription. The rotation is permanent (the file is reordered, not just a viewer toggle) so the rotated PDF stays rotated in every reader including phones."},
    ],
    "watermark": [
        {"q": "Can I use an image as a watermark?", "a": "Yes. Upload a PNG or JPG image (logos with transparency work best). Set opacity 5-100% so the watermark is visible but does not obscure document content. The image is scaled to your specified size and positioned per the layout option."},
        {"q": "Is the watermark applied to every page?", "a": "By default yes. You can also specify a page range (e.g. 'all', '1-5', '7,12,15') so only those pages receive the watermark. Useful for watermarking only the cover or only the body."},
        {"q": "Can someone remove the watermark?", "a": "The watermark is flattened into the page content stream, so it cannot be toggled off. Advanced PDF editors (Acrobat Pro, Foxit) could theoretically paint over it with white rectangles, but this is detectable and time-consuming. For maximum protection, use a diagonal repeating pattern across the page rather than a single corner watermark."},
        {"q": "Is it safe to watermark a sensitive PDF?", "a": "Yes. The PDF and watermark image are held in temporary per-request storage inside an isolated Docker container for the watermarking pass only. Both are unlinked the moment your download begins. The watermark text or image is not stored, logged, or sent to a third party."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no cap on the number of watermarks you can apply (run the tool repeatedly to layer text + image + diagonal)."},
        {"q": "Can I batch-watermark multiple PDFs with the same watermark?", "a": "Yes — upload multiple PDFs and the same watermark configuration is applied to each, then bundled into a ZIP. Useful for stamping a 'DRAFT' watermark across a quarterly delivery."},
        {"q": "How is this different from iLovePDF or Smallpdf watermarking?", "a": "Free with no daily limit (Smallpdf caps free use to 2 watermarks/day) and no account required. We don't add our own watermark to the output (iLovePDF and Smallpdf both watermark the FREE-tier output as a brand stamp). And the entire pipeline is open source."},
    ],
    "ocr-pdf": [
        {"q": "What languages does the OCR support?", "a": "PrivaTools ships Tesseract's full language pack: 100+ languages including English, Spanish, French, German, Italian, Portuguese, Chinese (Simplified and Traditional), Japanese, Korean, Arabic, Hindi, Russian, Hebrew, Thai, and Vietnamese. Pick the language explicitly for best accuracy; auto-detect works but adds a few seconds."},
        {"q": "Will OCR change how my scanned PDF looks?", "a": "No — the visual page stays pixel-identical to the input. OCR adds an invisible text layer behind the scan so the PDF becomes searchable and copy-pasteable, but the human-readable appearance is unchanged."},
        {"q": "How accurate is the OCR?", "a": "Clean 300 DPI scans typically reach 95–99% accuracy on Latin scripts. Lower resolutions or skewed pages drop to 85–95%. For best results, run Deskew PDF before OCR if pages are tilted, and crank up the scanner DPI if you control the scan."},
        {"q": "Can I get the extracted text as a separate file?", "a": "Yes. The default output is a searchable PDF, but you can also download just the extracted text as .txt (per page or combined) or as structured JSON with per-page text and bounding boxes."},
        {"q": "Is it safe to OCR a confidential document?", "a": "Yes. The PDF enters an isolated Docker container, OCR runs in temporary per-request storage, the result is returned, and both the input and output are unlinked immediately. The text is never logged, never indexed, never sent to any third-party API. The whole pipeline is open source for verification."},
        {"q": "Can I OCR a scanned PDF in a language I don't have the keyboard for?", "a": "Yes — the OCR doesn't need a keyboard, only that the language pack is installed (which it is for 100+ languages). After OCR, you can copy the text to a translator like DeepL or Google Translate."},
    ],
    "redact-pdf": [
        {"q": "Is redaction permanent and truly irreversible?", "a": "Yes. The underlying text glyphs and image pixels under each redaction rectangle are destroyed before the new PDF is written. The original bytes are not preserved in the file. No forensic tool can recover them — there is nothing left to recover."},
        {"q": "Can I search and redact every occurrence of a name or number?", "a": "Yes. Use the search-and-redact mode to type a phrase (case-sensitive optional) and the tool marks every occurrence across the whole document. Review the matches, then apply the redactions in one batch."},
        {"q": "What's the difference between redacting and drawing a black box?", "a": "Drawing a black annotation rectangle (like in Acrobat's Comment tool) covers the text visually but the text is still under the rectangle — anyone can move or delete the annotation and recover the secret. True redaction permanently removes the text and image data and rewrites the file. PrivaTools uses true redaction, not annotation."},
        {"q": "Will the redacted PDF still be searchable for non-redacted text?", "a": "Yes. Only the content under the redaction rectangles is destroyed. Text outside the rectangles, along with bookmarks, hyperlinks, and the text-search layer, are preserved intact."},
        {"q": "Is metadata also redacted?", "a": "By default the rectangles destroy on-page text and images. Author name, title, software, and other XMP/Info metadata are NOT automatically stripped — use the Strip Metadata tool afterward (or use Smart Redact which redacts both). For maximum safety: redact, then strip metadata, then sanitize."},
        {"q": "Is it safe to redact a sensitive legal document on PrivaTools?", "a": "Yes. The original and the redacted output are held in temporary per-request storage and unlinked immediately after the response. The redaction logic is open source under MIT — you can read every line on GitHub or self-host the tool entirely. No third-party API is involved, no log captures content."},
    ],
    "flatten-pdf": [
        {"q": "What does flattening a PDF mean?", "a": "Flattening converts interactive elements like form fields, annotations, and layers into static page content. The visual appearance stays the same but the elements can no longer be edited."},
        {"q": "When should I flatten a PDF?", "a": "Flatten before sharing filled forms (to prevent edits), before printing (to avoid rendering issues), or when a recipient's PDF viewer does not display annotations correctly."},
        {"q": "Does flattening reduce file size?", "a": "Sometimes. Removing form field metadata and annotation data can slightly reduce file size, but the effect depends on the document."},
    ],
    "bookmarks": [
        {"q": "Can I create a multi-level bookmark tree?", "a": "Yes. You can nest bookmarks under parent entries to create a hierarchical table of contents with multiple levels."},
        {"q": "Do bookmarks work in all PDF readers?", "a": "Yes. The bookmarks use the standard PDF outline format supported by Adobe Reader, Preview, Chrome, Firefox, and all major PDF viewers."},
        {"q": "Can I import a bookmark structure from a text file?", "a": "Currently, bookmarks are created manually in the editor. You can copy-paste titles and set page numbers individually."},
    ],
    "form-creator": [
        {"q": "What field types can I add?", "a": "Text inputs, text areas, checkboxes, radio buttons, dropdowns, date pickers, and signature fields."},
        {"q": "Will the form work in Adobe Reader?", "a": "Yes. The forms use the standard AcroForm format, which is compatible with Adobe Reader, Foxit, and all major PDF viewers."},
        {"q": "Can I set fields as required?", "a": "Yes. Mark any field as required to prevent submission without filling it in. You can also set validation rules like numeric-only or email format."},
    ],
    "extract-tables": [
        {"q": "What output formats are supported?", "a": "CSV, Excel (.xlsx), and JSON. Each table is extracted separately and all results are packaged in a ZIP file."},
        {"q": "Can it extract tables from scanned PDFs?", "a": "For best results, run OCR first using the OCR tool to create a text layer, then use table extraction. The tool works best with text-based PDFs."},
        {"q": "How does the tool detect table boundaries?", "a": "It uses Camelot and Tabula libraries, which detect ruled lines and text alignment patterns to identify table structures. Tables without visible borders may need manual page selection."},
    ],
    "pdf-to-pdfa": [
        {"q": "What is PDF/A and why would I need it?", "a": "PDF/A is an ISO-standardized archival format that ensures documents remain viewable long-term. Government agencies, courts, and archives often require PDF/A submissions."},
        {"q": "What changes does the conversion make?", "a": "The tool embeds all fonts, converts color spaces to sRGB, removes JavaScript and multimedia, and adds the required PDF/A metadata."},
        {"q": "Will the document look different after conversion?", "a": "Visually the document should look the same. Transparency may be flattened in PDF/A-1b, and embedded multimedia will be removed since PDF/A does not allow it."},
    ],
    "image-to-pdf": [
        {"q": "What image formats are supported?", "a": "JPG, PNG, WebP, BMP, and TIFF. Each image can be up to 500 MB."},
        {"q": "Can I control the page size?", "a": "Yes. Choose A4, Letter, or fit-to-image (where the page matches the image dimensions exactly). You can also set landscape or portrait orientation."},
        {"q": "Are multiple images combined into one PDF?", "a": "Yes. All uploaded images become pages in a single PDF. Drag to reorder them before converting."},
    ],
    "txt-to-pdf": [
        {"q": "Can I change the font and page size?", "a": "Yes. Choose from several font families (serif, sans-serif, monospace), set the font size, and select A4 or Letter page size with custom margins."},
        {"q": "Does the tool handle Unicode text?", "a": "Yes. UTF-8 encoded text is fully supported, including non-Latin scripts like Chinese, Arabic, Cyrillic, and Devanagari."},
        {"q": "Is there a character or line limit?", "a": "No character limit beyond the 500 MB file-size cap. The text is automatically reflowed and paginated."},
    ],
    "office-to-pdf": [
        {"q": "Which Office formats are supported?", "a": "Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.ppt, .pptx), and OpenDocument formats (.odt, .ods, .odp)."},
        {"q": "Are charts and images preserved?", "a": "Yes. The conversion uses LibreOffice, which preserves charts, images, tables, headers, footers, and most formatting accurately."},
        {"q": "How long does conversion take?", "a": "Most documents convert in 2-10 seconds. Large files with many images or complex layouts may take up to 30 seconds."},
    ],
    "word-to-pdf": [
        {"q": "Is formatting preserved during conversion?", "a": "Yes. LibreOffice preserves fonts, styles, tables, images, headers, footers, and table-of-contents links. Minor differences may occur with uncommon fonts."},
        {"q": "Are .doc (legacy) files supported?", "a": "Yes. Both the older .doc format and the modern .docx format are supported."},
        {"q": "What about tracked changes and comments?", "a": "Tracked changes and comments visible in the document will appear in the PDF. Accept or reject changes in Word first if you want a clean output."},
    ],
    "epub-to-pdf": [
        {"q": "Are images and formatting preserved?", "a": "Yes. Chapter headings, bold/italic text, embedded images, and basic CSS styling are preserved in the PDF output."},
        {"q": "Can I convert DRM-protected EPUBs?", "a": "No. DRM-protected e-books cannot be converted. The tool only works with DRM-free EPUB files."},
        {"q": "What page size options are available?", "a": "A4, Letter, and custom dimensions. The text is reflowed to fit the chosen page size while keeping chapter breaks."},
    ],
    "html-to-pdf": [
        {"q": "Can I convert a live website URL to PDF?", "a": "Yes. Enter any public URL and the server will render the page — including CSS, images, and JavaScript — and convert it to PDF."},
        {"q": "Is JavaScript rendered?", "a": "Yes. A headless browser executes JavaScript before capturing the page, so dynamically loaded content appears in the PDF."},
        {"q": "Are external stylesheets and images included?", "a": "Yes. The renderer fetches external CSS, web fonts, and images. Only resources behind authentication may not load."},
    ],
    "xml-to-pdf": [
        {"q": "What XML schemas are supported?", "a": "Any well-formed XML file is supported. The tool renders the structure as a readable tree or table — it does not apply XSL transforms."},
        {"q": "Is syntax highlighting included?", "a": "Yes. Element names, attributes, and values are color-coded for readability in the PDF output."},
        {"q": "Can I convert large XML files?", "a": "Files up to 500 MB are supported. Very deeply nested structures may produce many pages."},
    ],
    "csv-to-pdf": [
        {"q": "Does the tool auto-detect delimiters?", "a": "Yes. Comma, semicolon, tab, and pipe delimiters are automatically detected. You can also specify the delimiter manually."},
        {"q": "How are wide tables handled?", "a": "Wide tables can be rendered in landscape orientation. If they still exceed the page width, columns are scaled to fit or split across pages."},
        {"q": "Is the first row treated as a header?", "a": "By default yes — the first row is bolded as a header. You can disable this if your data has no header row."},
    ],
    "json-to-pdf": [
        {"q": "Is JSON validated before conversion?", "a": "Yes. The tool validates the JSON and shows a clear error message with the line number if the syntax is invalid."},
        {"q": "How are nested objects displayed?", "a": "Nested objects and arrays are indented with syntax highlighting. Collapsible sections are shown in the preview but expanded in the PDF."},
        {"q": "Can I convert JSON arrays into tables?", "a": "Yes. Arrays of objects with consistent keys are rendered as a table, with keys as column headers and each object as a row."},
    ],
    "pdf-to-word": [
        {"q": "How accurate is the PDF to Word conversion?", "a": "Text, paragraphs, images, headings, and simple tables convert with high fidelity. Multi-column magazine layouts and heavily-designed PDFs with overlapping text and graphics may need light cleanup in Word. Forms convert to plain text — not editable Word form fields."},
        {"q": "Can I convert scanned PDFs to Word?", "a": "Yes. Scanned PDFs are auto-detected and pushed through Tesseract OCR before text extraction. For best results on poor scans, run the dedicated OCR PDF tool first (you can pick the language and deskew the pages), then convert the OCR'd PDF to Word."},
        {"q": "What Word format is produced — .doc or .docx?", "a": ".docx (Office Open XML). Compatible with Microsoft Word 2007 and later, Google Docs, LibreOffice Writer, Apple Pages, and every modern word processor. Older .doc binary format is not produced because it has been deprecated since 2007."},
        {"q": "Is it safe to convert a confidential PDF here?", "a": "Yes. The PDF and the generated .docx are held in a temp directory inside an isolated container for the duration of the request only — both are unlinked the moment the response is delivered. No copy remains in permanent storage, logs, or backups. The conversion code is open source under MIT for end-to-end audit."},
        {"q": "Will fonts and exact spacing be preserved?", "a": "Most common fonts are preserved by name; if Word doesn't have the exact font, it substitutes a similar one. Line and paragraph spacing is preserved to within a few pixels. For pixel-perfect re-typesetting, use PDF to RTF instead."},
        {"q": "How does this compare to Adobe Acrobat PDF to Word?", "a": "Quality is comparable for typical office documents. Adobe is slightly better on multi-column magazine layouts; PrivaTools is faster, free with no daily limit, and doesn't require an Adobe ID. We don't store the file or send it to any third-party API."},
    ],
    "pdf-to-excel": [
        {"q": "Does it convert the entire PDF or just tables?", "a": "The tool focuses on extracting tabular data. Each detected table becomes a separate sheet in the Excel file. Non-table text (paragraphs, headers, footers) is not included — use PDF to Word or PDF to Text for that."},
        {"q": "Can I choose which tables to extract?", "a": "Yes. Select specific pages, or let the tool auto-detect all tables across the document. Auto-detect uses Camelot and Tabula libraries which identify ruled lines and text-alignment patterns."},
        {"q": "What if my PDF has no visible table borders?", "a": "The tool can detect tables based on text alignment even without ruled borders, but results are more reliable on clearly bordered tables. For borderless tables with very irregular spacing, manual page selection plus column-position hints in the advanced settings give better accuracy."},
        {"q": "Is it safe to upload a confidential financial PDF?", "a": "Yes. The PDF and the generated .xlsx are held in temporary per-request storage inside an isolated Docker container for the conversion pass only — both are unlinked the moment your download begins. Nothing is logged, indexed, or sent to a third-party API. The conversion code is open source on GitHub."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. Large PDFs with many tables may take 15-30 seconds to extract."},
        {"q": "Does it work on scanned PDFs?", "a": "Scanned PDFs need OCR first. Run the OCR PDF tool (you can pick the language and deskew the pages), then convert the OCR'd PDF to Excel. The text layer added by OCR is what the table detector reads."},
        {"q": "Can I batch-convert multiple PDFs to Excel?", "a": "Yes — upload multiple PDFs and each is converted independently, then bundled into a ZIP of .xlsx files. Useful for processing a folder of monthly statements or invoices."},
        {"q": "How is this different from Adobe Acrobat PDF to Excel?", "a": "Comparable accuracy on standard tables. Adobe Acrobat handles complex merged-cell layouts slightly better; PrivaTools is faster, free with no daily limit, and doesn't require an Adobe ID or send your data to Adobe's cloud."},
    ],
    "pdf-to-text": [
        {"q": "Is formatting preserved in the text output?", "a": "The tool extracts raw text only. Bold, italic, font sizes, and layout are not preserved — you get clean plain text."},
        {"q": "Can I extract text from a specific page range?", "a": "Yes. Specify page numbers or ranges to extract text from only the pages you need."},
        {"q": "How does it handle multi-column layouts?", "a": "The tool reads text in natural reading order. Two-column layouts are generally handled correctly, but complex magazine-style layouts may interleave columns."},
    ],
    "pdf-to-image": [
        {"q": "What DPI should I use?", "a": "150 DPI is good for on-screen viewing. Use 300 DPI for printing. Higher values like 600 DPI produce large files but maximum detail."},
        {"q": "Which image formats are available?", "a": "PNG (lossless, best for text-heavy pages), JPG (smaller files, good for photos), and WebP (modern format with excellent compression)."},
        {"q": "Can I convert just specific pages?", "a": "Yes. Enter individual page numbers or ranges (e.g. 1-3, 7) to convert only the pages you need."},
    ],
    "heic-to-jpg": [
        {"q": "Why can't I open HEIC files on my computer?", "a": "HEIC is Apple's default photo format since iOS 11. Windows and many web apps do not support it natively. Converting to JPG makes the images universally compatible."},
        {"q": "Is image quality lost during conversion?", "a": "At quality 90-100, the difference is imperceptible. Lower quality settings reduce file size with minimal visible degradation."},
        {"q": "Is EXIF data preserved?", "a": "Yes. Camera data, GPS location, and orientation are preserved by default. Use the Remove EXIF tool afterward if you want to strip metadata."},
    ],
    "remove-exif": [
        {"q": "What metadata is removed?", "a": "All EXIF, IPTC, and XMP metadata — including GPS coordinates, camera model, date/time, software used, and thumbnail previews."},
        {"q": "Does removing EXIF data change image quality?", "a": "No. Only the metadata bytes are removed. The actual image pixels are not re-encoded or modified in any way."},
        {"q": "Why should I remove EXIF data?", "a": "EXIF data can contain your GPS location, device identifiers, and timestamps. Removing it before sharing photos online protects your privacy."},
    ],
    "image-compressor": [
        {"q": "Is PNG compression lossless?", "a": "Yes — PNG compression here is lossless. The pixels are byte-identical to the original; only the encoding is optimized via zlib levels and palette reduction. Verify with `cmp` or a pixel-diff tool: zero difference."},
        {"q": "How much can I expect a JPG to shrink?", "a": "JPGs typically shrink 40–70% at quality 75 with no visible difference for photos. Screenshots and graphics with flat colors shrink more aggressively. Quality 60 still looks good on most photos and gets you 60–80% reduction."},
        {"q": "Will compression strip my EXIF / GPS data?", "a": "By default EXIF is preserved. If you want to strip it (for privacy when sharing photos), use the dedicated Remove EXIF tool after compressing — or use Strip Metadata for a one-step solution."},
        {"q": "Can I batch-compress dozens of images?", "a": "Yes. Drop as many as you want; each is compressed with the same settings, then bundled into a single ZIP. There is no daily cap on the number of files."},
        {"q": "Is it safe to compress photos with sensitive content?", "a": "Yes. Each image is held in temporary per-request storage only for the duration of the request, then unlinked. No image is written to permanent storage, none is logged, and none is used to train any model. The codec runs server-side in an isolated container; the entire codebase is open source for verification."},
        {"q": "How is this different from TinyPNG or Squoosh?", "a": "TinyPNG caps free use at 20 images/month and uploads to their servers. Squoosh is browser-only but doesn't support batch. PrivaTools is unlimited, batch-friendly, server-processed for speed on large files, and the server-side code is self-hostable so you can run it on your own infrastructure."},
    ],
    "remove-background": [
        {"q": "What kinds of photos work best?", "a": "People, animals, products, and objects with clear edges work best. The U²-Net AI model handles fine details like hair, fur, and semi-transparent edges (sunglasses, leaves, water droplets) reasonably well — much better than the chroma-key technique on a green screen."},
        {"q": "Is the output a transparent PNG?", "a": "Yes — the output is a 32-bit PNG with a real alpha channel. You can drop it onto any background in Figma, Canva, Photoshop, or PowerPoint and it composites cleanly. You can also pick a solid-color or image replacement background before downloading."},
        {"q": "Does it work on group photos with multiple people?", "a": "Yes, but quality varies. The model is trained on single-subject portraits, so isolated people in a group are detected well. Overlapping bodies, faces in the background, and partial occlusions may need touch-up in an image editor."},
        {"q": "Is my photo uploaded somewhere external — like remove.bg?", "a": "No. The U²-Net model runs on PrivaTools' own server inside an isolated Docker container. The photo enters temporary per-request storage, the model runs locally, the result is sent back, and both the input and output are unlinked from the temp directory immediately after the response. No third-party background-removal service is called."},
        {"q": "What's the maximum image size?", "a": "500 MB per file, or 100 megapixels of pixel area — whichever you hit first. For most photography that's never a limit. RAW DSLR files at full resolution work; cropped product photos are well within bounds."},
        {"q": "How does this compare to remove.bg or Canva?", "a": "Free with no daily quota or watermark (remove.bg adds a watermark on the free tier and caps at 1 image per session), no account required (Canva requires sign-up), and the entire pipeline is open source so you can self-host it. Quality is comparable to remove.bg's free tier."},
    ],
    "video-to-gif": [
        {"q": "What is the maximum GIF duration?", "a": "There is no strict limit, but GIFs longer than 15-30 seconds can become very large. Keeping clips short produces better results."},
        {"q": "Can I control the file size?", "a": "Yes. Lower the frame rate (10 fps is usually enough), reduce the width, and shorten the duration to get smaller files."},
        {"q": "Which video formats are supported?", "a": "MP4, WebM, MOV, and AVI. The server uses FFmpeg, which supports virtually all common video codecs."},
    ],
    "compress-video": [
        {"q": "How much can a video be compressed?", "a": "Typical results are 30-70% size reduction at Medium compression. Raw or high-bitrate videos see the largest savings."},
        {"q": "Does compression change the video resolution?", "a": "No. The resolution stays the same by default. Only the bitrate is reduced. You can optionally lower the resolution for even smaller files."},
        {"q": "What output format is used?", "a": "The output is MP4 with H.264 encoding, which is universally compatible with all devices and browsers."},
    ],
    "trim-media": [
        {"q": "Can I trim audio files too?", "a": "Yes. The tool supports both audio (MP3, WAV, OGG, FLAC) and video (MP4, WebM, MOV, AVI) files."},
        {"q": "Is the trimmed file re-encoded?", "a": "When possible, the tool uses lossless cutting (no re-encoding) to preserve original quality. Some format combinations require re-encoding."},
        {"q": "How precise is the trimming?", "a": "Precision depends on the format. MP4 can be cut to the nearest keyframe (typically within 0.5 seconds). Re-encoded output is frame-accurate."},
    ],
    "base64": [
        {"q": "Can I encode files (not just text)?", "a": "Yes. Upload any file — images, PDFs, binaries — and the tool returns the Base64-encoded string. Useful for embedding files in JSON, HTML, or CSS."},
        {"q": "Is there a size limit for encoding?", "a": "Files up to 500 MB can be encoded. Keep in mind that Base64 output is approximately 33% larger than the original file."},
        {"q": "What character set is used?", "a": "Standard Base64 (RFC 4648) using A-Z, a-z, 0-9, +, and /. URL-safe Base64 (replacing + and / with - and _) is also available."},
    ],
    "text-diff": [
        {"q": "What diff algorithm is used?", "a": "The tool uses a line-by-line diff algorithm similar to Unix diff, highlighting additions, deletions, and modifications with color coding."},
        {"q": "Can I compare files directly?", "a": "Yes. Upload two text files instead of pasting. Supported formats include .txt, .csv, .json, .xml, .html, .css, .js, .py, and other plain-text formats."},
        {"q": "Is there a file size limit for comparison?", "a": "Each file can be up to 500 MB. Very large files may take a few seconds to process the diff."},
        {"q": "Can I compare code files?", "a": "Yes. The diff viewer works with any plain-text format. It highlights changes line by line, making it useful for comparing code, configs, or data files."},
    ],
    "batch-compress-pdf": [
        {"q": "How many PDFs can I compress at once?", "a": "You can upload up to 50 PDF files per batch. Each file can be up to 500 MB. All files are compressed in parallel using 4-core processing."},
        {"q": "What compression levels are available?", "a": "Three levels: Light (minimal quality loss, ~20% reduction), Balanced (good quality with ~50% reduction), and Extreme (maximum compression, up to 90% smaller)."},
        {"q": "How do I get my compressed files?", "a": "All compressed PDFs are packaged into a single ZIP file for download. Each file keeps its original name with '_compressed' appended."},
    ],
    "pdf-page-counter": [
        {"q": "How many PDFs can I count at once?", "a": "Upload up to 100 PDF files. The tool instantly reports the page count for each file plus the total across all files."},
        {"q": "Does it work with encrypted PDFs?", "a": "Yes, the page counter works with most encrypted PDFs since it only reads metadata, not content. Password-protected PDFs that block all access may show as invalid."},
        {"q": "Is this useful for print quotes?", "a": "Absolutely. Print shops and copy centers use this to quickly count total pages across multiple documents for accurate pricing."},
    ],
    "image-upscaler": [
        {"q": "What upscaling methods are available?", "a": "The tool uses Lanczos resampling, a high-quality interpolation algorithm that produces sharp, artifact-free results. Choose 2x or 4x enlargement."},
        {"q": "What image formats are supported?", "a": "JPG, PNG, and WebP images are supported. The output format matches the input — upload a JPG, get a JPG back."},
        {"q": "Is there a maximum image size?", "a": "The upscaled result cannot exceed 100 megapixels. For a 4x upscale, this means input images up to about 2500x2500 pixels."},
    ],
    "audio-converter": [
        {"q": "What audio formats are supported?", "a": "Convert between MP3, WAV, OGG, FLAC, and AAC. The tool uses FFmpeg for professional-quality conversion with precise codec handling."},
        {"q": "Can I choose the bitrate?", "a": "Yes. Available bitrates: 64k (small file), 128k (good), 192k (high quality), 256k (very high), and 320k (maximum). Default is 192k."},
        {"q": "What is the file size limit?", "a": "Audio files up to 200 MB are supported. This covers most audio files including full albums in lossless FLAC format."},
    ],

    # ── v1.1.0 + v1.2.0 additions ─────────────────────────────────────────
    "highlight-pdf": [
        {"q": "Are the highlights real PDF annotations or flattened images?", "a": "Real PDF annotations. They render in every PDF viewer and can be removed later if you reopen the file in an editor. Nothing about the underlying text is changed."},
        {"q": "Can I highlight multiple phrases at once?", "a": "Run the tool once per phrase. Each run preserves previous highlights, so you can layer different colors for different keywords."},
        {"q": "Does the highlighter respect case?", "a": "Toggle case-sensitive matching for exact-case search; leave it off for case-insensitive flexible matching. Case-insensitive is the default."},
    ],
    "summarize-pdf": [
        {"q": "Is my PDF really not uploaded?", "a": "Correct. The summarization model loads once into your browser (~250 MB, cached in IndexedDB after first load). After that, summarization runs entirely in WebAssembly inside your tab. Verify by opening DevTools → Network — no requests fire while summarization is running. Your PDF, your machine, your data."},
        {"q": "How long does it take?", "a": "About 2–4 seconds per chunk on a modern laptop. A 100-page PDF takes 3–6 minutes end-to-end; a 10-page PDF takes 30–60 seconds. First-ever run is slower (~30s) while the model downloads into IndexedDB — subsequent runs are instant from cold start."},
        {"q": "What languages are supported?", "a": "The default distilbart-cnn-12-6 model is English-only. Multilingual support via mT5 is on the roadmap; for non-English summaries today, translate the PDF to English first (via DeepL or Google Translate), then summarize."},
        {"q": "Is the summary as good as ChatGPT?", "a": "Not quite — frontier cloud models like GPT-4 are 50–100x larger. distilbart produces good professional executive summaries but won't match GPT-4 nuance or domain-specific phrasing. The trade-off is full privacy: your document genuinely never leaves your browser."},
        {"q": "Is it safe to summarize a confidential PDF?", "a": "Yes — uniquely safe even by PrivaTools standards because nothing is uploaded at all. The PDF is read by your browser's PDF.js library, chunked locally, fed into the WebAssembly model in your tab, and the summary is returned to the same tab. No server, no logs, no third-party API. Confirmable via DevTools."},
        {"q": "What's the file size limit?", "a": "There's no server-side size limit since nothing is uploaded. The practical limit is browser memory: PDFs up to ~500 MB work on most laptops with 8 GB+ RAM. Very long PDFs (500+ pages) will be slow but functional."},
        {"q": "How is this different from ChatGPT, Claude, or Perplexity summaries?", "a": "Cloud models produce better summaries but require you to upload your document to their servers (Anthropic, OpenAI, Perplexity all retain inputs for at least 30 days under their default ToS). PrivaTools sacrifices some summary polish for zero data leaving your device. For confidential drafts, contracts, or legal briefs, the privacy trade is worth it."},
        {"q": "Do I need an account?", "a": "No — no account, no email, no sign-up. The tool loads instantly in your browser; the privacy guarantees are architectural, not policy-based."},
    ],
    "smart-redact": [
        {"q": "What entities does it detect?", "a": "Names (persons and organizations), emails, phone numbers, postal addresses, SSNs and other government IDs, credit card numbers, dates, locations, and IP addresses. The BERT-base-NER model also catches custom patterns via regex hooks — useful for proprietary identifiers like case numbers or patient IDs."},
        {"q": "Where does the NER scan run?", "a": "Entity detection runs in your browser using @huggingface/transformers WebAssembly. The PDF text never leaves your machine during scanning. When you click Apply, the PDF and selected strings are sent to the isolated backend so PyMuPDF can permanently bake in the redactions; temporary files are unlinked after the response."},
        {"q": "Is the redaction reversible?", "a": "No. The backend applies real PyMuPDF redactions which permanently destroy the underlying glyphs and image pixels under each redaction rectangle. The redacted file cannot be 'unredacted' even with forensic tools — there is nothing left to recover."},
        {"q": "How is this different from regular Redact?", "a": "Regular Redact PDF requires you to draw rectangles manually over each piece of sensitive content. Smart Redact auto-detects PII entities so you only need to review the model's suggestions and click 'apply' on the ones to redact. For known-pattern data (SSNs, credit cards) accuracy is near-perfect; for free-text names, you should review."},
        {"q": "Is it safe to use on a confidential legal or medical document?", "a": "Yes — and arguably safer than manual redaction because the model catches PII you'd miss. Detection runs in-browser (the document text never uploads); only the final redacted file is sent to the server for the permanent-redaction pass, then unlinked immediately. The whole pipeline is open source for verification."},
        {"q": "What's the file size limit?", "a": "Detection runs in-browser so it's bounded by browser memory (typically 500 MB practical). The server-side redaction pass accepts up to 500 MB. No daily or monthly quota."},
        {"q": "What languages are supported for entity detection?", "a": "The default BERT-base-NER model is English-only with strong coverage. Multilingual NER models are on the roadmap. For non-English documents, you can use Smart Redact for the pattern-based entities (numbers, emails, dates) which work across languages, plus regular Redact PDF for free-text."},
        {"q": "Do I need an account?", "a": "No — no account, no email, no sign-up. The tool loads in your browser; privacy guarantees are architectural."},
    ],
    "split-in-half": [
        {"q": "When would I use this?", "a": "For two-up scans (where two pages were scanned side-by-side onto one physical page), scanned booklets, or any PDF where each page should be two pages in the output."},
        {"q": "Does it work on PDFs with mixed page sizes?", "a": "Yes. Each page is split independently at its own midpoint, so different page sizes work fine."},
        {"q": "What's the difference between vertical and horizontal?", "a": "Vertical bisects each page down the middle into left and right halves (the common case for landscape two-up scans). Horizontal bisects across the middle into top and bottom halves."},
    ],
    "pdf-to-svg": [
        {"q": "What kind of PDFs convert best?", "a": "Vector PDFs (drawn in Illustrator, Inkscape, Figma, LaTeX, etc.) convert into editable vector SVGs. Scanned/raster PDFs become SVGs containing embedded images."},
        {"q": "How many SVG files come back?", "a": "One per page, packaged into a ZIP."},
        {"q": "Can I edit the SVGs after?", "a": "Yes. Open in any vector editor (Illustrator, Inkscape, Figma). Text and paths are editable."},
    ],
    "pdf-to-html": [
        {"q": "How accurate is the conversion?", "a": "PyMuPDF preserves text positioning and fonts via inline styles. Layout is faithful for simple documents; complex multi-column or floating-element layouts may need manual cleanup."},
        {"q": "Are images included?", "a": "Yes. Embedded images come through as base64-encoded inline data URLs, so the HTML is fully self-contained — no external image files needed."},
        {"q": "Why convert PDF to HTML?", "a": "Web archiving, accessibility (screen readers handle HTML better than complex PDFs), republishing offline documents online, or any use where you need the content as a web page."},
    ],
    "pdf-to-rtf": [
        {"q": "What's RTF good for?", "a": "Rich Text Format opens in every word processor (Word, Pages, LibreOffice, WordPad) without the bloat of .docx and with better text fidelity than .txt. Useful for legacy or cross-platform document exchange."},
        {"q": "Are images preserved?", "a": "No. The current implementation focuses on text and structure. For full visual fidelity, use PDF to Word instead."},
        {"q": "Does it handle Unicode?", "a": "Yes. Non-ASCII characters are encoded via the standard RTF \\uN escape mechanism."},
    ],
    "web-optimize-pdf": [
        {"q": "What does linearization actually do?", "a": "It reorganizes the PDF byte layout so the first page's objects come first in the file. A byte-range-aware viewer can then start rendering the first page while the rest still downloads."},
        {"q": "Does it change file size?", "a": "Usually slightly smaller, sometimes slightly larger — the rearrangement adds a small overhead but qpdf also re-streams and recompresses where it can."},
        {"q": "Do I need this for a PDF served from my own server?", "a": "Only if you're serving large PDFs and want the inline-viewer experience to feel fast. For small (<2 MB) PDFs the difference is invisible."},
    ],
    "split-by-text": [
        {"q": "How does it decide where to split?", "a": "It scans every page for your search term. Every page that contains the term becomes the start of a new chunk. The chunk runs until the next match-page or the end of the document."},
        {"q": "Can I use a regex?", "a": "Not in the current version — the search is a literal string match (case-sensitive optional). For regex splits, use the dev API directly."},
        {"q": "What if my keyword doesn't appear at all?", "a": "The tool returns a 400 error with a clear message. Make sure your search exactly matches the casing if you have case-sensitive enabled."},
    ],
    "view-exif": [
        {"q": "What metadata does it show?", "a": "All standard EXIF tags (camera make/model, lens, ISO, exposure, focal length, timestamps), GPS sub-IFD (latitude, longitude, altitude), IPTC, and XMP-embedded fields, plus PNG tEXt chunks if present."},
        {"q": "Does this strip the metadata?", "a": "No — this is read-only. To strip metadata, use Remove EXIF."},
        {"q": "Why does my photo have GPS coordinates?", "a": "Most smartphones embed GPS coordinates in photos by default. They reveal exactly where the photo was taken. Strip them before posting publicly."},
    ],
    "jwt-decoder": [
        {"q": "Is it safe to paste a real production JWT here?", "a": "Yes — decoding happens entirely in your browser using JavaScript's atob(). No part of the token is sent to a server. Verify by checking DevTools → Network."},
        {"q": "Can it verify the signature?", "a": "Not in this tool. Verification requires the issuer's signing key (HMAC secret for HS*, public key for RS*/ES*). The decoder displays the signature for inspection but doesn't validate it."},
        {"q": "What if my JWT is malformed?", "a": "If the three-part dot structure is wrong, you'll see a clear error. If the base64 is malformed, the parser shows which segment failed."},
    ],
    "regex-tester": [
        {"q": "Which regex flavor does it use?", "a": "JavaScript RegExp (ECMAScript). The same engine that powers browser pattern matching. Most patterns are portable to Python re, PCRE, or Go regexp with minor adjustments."},
        {"q": "Is my test text saved anywhere?", "a": "No. Pattern and text are kept in browser state only. Refresh the page and they're gone. No server-side storage."},
        {"q": "How many matches can it handle?", "a": "Tested up to ~10,000 matches without slowdown. Beyond that, the highlighting may lag but the match list still renders."},
    ],
    "timestamp-converter": [
        {"q": "How does it know if a number is seconds or milliseconds?", "a": "By magnitude. Numbers larger than 10^12 (Sep 2001 onward in milliseconds) are treated as milliseconds; smaller as seconds. You can also paste an ISO 8601 string explicitly."},
        {"q": "Why is the local time different from the UTC time?", "a": "Your browser's timezone offset is applied. The UTC value is what's actually stored in the timestamp; local is just for human convenience."},
        {"q": "Can I generate a future timestamp?", "a": "Yes. Type or paste any past or future ISO date and you'll get the corresponding epoch. The relative phrase will say 'in X days' for the future."},
    ],
    "batch-compress-pdf": [
        {"q": "How many PDFs can I upload?", "a": "Up to 50 files per batch, up to 500 MB per file."},
        {"q": "Are they compressed in parallel?", "a": "Yes — the backend runs 4 worker processes simultaneously, so 4 files compress at once. Total time scales nearly linearly with file count divided by 4."},
        {"q": "What's the difference between Light, Recommended, and Extreme?", "a": "Light shrinks structure only (5–30% reduction, no visible quality loss). Recommended (default) resamples images at 150 DPI (40–70% reduction). Extreme drops to 96 DPI and lower JPEG quality (60–90% reduction)."},
    ],
    "pdf-page-counter": [
        {"q": "How is this faster than opening each PDF?", "a": "The tool reads only the PDF's page metadata, not the page content. For 100 PDFs the total scan time is typically under a second."},
        {"q": "Does it work on encrypted PDFs?", "a": "Yes for most. Password-protected PDFs that block metadata access return as invalid."},
        {"q": "Useful for print pricing?", "a": "Yes — print shops use this exact tool to count total pages across multi-file print jobs for instant quotes."},
    ],
    "webp-to-jpg": [
        {"q": "Why convert WebP to JPG?", "a": "WebP isn't supported by all software, email clients, or older browsers. JPG is universal — every image viewer can open it."},
        {"q": "Will the quality be the same?", "a": "Essentially yes. Default JPG quality is 85, which is visually indistinguishable from the WebP source at typical viewing sizes."},
        {"q": "Does it preserve transparency?", "a": "No — JPEG doesn't support transparency. Transparent pixels in the source render as white in the JPG. Use HEIC to PNG or WebP to PNG if you need transparency preserved."},
    ],
    "webp-to-png": [
        {"q": "Why convert WebP to PNG?", "a": "PNG is lossless and supports transparency, making it ideal for graphics, logos, screenshots, and anywhere you need pixel-perfect output."},
        {"q": "How much larger is the PNG?", "a": "Typically 3–5x the size of the WebP source. PNG compression is lossless but less efficient than WebP."},
        {"q": "Does it preserve transparency?", "a": "Yes. Transparent pixels in the WebP come through unchanged in the PNG."},
    ],
    "heic-to-png": [
        {"q": "What's HEIC and why convert it?", "a": "HEIC (High Efficiency Image Container) is Apple's image format from iOS 11 onward. It's space-efficient but not widely supported outside Apple's ecosystem. PNG works everywhere."},
        {"q": "Is PNG better than JPG for HEIC conversion?", "a": "If you need transparency or are doing further editing: yes. For sharing on the web or attaching to emails: JPG is fine and 3–5x smaller."},
        {"q": "Are EXIF tags preserved?", "a": "Most are stripped during conversion (since PNG and HEIC have different metadata formats). If you need to preserve EXIF, use HEIC to JPG instead and the standard EXIF block survives."},
    ],

    # ── v1.4.0 — additional format converter aliases ─────────────────────
    "jpg-to-png": [
        {"q": "Why convert JPG to PNG?", "a": "PNG is lossless — every pixel of the source is preserved. Use PNG when you plan to do further editing (each JPG save degrades the image) or when you need transparency in compositing."},
        {"q": "Will the PNG be larger?", "a": "Yes — typically 3–10× larger, because PNG is lossless while JPG is compressed. For photos, JPG is usually a better choice unless you specifically need lossless quality."},
        {"q": "Does it preserve metadata?", "a": "Standard EXIF data is preserved when possible. Color profiles (sRGB, Adobe RGB) are written into the PNG header."},
    ],
    "png-to-jpg": [
        {"q": "Why convert PNG to JPG?", "a": "JPG files are 70–90% smaller than equivalent PNGs for photographs — perfect when you need to email, upload, or post images without bandwidth penalties."},
        {"q": "What happens to transparency?", "a": "JPG doesn't support transparency. Transparent pixels are flattened to white. If you need to preserve transparency, use PNG to WebP instead."},
        {"q": "Will I lose quality?", "a": "JPG is lossy, but at quality 85 (our default) the difference is essentially invisible. Re-saving the same JPG repeatedly does degrade — convert once, then keep the original PNG as a master."},
    ],
    "jpg-to-webp": [
        {"q": "Why convert JPG to WebP?", "a": "WebP files are typically 25–35% smaller than JPGs at the same visual quality. That speeds up page loads and saves bandwidth, especially for image-heavy sites."},
        {"q": "Will every browser display WebP?", "a": "Yes — every major browser supports WebP since 2020 (Chrome, Firefox, Safari 14+, Edge). For maximum compatibility with very old browsers or email clients, use JPG."},
        {"q": "Is WebP a lossy format?", "a": "It can be either. Our default is lossy WebP for best compression. Lossless WebP is also supported but produces larger files."},
    ],
    "png-to-webp": [
        {"q": "Why convert PNG to WebP?", "a": "Lossless WebP is typically 25% smaller than PNG; lossy WebP is dramatically smaller. Either way, you save bandwidth — useful for web assets, icons, and product images."},
        {"q": "Is transparency preserved?", "a": "Yes. WebP supports an alpha channel exactly like PNG, so transparent areas come through unchanged."},
        {"q": "When should I stay with PNG?", "a": "If you need maximum compatibility with very old software, PDF generators, or print pipelines — PNG is supported everywhere."},
    ],
    "tiff-to-jpg": [
        {"q": "Why convert TIFF to JPG?", "a": "TIFF files from scanners are often 10–50 MB each. JPG shrinks them to a few hundred KB, perfect for email and online sharing where quality at 85% is indistinguishable."},
        {"q": "What about multi-page TIFFs?", "a": "Only the first page is converted to JPG. To handle multi-page TIFFs, use our TIFF to PDF tool instead — it preserves all pages."},
        {"q": "Will I lose quality?", "a": "Some, but at our default quality of 85, the difference is essentially invisible at typical viewing sizes."},
    ],
    "tiff-to-png": [
        {"q": "Why convert TIFF to PNG?", "a": "TIFF is excellent for archival but heavyweight and not browser-friendly. PNG is universally supported and still lossless — perfect for sharing scanned documents online."},
        {"q": "Is the conversion lossless?", "a": "Yes. Both TIFF and PNG are lossless image formats, so no pixel data is lost. The PNG is typically 30–60% smaller because PNG's compression is more efficient for typical scan content."},
        {"q": "Will multi-page TIFFs be handled?", "a": "Only the first page is converted. For multi-page TIFF archives, use our TIFF to PDF tool to preserve every page."},
    ],
    "bmp-to-jpg": [
        {"q": "Why convert BMP to JPG?", "a": "BMP files are uncompressed and can be 10–50× larger than the same image as JPG. Converting saves enormous space with virtually no visible quality difference for photos."},
        {"q": "What about screenshots in BMP?", "a": "For screenshots and pixel art, consider BMP to PNG instead — PNG is lossless and handles sharp edges better than JPG."},
        {"q": "Are old Windows BMPs supported?", "a": "Yes. All standard BMP variants (1-bit, 4-bit, 8-bit, 16-bit, 24-bit, 32-bit, RLE-compressed) are supported."},
    ],
    "bmp-to-png": [
        {"q": "Why convert BMP to PNG?", "a": "PNG is lossless like BMP but uses compression — typically 70–90% smaller files. PNG is also the standard format for web and modern software."},
        {"q": "Will my screenshots look identical?", "a": "Yes — pixel-perfect identical. PNG uses lossless compression, so no pixel data changes."},
        {"q": "What about indexed-color BMPs?", "a": "Supported. 1-bit, 4-bit, and 8-bit palette BMPs convert to indexed-color PNGs preserving the original palette."},
    ],
    "gif-to-jpg": [
        {"q": "What about animated GIFs?", "a": "Only the first frame is converted. To extract every frame as JPGs, use a dedicated GIF frame extractor — coming soon to PrivaTools."},
        {"q": "Will transparency be preserved?", "a": "No — JPG doesn't support transparency. Transparent pixels in the source GIF become white in the JPG."},
        {"q": "Why convert GIF to JPG anyway?", "a": "GIFs are limited to 256 colors and can be larger than JPGs of the same single frame. JPG is ideal when you only need a static still and want smaller file size."},
    ],
    "gif-to-png": [
        {"q": "What about animated GIFs?", "a": "Only the first frame is converted to PNG. For animated GIFs, consider converting to a video format like MP4 or WebM using our GIF to MP4 tool."},
        {"q": "Will transparency be preserved?", "a": "Yes — PNG fully supports transparency, so transparent areas of the GIF come through cleanly."},
        {"q": "Is the conversion lossless?", "a": "Yes. Both GIF and PNG are lossless formats, so the first frame is reproduced pixel-perfectly."},
    ],
    "m4a-to-mp3": [
        {"q": "Why convert M4A to MP3?", "a": "M4A (AAC inside an MP4 container) isn't universally supported — older car stereos, some Android players, and many legacy devices won't play it. MP3 works everywhere."},
        {"q": "Will the audio quality drop?", "a": "Slightly. M4A's AAC codec is more efficient than MP3, so at the same bitrate AAC sounds better. Our 192 kbps default produces a result that's indistinguishable from the source for casual listening."},
        {"q": "Does it work for iPhone voice memos?", "a": "Yes — voice memos export as M4A and convert cleanly to MP3 here."},
    ],
    "mp4-to-mp3": [
        {"q": "Does this work for any MP4?", "a": "Yes — as long as the MP4 has an audio track. Music videos, lecture recordings, podcasts, screen recordings with narration, all work."},
        {"q": "What about file size?", "a": "MP3 audio is dramatically smaller than the original video. A 1 GB video file typically becomes a 5–15 MB MP3."},
        {"q": "Is the video kept?", "a": "No — only the audio track is extracted. If you also need the video, keep the original MP4."},
    ],
    "mov-to-mp4": [
        {"q": "Why convert MOV to MP4?", "a": "MOV is Apple's QuickTime format. While Macs play it natively, Windows, Android, and most streaming platforms prefer MP4. The codecs inside are often identical (H.264), so conversion is fast and lossless."},
        {"q": "Will I lose quality?", "a": "Usually no — when streams are compatible, we remux the file (no re-encoding), preserving the original bytes exactly. If re-encoding is needed, we use high-quality settings."},
        {"q": "Does it preserve audio?", "a": "Yes. The audio track (typically AAC) is kept intact."},
    ],
    "avi-to-mp4": [
        {"q": "Why convert AVI to MP4?", "a": "AVI is an old Microsoft container with poor support for modern codecs and metadata. MP4 is the universal standard — every modern device, browser, and editor plays it."},
        {"q": "What if my AVI uses DivX or Xvid?", "a": "FFmpeg re-encodes the video to H.264 inside the MP4 container, so any source codec is handled."},
        {"q": "Will the file get bigger or smaller?", "a": "Usually similar or smaller. Old AVIs often used inefficient codecs; modern H.264 typically achieves the same quality at a smaller size."},
    ],
    "webm-to-mp4": [
        {"q": "Why convert WebM to MP4?", "a": "WebM (VP8/VP9 codecs) isn't supported on iOS Safari, older Android, or in many editing programs. MP4 with H.264 is universal."},
        {"q": "Does the audio survive?", "a": "Yes. WebM's Opus or Vorbis audio is re-encoded to AAC inside the MP4 container."},
        {"q": "Will I lose quality?", "a": "Re-encoding always sacrifices a tiny amount of quality, but at high bitrates the result is visually identical to the source."},
    ],
    "mp4-to-webm": [
        {"q": "Why convert MP4 to WebM?", "a": "WebM uses VP9, which is royalty-free and often produces smaller files than H.264 at the same quality. Ideal for hosting video on the open web."},
        {"q": "Will every browser play it?", "a": "Every modern desktop browser plays WebM. Safari on iOS supports it from iOS 16 onward. For maximum compatibility, MP4 is still safer."},
        {"q": "How much smaller will it be?", "a": "Typically 20–40% smaller than the equivalent MP4 at the same visible quality."},
    ],
    "yaml-to-json": [
        {"q": "Is it 100% in my browser?", "a": "Yes. The YAML never leaves your device — no server roundtrip, no logs, no analytics on the content."},
        {"q": "Which YAML features are supported?", "a": "All common config features: scalars, lists, nested maps, quoted strings, comments, multi-line strings, and flow-style arrays and objects. Anchors, tags, and multi-doc streams are not supported — those are rare in practice."},
        {"q": "What if my YAML has a parse error?", "a": "The error message appears in the output area with line context. Fix the YAML and the conversion updates instantly."},
    ],
    "json-to-yaml": [
        {"q": "Is it 100% in my browser?", "a": "Yes. The JSON never leaves your device — pure-browser conversion, no upload."},
        {"q": "Will it format the YAML correctly?", "a": "Yes — proper indentation (2 spaces), keys with special characters get quoted, lists get the bullet-point style by default. Output is ready to paste into a Kubernetes or GitHub Actions file."},
        {"q": "What if the JSON is invalid?", "a": "An error appears in the output area. Fix the JSON and the conversion updates live."},
    ],
    "case-converter": [
        {"q": "Which case formats are supported?", "a": "12: lowercase, UPPERCASE, Title Case, Sentence case, camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case, path/case, and iNVERSE."},
        {"q": "Will it handle existing camelCase or snake_case input correctly?", "a": "Yes. The tool detects word boundaries from underscores, hyphens, spaces, and lowercase→uppercase transitions, so converting between any two cases works correctly."},
        {"q": "Does it run in my browser?", "a": "Yes — 100%. Your text never leaves the page. Useful for renaming variables, generating CSS class names, or normalizing identifiers without exposing them to a server."},
    ],
    "cron-parser": [
        {"q": "Does it support Quartz cron with seconds?", "a": "No. This tool intentionally supports standard 5-field cron because that is what Linux crontab, many schedulers, and most deployment platforms use."},
        {"q": "Which timezone is used for next runs?", "a": "Your browser's local timezone. The expression itself is not uploaded or evaluated on the server."},
        {"q": "Can it validate ranges and steps?", "a": "Yes. It catches invalid ranges, bad steps, out-of-bounds values, and expressions with the wrong number of fields."},
    ],
    "sql-formatter": [
        {"q": "Is this a full SQL parser?", "a": "No. It is a lightweight formatter for readable query cleanup. It does not execute, optimize, or validate SQL against a database schema."},
        {"q": "Will my query be uploaded?", "a": "No. Formatting happens in browser JavaScript, which is useful for production query snippets and private table names."},
        {"q": "Which SQL dialects work?", "a": "Common SELECT, JOIN, WHERE, GROUP BY, ORDER BY, INSERT, UPDATE, and DELETE syntax formats well across Postgres, MySQL, SQLite, and similar dialects."},
    ],
    "graphql-formatter": [
        {"q": "Does it need my GraphQL schema?", "a": "No. The formatter only structures the query text and does not introspect or validate against a schema."},
        {"q": "Can it format mutations and fragments?", "a": "Yes. Queries, mutations, fragments, arguments, arrays, and nested selection sets are handled."},
        {"q": "Is it private?", "a": "Yes. The GraphQL text is formatted locally in your browser."},
    ],
    "yaml-toml-converter": [
        {"q": "Are YAML anchors and custom tags supported?", "a": "No. The converter is designed for common app config: nested maps, strings, numbers, booleans, and simple arrays."},
        {"q": "Will comments be preserved?", "a": "No. Comments are omitted during conversion because TOML and YAML comments do not map cleanly through a simple object representation."},
        {"q": "Does it upload config files?", "a": "No. Conversion runs locally in your browser."},
    ],
    "gitignore-generator": [
        {"q": "Does it call the toptal/gitignore API?", "a": "No. The templates are bundled in the app so the generator works offline and does not leak your selected stack."},
        {"q": "Can I combine multiple templates?", "a": "Yes. Select any combination and the generated .gitignore groups each template under a comment header."},
        {"q": "Can I download the file directly?", "a": "Yes. You can copy the text or download a .gitignore file from the browser."},
    ],
    "semver-bumper": [
        {"q": "Does it handle prerelease versions?", "a": "Yes. Versions like 1.2.3-beta.1 are accepted, and the prerelease bump increments the trailing number when present."},
        {"q": "Does it edit package.json?", "a": "No. It only calculates version strings so you can copy the value into your release workflow."},
        {"q": "What rules does it follow?", "a": "Patch increments the third number, minor increments the second and resets patch, major increments the first and resets minor and patch."},
    ],
    "env-validator": [
        {"q": "Does this replace secret scanning?", "a": "No. It is a fast syntax and hygiene check. Use dedicated secret scanning before committing any real credentials."},
        {"q": "Will it reveal my secrets to PrivaTools?", "a": "No. The .env text stays in browser memory and is never sent to the backend."},
        {"q": "What checks are included?", "a": "Missing equals signs, invalid variable names, duplicate keys, empty values, unquoted spaces, and short-looking secret values."},
    ],
    "json-to-csv-schema": [
        {"q": "How are nested objects handled?", "a": "Nested keys are flattened with dot notation, such as user.email or billing.address.city."},
        {"q": "What schema is inferred?", "a": "The tool infers simple column types: empty, boolean, number, date, or string, plus value coverage per column."},
        {"q": "Does large JSON get uploaded?", "a": "No. Parsing, schema inference, and CSV generation all run in your browser."},
    ],
    # ── Phase 7 — competitor-gap tools (v1.5.0) ──────────────────────────
    "mute-video": [
        {"q": "Is the video quality preserved?", "a": "100% — we stream-copy the video track without re-encoding. The output is bit-identical to the input minus the audio stream."},
        {"q": "Will the file get smaller?", "a": "Yes, by the size of the audio track. For typical MP4s that's 5-15% smaller. The video portion is unchanged."},
        {"q": "Can I just mute the audio instead of removing it?", "a": "This tool removes the audio track entirely. To replace with silence, use Video Converter and pick MP4 — that will re-encode and let you control audio."},
    ],
    "reverse-video": [
        {"q": "Why is reversing slow?", "a": "Reversing requires re-encoding the whole video — FFmpeg has to read every frame, store them, then write them out in reverse order. RAM usage grows with video length."},
        {"q": "Will the audio sound weird?", "a": "Yes — speech becomes gibberish but music can sound interesting. The audio is reversed with the video so they stay in sync."},
        {"q": "What's a good use case?", "a": "Reverse-loop animations, training analysis (replay a fall or trick backwards), creative edits, debugging frame-by-frame issues."},
    ],
    "video-speed": [
        {"q": "Will fast-forward make voices sound chipmunky?", "a": "No — we use FFmpeg's atempo filter which pitch-corrects audio. A 2× speedup sounds like fast speech, not a chipmunk."},
        {"q": "What's the maximum slowdown / speedup?", "a": "0.25× (4× slower) to 4× (4× faster). Beyond that the audio quality degrades noticeably and most viewers can't follow."},
        {"q": "Does it work for slow-motion footage?", "a": "Sort of — for true high-quality slow-motion you need video captured at higher FPS originally. This tool stretches the existing frames in time, so very slow speeds get a duplicated-frame look."},
    ],
    "audio-trim": [
        {"q": "How precise are the start/end times?", "a": "To 1-second precision via stream-copy. For frame-accurate trimming, use the Trim Media tool which re-encodes."},
        {"q": "Will trimming reduce audio quality?", "a": "No — we use stream-copy mode which preserves the original bytes. The trimmed file is identical quality to the source."},
        {"q": "What format does it output?", "a": "Same format as input. Trim an MP3 → get an MP3. Trim a FLAC → get a FLAC. No re-encoding."},
    ],
    "image-palette": [
        {"q": "How are the colors picked?", "a": "We downsize the image to 400×400 for speed, then run a fast octree quantization to find the N most-dominant colors. Percentages are based on pixel coverage."},
        {"q": "Will it find the brand color from a logo?", "a": "Usually yes — logos have a few dominant colors that octree picks up well. For logos on white backgrounds, asking for 6 colors typically gives 1 white + the actual brand colors."},
        {"q": "Can I get more than 24 colors?", "a": "Not in this tool — beyond 24 the palette becomes too noisy to be useful. For full palette analysis, export the image to a design tool."},
    ],
    "pixelate-image": [
        {"q": "Pixelate vs blur — which should I use?", "a": "Pixelate is reversible (depixelization attacks can sometimes recover content) but reads clearly as 'censored'. Blur is harder to reverse but can look like a normal photo defect. For true privacy on serious content, use both: blur first then pixelate."},
        {"q": "Can I select a specific region?", "a": "This tool applies the effect to the whole image. For region-selective censoring, upload to an image editor first (e.g. our Edit PDF for documents) and white-out or rectangle over the area."},
        {"q": "Does the original get stored?", "a": "No — your image is processed in an isolated Docker container and deleted the moment the response is returned."},
    ],
    "rotate-image": [
        {"q": "Will rotation lose quality?", "a": "For 90°/180°/270° rotations no — they're lossless transpositions of pixels. Arbitrary angles re-sample using bicubic interpolation which is visually near-lossless but technically introduces sub-pixel smoothing."},
        {"q": "Why is my output bigger than the input?", "a": "For non-90° angles, the rotated rectangle no longer fits in the original bounding box. The canvas auto-expands so the whole rotated image is visible (corners get transparent/white padding)."},
        {"q": "Does PNG/WEBP transparency carry over?", "a": "Yes — the alpha channel is preserved, and rotated corners are transparent (not white) for PNG and WEBP. For JPG the corners get white since JPG has no alpha."},
    ],
    "flip-image": [
        {"q": "Horizontal vs vertical — when do I use which?", "a": "Horizontal flip mirrors left↔right — the most common use is fixing selfies that come out mirrored. Vertical flip turns the image upside down — used for design layouts or correcting scans that were placed face-down."},
        {"q": "Does flipping change the file size?", "a": "Effectively no — flipping is a pure pixel rearrangement, so the encoded output is similar in size to the input (sometimes 1-3% larger because compression heuristics work slightly differently on the new orientation)."},
        {"q": "Is metadata preserved?", "a": "We strip EXIF orientation hints on save, so the saved image bytes match what you see. If you need the original metadata kept, use Remove EXIF + this tool together."},
    ],

    # ── Auto-generated content for v1.3.1 SEO coverage push ──────────────
    "add-attachment": [
        {"q": "What's the difference between an attachment and embedding?", "a": "An attachment is a file stored inside the PDF that the reader can open separately. Embedding means inlining content (images, fonts) into the page itself. Use attachments when you want recipients to access the supporting file but keep the visible PDF clean."},
        {"q": "Will email clients flag attached PDFs as suspicious?", "a": "No, attachments inside a PDF aren't visible to email gateway scanners as separate attachments — the file is part of the PDF structure. Most spam filters don't flag them."},
        {"q": "How big can the embedded file be?", "a": "Up to the 500 MB total file limit. The PDF size grows by approximately the embedded file's size."},
    ],
    "add-hyperlinks": [
        {"q": "Can I link to other pages in the same PDF?", "a": "Currently the tool supports external URLs. For internal page jumps, use the Bookmarks tool instead."},
        {"q": "Are the links visible to the user?", "a": "The clickable rectangle is invisible by default. To add visible underlined link text, use the Edit PDF tool to draw the underline first."},
        {"q": "Will hyperlinks survive printing or PDF/A conversion?", "a": "Hyperlinks don't print (they're interactive annotations) but they're preserved through most PDF/A conversions. PDF/A-1a strips them; PDF/A-2 keeps them."},
    ],
    "add-shapes": [
        {"q": "Are shapes flattened into the page?", "a": "Yes — shapes become part of the page's content stream, not annotations. They can't be moved or deleted afterwards without re-editing the PDF."},
        {"q": "Can I draw filled or only outlined shapes?", "a": "Both. Set fillColor for a filled shape; omit it and only the stroke renders. Set both for an outlined fill."},
        {"q": "What about transparency?", "a": "Use a color with alpha (e.g., rgba(255,0,0,0.5)) or pass an opacity value (0–1)."},
    ],
    "alternate-mix": [
        {"q": "When would I use this?", "a": "The classic case is double-sided scanning on a single-sided scanner: scan the odd pages, flip the stack, scan the even pages in reverse, then alternate-mix them with reverse-alternate."},
        {"q": "What if the PDFs have different page counts?", "a": "PrivaTools alternates pages until one source is exhausted, then appends the remaining pages from the longer source at the end."},
        {"q": "Does this preserve bookmarks?", "a": "No. Bookmarks from the originals are dropped because they would point to incorrect pages after interleaving."},
    ],
    "annotate-pdf": [
        {"q": "Are annotations flattened?", "a": "By default no — they remain as editable annotations. If you want them permanently baked into the page, run the Flatten tool afterwards."},
        {"q": "Can I attach sticky-note comments?", "a": "Yes. Add a note annotation with author + content; readers display it as an icon that opens a popup with the text on click."},
        {"q": "Do annotations survive PDF/A conversion?", "a": "Some do (text, highlight, square) but interactive ones (file attachments, popup notes) get flattened or stripped depending on the PDF/A profile."},
    ],
    "auto-crop": [
        {"q": "Will this make text run off the page?", "a": "No — the algorithm leaves a small safety margin around detected content. If a page has no content (blank), the original MediaBox is kept."},
        {"q": "What if my PDF has different page sizes after scanning?", "a": "Auto-crop computes the bounding box per-page, so pages are independently cropped to their own content."},
        {"q": "Will this affect printing?", "a": "After auto-crop, printing produces a smaller paper size. If you need the same paper size with less margin, use the Resize tool afterwards."},
    ],
    "bates-numbering": [
        {"q": "What's Bates numbering used for?", "a": "Sequential page identification across legal discovery documents. Each page in a production gets a unique identifier so attorneys can reference exact pages."},
        {"q": "Can I start the numbering at a value other than 1?", "a": "Yes — set start_number to any positive integer. This is the standard workflow for continuing a numbering scheme across multiple production batches."},
        {"q": "Does it survive redaction?", "a": "Yes — Bates numbers are stamped directly onto the page content, so they remain after redaction (unless the redaction rectangle covers them)."},
    ],
    "bmp-to-pdf": [
        {"q": "Why is the output PDF so much smaller than the BMPs?", "a": "BMP is uncompressed; PDF stores images in DCT (JPEG) or Flate format. A 5 MB BMP usually becomes a few hundred KB inside the PDF."},
        {"q": "Will quality degrade?", "a": "By default the conversion is near-lossless using high-quality JPEG. For 100% lossless, convert via PNG first (PNG-to-PDF) — slightly larger output."},
        {"q": "How many BMPs can I convert at once?", "a": "Up to the 500 MB total file limit. Several dozen images is routine."},
    ],
    "booklet-pdf": [
        {"q": "Why is the order so strange?", "a": "Saddle-stitch binding folds the sheets in half — the front cover of sheet 1 carries pages 8 and 1, the back carries pages 2 and 7. The math is fixed by binding geometry."},
        {"q": "What if my page count isn't a multiple of 4?", "a": "PrivaTools pads with blank pages at the end before computing the imposition order, so the booklet always works."},
        {"q": "Can I use this for thick books?", "a": "Saddle-stitch caps at about 80 pages (20 sheets) because the inner pages start to creep. For longer documents use perfect binding (no imposition needed)."},
    ],
    "compare-pdf": [
        {"q": "Does this work on scanned PDFs?", "a": "Only with OCR. Run OCR PDF on both files first so the text layer is present, then compare."},
        {"q": "How accurate is the text diff?", "a": "Word-level diff handles reordering, insertion, deletion, and formatting changes. Diffs based on character runs would be noisier."},
        {"q": "Can I compare more than two files?", "a": "Run Compare twice (A vs B, then B vs C) to chain a multi-revision comparison."},
    ],
    "crop-pdf": [
        {"q": "Difference between Crop and Auto-Crop?", "a": "Crop uses your manual margins (same on every page). Auto-Crop detects each page's actual content bounding box automatically."},
        {"q": "Will the cropped content be deleted from the file?", "a": "No — only the visible region changes. The full page content is still in the file. To permanently remove the cropped data, run Flatten or Sanitize afterwards."},
        {"q": "How do I undo a crop?", "a": "Re-open the PDF in PrivaTools Crop with negative margins to expand the box, or run Flatten which bakes the current crop in."},
    ],
    "delete-annotations": [
        {"q": "Will this remove form fields too?", "a": "Yes — form fields are a type of annotation. To preserve form structure but clear values, use the Fill Form tool with empty values instead."},
        {"q": "Are hyperlinks deleted?", "a": "Yes — hyperlinks are link annotations. Use this to make a PDF completely 'read-only' as a static document."},
        {"q": "Does this remove signatures?", "a": "Yes, signature annotations are removed too — which invalidates the cryptographic signature."},
    ],
    "delete-pages": [
        {"q": "What happens to bookmarks pointing to deleted pages?", "a": "They're either dropped or rewritten to the nearest remaining page, depending on outline structure. The Bookmarks tool can be used afterwards to clean them up."},
        {"q": "Can I delete page ranges?", "a": "Yes — use ranges like '5-12'. Mix single pages and ranges freely."},
        {"q": "Will the page numbers update?", "a": "Visible page numbers (added with the Page Numbers tool) stay as they were rendered. The internal page indices reflect the new order."},
    ],
    "deskew-pdf": [
        {"q": "My scans look fine — should I run deskew?", "a": "If the text appears tilted by more than ~0.5°, deskew helps OCR accuracy noticeably. For perfectly straight scans it's a no-op."},
        {"q": "Will deskew add white margins?", "a": "Yes — rotated pages need a slightly larger canvas. PrivaTools fills the margins with the surrounding background color (usually white)."},
        {"q": "Should I deskew before or after OCR?", "a": "Always before. OCR engines are much more accurate on straight-line text."},
    ],
    "esign-pdf": [
        {"q": "Is this a cryptographically valid signature?", "a": "No — this places a visual signature image, like signing paper. For cryptographically verifiable signatures, use the Sign PDF tool with a certificate."},
        {"q": "Does my signature image stay on PrivaTools?", "a": "No. It's used only to render the output PDF and is deleted immediately afterwards."},
        {"q": "Can I use a signature image I already have?", "a": "Yes — upload a transparent PNG of your signature instead of drawing one."},
    ],
    "excel-to-pdf": [
        {"q": "Will my formulas be visible?", "a": "No — only computed values appear. The formulas themselves are not included (PDF has no formula concept)."},
        {"q": "What about charts and images?", "a": "Charts render as static images. Embedded images are preserved at their original size."},
        {"q": "How does it handle very wide sheets?", "a": "Wide sheets paginate across multiple PDF pages, with column headers repeated on each."},
    ],
    "extract-images": [
        {"q": "Will the images be the original resolution?", "a": "Yes. PDF embeds images at the resolution set when the PDF was created — extraction recovers them unchanged."},
        {"q": "What if the same image appears multiple times?", "a": "Each visual occurrence is extracted, even if it's the same underlying image data. Use deduplication after if needed."},
        {"q": "Does it work on scanned PDFs?", "a": "Yes — each page of a scanned PDF is one big image. The tool extracts that page-image directly."},
    ],
    "extract-pages": [
        {"q": "How is this different from Delete Pages?", "a": "Extract keeps the listed pages; Delete removes them. They're complementary — use whichever produces less typing."},
        {"q": "Can I extract pages into separate files?", "a": "For one-file-per-page splitting, use the Split PDF tool with 'individual' mode."},
        {"q": "Does this preserve bookmarks?", "a": "Bookmarks pointing to kept pages are preserved; those pointing to dropped pages are removed."},
    ],
    "fill-form": [
        {"q": "How do I know what the form field names are?", "a": "Use the /api/fill-form/fields endpoint (or paste-then-inspect): PrivaTools returns the list of field names, types, and current values without filling anything."},
        {"q": "Can I flatten the filled form?", "a": "Yes — run the Flatten tool afterwards to bake the values into the page content so they can't be edited."},
        {"q": "Does this work on signed forms?", "a": "Filling a signed form invalidates the signature. Sign last, after filling."},
    ],
    "gif-to-pdf": [
        {"q": "Do animated GIFs animate inside the PDF?", "a": "No — PDF doesn't support animation. Only the first frame is used. To convert animation to PDF, use GIF to MP4 then Video to PDF for keyframes."},
        {"q": "How is transparency handled?", "a": "GIF transparent pixels render against a white page background. Use PNG-to-PDF if you need true alpha."},
        {"q": "Can the GIF stay as a GIF inside the PDF?", "a": "PDF doesn't natively support GIF — the image is re-encoded as JPEG or Flate during embedding."},
    ],
    "grayscale-pdf": [
        {"q": "Will text still be searchable?", "a": "Yes — the text layer is preserved. Only the rendered visuals change to grayscale."},
        {"q": "Why convert to grayscale?", "a": "Cheaper printing on black-and-white printers, smaller file size, accessibility for color-blind readers, archival storage."},
        {"q": "How does this differ from black-and-white?", "a": "Grayscale preserves shading (256 grey levels). True black-and-white (1-bit) is harsher but smaller — not currently offered as a separate option."},
    ],
    "header-footer": [
        {"q": "Will the header/footer overlap existing content?", "a": "It might if your pages have content close to the edges. Use the Crop or Resize tool first to add margin space if needed."},
        {"q": "Can I exclude the cover page?", "a": "Pages-to-affect parameter accepts ranges like '2-' to skip the first page or '2-N-1' to skip first + last."},
        {"q": "Are these editable annotations or baked-in?", "a": "Baked into the page content. They can't be removed without re-editing — use Whiteout to cover them if needed later."},
    ],
    "heic-to-pdf": [
        {"q": "Will the PDF be much larger than the HEIC?", "a": "Yes — HEIC is more efficient than JPEG. The PDF uses JPEG internally and is typically 2-3x the size of the source HEICs."},
        {"q": "Does this preserve image quality?", "a": "Default JPEG quality is 90, which is visually indistinguishable. Lossless would require PNG-to-PDF and produce much larger files."},
        {"q": "What happens to GPS metadata?", "a": "Stripped during conversion. Use View EXIF first if you want to record GPS coordinates before they're gone."},
    ],
    "invert-colors": [
        {"q": "Why would I invert colors?", "a": "Dark-mode reading on tablets, contrast-flipped scanning of light text on dark backgrounds, or accessibility for users sensitive to bright whites."},
        {"q": "Will the text still be searchable after?", "a": "Inverted pages become images, so the text layer is lost. To preserve searchability, OCR the inverted PDF afterwards."},
        {"q": "Can I invert only certain pages?", "a": "Currently inversion applies to all pages. Run Extract Pages → Invert → Merge to apply selectively."},
    ],
    "jpg-to-pdf": [
        {"q": "Will my photos lose quality?", "a": "Quality is preserved — JPGs are embedded as-is into the PDF (no re-encoding pass). The PDF wrapper adds about 5% overhead on top of the original JPG sizes. PNG inputs are also embedded losslessly."},
        {"q": "Can I reorder the photos before conversion?", "a": "Yes — drag the thumbnails to your desired order before clicking Convert. Add page breaks between groups for chapter-style organization."},
        {"q": "Does this preserve EXIF metadata?", "a": "GPS and camera EXIF metadata are stripped by default for privacy (so the recipient can't see your home location or device model). PDF-level metadata like title and author can be set separately with the Update Metadata tool after conversion."},
        {"q": "Is it safe to upload sensitive photos?", "a": "Yes. The photos are held in temporary per-request storage inside an isolated Docker container for the conversion pass only — both the input JPGs and the output PDF are unlinked the moment your download begins. Nothing is logged, no thumbnail is kept, no copy is sent to any third-party API. The conversion code is open source."},
        {"q": "Can I batch convert dozens of photos at once?", "a": "Yes — drop as many as you want into the upload zone. All become pages in a single PDF (drag to reorder before clicking Convert). For very large batches you can split into multiple PDFs or use the Image to PDF generic tool for finer control."},
        {"q": "Can I control the page size and orientation?", "a": "Yes. Choose A4, Letter, or fit-to-image (where each page matches its source image dimensions exactly). Set landscape or portrait, and pick margin presets (none, small, medium, large) or specify custom margins in millimeters or inches."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no cap on the number of photos you can combine."},
        {"q": "How is this different from iLovePDF or Smallpdf JPG to PDF?", "a": "Free with no daily limit (iLovePDF caps free use, Smallpdf restricts to 2 tasks/day), no account required, and no watermark on the output. The conversion code is open source and self-hostable, so you can run it on your own infrastructure if you handle particularly sensitive imagery."},
    ],
    "markdown-to-pdf": [
        {"q": "Are images included?", "a": "Local image references in the Markdown are inlined if they're in the same upload; remote URLs are fetched at render time."},
        {"q": "Can I customize the styling?", "a": "Not yet — the default style is GitHub-inspired (clean serif body, monospace code). Custom CSS is on the roadmap."},
        {"q": "Does it handle code-block syntax highlighting?", "a": "Yes — fenced code blocks with language hints get tokenized and colored (Python, JS, SQL, Bash, etc.)."},
    ],
    "metadata": [
        {"q": "What metadata does a typical PDF carry?", "a": "At minimum: producer (the software that created it) and creation date. Often also: author name, original filename, software version. Scanned PDFs may carry scanner model + driver."},
        {"q": "Why does this matter for privacy?", "a": "Producer + Creator + Author fields can identify the person or machine that created a document — useful in forensics, problematic for whistleblowers."},
        {"q": "Is XMP metadata shown too?", "a": "Yes — both the Info dictionary (old format) and XMP stream (new format) are inspected."},
    ],
    "nup": [
        {"q": "Why is this called 'N-up'?", "a": "Print-industry terminology: '2-up' = 2 pages per sheet, '4-up' = 4 per sheet, etc. Saves paper and ink for review prints."},
        {"q": "Are page numbers preserved?", "a": "Original page numbers (rendered on the page) shrink with the page. Add new page numbers afterwards if you need them readable."},
        {"q": "What aspect ratio works best?", "a": "2-up and 8-up work well for landscape, 4-up and 9-up for portrait. Mismatches add whitespace around each sub-page."},
    ],
    "odt-to-pdf": [
        {"q": "What about ODT-specific features (math equations, drawings)?", "a": "OpenDocument math (Formula) and drawings render correctly as the LibreOffice converter handles them natively."},
        {"q": "Will fonts that aren't on the server cause problems?", "a": "Missing fonts get substituted. Embedded fonts in the ODT are honored."},
        {"q": "Does it handle macros?", "a": "Macros are not executed — only the static document content is converted."},
    ],
    "organize-pages": [
        {"q": "Can I rotate individual pages independently?", "a": "Yes — each thumbnail has its own rotate button. Rotations are 90° clockwise / counter-clockwise / 180°."},
        {"q": "How is this different from Extract Pages?", "a": "Extract keeps a subset in original order. Organize lets you reorder, duplicate, rotate, and delete all in one pass."},
        {"q": "Does it preserve bookmarks?", "a": "Bookmarks targeting deleted pages are removed; targeting reordered pages, they follow to the new position."},
    ],
    "overlay": [
        {"q": "What's the difference between overlay and merge?", "a": "Merge concatenates files page-by-page. Overlay composites pages on top of each other — useful for adding letterheads, watermarks-from-PDF, or repeating templates."},
        {"q": "Can I overlay only some pages?", "a": "By default it applies cycle-wise: if the overlay has 3 pages and the base has 10, the overlay repeats. For one-time overlay, use a base + overlay of equal length."},
        {"q": "Does transparency work?", "a": "Yes — PDF supports transparency and the overlay's alpha is honored. White rectangles still cover what's beneath; transparent regions show base content through."},
    ],
    "page-numbers": [
        {"q": "Can I use Roman numerals or letters?", "a": "Currently Arabic digits only. Roman / alpha numbering is on the roadmap."},
        {"q": "How is this different from Bates numbering?", "a": "Page numbers are simple sequential digits. Bates numbers have a prefix, configurable padding, and are used in legal contexts."},
        {"q": "Can I start from a specific page?", "a": "Yes — pages-to-affect lets you specify a starting page (e.g. exclude cover + TOC)."},
    ],
    "pdf-to-bmp": [
        {"q": "Why are BMPs so much larger than PNG?", "a": "BMP stores every pixel uncompressed. PNG losslessly compresses to ~20% the size. Use BMP only when you specifically need uncompressed pixel data."},
        {"q": "What's BMP good for?", "a": "Legacy Windows software that doesn't support modern formats; embedded systems; precise pixel manipulation."},
        {"q": "Can I get just one page as BMP?", "a": "Extract that page first with Extract Pages, then convert."},
    ],
    "pdf-to-epub": [
        {"q": "How accurate is the EPUB compared to the PDF?", "a": "Text and basic structure transfer well. Complex multi-column layouts, footnotes, and figure captions may need cleanup in calibre."},
        {"q": "Does it preserve images?", "a": "Yes — embedded images are included as EPUB resources at original resolution."},
        {"q": "Will the table of contents work?", "a": "If the PDF has bookmarks, they become the EPUB's TOC. Without bookmarks, the TOC is built from detected headings."},
    ],
    "pdf-to-gif": [
        {"q": "Will the GIFs look good?", "a": "GIF's 256-color palette quantizes the page. Text remains readable but gradients and photos show banding. Use PNG for higher quality."},
        {"q": "Does this make an animated GIF?", "a": "No — each page is one static GIF. To make a flipbook-style animation, use Video to GIF after converting to images and back."},
        {"q": "How big are the output files?", "a": "Typically 30-100 KB per page at 96 DPI."},
    ],
    "pdf-to-jpg": [
        {"q": "Why JPG instead of PNG?", "a": "JPG is smaller for photos and scanned content (typically 5-10x smaller at quality 85). Use PDF-to-PNG if your PDF has crisp text or graphics where JPEG compression artifacts would show as ringing around letter edges."},
        {"q": "What about transparency?", "a": "JPG doesn't support transparency. White pages render as white; PDF transparent regions become white in JPG. For transparency, use PDF-to-PNG instead."},
        {"q": "How long does it take?", "a": "Roughly 50-100 ms per page at 150 DPI on the server. A 100-page PDF takes ~10 seconds end-to-end. Higher DPI (300+) increases time proportionally."},
        {"q": "Is it safe to convert a confidential PDF?", "a": "Yes. The PDF and the generated JPGs are held in temporary per-request storage inside an isolated Docker container for the conversion pass only — both are unlinked the moment your download begins. Nothing is logged or sent to any third-party API. The conversion uses PyMuPDF/poppler locally."},
        {"q": "What DPI should I use?", "a": "96 DPI for web preview/thumbnails, 150 DPI for general on-screen viewing (default), 300 DPI for printable copies, 600 DPI for archival. Higher DPI = larger files. For social-media sharing, 150 DPI is typically more than enough."},
        {"q": "Can I convert just specific pages?", "a": "Yes. Enter individual page numbers or ranges (e.g. 1-3, 7, 12-15). Each selected page becomes one JPG. Single-page selections return as a single JPG; multi-page selections come as a ZIP."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. There is no cap on the number of pages — every page becomes one JPG and they're bundled into a ZIP."},
        {"q": "How is this different from iLovePDF PDF to JPG?", "a": "Free with no daily limit (iLovePDF caps free use to 2 tasks/day), no account required, and no watermark on the output JPGs. The conversion is the same poppler-based pipeline used by Linux distributions, just exposed without a paywall."},
    ],
    "pdf-to-markdown": [
        {"q": "How accurate is the structural detection?", "a": "Headings work well when source fonts are larger. Tables transfer if cells are clearly separated. Code-block detection is a heuristic — manual review recommended."},
        {"q": "What about images?", "a": "Images are extracted to a sibling folder and referenced by Markdown image syntax."},
        {"q": "Will hyperlinks be preserved?", "a": "Yes — PDF hyperlinks become Markdown links."},
    ],
    "pdf-to-png": [
        {"q": "Why PNG instead of JPG?", "a": "PNG is lossless — text and graphics stay crisp. JPG compresses better for photos but introduces compression artifacts on text."},
        {"q": "How big are the PNGs?", "a": "Roughly 200-500 KB per page at 150 DPI for typical text content; up to 2-3 MB at 300 DPI."},
        {"q": "Does this preserve PDF transparency?", "a": "PDF transparency layers flatten during rasterization but the result PNG has alpha if the PDF page had transparent regions over the page background."},
    ],
    "pdf-to-pptx": [
        {"q": "Will the text be editable in PowerPoint?", "a": "The extracted text overlay is editable. The underlying page image stays as a backdrop. For pixel-perfect editing, you may need to remove the backdrop and rebuild from the text."},
        {"q": "What about embedded charts and graphics?", "a": "They appear as part of the page image. Re-creating editable charts requires manual recreation in PowerPoint."},
        {"q": "Can I get one slide per section instead of per page?", "a": "Not directly — use Extract Pages to isolate the sections first, then convert."},
    ],
    "pdf-to-tiff": [
        {"q": "Why TIFF for archival?", "a": "TIFF supports lossless compression (LZW, Deflate) and is the format of choice for long-term preservation in libraries and government archives."},
        {"q": "Single multi-page TIFF or one per page?", "a": "Default is multi-page TIFF for compact archiving. Use the per-page option for compatibility with software that only reads single-page TIFFs."},
        {"q": "Does it preserve text searchability?", "a": "TIFF is raster only — the text layer is lost. Use Sanitize PDF or PDF/A for archive while keeping text searchable."},
    ],
    "pdfa-validator": [
        {"q": "What is PDF/A and why does it matter?", "a": "PDF/A is an ISO standard for long-term archival. It requires self-contained PDFs (all fonts embedded, no external scripts, no encryption) so the document will render identically in 50 years."},
        {"q": "What's the difference between PDF/A-1, A-2, A-3?", "a": "A-1 is the strictest (no transparency, no XFA forms). A-2 adds transparency, JPEG 2000, and PDF attachments. A-3 allows arbitrary file attachments — useful for invoice + machine-readable data bundles."},
        {"q": "If it's not PDF/A, can I convert it?", "a": "Yes — use the PDF to PDF/A tool which fixes the most common issues automatically (font embedding, color profile attachment)."},
    ],
    "png-to-pdf": [
        {"q": "Will the PDF be larger than the PNGs?", "a": "Roughly the same — PNGs are already losslessly compressed, and PDF embeds them with minimal overhead."},
        {"q": "How is transparency handled?", "a": "Transparent PNGs render over a white background. If you need true alpha through, use the Image to PDF generic tool with the keep-alpha option."},
        {"q": "Is there a max number of images?", "a": "Practical limit is around 100 images per conversion before browser upload time becomes inconvenient. Backend limit is 500 MB total."},
    ],
    "pptx-to-pdf-convert": [
        {"q": "Will animations be preserved?", "a": "PDF doesn't support animation. Each slide renders in its initial state. For animation, export to video first."},
        {"q": "How are speaker notes handled?", "a": "Notes are not included in the PDF by default. We don't currently offer a 'with notes' option but it's on the roadmap."},
        {"q": "What about embedded videos?", "a": "Videos render as a poster frame (the first frame). Use Extract Audio + Video to PDF for video-centric conversion."},
    ],
    "qr-code": [
        {"q": "Can I customize colors?", "a": "Currently black-on-white only. Custom colors and logos in the center are on the roadmap."},
        {"q": "How do I encode a URL with parameters?", "a": "Just paste the full URL. Special characters are encoded automatically inside the QR."},
        {"q": "What's the maximum data I can encode?", "a": "Around 2,500 alphanumeric characters or 4,000 numeric digits at error correction level L. Higher EC levels reduce capacity."},
    ],
    "remove-blank-pages": [
        {"q": "How does it detect 'blank'?", "a": "Each page is rendered to a low-res raster and analysed for pixel density. Pages with less than (100 - sensitivity)% non-white pixels are marked for removal."},
        {"q": "Will pages with only a page number get deleted?", "a": "Depends on sensitivity. At sensitivity 95 (default), pages with isolated tiny content like page numbers are kept. At sensitivity 80, they may be removed."},
        {"q": "What if a page has only a watermark?", "a": "The watermark counts as content. Use sensitivity 99 to only remove pages with no content at all."},
    ],
    "repair-pdf": [
        {"q": "What kinds of damage can it fix?", "a": "Missing or corrupt cross-reference tables, broken trailers, dangling object references, slightly-truncated streams. Cannot recover from missing object data."},
        {"q": "Will the repaired PDF look identical?", "a": "Yes if the damage was in metadata/structure. Visible content damage (cropped images, missing fonts) requires the original to fix."},
        {"q": "Can it merge two damaged PDFs?", "a": "Repair each separately first, then use Merge."},
    ],
    "resize-pdf": [
        {"q": "Will my content be cropped if I resize to a smaller page?", "a": "No — content scales proportionally. If you want to crop instead, use the Crop tool."},
        {"q": "Difference between Resize and Crop?", "a": "Resize changes the page dimensions (scales content). Crop changes the visible region without scaling."},
        {"q": "Does this affect text quality?", "a": "Text is vector-based in PDFs, so it scales perfectly. Only embedded raster images can lose quality on extreme upscale."},
    ],
    "reverse-pdf": [
        {"q": "When would I use this?", "a": "Most common: rescue a scan where pages came out in reverse order. Also: countdown PDFs (10, 9, 8…), reverse-chronological logs."},
        {"q": "Are bookmarks updated?", "a": "Yes — bookmarks pointing to page N are rewritten to point to page (total - N + 1)."},
        {"q": "Will visible page numbers update?", "a": "Page numbers stamped with the Page Numbers tool are part of page content; they don't auto-update. Reverse first, then re-add page numbers."},
    ],
    "rtf-to-pdf": [
        {"q": "What about RTF features like fields?", "a": "Calculated fields (page numbers, dates) render as their current values. Form fields aren't converted to PDF form fields — use Form Creator for that."},
        {"q": "Does it preserve fonts?", "a": "Fonts referenced in the RTF are matched to server-installed fonts. Missing fonts fall back to a close visual equivalent."},
        {"q": "How does this differ from DOCX-to-PDF?", "a": "RTF is an older Microsoft format. DOCX is a newer ZIP-based format. Both convert similarly but DOCX preserves more layout fidelity."},
    ],
    "sanitize-pdf": [
        {"q": "What is sanitization protecting against?", "a": "Malicious PDFs that exploit reader vulnerabilities through embedded scripts or auto-launching attachments. Most modern readers are hardened against these, but defense in depth is wise."},
        {"q": "Does this remove form fields?", "a": "No — form fields are kept (just JavaScript actions on them are stripped). Use Flatten or Delete Annotations to remove form structure."},
        {"q": "Are hyperlinks removed?", "a": "Plain http/https links are kept. Links using non-web URI schemes (file:, mailto: with auto-execute, etc.) are stripped."},
    ],
    "set-permissions": [
        {"q": "What's the difference between owner password and user password?", "a": "User password = required to OPEN. Owner password = required to override permissions (print, edit). Use Protect PDF for both; this tool sets only the owner password + permission flags."},
        {"q": "How strong is the protection?", "a": "It's enforced by readers as a courtesy — Adobe Acrobat respects it strictly, some open-source readers ignore it. For real security, encrypt with a user password."},
        {"q": "Can users still copy text?", "a": "Only if allow_copy is true. If false, the reader disables text selection. Note: screenshots still work (no PDF protection can prevent that)."},
    ],
    "split-by-bookmarks": [
        {"q": "What if the PDF has no bookmarks?", "a": "The tool returns an error. Use the regular Split tool or the new Split by Text tool which doesn't need bookmarks."},
        {"q": "Does it use nested sub-bookmarks?", "a": "No — only top-level bookmarks define split points. Sub-sections stay within their parent chapter PDF."},
        {"q": "Can I include the bookmark title as the PDF title?", "a": "Each output PDF inherits its starting bookmark's title as the file name. The internal PDF Title metadata is set to match."},
    ],
    "stamp-pdf": [
        {"q": "Are stamps editable annotations or baked-in?", "a": "Baked into the page content. They survive copying, printing, and PDF/A conversion. To remove, use Whiteout to cover them."},
        {"q": "Can I apply a stamp to only specific pages?", "a": "Yes — pages parameter accepts page ranges like '1-3' or 'all'."},
        {"q": "How big is the stamp?", "a": "Auto-sized to roughly 60% of page width with the chosen opacity for visibility without obscuring content."},
    ],
    "strip-metadata": [
        {"q": "Why strip metadata?", "a": "Author / producer / original-filename fields can identify who created or owns a document — a privacy concern for whistleblowers, journalists, or before public release."},
        {"q": "What about embedded images' EXIF?", "a": "Image-level EXIF inside PDF embedded images is also stripped. The image pixel data is unchanged."},
        {"q": "Is this the same as Sanitize?", "a": "No — Strip Metadata removes informational fields. Sanitize removes security-risky elements (JavaScript, auto-launch attachments)."},
    ],
    "svg-to-pdf": [
        {"q": "Will my SVG stay as vector inside the PDF?", "a": "Yes — PDF natively supports vector content, so paths, text, and gradients remain editable at any zoom level."},
        {"q": "What about embedded raster images inside SVG?", "a": "Embedded raster images (data URLs, external image refs) are preserved as raster within the PDF."},
        {"q": "Does it handle CSS styles inside SVG?", "a": "Standard SVG CSS (fill, stroke, opacity, transform) is honored. External stylesheet refs are inlined first."},
    ],
    "tiff-to-pdf": [
        {"q": "Will quality be preserved?", "a": "Yes — TIFF is lossless. PDF uses Flate (lossless) or JPEG (near-lossless) when embedding. Default is high-quality JPEG to keep file size reasonable."},
        {"q": "What about CMYK TIFFs (for print)?", "a": "CMYK is preserved through to the PDF. Use this workflow for prepress / professional printing pipelines."},
        {"q": "How are multi-page TIFFs handled?", "a": "Each TIFF page becomes a PDF page in order. Multiple multi-page TIFFs in one upload are concatenated."},
    ],
    "transparent-background": [
        {"q": "Will text be affected?", "a": "Black text is preserved. Light grey or low-contrast text near the threshold may become semi-transparent — lower the threshold (e.g. 220) to be more aggressive about preserving content."},
        {"q": "What's the output format?", "a": "PDF with transparent regions where the background was. Open in a reader to see the underlying canvas show through."},
        {"q": "Can I use this on photos?", "a": "It works best on text/diagram documents with clean backgrounds. Photos with light skies become weirdly transparent — use Remove Background (rembg) for photos."},
    ],
    "verify-signature": [
        {"q": "Does this require uploading my certificates?", "a": "No — verification uses the certificates embedded in the PDF itself, plus the system's trusted CA store."},
        {"q": "What if a signature is invalid?", "a": "The report says exactly why: content modified, certificate expired, untrusted issuer, or signature format unsupported. The PDF itself isn't rejected — just the signature."},
        {"q": "Can I verify multiple signatures?", "a": "Yes — PDFs can have multiple signatures (e.g. one per signing party). All are verified independently."},
    ],
    "webp-to-pdf": [
        {"q": "Will the PDF be much smaller than from JPG?", "a": "Slightly smaller — WebP-derived JPEGs inside PDF are similar to direct JPGs. The main benefit was at upload time (smaller WebP files)."},
        {"q": "What about animated WebP?", "a": "Only the first frame is used. PDF doesn't support animation."},
        {"q": "Does this preserve transparency?", "a": "PDF supports transparency but most readers render text-on-transparency oddly. We default to compositing over white for best compatibility."},
    ],
    "whiteout-pdf": [
        {"q": "Is whiteout the same as redaction?", "a": "No — whiteout covers content visually but the underlying text remains in the file. For permanent redaction (text removed), use Redact PDF or Smart Redact."},
        {"q": "Can I use any color, not just white?", "a": "Yes — color is configurable. Black for blackout style, white for whiteout, any custom hex color for matching background."},
        {"q": "Does it work on scanned PDFs?", "a": "Yes — the cover rectangle is added on top of the rendered page. Behind, the original pixels are still in the file."},
    ],
    "add-subtitles": [
        {"q": "Should I burn-in or use a soft subtitle track?", "a": "Burn-in: best for social media (Twitter, Instagram) where players don't render subtitle tracks. Soft: best for accessibility — viewers can turn off."},
        {"q": "What subtitle formats are supported?", "a": "Input: SRT. Burn-in output: works in any video player. Soft track: MP4 with WebVTT or MKV with SRT — depending on output format."},
        {"q": "Can I customize the font / size / color?", "a": "Currently uses sensible defaults (white text with black outline, sans-serif). Custom styling is on the roadmap."},
    ],
    "audio-merge": [
        {"q": "What if my files have different sample rates?", "a": "FFmpeg resamples to a common rate (usually 44.1 kHz) automatically. There may be a tiny re-encoding loss; for lossless concatenation use FLAC inputs."},
        {"q": "Are gaps between tracks added?", "a": "No — files are concatenated seamlessly. To add silence, prepare it as a separate file with the same format and insert it in the order."},
        {"q": "Maximum total length?", "a": "Practical limit is whatever fits inside the 500 MB output. Hours of MP3 at moderate bitrate is fine."},
    ],
    "color-converter": [
        {"q": "Does it work with alpha (transparency)?", "a": "Yes — paste #RRGGBBAA or rgba(...) and the alpha channel is preserved across all output formats."},
        {"q": "Why does my CMYK look different from print?", "a": "CMYK conversion uses a sRGB → CMYK approximation. For exact print color, use your printer's color profile."},
        {"q": "Is the calculation done locally?", "a": "Yes — pure browser JavaScript. No network requests."},
    ],
    "create-zip": [
        {"q": "Can I password-protect the ZIP?", "a": "Not yet. Create ZIP currently produces standard unencrypted ZIP archives; password-protected ZIP creation is on the roadmap."},
        {"q": "Will it preserve folder structure?", "a": "Uploaded files are placed at the root of the archive. To preserve a folder structure, upload them folder-by-folder using the multi-folder option."},
        {"q": "What compression level should I choose?", "a": "Balanced is best for most files. Store is fastest for already-compressed files like JPG, MP4, and PDF. Maximum can shrink text-heavy files more but takes longer."},
    ],
    "csv-json": [
        {"q": "How does CSV escaping work?", "a": "Standard RFC 4180: commas in values must be quoted; quotes inside values are doubled (\"\"). PrivaTools handles both."},
        {"q": "What about nested JSON?", "a": "Nested objects are flattened to dot-notation columns (user.name, user.email) for CSV output. Reverse direction reconstructs the nesting."},
        {"q": "Will my data be uploaded?", "a": "No — pure-browser conversion. No data leaves your machine."},
    ],
    "extract-archive": [
        {"q": "What about password-protected archives?", "a": "Password-protected archives are not supported yet. Extract Archive currently handles unencrypted ZIP and TAR-family archives; encrypted archive support is on the roadmap."},
        {"q": "Does it support RAR / 7z?", "a": "No. Extract Archive currently supports ZIP and TAR-family archives (.tar, .tar.gz, .tar.bz2, .tar.xz). RAR and 7z support is on the roadmap."},
        {"q": "What if the archive contains many small files?", "a": "Up to 1000 files per archive. For larger, split before zipping."},
    ],
    "extract-audio": [
        {"q": "Will quality be preserved?", "a": "WAV/FLAC are lossless. MP3/AAC at 192 kbps+ is transparent for most listeners. Lower bitrates lose quality."},
        {"q": "What if the video has multiple audio tracks?", "a": "PrivaTools extracts the first/default audio track. Multi-track extraction is on the roadmap."},
        {"q": "Can I extract just a section of the audio?", "a": "Use Trim Media first to isolate the section, then extract audio from the trimmed video."},
    ],
    "generate-barcode": [
        {"q": "What barcode type for a URL?", "a": "Use QR code — barcodes like Code 128 work for text but are much wider for the same content."},
        {"q": "Will it scan reliably?", "a": "Yes — barcodes are rendered at the standard 2D module size. Printed at 100% on a regular printer, any standard scanner reads them."},
        {"q": "Can I include a check digit?", "a": "EAN-13 and UPC-A auto-calculate the check digit. Code 128 has a built-in checksum. Code 39 supports optional checksums."},
    ],
    "generate-favicon": [
        {"q": "Do I need all those sizes?", "a": "Yes — different browsers and devices use different sizes (16×16 for tabs, 192×192 for Android home screen, 512×512 for PWA install)."},
        {"q": "Should I use PNG or SVG source?", "a": "SVG is best — it stays sharp at every size. PNG works if you only have a raster logo. JPG loses some sharpness from compression."},
        {"q": "Will my logo become circular?", "a": "No — favicons render exactly as uploaded. To get a circular look, upload a circular PNG with transparency."},
    ],
    "gif-to-mp4": [
        {"q": "Why convert GIF to MP4?", "a": "MP4 is dramatically smaller (better compression), supports audio, and plays smoother. Most social platforms now auto-convert uploaded GIFs to MP4 anyway."},
        {"q": "Will the loop work in MP4?", "a": "MP4 doesn't have built-in loop info — players decide. Embed with <video loop autoplay muted> to mimic GIF behavior on the web."},
        {"q": "Does it preserve transparency?", "a": "MP4 doesn't support transparency. Transparent pixels render against a black background. Use WebM with VP9 if you need alpha."},
    ],
    "hash-generator": [
        {"q": "Is MD5 safe to use?", "a": "For non-security purposes (file integrity, deduplication): yes. For security (passwords, signatures): no — MD5 is broken. Use SHA-256 or SHA-512."},
        {"q": "Why are file hashes useful?", "a": "Verifying file integrity after download, deduplication, change detection, content-addressed storage."},
        {"q": "Is the hash calculation done in the browser?", "a": "Yes — Web Crypto API runs the hash in your browser. Files are not uploaded."},
    ],
    "image-converter": [
        {"q": "Which format is best for what?", "a": "PNG for graphics with transparency or crisp text/UI elements. JPG for photos (smaller files at near-identical quality). WebP for web delivery (smaller than JPG at the same quality, supported by all modern browsers). TIFF for archival or print workflows. HEIC for iPhone-style storage (limited compatibility outside Apple). AVIF for cutting-edge web (smallest of all, but newer browsers only)."},
        {"q": "Does it preserve EXIF metadata?", "a": "EXIF is stripped during conversion by default for privacy (GPS, camera model, timestamps removed). Use View EXIF first to record any metadata you want to keep, or use the 'preserve metadata' toggle in advanced options if your destination workflow needs the original EXIF."},
        {"q": "Can I batch-convert?", "a": "Yes — upload multiple images and all are converted to the chosen format, then bundled into a ZIP. For format-specific batch workflows you can also use the dedicated tools (jpg-to-png, heic-to-jpg, webp-to-png, etc.) which preselect the input/output formats."},
        {"q": "Is it safe to convert sensitive images?", "a": "Yes. The images are held in temporary per-request storage inside an isolated Docker container for the conversion pass only — both input and output are unlinked the moment your download begins. Nothing is logged, no thumbnail is kept, no copy is sent to any third-party API. The conversion uses libvips/Pillow locally."},
        {"q": "What's the file size limit?", "a": "500 MB per file with no daily or monthly quota. Maximum image dimensions are 100 megapixels (about 10000x10000 pixels) — sufficient for full-resolution DSLR RAW conversions."},
        {"q": "Will I lose quality?", "a": "Format-to-format quality depends on the codec. PNG → PNG, PNG → TIFF: lossless. JPG → PNG, HEIC → PNG: lossless (no re-encoding). JPG → JPG at quality 90+: imperceptibly lossy. JPG → WebP at quality 80: typically indistinguishable. Avoid stacked lossy conversions (JPG → JPG → JPG) which compound artifacts."},
        {"q": "Do I need an account?", "a": "No — no account, no email, no sign-up. Upload, convert, download. Privacy guarantees are architectural."},
        {"q": "How is this different from iLovePDF Image Converter or Convertio?", "a": "Free with no daily limit (Convertio caps free use to 100 MB/day), no account required, no watermark on the output, and we support more formats than the freemium converters (HEIC, AVIF, JPEG XL in addition to the standard set). The conversion pipeline is open source and self-hostable."},
    ],
    "image-ocr": [
        {"q": "How accurate is the OCR?", "a": "Tesseract handles clean printed text very well (98%+). Handwriting, low-resolution, or low-contrast images are harder."},
        {"q": "Should I preprocess the image first?", "a": "Deskew helps a lot for tilted scans. Convert to grayscale doesn't help (Tesseract converts internally)."},
        {"q": "What about handwriting?", "a": "Tesseract is trained on print. Use a specialized handwriting OCR for cursive."},
    ],
    "image-watermark": [
        {"q": "Can I watermark with an image instead of text?", "a": "Currently text-only watermarks. Image watermarks (logo overlay) are on the roadmap."},
        {"q": "Is the watermark removable?", "a": "Depends on placement. Watermarks over high-detail areas are harder to remove than over solid backgrounds. AI inpainting tools can sometimes erase them — for stronger protection, use diagonal repeating patterns."},
        {"q": "Does it affect image quality?", "a": "Negligibly. Output is at the same JPEG quality as input."},
    ],
    "json-xml-formatter": [
        {"q": "Will it validate the input?", "a": "Yes — invalid JSON / XML shows an error with the line and column. Common errors (trailing commas, unclosed strings, mismatched tags) are highlighted."},
        {"q": "Can it convert JSON ↔ XML?", "a": "This tool only formats. For conversion, paste into the CSV/JSON converter or use a dedicated converter."},
        {"q": "Is the indent customizable?", "a": "Yes — 2 spaces, 4 spaces, or tabs."},
    ],
    "lorem-ipsum": [
        {"q": "Why use Lorem Ipsum and not English?", "a": "It has roughly Latin letter frequencies so designs feel real, without distracting reviewers with the actual content. English placeholder text always gets read instead of looked at."},
        {"q": "Can I get other languages?", "a": "Cyrillic, Greek, Arabic, and CJK placeholder texts are on the roadmap."},
        {"q": "Is it copyrighted?", "a": "Cicero died in 43 BC. Public domain."},
    ],
    "make-collage": [
        {"q": "Will images be resized?", "a": "Each image is scaled to fit its grid cell while preserving aspect ratio. To force same aspect ratio, crop them first with Resize Crop Image."},
        {"q": "Can I rearrange the images?", "a": "Drag in the upload area to reorder. They fill left-to-right, top-to-bottom."},
        {"q": "What's the max grid size?", "a": "Tested up to 100 images. Output JPEG can be up to 30,000 pixels wide before browser limits."},
    ],
    "markdown-html": [
        {"q": "What about extensions like tables and code blocks?", "a": "GitHub-flavored Markdown extensions are supported in both directions: tables, fenced code, strikethrough, task lists."},
        {"q": "Will inline CSS be preserved?", "a": "Conversion is opinionated — visible content keeps semantics, but custom CSS is stripped. For a faithful HTML→PDF, use the Markdown-to-PDF tool instead."},
        {"q": "Is the conversion lossless?", "a": "HTML → Markdown can lose nesting fidelity (deeply-nested divs flatten). Markdown → HTML is exact."},
    ],
    "merge-images": [
        {"q": "Will images be cropped?", "a": "No — they're scaled to a common dimension (width for vertical, height for horizontal). Smaller images upscale; larger images downscale."},
        {"q": "What if my images have different aspect ratios?", "a": "They get letterboxed (transparent padding) to fit. Use Resize Crop Image first to force a common aspect ratio."},
        {"q": "Difference from Make Collage?", "a": "Merge concatenates in a single row or column. Collage arranges in a grid with configurable columns."},
    ],
    "password-generator": [
        {"q": "How strong is the password?", "a": "Length 20 with mixed classes ≈ 130 bits of entropy — uncrackable by brute force. Length 12 ≈ 78 bits — still very strong."},
        {"q": "Why exclude ambiguous characters?", "a": "Visual confusion: l vs 1 vs I, 0 vs O. Excluding them makes the password easier to type / read aloud at the cost of slightly less entropy."},
        {"q": "Is it really random?", "a": "Yes — Web Crypto's getRandomValues uses the OS's cryptographically secure RNG (e.g. /dev/urandom on Linux, BCryptGenRandom on Windows)."},
    ],
    "qr-reader": [
        {"q": "Can it read damaged QR codes?", "a": "QR codes have built-in error correction (up to 30%). Slightly damaged codes still read; heavily damaged ones fail."},
        {"q": "Multiple QR codes in one image?", "a": "All detected QR codes are returned with their position. Useful for batch scanning of labels."},
        {"q": "What about other barcode types?", "a": "pyzbar also reads Code 128, Code 39, EAN-13, UPC-A, etc. The decoder identifies the type automatically."},
    ],
    "resize-crop-image": [
        {"q": "Should I resize or crop?", "a": "Resize when you want to keep the entire image. Crop when you have a specific aspect ratio target (e.g. social media banner)."},
        {"q": "Will upscaling lose quality?", "a": "Some sharpness loss is unavoidable when upscaling. For 2x or 4x enlargement with AI smoothing, use Image Upscaler."},
        {"q": "Can I pick the crop position?", "a": "Currently crop is centered. Drag-to-crop with a custom anchor is on the roadmap."},
    ],
    "subtitle-converter": [
        {"q": "What's the difference between SRT and VTT?", "a": "SRT: simplest. VTT (WebVTT): used by HTML5 <track>, supports styling. ASS (Advanced SubStation Alpha): rich styling like karaoke colors, but less compatible."},
        {"q": "Will styling carry over?", "a": "SRT → VTT: yes. VTT → SRT: styling is stripped (SRT has no style support). ASS → SRT: styling lost; text and timing preserved."},
        {"q": "Is my subtitle file uploaded?", "a": "No — pure browser conversion."},
    ],
    "svg-to-png": [
        {"q": "Why convert SVG to PNG?", "a": "PNG is universally supported (email, legacy apps, social media uploads). SVG can break in tools that don't render it (Gmail, some Slack clients)."},
        {"q": "How large should the output be?", "a": "For social media: 1200×630 (use Resize Crop Image after). For app icons: 1024×1024 base. For web retina: 2x your design size."},
        {"q": "Does it preserve transparency?", "a": "Yes — SVG transparency translates to PNG alpha. The PNG is fully alpha-channel."},
    ],
    "url-encoder": [
        {"q": "What's the difference between URL encoding and base64?", "a": "URL encoding only escapes characters that have special meaning in URLs. Base64 encodes any binary as ASCII (longer but binary-safe). Use Base64 for arbitrary data."},
        {"q": "Why decode a JWT here?", "a": "All in your browser — never paste a real production JWT into a server-side decoder. The standalone JWT Decoder tool shows expiry and claim details too."},
        {"q": "Will the encoded URL be browser-safe?", "a": "Yes — outputs only ASCII-safe chars (alphanumeric + - _ . ~ % escapes)."},
    ],
    "url-to-pdf": [
        {"q": "Will JavaScript-rendered content show up?", "a": "WeasyPrint doesn't execute JS — only the server-rendered HTML is converted. For JS-heavy SPAs (React, Vue), use the site's print stylesheet or a server-side rendered version."},
        {"q": "Can I convert pages behind a login?", "a": "Not currently — only public pages. Authenticated capture is on the roadmap."},
        {"q": "Does it use my browser cookies?", "a": "No — the fetch is server-side from a clean session. Anonymous, no cookies."},
    ],
    "uuid-generator": [
        {"q": "What's the difference between v4 and v7?", "a": "v4 is purely random — unsortable. v7 (new in 2024) embeds a timestamp prefix so UUIDs sort chronologically. Use v7 for database primary keys."},
        {"q": "How likely is a collision?", "a": "v4 collision after generating 2^61 ≈ 2.3 quintillion UUIDs. Practically impossible."},
        {"q": "Are they cryptographically random?", "a": "v4 uses Web Crypto's getRandomValues — yes, cryptographically secure."},
    ],
    "video-converter": [
        {"q": "Which format to choose?", "a": "MP4: most compatible. WebM: smaller, used for web embedding. MOV: works in Apple ecosystem and Final Cut. MKV: open-source flexible container."},
        {"q": "Will quality suffer?", "a": "FFmpeg uses sensible default bitrates that preserve visual quality. For lossless conversion (rare), use the MKV output."},
        {"q": "How long does it take?", "a": "Roughly real-time on the server (a 2-minute video = ~2 minutes to convert)."},
    ],
    "video-merge": [
        {"q": "Do the videos need the same resolution?", "a": "PrivaTools resizes inputs to a common resolution (the smallest source). For pixel-perfect quality, pre-resize all sources to the same dimensions first."},
        {"q": "What about audio-less videos?", "a": "Silent audio is added (anullsrc) for missing tracks so concatenation succeeds."},
        {"q": "Can I add a transition between clips?", "a": "Not currently — clips are concatenated directly. Crossfade transitions are on the roadmap."},
    ],
    "video-resizer": [
        {"q": "Will upscaling improve quality?", "a": "No — upscaling can't add detail. Use it to match a target resolution, not to improve quality."},
        {"q": "Does this re-encode the audio?", "a": "Audio is copied unchanged when possible (saves time, no quality loss)."},
        {"q": "Can I crop to a different aspect ratio?", "a": "Not directly — the resizer preserves aspect ratio. For aspect-ratio crops, use a video editor."},
    ],
    "video-thumbnail": [
        {"q": "How do I find a good thumbnail moment?", "a": "Trial and error — try different timestamps to find a visually interesting frame. For automated 'best' selection, use Video to PDF and pick from the keyframe samples."},
        {"q": "What resolution will the PNG be?", "a": "Same as the source video's resolution. Use Resize Crop Image after if you need a specific size for social media."},
        {"q": "Can I extract multiple thumbnails at once?", "a": "Yes — Video to PDF extracts multiple keyframes and lays them out as PDF pages."},
    ],
    "video-to-pdf": [
        {"q": "Why convert video to PDF?", "a": "Storyboarding, content moderation review, video summarisation for accessibility, lecture notes from recorded talks."},
        {"q": "Can I get just keyframes (scene changes)?", "a": "Evenly-spaced frames are the default. Smart scene-change detection is on the roadmap."},
        {"q": "What resolution are the frames?", "a": "Native video resolution. The PDF page size matches."},
    ],
    "word-counter": [
        {"q": "What counts as a word?", "a": "Whitespace-separated tokens. Hyphenated words ('self-host') count as one. Apostrophes ('don't') keep the word as one."},
        {"q": "How is reading time calculated?", "a": "Word count ÷ 200 words per minute (average adult reading speed for non-fiction). Adjust for technical content (slower) or casual reading (faster)."},
        {"q": "Is my text saved?", "a": "No — everything runs in your browser and persists only in this session."},
    ],
}


# Phase 2 conversion aliases share the same proven converter backends as the
# existing image/audio/video format tools, so generate consistent HowTo + FAQ
# coverage instead of hand-writing near-identical blocks 26 times.
_P2_FORMAT_ALIAS_CONTENT: tuple[tuple[str, str, str, str, str], ...] = (
    ("jpg-to-tiff", "JPG to TIFF", "a JPG or JPEG image", "a TIFF image", "image"),
    ("png-to-tiff", "PNG to TIFF", "a PNG image", "a TIFF image", "image"),
    ("webp-to-tiff", "WebP to TIFF", "a WebP image", "a TIFF image", "image"),
    ("jpg-to-bmp", "JPG to BMP", "a JPG or JPEG image", "a BMP image", "image"),
    ("png-to-bmp", "PNG to BMP", "a PNG image", "a BMP image", "image"),
    ("webp-to-bmp", "WebP to BMP", "a WebP image", "a BMP image", "image"),
    ("mp3-to-wav", "MP3 to WAV", "an MP3 audio file", "a WAV audio file", "audio"),
    ("wav-to-mp3", "WAV to MP3", "a WAV audio file", "an MP3 audio file", "audio"),
    ("flac-to-mp3", "FLAC to MP3", "a FLAC audio file", "an MP3 audio file", "audio"),
    ("ogg-to-mp3", "OGG to MP3", "an OGG audio file", "an MP3 audio file", "audio"),
    ("aac-to-mp3", "AAC to MP3", "an AAC audio file", "an MP3 audio file", "audio"),
    ("mp3-to-ogg", "MP3 to OGG", "an MP3 audio file", "an OGG audio file", "audio"),
    ("mp3-to-flac", "MP3 to FLAC", "an MP3 audio file", "a FLAC audio file", "audio"),
    ("mp3-to-aac", "MP3 to AAC", "an MP3 audio file", "an AAC audio file", "audio"),
    ("wav-to-flac", "WAV to FLAC", "a WAV audio file", "a FLAC audio file", "audio"),
    ("wav-to-ogg", "WAV to OGG", "a WAV audio file", "an OGG audio file", "audio"),
    ("mkv-to-mp4", "MKV to MP4", "an MKV video file", "an MP4 video file", "video"),
    ("mp4-to-mov", "MP4 to MOV", "an MP4 video file", "a MOV video file", "video"),
    ("mov-to-webm", "MOV to WebM", "a MOV video file", "a WebM video file", "video"),
    ("mkv-to-webm", "MKV to WebM", "an MKV video file", "a WebM video file", "video"),
    ("mp4-to-avi", "MP4 to AVI", "an MP4 video file", "an AVI video file", "video"),
    ("avi-to-webm", "AVI to WebM", "an AVI video file", "a WebM video file", "video"),
    ("webm-to-mov", "WebM to MOV", "a WebM video file", "a MOV video file", "video"),
    ("mov-to-mkv", "MOV to MKV", "a MOV video file", "an MKV video file", "video"),
    ("webm-to-gif", "WebM to GIF", "a WebM video file", "an animated GIF", "gif"),
    ("mov-to-gif", "MOV to GIF", "a MOV video file", "an animated GIF", "gif"),
)


# Per-slug bespoke FAQ for the format-alias converters. Without these, every
# converter in a media-kind cluster (image/audio/video/gif) renders a
# byte-identical template FAQ — a near-duplicate "doorway" pattern Google
# declines to index. Each entry answers the REAL technical distinction of that
# specific conversion (lossy vs lossless, container vs codec, format use) so the
# 26 pages read as genuinely different from one another.
_ALIAS_FAQ_OVERRIDES: dict[str, list[dict[str, str]]] = {
    # ── Image ──────────────────────────────────────────────────────────
    "jpg-to-tiff": [
        {"q": "Does converting JPG to TIFF improve quality?", "a": "No. JPG is already lossy, and TIFF stores those exact pixels without further loss — but it cannot recover detail JPG discarded. Convert when a workflow (archival, print, scanning, OCR) needs a lossless/uncompressed container, not to 'upscale' a JPG."},
        {"q": "Why is the TIFF so much larger than the JPG?", "a": "TIFF is uncompressed or losslessly compressed, so a 2 MB JPG can become 20–40 MB. That's expected — you trade file size for a lossless, edit- and print-friendly format."},
        {"q": "Is the conversion private?", "a": "Yes. It runs on the PrivaTools backend with local image libraries (no third-party API); input and output files are deleted immediately after the response."},
    ],
    "png-to-tiff": [
        {"q": "Is PNG transparency preserved in the TIFF?", "a": "Alpha transparency is preserved where the target TIFF profile supports it. For print/archival TIFF without an alpha channel, transparent areas are flattened to white."},
        {"q": "Why convert PNG to TIFF?", "a": "TIFF is the standard for print prepress, scanning, and long-term archival. PNG→TIFF is lossless, so no image detail is lost in the conversion."},
        {"q": "Are my images uploaded to a third party?", "a": "No. Processing is local to the PrivaTools backend; files are temporary and removed right after download."},
    ],
    "webp-to-tiff": [
        {"q": "Does WebP to TIFF lose quality?", "a": "If your WebP is lossy, TIFF can't restore discarded detail; if it's lossless WebP, the TIFF is pixel-identical. Either way TIFF gives you the lossless container that print and archival tools expect."},
        {"q": "Why not just keep the WebP?", "a": "Many print, scanner, and legacy desktop applications don't read WebP at all. TIFF is universally supported by those workflows."},
        {"q": "Is it processed privately?", "a": "Yes — local conversion on the PrivaTools backend, with input and output deleted immediately after the response."},
    ],
    "jpg-to-bmp": [
        {"q": "Why convert JPG to BMP?", "a": "BMP is an uncompressed bitmap that legacy Windows apps, embedded systems, and some signage/industrial tools require. JPG→BMP decodes to raw pixels (lossless from the JPG) for maximum compatibility."},
        {"q": "Will the BMP be much larger?", "a": "Yes — BMP stores every pixel uncompressed, so expect roughly 5–20× the JPG's size."},
        {"q": "Are files kept after conversion?", "a": "No. Input and output files are temporary and deleted as soon as the download is returned."},
    ],
    "png-to-bmp": [
        {"q": "Is PNG transparency kept in BMP?", "a": "Standard BMP has no alpha channel, so transparent areas are flattened (to white by default). If you need to keep transparency, use PNG→TIFF instead."},
        {"q": "Why convert to BMP?", "a": "For legacy Windows software, embedded displays, and tools that only accept uncompressed bitmap input."},
        {"q": "Is the conversion private?", "a": "Yes — local processing on the PrivaTools backend; files removed immediately after the response."},
    ],
    "webp-to-bmp": [
        {"q": "Why convert WebP to BMP?", "a": "To use a modern WebP image in older software or hardware that only reads uncompressed bitmaps. The BMP is a raw, maximally-compatible copy."},
        {"q": "Is the BMP lossless?", "a": "The BMP is a lossless copy of the decoded WebP pixels; if the source WebP was lossy, those pixels are already final and can't be improved."},
        {"q": "Are uploads retained?", "a": "No. Files are temporary and deleted right after the download response."},
    ],
    # ── Audio ──────────────────────────────────────────────────────────
    "mp3-to-wav": [
        {"q": "Does MP3 to WAV improve sound quality?", "a": "No. MP3 is lossy; WAV just stores that same audio uncompressed. The detail MP3 removed can't be restored — convert when a DAW, CD-authoring, or editing tool requires uncompressed PCM/WAV input."},
        {"q": "Why is the WAV file so big?", "a": "WAV is uncompressed PCM — roughly 10 MB per minute of stereo audio — so a 4 MB MP3 can become around 40 MB."},
        {"q": "Are my audio files stored?", "a": "No. Input and output are temporary and deleted after the download response is sent. Conversion uses FFmpeg server-side."},
    ],
    "wav-to-mp3": [
        {"q": "What bitrate should I choose?", "a": "192 kbps is a solid default; 256–320 kbps is near-transparent for music. MP3 is lossy, so a higher bitrate keeps more detail at the cost of a larger file."},
        {"q": "How much smaller will the MP3 be?", "a": "Typically 5–11× smaller than the WAV, depending on the bitrate you pick."},
        {"q": "Is the conversion private?", "a": "Yes — FFmpeg runs on the PrivaTools backend and the files are deleted immediately after the response."},
    ],
    "flac-to-mp3": [
        {"q": "Will I lose quality converting FLAC to MP3?", "a": "Yes — FLAC is lossless and MP3 is lossy, so the conversion discards some audio data. At 256–320 kbps the difference is inaudible to most people, but it's a one-way trade for a smaller, universally-compatible file."},
        {"q": "Why convert FLAC to MP3 at all?", "a": "MP3 plays on virtually every device and is roughly 3–6× smaller than FLAC — ideal for phones, portable players, and sharing."},
        {"q": "Are files retained?", "a": "No. Uploads and outputs are temporary and removed right after the download."},
    ],
    "ogg-to-mp3": [
        {"q": "Why convert OGG to MP3?", "a": "OGG Vorbis isn't supported by some players, car stereos, and editing apps; MP3 is nearly universal. Both are lossy, so this is about compatibility, not quality."},
        {"q": "Is there quality loss?", "a": "Re-encoding one lossy format to another (transcoding) loses a little quality. Choose 256–320 kbps to keep it minimal."},
        {"q": "Is it processed privately?", "a": "Yes — local FFmpeg conversion; files deleted immediately after the response."},
    ],
    "aac-to-mp3": [
        {"q": "Does AAC to MP3 reduce quality?", "a": "Both are lossy, so transcoding AAC→MP3 loses a little detail. Use 256–320 kbps to keep it near-transparent. Convert for devices that don't support AAC/M4A."},
        {"q": "Why isn't my AAC playing everywhere?", "a": "AAC (often in an .m4a wrapper) has excellent quality-per-byte, but some older or non-Apple devices prefer MP3."},
        {"q": "Are files kept?", "a": "No — temporary input/output, deleted after the download response."},
    ],
    "mp3-to-ogg": [
        {"q": "Will MP3 to OGG sound better?", "a": "No — both are lossy, and the source MP3's lost detail can't be recovered. OGG Vorbis can be slightly more efficient at the same bitrate, which is useful for open-format projects and games."},
        {"q": "Why use OGG?", "a": "It's a royalty-free, open format favored by game engines (Godot, Unity) and open-source software."},
        {"q": "Is the conversion private?", "a": "Yes — local FFmpeg on the PrivaTools backend; files removed after the response."},
    ],
    "mp3-to-flac": [
        {"q": "Does MP3 to FLAC restore lossless quality?", "a": "No. FLAC will losslessly preserve whatever is in the MP3, but it cannot recreate the detail MP3 already discarded — you get a larger file, not better audio. Convert only when a tool specifically requires a lossless container."},
        {"q": "When is MP3 to FLAC actually useful?", "a": "When a workflow or device only accepts FLAC/lossless input, or to archive the file without further generational loss."},
        {"q": "Are files retained?", "a": "No. Uploads and outputs are temporary and deleted after the download."},
    ],
    "mp3-to-aac": [
        {"q": "Is AAC better than MP3?", "a": "AAC generally sounds better than MP3 at the same bitrate, but transcoding an existing MP3 won't recover lost detail — it just repackages it. Use it for Apple/M4A workflows."},
        {"q": "What bitrate should I pick?", "a": "128–256 kbps AAC is typical; AAC is efficient, so 128–192 kbps often matches a higher-bitrate MP3."},
        {"q": "Is it private?", "a": "Yes — local FFmpeg conversion; files deleted immediately after the response."},
    ],
    "wav-to-flac": [
        {"q": "Is WAV to FLAC lossless?", "a": "Yes — FLAC compresses WAV losslessly, typically to 40–60% of the size with zero quality loss. It's the ideal way to archive uncompressed audio."},
        {"q": "Will the FLAC play everywhere?", "a": "FLAC is widely supported on desktops and modern players, but not on every older or portable device. Keep WAV or use WAV→MP3 for those."},
        {"q": "Are files kept?", "a": "No — temporary input/output, removed after the download response."},
    ],
    "wav-to-ogg": [
        {"q": "Why convert WAV to OGG?", "a": "OGG Vorbis produces small, good-quality lossy files in a royalty-free format — handy for games, web audio, and open-source projects, and far smaller than WAV."},
        {"q": "Is OGG lossy or lossless?", "a": "OGG Vorbis here is lossy; pick a quality level that balances size and fidelity. For lossless, use WAV→FLAC instead."},
        {"q": "Is the conversion private?", "a": "Yes — local FFmpeg; files deleted right after the response."},
    ],
    # ── Video ──────────────────────────────────────────────────────────
    "mkv-to-mp4": [
        {"q": "Does MKV to MP4 re-encode the video?", "a": "When the MKV's streams are already MP4-compatible (e.g. H.264/H.265 video + AAC audio), PrivaTools remuxes the container without re-encoding — fast and lossless. Incompatible codecs are re-encoded with sensible defaults."},
        {"q": "Why MP4 instead of MKV?", "a": "MP4 plays natively on phones, browsers, TVs, and editors; MKV is a flexible container but far less universally supported."},
        {"q": "Are videos retained after conversion?", "a": "No. Uploaded videos and outputs are temporary and deleted after the response."},
    ],
    "mp4-to-mov": [
        {"q": "Why convert MP4 to MOV?", "a": "MOV is Apple's QuickTime container, preferred by Final Cut Pro, iMovie, and some macOS/iOS workflows. If the codecs are compatible, the conversion is a fast, lossless remux."},
        {"q": "Is quality lost?", "a": "If it remuxes (same codec), no. If re-encoding is required, defaults target compatibility with minimal visible loss."},
        {"q": "Are files kept?", "a": "No — temporary input/output, deleted after the download."},
    ],
    "mov-to-webm": [
        {"q": "Why convert MOV to WebM?", "a": "WebM (VP9/Opus) is the open format for fast-loading HTML5 video and is well-supported in browsers. MOV→WebM always re-encodes because the codecs differ."},
        {"q": "Will the file get smaller?", "a": "Usually yes — WebM/VP9 is efficient for the web and is often smaller than the source MOV at similar quality."},
        {"q": "Is it processed privately?", "a": "Yes — local FFmpeg on the PrivaTools backend; files removed after the response."},
    ],
    "mkv-to-webm": [
        {"q": "Does MKV to WebM re-encode?", "a": "Often partially — WebM requires VP8/VP9 video and Vorbis/Opus audio, so any stream not already in those codecs is re-encoded. Both are Matroska-based, so the container step itself is straightforward."},
        {"q": "Why convert to WebM?", "a": "To embed open-format video on the web without proprietary codecs."},
        {"q": "Are uploads retained?", "a": "No — temporary files, deleted after the response."},
    ],
    "mp4-to-avi": [
        {"q": "Why convert MP4 to AVI?", "a": "AVI is an older container some legacy editors, players, and devices still require. The conversion re-encodes into an AVI-friendly codec, so expect a larger file than the MP4."},
        {"q": "Will quality drop?", "a": "AVI codecs are less efficient than modern H.264/MP4, so files are larger and re-encoding causes minor loss. Use AVI only when something specifically needs it."},
        {"q": "Are files kept?", "a": "No — temporary input/output, removed after the download response."},
    ],
    "avi-to-webm": [
        {"q": "Why convert AVI to WebM?", "a": "To turn an old AVI clip into a small, web-ready, open-format video. WebM (VP9/Opus) re-encodes the AVI for efficient browser playback."},
        {"q": "Will it shrink the file?", "a": "Usually significantly — modern WebM is far more efficient than typical legacy AVI codecs."},
        {"q": "Is it private?", "a": "Yes — local FFmpeg conversion; files deleted after the response."},
    ],
    "webm-to-mov": [
        {"q": "Why convert WebM to MOV?", "a": "To bring web video into Apple editors (Final Cut, iMovie) that prefer QuickTime/MOV. The codecs differ, so this re-encodes to a MOV-friendly codec like H.264."},
        {"q": "Any quality loss?", "a": "Re-encoding causes minor loss; the defaults target visual parity with the source."},
        {"q": "Are files retained?", "a": "No — temporary files, deleted after the download."},
    ],
    "mov-to-mkv": [
        {"q": "Why convert MOV to MKV?", "a": "MKV is a flexible archival container that can hold multiple audio and subtitle tracks. If the MOV's codecs are MKV-compatible, the conversion remuxes losslessly."},
        {"q": "Is it lossless?", "a": "When remuxing (same codecs), yes — no quality change, just a different container. Incompatible codecs are re-encoded."},
        {"q": "Are uploads kept?", "a": "No — temporary input/output, removed after the response."},
    ],
    # ── Video → GIF ────────────────────────────────────────────────────
    "webm-to-gif": [
        {"q": "Why is the GIF larger than the WebM?", "a": "GIF stores every frame as a separate image and is capped at 256 colors, so it's inefficient — a short WebM can become a much larger GIF. Trim the clip first to keep the size down."},
        {"q": "Will the GIF have sound?", "a": "No — GIF is a silent image-animation format and cannot contain audio."},
        {"q": "What clip length works best?", "a": "Keep it under about 6–10 seconds; longer clips produce very large GIFs."},
    ],
    "mov-to-gif": [
        {"q": "How long should the clip be?", "a": "Short — a few seconds. GIF encodes every frame as an image, so a long MOV becomes a very large GIF. Trim before converting."},
        {"q": "Does the GIF keep audio?", "a": "No — GIF has no audio track. Convert to MP4 or WebM if you need sound."},
        {"q": "Why convert MOV to GIF?", "a": "For short looping clips in chats, docs, and on the web where autoplaying video isn't supported."},
    ],
}


for _slug, _name, _input_label, _output_label, _kind in _P2_FORMAT_ALIAS_CONTENT:
    TOOL_HOWTO.setdefault(_slug, [
        {"name": f"Upload {_input_label}", "text": f"Drop or select {_input_label}. Files are processed by the same local PrivaTools converter used by the main {_kind} tools."},
        {"name": f"Convert to {_output_label}", "text": f"Click Convert. PrivaTools preselects the right output format for {_name}, so there are no extra settings to configure."},
        {"name": f"Download {_output_label}", "text": "The converted file downloads automatically. Temporary input and output files are removed immediately after the response is delivered."},
    ])
    _bespoke_faq = _ALIAS_FAQ_OVERRIDES.get(_slug)
    if _bespoke_faq:
        TOOL_FAQ.setdefault(_slug, _bespoke_faq)
    elif _kind == "image":
        TOOL_FAQ.setdefault(_slug, [
            {"q": "Does this upload to a third-party image service?", "a": "No. The conversion runs on the self-hosted PrivaTools backend with Pillow/libvips-style local processing. Files are not sent to an external conversion API."},
            {"q": "Will image metadata be kept?", "a": "Image conversion strips sensitive metadata by default for privacy, including GPS and camera metadata where present."},
            {"q": "Can I use this for legacy software?", "a": "Yes. TIFF and BMP outputs are included specifically for archive, print, scanner, and older Windows workflows that reject modern formats."},
        ])
    elif _kind == "audio":
        TOOL_FAQ.setdefault(_slug, [
            {"q": "Does conversion improve the original audio quality?", "a": "No conversion can restore detail that was already lost. Use it for compatibility, smaller files, or a required container/codec."},
            {"q": "What engine handles the audio conversion?", "a": "FFmpeg runs server-side with standard codecs for MP3, WAV, OGG, FLAC, and AAC."},
            {"q": "Are audio files stored?", "a": "No. Input and output files are temporary and deleted after the download response is returned."},
        ])
    elif _kind == "gif":
        TOOL_FAQ.setdefault(_slug, [
            {"q": "Can I make a GIF from a long video?", "a": "Short clips work best. GIFs grow quickly because every frame is stored as an image; trim the source first for smaller output."},
            {"q": "Does the GIF include audio?", "a": "No. GIF is an image animation format and cannot contain audio."},
            {"q": "What engine creates the GIF?", "a": "FFmpeg extracts frames from the uploaded video and encodes them as an animated GIF on the PrivaTools backend."},
        ])
    else:
        TOOL_FAQ.setdefault(_slug, [
            {"q": "Will the converted video work everywhere?", "a": "MP4 is the most compatible output. MOV is best for Apple workflows, WebM for web embeds, AVI for legacy devices, and MKV for archival containers."},
            {"q": "Does video conversion reduce quality?", "a": "PrivaTools uses sensible FFmpeg defaults. Some re-encoding is normal when changing containers/codecs, but the defaults target compatibility without obvious quality loss."},
            {"q": "Are videos retained after conversion?", "a": "No. Uploaded videos and converted outputs are temporary and deleted after the response is sent."},
        ])
